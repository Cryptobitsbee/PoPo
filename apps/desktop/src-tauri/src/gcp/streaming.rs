// gcp/streaming.rs — Speech-to-Text v2 `StreamingRecognize` (bidirectional gRPC).
//
// Why StreamingRecognize instead of batch Recognize?
//   - In push-to-talk, ALL audio is captured first, then batch-uploaded. For
//     2 minutes of audio this takes 15-20s end-to-end (upload + process).
//   - StreamingRecognize sends audio chunks IN REAL-TIME during recording.
//     By the time the user releases the hotkey, GCP has already processed
//     99% of the audio. Final transcript arrives in ~200-500ms.
//   - Interim results can be shown on the pill in the future (v0.2).
//
// Architecture:
//   LiveStream::start() opens the bidirectional stream and sends the config
//   message. Returns a LiveStreamHandle that exposes:
//     - send_audio(pcm16_bytes) — pushes audio into the gRPC stream
//     - finish() — half-closes send, collects final results, returns transcript
//
// The chunk forwarder in hotkey/mod.rs calls send_audio every ~100ms with
// resampled PCM16 bytes. On release, it calls finish() to get the transcript.

use anyhow::{anyhow, Context, Result};
use googleapis_tonic_google_cloud_speech_v2::google::cloud::speech::v2::{
    explicit_decoding_config::AudioEncoding, recognition_config::DecodingConfig,
    speech_client::SpeechClient, streaming_recognition_features::EndpointingSensitivity,
    streaming_recognize_request, CustomPromptConfig, DenoiserConfig, ExplicitDecodingConfig,
    RecognitionConfig, RecognitionFeatures, StreamingRecognitionConfig,
    StreamingRecognitionFeatures, StreamingRecognizeRequest, StreamingRecognizeResponse,
};
use tokio::sync::mpsc;
use tonic::metadata::MetadataValue;

use crate::gcp::auth::Authenticator;

/// Buffer size for the mpsc channel feeding the gRPC stream.
/// 50 messages ≈ 50 × 100ms chunks = 5 seconds of audio buffered.
/// If the sender outpaces gRPC upload, it'll await (bounded back-pressure).
const STREAM_CHANNEL_BUFFER: usize = 50;

/// Build the recognizer resource path. Same format as chirp.rs.
fn recognizer_resource(project_id: &str) -> String {
    format!(
        "projects/{project_id}/locations/{}/recognizers/_",
        crate::gcp::client::SPEECH_REGION
    )
}

/// Handle to an active StreamingRecognize session. Created by
/// `LiveStream::start()`. The caller pushes audio via `send_audio()`
/// and then calls `finish()` to close the stream and get the transcript.
pub struct LiveStreamHandle {
    /// Sender half of the mpsc channel feeding the gRPC request stream.
    /// Dropping this (or calling `finish()`) signals half-close.
    tx: Option<mpsc::Sender<StreamingRecognizeRequest>>,
    /// Background task that reads the gRPC response stream and collects
    /// final results. Joined in `finish()`.
    response_task: Option<tokio::task::JoinHandle<Result<String>>>,
}

impl LiveStreamHandle {
    /// Clone the mpsc sender so external code (chunk forwarder) can send
    /// audio messages directly into the gRPC stream.
    pub fn clone_tx(&self) -> mpsc::Sender<StreamingRecognizeRequest> {
        self.tx
            .as_ref()
            .expect("clone_tx called after stream closed")
            .clone()
    }

    /// Send a chunk of PCM16 audio bytes to GCP. Non-blocking (returns
    /// immediately unless the channel buffer is full, in which case it
    /// awaits back-pressure from tonic's HTTP/2 flow control).
    ///
    /// `pcm16_bytes` should be LINEAR16 (little-endian i16) at 16 kHz mono.
    pub async fn send_audio(&self, pcm16_bytes: Vec<u8>) -> Result<()> {
        let tx = self
            .tx
            .as_ref()
            .ok_or_else(|| anyhow!("stream already closed"))?;

        let msg = StreamingRecognizeRequest {
            recognizer: String::new(), // only needed in the first message
            streaming_request: Some(streaming_recognize_request::StreamingRequest::Audio(
                pcm16_bytes.into(),
            )),
        };

        tx.send(msg)
            .await
            .map_err(|_| anyhow!("gRPC stream channel closed unexpectedly"))
    }

    /// Half-close the send side and wait for the response stream to
    /// deliver all `is_final` transcript results. Returns the joined
    /// full transcript string.
    ///
    /// This is the "fast finish" — by the time we call this, GCP has
    /// already processed most of the audio in real-time. Typical
    /// latency: 200-500ms for the final trailing chunk.
    pub async fn finish(mut self) -> Result<String> {
        // Drop the sender to signal half-close on the gRPC stream.
        // tonic interprets end-of-stream on the request side as
        // "client is done sending".
        drop(self.tx.take());

        // Wait for the response collector task to finish.
        let task = self
            .response_task
            .take()
            .ok_or_else(|| anyhow!("response task already consumed"))?;

        match task.await {
            Ok(result) => result,
            Err(join_err) => Err(anyhow!("response collector task panicked: {join_err}")),
        }
    }

    /// Cancel the stream WITHOUT awaiting a transcript. Used when we
    /// already know we don't want the result — e.g., the session was
    /// too short / too quiet (protects against Chirp 3 prompt-echo
    /// hallucination and avoids paying for a guaranteed-bad call).
    ///
    /// Drops the send side (triggers half-close so the server releases
    /// the recognizer slot and stops billing) and aborts the response
    /// collector so no transcript is waited for.
    pub fn abort(mut self) {
        drop(self.tx.take());
        if let Some(task) = self.response_task.take() {
            task.abort();
        }
    }
}

/// Open a bidirectional StreamingRecognize gRPC stream. Sends the initial
/// config message and returns a handle for pushing audio + collecting results.
///
/// # Arguments
/// - `auth` — GCP authenticator for minting Bearer tokens.
/// - `project_id` — GCP project ID (from the user's setup wizard).
/// - `language_codes` — array of BCP-47 language codes. Empty array
///   (or `["auto"]`) → Chirp 3 auto-detect across 125+ languages.
///   Multiple codes (e.g. `["hi-IN", "en-US"]`) enable Chirp 3's
///   code-switching for bilingual speakers.
/// - `sample_rate` — Target sample rate for the audio (should be 16000).
/// - `_features` — Phase C feature flags (accepted for API parity with
///   the batch path, but INTENTIONALLY IGNORED here per Session 28:
///   Chirp 3 doesn't support `enable_spoken_punctuation`,
///   `enable_spoken_emojis`, or `profanity_filter`, and setting them
///   produces a gRPC "Invalid argument" error. Automatic punctuation
///   is always on in Chirp 3 natively, so we don't need the flag.
///   Keep this param so on_release can still pass the resolved value
///   — when we eventually wire a Chirp-2 fallback or multi-model
///   support, the flags flow through here.)
pub async fn start(
    auth: &Authenticator,
    project_id: &str,
    language_codes: &[String],
    sample_rate: i32,
    _features: RecognitionFeatures,
    custom_prompt: &str,
    // Dictionary phrases to bias Chirp 3's recognition toward. Empty
    // = no adaptation attached to the request. See
    // `hotkey::build_speech_adaptation` for the construction helper.
    adaptation_phrases: &[String],
) -> Result<LiveStreamHandle> {
    let t0 = std::time::Instant::now();

    // 1. Mint auth token.
    let token = auth.access_token().await?;
    let bearer: MetadataValue<_> = format!("Bearer {token}")
        .parse()
        .map_err(|e| anyhow!("bad token value: {e}"))?;
    tracing::info!(
        "streaming [step 1/6]: auth token minted in {}ms",
        t0.elapsed().as_millis()
    );

    // 2. Get the cached gRPC channel.
    let t1 = std::time::Instant::now();
    let channel = crate::gcp::client::get_channel().await?;
    let mut client = SpeechClient::new(channel);
    tracing::info!(
        "streaming [step 2/6]: channel acquired in {}ms",
        t1.elapsed().as_millis()
    );

    // 3. Create the mpsc channel for feeding requests into the stream.
    let (tx, rx) = mpsc::channel::<StreamingRecognizeRequest>(STREAM_CHANNEL_BUFFER);

    // Resolve the language list Chirp 3 actually wants. Empty array
    // produces "Invalid argument" on v2 — `["auto"]` is the canonical
    // Chirp 3 auto-detect sentinel.
    let effective_langs: Vec<String> = if language_codes.is_empty() {
        vec!["auto".to_string()]
    } else {
        language_codes.to_vec()
    };

    // 4. Build the initial config message (no audio in first message).
    //
    //    Chirp 3 specifics (Session 29 — verified against official docs,
    //    see `docs/CHIRP_3_TRANSCRIPTION.md`):
    //    - `features: None` — Chirp 3 rejects `enable_spoken_punctuation`,
    //      `enable_spoken_emojis`, `profanity_filter`. Automatic
    //      punctuation + capitalization are always on natively.
    //    - `denoiser_config` IS supported on Chirp 3 per the docs'
    //      "Enable denoiser" example. `snr_threshold` is deprecated on
    //      Chirp 3 but must be 0.0 for compatibility.
    //    - `streaming_features.interim_results = true` so we observably
    //      receive progressive transcripts DURING recording (visible
    //      proof in logs + sets us up for future pill live-text).
    //    - `endpointing_sensitivity = STANDARD` is the default;
    //      explicit for clarity. Could expose SHORT / SUPERSHORT in
    //      Settings for advanced users later.
    //    - `enable_voice_activity_events = false` for now; keep local
    //      silence auto-stop. Revisit when Silero VAD lands.
    let config_msg = StreamingRecognizeRequest {
        recognizer: recognizer_resource(project_id),
        streaming_request: Some(
            streaming_recognize_request::StreamingRequest::StreamingConfig(
                StreamingRecognitionConfig {
                    config: Some(RecognitionConfig {
                        decoding_config: Some(DecodingConfig::ExplicitDecodingConfig(
                            ExplicitDecodingConfig {
                                encoding: AudioEncoding::Linear16 as i32,
                                sample_rate_hertz: sample_rate,
                                audio_channel_count: 1,
                            },
                        )),
                        language_codes: effective_langs.clone(),
                        model: "chirp_3".into(),
                        features: if custom_prompt.is_empty() {
                            None
                        } else {
                            Some(RecognitionFeatures {
                                enable_automatic_punctuation: true,
                                custom_prompt_config: Some(CustomPromptConfig {
                                    custom_prompt: custom_prompt.to_string(),
                                }),
                                ..Default::default()
                            })
                        },
                        adaptation: crate::hotkey::build_speech_adaptation(adaptation_phrases),
                        denoiser_config: Some(DenoiserConfig {
                            denoise_audio: true,
                            snr_threshold: 0.0,
                        }),
                        ..Default::default()
                    }),
                    config_mask: None,
                    streaming_features: Some(StreamingRecognitionFeatures {
                        interim_results: true,
                        enable_voice_activity_events: false,
                        endpointing_sensitivity: EndpointingSensitivity::Standard as i32,
                        voice_activity_timeout: None,
                    }),
                },
            ),
        ),
    };

    tracing::info!(
        "streaming: opening StreamingRecognize (languages={:?}, model=chirp_3, denoiser=on, custom_prompt={}, adaptation={} phrases, interim_results=on, endpointing=STANDARD)",
        effective_langs,
        if custom_prompt.is_empty() { "off" } else { "on" },
        adaptation_phrases.len()
    );

    // 5. Send the config message into the channel FIRST, before starting
    //    the gRPC stream. This ensures the server receives the config as
    //    the very first message.
    tx.send(config_msg)
        .await
        .map_err(|_| anyhow!("failed to send config message into channel"))?;
    tracing::info!(
        "streaming [step 5/6]: config message queued in {}ms total",
        t0.elapsed().as_millis()
    );

    // 6. Open the bidirectional stream WITHOUT blocking.
    //
    //    Key insight (Session 29 research): in tonic, the ReceiverStream
    //    feeds messages to the server AS SOON AS the HTTP/2 stream is
    //    open — even BEFORE `streaming_recognize().await` resolves (which
    //    waits for response HEADERS from the server). The server's response
    //    headers take ~12s on cold start (Chirp 3 model allocation), but
    //    the outbound data path is open within ~200-500ms.
    //
    //    Our previous bug: we awaited streaming_recognize FIRST, then
    //    started the forwarder. During that 12s, no audio reached the
    //    server → it timed out waiting for audio after config.
    //
    //    Fix: spawn the streaming_recognize + response collector into a
    //    background task. Return the LiveStreamHandle IMMEDIATELY so the
    //    caller (hotkey::on_press) can spawn the chunk forwarder right
    //    away. Audio flows into tx → mpsc → ReceiverStream → HTTP/2 →
    //    server while the response task is still awaiting headers.
    let request_stream = tokio_stream::wrappers::ReceiverStream::new(rx);
    let mut request = tonic::Request::new(request_stream);
    request.metadata_mut().insert("authorization", bearer);

    let response_task = tokio::spawn(async move {
        let t_rpc = std::time::Instant::now();
        let response = client
            .streaming_recognize(request)
            .await
            .context("failed to open StreamingRecognize stream")?;
        tracing::info!(
            "streaming [step 6/6]: streaming_recognize() returned in {}ms (this is the gRPC open)",
            t_rpc.elapsed().as_millis()
        );

        let mut response_stream = response.into_inner();
        collect_final_results(&mut response_stream).await
    });

    tracing::info!(
        "streaming: handle ready in {}ms total (response task running in background)",
        t0.elapsed().as_millis()
    );

    Ok(LiveStreamHandle {
        tx: Some(tx),
        response_task: Some(response_task),
    })
}

/// Read the response stream until it ends (server closes after we
/// half-close the send side). Collects all `is_final` result transcripts
/// and joins them with spaces.
///
/// With `streaming_features.interim_results = true` (Session 29),
/// Chirp 3 sends progressive interim results continuously during
/// recording. Interim results are logged (not collected) — they're the
/// visible proof that real-time streaming is actually happening.
async fn collect_final_results(
    stream: &mut tonic::Streaming<StreamingRecognizeResponse>,
) -> Result<String> {
    let mut final_segments: Vec<String> = Vec::new();
    let mut interim_count: u32 = 0;
    let mut event_count: u32 = 0;
    let start = std::time::Instant::now();

    loop {
        match stream.message().await {
            Ok(Some(response)) => {
                // Voice-activity events (only fire when
                // enable_voice_activity_events=true; currently off).
                // Logged in case we flip the flag later.
                if response.speech_event_type != 0 {
                    event_count += 1;
                    tracing::debug!(
                        "streaming: speech_event_type={} at +{}ms",
                        response.speech_event_type,
                        start.elapsed().as_millis()
                    );
                }

                for result in &response.results {
                    if result.is_final {
                        if let Some(alt) = result.alternatives.first() {
                            let text = alt.transcript.trim();
                            if !text.is_empty() {
                                tracing::debug!(
                                    "streaming: FINAL segment at +{}ms: {} chars (confidence: {:.2})",
                                    start.elapsed().as_millis(),
                                    text.chars().count(),
                                    alt.confidence
                                );
                                final_segments.push(text.to_string());
                            }
                        }
                    } else if let Some(alt) = result.alternatives.first() {
                        // Interim — GCP is transcribing in real time
                        // while we're still sending audio. Log the
                        // first one + every 5th to keep the signal
                        // visible without spamming.
                        interim_count += 1;
                        if interim_count == 1 || interim_count % 5 == 0 {
                            tracing::info!(
                                "streaming: interim #{interim_count} at +{}ms (stability {:.2}, {} chars)",
                                start.elapsed().as_millis(),
                                result.stability,
                                alt.transcript.trim().chars().count()
                            );
                        }
                    }
                }
            }
            Ok(None) => {
                // Stream ended normally (server closed after our half-close).
                break;
            }
            Err(status) => {
                // gRPC error from the server.
                return Err(anyhow!(
                    "StreamingRecognize response error: code={} message={}",
                    status.code(),
                    status.message()
                ));
            }
        }
    }

    let transcript = final_segments.join(" ");

    if transcript.is_empty() {
        return Err(anyhow!(
            "StreamingRecognize returned no final transcript (silence? wrong mic?)"
        ));
    }

    tracing::info!(
        "streaming: collected {} final + {} interim + {} events over {}ms, total {} chars",
        final_segments.len(),
        interim_count,
        event_count,
        start.elapsed().as_millis(),
        transcript.len()
    );

    Ok(transcript)
}
