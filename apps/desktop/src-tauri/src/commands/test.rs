// commands/test.rs — Phase E: Test page real dictation pipeline.
//
// Provides two commands that wire the Test page's "Hold to Dictate"
// button to the same cpal + GCP Chirp pipeline used by the global
// hotkey — but WITHOUT the paste step. The transcript is returned to
// the Test page for display only.
//
// Commands:
//   cmd_test_dictate_start(mic_id?)  — open mic, start waveform events
//   cmd_test_dictate_stop()          — close mic, transcribe, emit result
//
// Events emitted (same shape as pill events so existing React hooks work):
//   test:waveform  { bars: [f32; 16] }  — 25 Hz while recording
//   test:transcript { text: String, error: Option<String> }
//
// State is managed via TestRecordingState (separate from PopoState so
// we don't pollute the hotkey state machine with test-mode concerns).

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::audio::{self, capture::CaptureHandle, processor};
use crate::gcp::{self, auth::Authenticator, GcpConfig};
use crate::hotkey::PopoState;

// ── Shared state ────────────────────────────────────────────────────

/// In-flight test recording. Held in Tauri managed state so both
/// start + stop commands can access it.
struct TestSession {
    /// Owned handle — dropping this stops cpal.
    handle: CaptureHandle,
    /// Shared ring buffer (same Arc the waveform task reads from).
    samples: Arc<Mutex<VecDeque<f32>>>,
    /// Flipped to `false` to stop the waveform task.
    running: Arc<AtomicBool>,
}

pub struct TestRecordingState {
    inner: Mutex<Option<TestSession>>,
}

impl Default for TestRecordingState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }
}

// ── Event payloads ──────────────────────────────────────────────────

#[derive(Serialize, Clone)]
struct TestWaveformPayload {
    bars: [f32; 16],
}

#[derive(Serialize, Clone)]
pub struct TestTranscriptPayload {
    pub text: String,
    pub error: Option<String>,
}

// ── Commands ────────────────────────────────────────────────────────

/// Start a test dictation session. Opens the microphone and begins
/// emitting `test:waveform` events at 25 Hz.
///
/// `mic_id`: device name from `cmd_list_mics`. `None` / empty string
/// → system default.
///
/// No-ops silently if a test session is already running.
#[tauri::command]
pub fn cmd_test_dictate_start(
    app: AppHandle,
    test: State<'_, TestRecordingState>,
    mic_id: Option<String>,
) -> Result<(), String> {
    let mut guard = test
        .inner()
        .inner
        .lock()
        .map_err(|_| "TestRecordingState mutex poisoned".to_string())?;

    if guard.is_some() {
        tracing::warn!("cmd_test_dictate_start: already running, ignoring");
        return Ok(());
    }

    // Resolve mic name (None → system default).
    let mic_name: Option<String> = mic_id.and_then(|s| {
        let t = s.trim().to_string();
        if t.is_empty() {
            None
        } else {
            Some(t)
        }
    });

    let capture =
        audio::capture::start(mic_name.as_deref()).map_err(|e| format!("mic open failed: {e}"))?;

    let samples = capture.samples.clone();
    let sample_rate = capture.sample_rate;
    let running = Arc::new(AtomicBool::new(true));

    // Spawn the waveform task — mirrors hotkey waveform task but emits
    // `test:waveform` instead of `pill:waveform`.
    spawn_test_waveform_task(app.clone(), running.clone(), samples.clone(), sample_rate);

    *guard = Some(TestSession {
        handle: capture,
        samples,
        running,
    });

    tracing::info!("cmd_test_dictate_start: recording started");
    Ok(())
}

/// Stop the test dictation session, transcribe via GCP, and emit
/// `test:transcript` with the result (or error message).
///
/// No-ops if no session is running.
#[tauri::command]
pub async fn cmd_test_dictate_stop(
    app: AppHandle,
    test: State<'_, TestRecordingState>,
    popo: State<'_, PopoState>,
) -> Result<(), String> {
    // Take the session out of the mutex.
    let session = {
        let mut guard = test
            .inner()
            .inner
            .lock()
            .map_err(|_| "TestRecordingState mutex poisoned".to_string())?;
        match guard.take() {
            Some(s) => s,
            None => {
                tracing::warn!("cmd_test_dictate_stop: no active test session");
                return Ok(());
            }
        }
    };

    // Stop waveform task + cpal stream.
    session.running.store(false, Ordering::Relaxed);
    let samples = session.samples.clone();
    let sample_rate = session.handle.sample_rate;
    // Snapshot the audio buffer before the stream drops.
    let pcm_snapshot: Vec<f32> = samples
        .lock()
        .map(|g| g.iter().copied().collect())
        .unwrap_or_default();
    // `session.handle` (stream) drops here → audio capture stops.
    drop(session);

    tracing::info!(
        "cmd_test_dictate_stop: captured {} samples @ {} Hz",
        pcm_snapshot.len(),
        sample_rate
    );

    // Emit zero bars so the waveform resets visually.
    let _ = app.emit("test:waveform", TestWaveformPayload { bars: [0.0; 16] });

    // Transcribe with GCP Chirp (or fake_transcribe fallback).
    let gcp_snapshot: Option<(GcpConfig, Authenticator)> = {
        let guard = popo
            .inner()
            .gcp
            .lock()
            .expect("PopoState gcp mutex poisoned");
        guard.as_ref().cloned()
    };

    let raw_samples = Arc::new(Mutex::new(VecDeque::from(pcm_snapshot)));

    let transcript_result = match gcp_snapshot {
        Some((ref config, ref auth)) => {
            // Resolve Phase C language codes + features from current state.
            // Same logic as hotkey::resolve_language_codes; duplicated here
            // because that helper is private to the hotkey module and the
            // test command path is read-only (no lock ordering concerns).
            let language_codes: Vec<String> = {
                let multi = popo
                    .inner()
                    .multi_language_codes
                    .lock()
                    .map(|g| g.clone())
                    .unwrap_or_default();
                if !multi.is_empty() {
                    multi
                } else {
                    let single = config.language_code.trim();
                    if single.is_empty() || single.eq_ignore_ascii_case("auto") {
                        Vec::new()
                    } else {
                        vec![single.to_string()]
                    }
                }
            };
            let features = {
                use googleapis_tonic_google_cloud_speech_v2::google::cloud::speech::v2::RecognitionFeatures;
                RecognitionFeatures {
                    enable_automatic_punctuation: true,
                    enable_spoken_punctuation: popo
                        .inner()
                        .spoken_punctuation
                        .lock()
                        .map(|g| *g)
                        .unwrap_or(false),
                    enable_spoken_emojis: popo
                        .inner()
                        .spoken_emojis
                        .lock()
                        .map(|g| *g)
                        .unwrap_or(false),
                    profanity_filter: popo
                        .inner()
                        .profanity_filter
                        .lock()
                        .map(|g| *g)
                        .unwrap_or(false),
                    ..Default::default()
                }
            };

            gcp::transcribe(
                auth,
                config,
                &raw_samples,
                sample_rate,
                &language_codes,
                features,
                "",
                &popo
                    .inner()
                    .dictionary
                    .lock()
                    .map(|g| g.clone())
                    .unwrap_or_default(),
            )
            .await
            .map_err(|e| {
                let mut out = format!("{e}");
                let mut src = e.source();
                while let Some(c) = src {
                    out.push_str(": ");
                    out.push_str(&c.to_string());
                    src = c.source();
                }
                out
            })
        }
        None => Ok(gcp::fake_transcribe(&raw_samples).await),
    };

    let (text, error) = match transcript_result {
        Ok(t) => (t, None),
        Err(e) => (String::new(), Some(e)),
    };

    let _ = app.emit("test:transcript", TestTranscriptPayload { text, error });

    tracing::info!("cmd_test_dictate_stop: transcript emitted");
    Ok(())
}

// ── Waveform task ────────────────────────────────────────────────────

fn spawn_test_waveform_task(
    app: AppHandle,
    running: Arc<AtomicBool>,
    samples: Arc<Mutex<VecDeque<f32>>>,
    sample_rate: u32,
) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(40)).await;

        let mut ticker = tokio::time::interval(Duration::from_millis(40));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        // EMA smoothing — same alpha as the pill waveform task.
        const SMOOTH_ALPHA: f32 = 0.3;
        let mut smoothed = [0.0f32; 16];

        while running.load(Ordering::Relaxed) {
            ticker.tick().await;
            let raw = processor::compute_bars(&samples, sample_rate);
            for i in 0..16 {
                smoothed[i] = SMOOTH_ALPHA * raw[i] + (1.0 - SMOOTH_ALPHA) * smoothed[i];
            }
            let _ = app.emit("test:waveform", TestWaveformPayload { bars: smoothed });
        }
    });
}
