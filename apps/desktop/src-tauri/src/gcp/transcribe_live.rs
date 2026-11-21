// gcp/transcribe_live.rs — Gemini 3.5 Transcribe Live over the Vertex AI
// Live API (`BidiGenerateContent`), PoPo's speech-to-text engine.
//
// Replaces the Chirp 3 / Speech-to-Text v2 tonic gRPC path. See
// `docs/GEMINI_TRANSCRIBE_LIVE.md` for the full migration spec; the
// load-bearing facts, repeated here so they can't be lost:
//
//   1. MODEL ID. Vertex serves `gemini-3.5-transcribe-live-preview`.
//      The unsuffixed `gemini-3.5-transcribe-live` is the AI Studio ID
//      and does NOT resolve here. Same class of bug as Session 59's
//      `us-central1` Vertex 404.
//
//   2. LOCATION IS `global` ONLY. Google's regional-availability table
//      lists one location for this model, with "single-region and
//      multi-region support coming soon". Do NOT reuse
//      `gemini::normalize_vertex_location` — that governs Flash-Lite,
//      which genuinely supports global/us/eu. Conflating them is a
//      live footgun.
//
//   3. `setupComplete` IS A HARD GATE. Google: "clients must wait to
//      receive the setup_complete message from the server before
//      streaming audio data. Sending audio requests before
//      setup_complete is received can cause the session to cancel
//      unexpectedly and may result in empty transcriptions,
//      particularly on short audio clips." PoPo dictations ARE short.
//      `open()` therefore does not return until the gate clears. This
//      inverts Session 27's design, which deliberately avoided awaiting
//      stream open because Chirp blocked ~12s on response headers.
//
//   4. SETUP PARAMETERS ARE IMMUTABLE once processed. `mode`,
//      `languageCodes`, and `customVocabulary` all live in `setup`, and
//      all three are things PoPo varies per dictation. One socket
//      therefore cannot switch tier mid-life — hence `SessionConfig`
//      and its fingerprint, which the caller uses to decide whether a
//      warm socket is reusable.
//
//   5. NO SESSION RESUMPTION. Google: "If you need to ensure zero data
//      retention in your application, don't enable session resumption."
//      It works by server-side caching audio and text. Incompatible
//      with PoPo's privacy posture. We reconnect fresh on `goAway`.
//
// Audio format is unchanged from the Chirp era and from what
// `audio/processor.rs` already produces: raw 16-bit PCM, 16 kHz, mono,
// little-endian, in ~100ms chunks. The only new work is base64.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use base64::Engine as _;
use futures::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;

/// Vertex streaming model ID. The `-preview` suffix is required.
pub const MODEL_ID: &str = "gemini-3.5-transcribe-live-preview";

/// The only location this model is served from. Not user-configurable.
pub const STT_LOCATION: &str = "global";

/// Sample rate we advertise in the audio MIME type. Must match what
/// `audio/processor.rs` resamples to.
pub const SAMPLE_RATE: u32 = 16_000;

/// Google accepts up to 1000 `customVocabulary` terms but documents best
/// results under ~100, so the user Dictionary is capped rather than sent
/// unbounded.
pub const MAX_CUSTOM_VOCABULARY: usize = 1_000;

/// How long to wait for `setupComplete` before treating the socket as
/// unusable. Generous because it covers TLS + handshake + model
/// allocation, but bounded so a wedged socket can't hang a dictation.
const SETUP_TIMEOUT: Duration = Duration::from_secs(10);

/// Overall ceiling on collecting the final transcript after
/// `activityEnd`.
const FINISH_TIMEOUT: Duration = Duration::from_secs(15);

/// Once at least one final segment has arrived, wait this long for a
/// possible sibling segment before returning. Mirrors the Chirp-era
/// `collect_final_results` behaviour, where one utterance could produce
/// several `is_final` results.
const FINAL_SETTLE: Duration = Duration::from_millis(300);

/// Upper bound on waiting for the writer task during `close()`. Short,
/// because `close()` runs on the interactive dictation path.
const CLOSE_TIMEOUT: Duration = Duration::from_millis(750);

/// Transcription formatting mode, set in the `setup` message.
///
/// Maps onto PoPo's three-tier routing (spec §3):
///   - `Verbatim` — tier 1 (Auto-format off) and tier 3 (a real mode
///     prompt exists, so Flash-Lite owns all formatting and must
///     receive unedited speech; SEED_MODES v10 FORBIDDEN lists assume
///     raw input).
///   - `Smart` — tier 2 (Auto-format on, no mode prompt). Google does
///     disfluency removal, self-correction resolution, punctuation and
///     casing, and list/number/date formatting inline. No Gemini hop.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TranscribeMode {
    Verbatim,
    Smart,
}

impl TranscribeMode {
    /// Wire value for `inputAudioTranscription.mode`.
    pub fn as_wire(self) -> &'static str {
        match self {
            TranscribeMode::Verbatim => "VERBATIM",
            TranscribeMode::Smart => "SMART",
        }
    }
}

/// Everything that lives in the immutable `setup` message.
///
/// Two sockets are interchangeable if and only if their
/// `SessionConfig`s are equal. `fingerprint()` exists so the warm-socket
/// manager can cheaply compare and log without deep-comparing vocab
/// lists.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionConfig {
    pub mode: TranscribeMode,
    /// Empty = automatic language identification with mid-utterance
    /// code-switching. This is why `Settings.multiLanguageCodes` could
    /// be deleted: Chirp needed an explicit array, this model does not.
    pub language_codes: Vec<String>,
    /// User Dictionary phrases. Up to 1000 accepted, best results under
    /// 100. Unlike Chirp's `PhraseSet` adaptation, this works fine
    /// alongside automatic language detection, so the Session 31
    /// "silently drop the Dictionary when language is auto" workaround
    /// is gone.
    pub custom_vocabulary: Vec<String>,
}

impl SessionConfig {
    /// Stable, cheap identity for warm-socket reuse decisions.
    pub fn fingerprint(&self) -> String {
        // Vocabulary is order-normalised so that a Dictionary reorder
        // (which changes nothing semantically) doesn't needlessly
        // invalidate a warm socket.
        let mut vocab: Vec<&str> = self.custom_vocabulary.iter().map(|s| s.as_str()).collect();
        vocab.sort_unstable();
        format!(
            "{}|{}|{}",
            self.mode.as_wire(),
            self.language_codes.join(","),
            vocab.join(",")
        )
    }
}

/// Fully-qualified publisher model resource for the `setup` message.
pub fn model_resource(project_id: &str, location: &str) -> String {
    format!("projects/{project_id}/locations/{location}/publishers/google/models/{MODEL_ID}")
}

/// WSS endpoint for the Live API bidi service.
///
/// `global` uses the bare host; regional locations are prefixed. Same
/// convention as `gemini::GeminiBackend::endpoint`, kept here rather
/// than shared because the two models have different location sets and
/// must not drift into each other.
pub fn ws_endpoint(location: &str) -> String {
    let host = if location == "global" {
        "aiplatform.googleapis.com".to_string()
    } else {
        format!("{location}-aiplatform.googleapis.com")
    };
    format!("wss://{host}/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent")
}

/// Build the `setup` message. Split out from `open()` so its exact
/// shape is unit-testable without a network or credentials.
pub fn build_setup_message(project_id: &str, location: &str, cfg: &SessionConfig) -> Value {
    let mut transcription = json!({
        "languageCodes": cfg.language_codes,
        "mode": cfg.mode.as_wire(),
    });

    // Omit the key entirely when empty rather than sending [] — fewer
    // assumptions about how the preview API treats an empty list.
    if !cfg.custom_vocabulary.is_empty() {
        transcription["customVocabulary"] = json!(cfg.custom_vocabulary);
    }

    json!({
        "setup": {
            "model": model_resource(project_id, location),
            "generationConfig": { "responseModalities": ["TEXT"] },
            "inputAudioTranscription": transcription,
            // Manual VAD. Google documents this as the push-to-talk
            // case: we own turn boundaries via activityStart/activityEnd
            // rather than letting the server guess from silence.
            "realtimeInputConfig": {
                "automaticActivityDetection": { "disabled": true }
            }
        }
    })
}

/// Parsed server message, normalised so the read loop stays readable.
#[derive(Debug, Clone, PartialEq, Eq)]
enum ServerEvent {
    SetupComplete,
    Interim(String),
    Final(String),
    /// Connection will close within ~60s. Finish the current turn, then
    /// let the manager reopen.
    GoAway,
    /// Something arrived that we don't model. Ignored, but logged.
    Other,
}

/// Classify one inbound JSON frame.
fn parse_server_event(raw: &str) -> ServerEvent {
    let Ok(v) = serde_json::from_str::<Value>(raw) else {
        return ServerEvent::Other;
    };

    if v.get("setupComplete").is_some() {
        return ServerEvent::SetupComplete;
    }
    if v.get("goAway").is_some() {
        return ServerEvent::GoAway;
    }

    if let Some(sc) = v.get("serverContent") {
        if let Some(text) = sc
            .get("inputTranscription")
            .and_then(|t| t.get("text"))
            .and_then(|t| t.as_str())
        {
            if !text.is_empty() {
                return ServerEvent::Final(text.to_string());
            }
        }
        if let Some(text) = sc
            .get("interimInputTranscription")
            .and_then(|t| t.get("text"))
            .and_then(|t| t.as_str())
        {
            if !text.is_empty() {
                return ServerEvent::Interim(text.to_string());
            }
        }
    }

    ServerEvent::Other
}

type WsSink = futures::stream::SplitSink<
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    Message,
>;

/// One outbound frame, queued for the writer task.
///
/// All writes funnel through a single task that owns the sink. This
/// exists because the audio pump runs in its OWN tokio task (see
/// `hotkey::spawn_chunk_forwarder`) while `on_release` concurrently
/// holds the session to close the turn. Without a channel, `send_audio`
/// would need `&mut self` from two places at once, which does not
/// compile — the Chirp path got this for free because tonic handed it a
/// cloneable `mpsc::Sender`.
#[derive(Debug)]
enum Outbound {
    ActivityStart,
    Audio(Vec<u8>),
    ActivityEnd,
}

impl Outbound {
    fn to_frame(&self) -> Value {
        match self {
            Outbound::ActivityStart => json!({ "realtimeInput": { "activityStart": {} } }),
            Outbound::ActivityEnd => json!({ "realtimeInput": { "activityEnd": {} } }),
            Outbound::Audio(bytes) => {
                let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
                json!({
                    "realtimeInput": {
                        "audio": {
                            "data": encoded,
                            "mimeType": format!("audio/pcm;rate={SAMPLE_RATE}")
                        }
                    }
                })
            }
        }
    }
}

/// Cloneable audio handle for the chunk-forwarder task.
///
/// Deliberately cannot start or end a turn — only the session owner
/// does that, so a forwarder can never desynchronise turn boundaries.
#[derive(Clone)]
pub struct AudioSender {
    outbound: mpsc::Sender<Outbound>,
}

impl AudioSender {
    /// Queue one chunk of 16 kHz mono PCM-16 little-endian audio.
    ///
    /// Applies back-pressure when the queue is full rather than
    /// dropping audio, which would silently truncate a transcript.
    pub async fn send_audio(&self, pcm16_bytes: Vec<u8>) -> Result<()> {
        self.outbound
            .send(Outbound::Audio(pcm16_bytes))
            .await
            .map_err(|_| anyhow!("Live API socket closed while sending audio"))
    }
}

/// One open Live API socket, past the `setupComplete` gate and ready to
/// carry utterances.
///
/// Lifecycle per dictation: `begin_utterance()` → `send_audio()` × N →
/// `end_utterance()`. The socket is reusable for the next dictation as
/// long as its `SessionConfig` still matches what the caller needs.
pub struct LiveSession {
    /// Queue feeding the writer task that owns the sink.
    outbound: mpsc::Sender<Outbound>,
    events: mpsc::Receiver<ServerEvent>,
    reader: tokio::task::JoinHandle<()>,
    /// `Option` so `close()` can await it without moving out of a type
    /// that implements `Drop`.
    writer: Option<tokio::task::JoinHandle<()>>,
    config: SessionConfig,
    go_away: Arc<AtomicBool>,
    /// True between `begin_utterance` and `end_utterance`. Guards
    /// against a caller sending audio outside a turn, which the server
    /// treats as a protocol error.
    in_utterance: bool,
}

impl LiveSession {
    /// Open a socket and block until `setupComplete` arrives.
    ///
    /// The token is minted by the caller so this function stays free of
    /// PopoState locking concerns (Session 57 rule: never hold a
    /// MutexGuard across an await).
    pub async fn open(access_token: &str, project_id: &str, config: SessionConfig) -> Result<Self> {
        let url = ws_endpoint(STT_LOCATION);
        let mut request = url
            .as_str()
            .into_client_request()
            .context("failed to build Live API websocket request")?;
        request.headers_mut().insert(
            "authorization",
            HeaderValue::from_str(&format!("Bearer {access_token}"))
                .context("access token is not a valid header value")?,
        );

        let (stream, _response) = tokio_tungstenite::connect_async(request)
            .await
            .context("failed to connect to the Vertex AI Live API")?;

        let (mut sink, mut source) = stream.split();

        let setup = build_setup_message(project_id, STT_LOCATION, &config);
        sink.send(Message::Text(setup.to_string()))
            .await
            .context("failed to send Live API setup message")?;

        let go_away = Arc::new(AtomicBool::new(false));
        let (tx, mut events) = mpsc::channel::<ServerEvent>(64);

        let reader_go_away = Arc::clone(&go_away);
        let reader = tokio::spawn(async move {
            while let Some(frame) = source.next().await {
                let event = match frame {
                    Ok(Message::Text(raw)) => parse_server_event(&raw),
                    Ok(Message::Binary(bytes)) => {
                        // Vertex sends JSON; some proxies deliver it as
                        // a binary frame. Treat both the same.
                        match std::str::from_utf8(&bytes) {
                            Ok(raw) => parse_server_event(raw),
                            Err(_) => ServerEvent::Other,
                        }
                    }
                    Ok(Message::Close(_)) => break,
                    Ok(_) => ServerEvent::Other,
                    Err(e) => {
                        tracing::warn!("transcribe_live: websocket read error: {e}");
                        break;
                    }
                };

                if event == ServerEvent::GoAway {
                    reader_go_away.store(true, Ordering::Relaxed);
                    tracing::info!("transcribe_live: goAway received; socket will be recycled");
                }
                if event == ServerEvent::Other {
                    continue;
                }
                if tx.send(event).await.is_err() {
                    break;
                }
            }
        });

        // The gate. Nothing may be sent before this clears.
        let gate = tokio::time::timeout(SETUP_TIMEOUT, async {
            while let Some(event) = events.recv().await {
                if event == ServerEvent::SetupComplete {
                    return true;
                }
            }
            false
        })
        .await;

        match gate {
            Ok(true) => {}
            Ok(false) => {
                reader.abort();
                return Err(anyhow!(
                    "Live API closed before setup completed. Check that the Vertex AI API is enabled and the service account has roles/aiplatform.user."
                ));
            }
            Err(_) => {
                reader.abort();
                return Err(anyhow!(
                    "Live API setup timed out after {}s.",
                    SETUP_TIMEOUT.as_secs()
                ));
            }
        }

        tracing::info!(
            "transcribe_live: session ready (mode={}, langs={:?}, vocab={})",
            config.mode.as_wire(),
            config.language_codes,
            config.custom_vocabulary.len()
        );

        // Writer task owns the sink from here on. Serialising every
        // outbound frame through one task is what lets the chunk
        // forwarder and the session owner both "write" concurrently.
        let (outbound, mut outbound_rx) = mpsc::channel::<Outbound>(256);
        let writer = tokio::spawn(async move {
            while let Some(msg) = outbound_rx.recv().await {
                let frame = msg.to_frame();
                if let Err(e) = sink.send(Message::Text(frame.to_string())).await {
                    tracing::warn!("transcribe_live: websocket write failed: {e}");
                    break;
                }
            }
            // Channel closed (session dropped): close politely.
            let _ = sink.send(Message::Close(None)).await;
        });

        Ok(Self {
            outbound,
            events,
            reader,
            writer: Some(writer),
            config,
            go_away,
            in_utterance: false,
        })
    }

    /// The config this socket was opened with. Compare fingerprints
    /// before reusing a warm session.
    pub fn config(&self) -> &SessionConfig {
        &self.config
    }

    /// True once the server has warned the connection is ending.
    pub fn is_expiring(&self) -> bool {
        self.go_away.load(Ordering::Relaxed)
    }

    /// Cloneable audio handle for the chunk-forwarder task.
    pub fn audio_sender(&self) -> AudioSender {
        AudioSender {
            outbound: self.outbound.clone(),
        }
    }

    /// Signal the start of a turn (hotkey down).
    pub async fn begin_utterance(&mut self) -> Result<()> {
        if self.in_utterance {
            return Err(anyhow!("begin_utterance called while already in a turn"));
        }
        self.send(Outbound::ActivityStart)
            .await
            .context("failed to signal activityStart")?;
        self.in_utterance = true;
        Ok(())
    }

    /// Push one chunk of 16 kHz mono PCM-16 little-endian audio.
    ///
    /// The forwarder task normally does this via `audio_sender()`; this
    /// method exists for the final trailing chunk that `on_release`
    /// flushes after the forwarder has stopped.
    pub async fn send_audio(&mut self, pcm16_bytes: Vec<u8>) -> Result<()> {
        if !self.in_utterance {
            return Err(anyhow!("send_audio called outside an utterance"));
        }
        self.send(Outbound::Audio(pcm16_bytes)).await
    }

    /// Close the turn (hotkey up) and collect the final transcript.
    ///
    /// Accumulates every final segment the server emits for this turn,
    /// then returns them joined. Returns `Ok("")` when the model heard
    /// nothing — the caller's existing too-quiet / no-speech
    /// classification in `audio/mic_error.rs` owns that case and must
    /// not be second-guessed here.
    pub async fn end_utterance(&mut self) -> Result<String> {
        if !self.in_utterance {
            return Err(anyhow!("end_utterance called outside an utterance"));
        }
        self.send(Outbound::ActivityEnd)
            .await
            .context("failed to signal activityEnd")?;
        self.in_utterance = false;

        let mut segments: Vec<String> = Vec::new();
        let overall = tokio::time::Instant::now() + FINISH_TIMEOUT;

        loop {
            // Once we have something, only wait a short settle window
            // for sibling segments. Before that, wait up to the overall
            // deadline.
            let wait = if segments.is_empty() {
                overall.saturating_duration_since(tokio::time::Instant::now())
            } else {
                FINAL_SETTLE
            };
            if wait.is_zero() {
                break;
            }

            match tokio::time::timeout(wait, self.events.recv()).await {
                Ok(Some(ServerEvent::Final(text))) => segments.push(text),
                Ok(Some(ServerEvent::Interim(_))) => continue,
                Ok(Some(ServerEvent::GoAway)) => continue,
                Ok(Some(_)) => continue,
                // Channel closed: reader ended. Return what we have.
                Ok(None) => break,
                // Settle window elapsed with at least one segment, or
                // the overall deadline elapsed with none.
                Err(_) => break,
            }
        }

        Ok(segments.join(" ").trim().to_string())
    }

    /// Abandon the turn without waiting for a transcript. Used when we
    /// already know the result is unwanted (too short / too quiet), so
    /// we stop billing without paying for a guaranteed-bad result.
    pub async fn abort_utterance(&mut self) {
        if self.in_utterance {
            let _ = self.send(Outbound::ActivityEnd).await;
            self.in_utterance = false;
        }
        // Drain whatever is buffered so a stale final from this turn
        // can't leak into the next one.
        while self.events.try_recv().is_ok() {}
    }

    /// Close the socket politely.
    ///
    /// Replaces the outbound sender with a dead one so the writer task's
    /// `recv()` returns `None`, which makes it emit a Close frame and
    /// exit, then waits for it. Takes `&mut self` rather than `self`
    /// because moving fields out of a `Drop` type is not allowed.
    ///
    /// The wait is BOUNDED. A writer parked on a TCP write to a
    /// half-dead socket may never return, and `close()` is called from
    /// `on_release` and `on_cancel` — both on the interactive path — so
    /// an unbounded await there would hang dictation and, because the
    /// caller holds the recording slot, freeze the app.
    pub async fn close(&mut self) {
        let (dead_tx, _dead_rx) = mpsc::channel::<Outbound>(1);
        let live = std::mem::replace(&mut self.outbound, dead_tx);
        drop(live);
        if let Some(writer) = self.writer.take() {
            match tokio::time::timeout(CLOSE_TIMEOUT, writer).await {
                Ok(_) => {}
                Err(_) => {
                    tracing::warn!(
                        "transcribe_live: writer did not finish within {}ms; abandoning socket",
                        CLOSE_TIMEOUT.as_millis()
                    );
                }
            }
        }
        self.reader.abort();
    }

    async fn send(&mut self, msg: Outbound) -> Result<()> {
        self.outbound
            .send(msg)
            .await
            .map_err(|_| anyhow!("Live API socket closed"))
    }
}

impl Drop for LiveSession {
    fn drop(&mut self) {
        // The reader is parked on `source.next()` and will never wake on
        // its own, so it must be aborted. The writer is left alone: when
        // `outbound` drops, its `recv()` returns `None` and it sends a
        // Close frame before exiting on its own.
        self.reader.abort();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(mode: TranscribeMode) -> SessionConfig {
        SessionConfig {
            mode,
            language_codes: vec![],
            custom_vocabulary: vec![],
        }
    }

    #[test]
    fn model_id_carries_the_vertex_preview_suffix() {
        // Regression guard: the unsuffixed AI Studio ID does not resolve
        // on Vertex.
        assert_eq!(MODEL_ID, "gemini-3.5-transcribe-live-preview");
        assert!(MODEL_ID.ends_with("-preview"));
    }

    #[test]
    fn location_is_global_only() {
        assert_eq!(STT_LOCATION, "global");
    }

    #[test]
    fn global_location_uses_the_bare_host() {
        assert_eq!(
            ws_endpoint("global"),
            "wss://aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent"
        );
    }

    #[test]
    fn regional_location_is_host_prefixed() {
        assert!(ws_endpoint("us-central1")
            .starts_with("wss://us-central1-aiplatform.googleapis.com/ws/"));
    }

    #[test]
    fn model_resource_is_fully_qualified() {
        assert_eq!(
            model_resource("my-proj", "global"),
            "projects/my-proj/locations/global/publishers/google/models/gemini-3.5-transcribe-live-preview"
        );
    }

    #[test]
    fn setup_message_shape_matches_the_live_api_contract() {
        let c = SessionConfig {
            mode: TranscribeMode::Smart,
            language_codes: vec!["en-IN".into()],
            custom_vocabulary: vec!["PoPo".into(), "Tauri".into()],
        };
        let msg = build_setup_message("proj", "global", &c);
        let setup = &msg["setup"];

        assert_eq!(
            setup["model"],
            "projects/proj/locations/global/publishers/google/models/gemini-3.5-transcribe-live-preview"
        );
        assert_eq!(setup["generationConfig"]["responseModalities"][0], "TEXT");
        assert_eq!(setup["inputAudioTranscription"]["mode"], "SMART");
        assert_eq!(
            setup["inputAudioTranscription"]["languageCodes"][0],
            "en-IN"
        );
        assert_eq!(
            setup["inputAudioTranscription"]["customVocabulary"][0],
            "PoPo"
        );
        // Manual VAD is what makes push-to-talk deterministic.
        assert_eq!(
            setup["realtimeInputConfig"]["automaticActivityDetection"]["disabled"],
            true
        );
    }

    #[test]
    fn empty_vocabulary_is_omitted_not_sent_as_empty_list() {
        let msg = build_setup_message("proj", "global", &cfg(TranscribeMode::Verbatim));
        assert!(msg["setup"]["inputAudioTranscription"]
            .get("customVocabulary")
            .is_none());
    }

    #[test]
    fn empty_language_codes_request_auto_detection() {
        let msg = build_setup_message("proj", "global", &cfg(TranscribeMode::Verbatim));
        let langs = &msg["setup"]["inputAudioTranscription"]["languageCodes"];
        assert!(langs.is_array());
        assert_eq!(langs.as_array().unwrap().len(), 0);
    }

    #[test]
    fn mode_wire_values_are_exact() {
        assert_eq!(TranscribeMode::Verbatim.as_wire(), "VERBATIM");
        assert_eq!(TranscribeMode::Smart.as_wire(), "SMART");
    }

    #[test]
    fn fingerprint_separates_modes() {
        assert_ne!(
            cfg(TranscribeMode::Smart).fingerprint(),
            cfg(TranscribeMode::Verbatim).fingerprint()
        );
    }

    #[test]
    fn fingerprint_ignores_vocabulary_order() {
        let a = SessionConfig {
            mode: TranscribeMode::Smart,
            language_codes: vec!["en-US".into()],
            custom_vocabulary: vec!["beta".into(), "alpha".into()],
        };
        let b = SessionConfig {
            mode: TranscribeMode::Smart,
            language_codes: vec!["en-US".into()],
            custom_vocabulary: vec!["alpha".into(), "beta".into()],
        };
        assert_eq!(a.fingerprint(), b.fingerprint());
    }

    #[test]
    fn fingerprint_tracks_vocabulary_content() {
        let mut a = cfg(TranscribeMode::Smart);
        a.custom_vocabulary = vec!["Kubernetes".into()];
        assert_ne!(a.fingerprint(), cfg(TranscribeMode::Smart).fingerprint());
    }

    #[test]
    fn fingerprint_tracks_language_selection() {
        let mut a = cfg(TranscribeMode::Smart);
        a.language_codes = vec!["hi-IN".into()];
        assert_ne!(a.fingerprint(), cfg(TranscribeMode::Smart).fingerprint());
    }

    #[test]
    fn parses_setup_complete() {
        assert_eq!(
            parse_server_event(r#"{"setupComplete":{}}"#),
            ServerEvent::SetupComplete
        );
    }

    #[test]
    fn parses_final_transcript() {
        let raw = r#"{"serverContent":{"inputTranscription":{"text":"hello there"}}}"#;
        assert_eq!(
            parse_server_event(raw),
            ServerEvent::Final("hello there".to_string())
        );
    }

    #[test]
    fn parses_interim_transcript() {
        let raw = r#"{"serverContent":{"interimInputTranscription":{"text":"hel"}}}"#;
        assert_eq!(
            parse_server_event(raw),
            ServerEvent::Interim("hel".to_string())
        );
    }

    #[test]
    fn final_wins_when_both_are_present() {
        let raw = r#"{"serverContent":{"interimInputTranscription":{"text":"partial"},
                       "inputTranscription":{"text":"complete"}}}"#;
        assert_eq!(
            parse_server_event(raw),
            ServerEvent::Final("complete".to_string())
        );
    }

    #[test]
    fn parses_go_away() {
        assert_eq!(
            parse_server_event(r#"{"goAway":{"timeLeft":"60s"}}"#),
            ServerEvent::GoAway
        );
    }

    #[test]
    fn empty_transcript_text_is_not_a_segment() {
        let raw = r#"{"serverContent":{"inputTranscription":{"text":""}}}"#;
        assert_eq!(parse_server_event(raw), ServerEvent::Other);
    }

    #[test]
    fn malformed_json_is_tolerated() {
        assert_eq!(parse_server_event("not json at all"), ServerEvent::Other);
        assert_eq!(parse_server_event(""), ServerEvent::Other);
    }

    #[test]
    fn activity_frames_have_the_documented_shape() {
        let start = Outbound::ActivityStart.to_frame();
        assert!(start["realtimeInput"]["activityStart"].is_object());
        let end = Outbound::ActivityEnd.to_frame();
        assert!(end["realtimeInput"]["activityEnd"].is_object());
    }

    #[test]
    fn audio_frames_are_base64_with_the_rate_bearing_mime_type() {
        // Two PCM-16 samples: 0x0001, 0x0002 little-endian.
        let frame = Outbound::Audio(vec![0x01, 0x00, 0x02, 0x00]).to_frame();
        let audio = &frame["realtimeInput"]["audio"];
        assert_eq!(audio["mimeType"], "audio/pcm;rate=16000");
        let data = audio["data"].as_str().unwrap();
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(data)
            .unwrap();
        assert_eq!(decoded, vec![0x01, 0x00, 0x02, 0x00]);
    }

    #[test]
    fn audio_sender_is_cloneable_for_the_forwarder_task() {
        // The forwarder runs in its own task, so the audio handle must
        // be Clone + Send. This is a compile-time assertion.
        fn assert_clone_send<T: Clone + Send + 'static>() {}
        assert_clone_send::<AudioSender>();
    }
}
