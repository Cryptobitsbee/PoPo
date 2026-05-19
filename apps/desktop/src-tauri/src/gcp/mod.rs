// gcp — Speech-to-Text v2 gRPC client (Chirp 2).
//
// Phase 2 [6] polish: real gRPC streaming via `chirp::transcribe`.
// `fake_transcribe` stays available as an explicit fallback when the user
// hasn't configured their GCP credentials yet — NO silent fallback on
// real-call errors (those should surface to the pill error state so the
// user knows something's wrong).

pub mod auth;
pub mod chirp;
pub mod client;
pub mod gemini;
pub mod streaming;

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::Result;

use crate::gcp::auth::Authenticator;

/// Persisted GCP configuration. Held in PopoState; updated by
/// `cmd_set_gcp_config` when the user finishes the setup wizard or
/// edits Settings → GCP Setup.
#[derive(Clone, Debug, Default)]
pub struct GcpConfig {
    pub service_account_path: String,
    pub project_id: String,
    /// Language code passed to Chirp ("auto", "en-US", "hi-IN", etc.).
    /// Empty string means fall back to "en-US" at call time.
    pub language_code: String,
}

impl GcpConfig {
    pub fn is_configured(&self) -> bool {
        !self.service_account_path.trim().is_empty() && !self.project_id.trim().is_empty()
    }
}

/// Build an Authenticator from the current config. Returns Err if the
/// config is incomplete or the service-account JSON is invalid.
pub async fn authenticator_from_config(config: &GcpConfig) -> Result<Authenticator> {
    Authenticator::from_service_account_file(&config.service_account_path).await
}

/// The real transcribe path. Drains the audio ring buffer into a Vec<f32>
/// and calls chirp::transcribe.
///
/// `language_codes` follows the Phase C contract: empty → auto-detect,
/// single → one language, multiple → code-switching.
/// `features` carries the Chirp 3 toggles (spoken punctuation / emojis /
/// profanity filter). Always-on cloud denoiser is added inside
/// `chirp::transcribe`; callers don't need to pass it.
pub async fn transcribe(
    auth: &Authenticator,
    config: &GcpConfig,
    samples: &Arc<Mutex<VecDeque<f32>>>,
    input_sample_rate: u32,
    language_codes: &[String],
    features: googleapis_tonic_google_cloud_speech_v2::google::cloud::speech::v2::RecognitionFeatures,
    custom_prompt: &str,
    adaptation_phrases: &[String],
) -> Result<String> {
    let drained: Vec<f32> = {
        let guard = samples
            .lock()
            .map_err(|_| anyhow::anyhow!("audio sample mutex poisoned"))?;
        guard.iter().copied().collect()
    };

    chirp::transcribe(
        auth,
        &config.project_id,
        drained,
        input_sample_rate,
        language_codes,
        features,
        custom_prompt,
        adaptation_phrases,
    )
    .await
}

/// Fake transcription stub — used when the user hasn't configured GCP
/// credentials yet. Instead of inventing a plausible "demo" transcript
/// (which confused users, especially when it sounded like a real thing
/// they supposedly said), we now paste a plainspoken setup pointer.
///
/// This makes the first-press-without-setup experience self-teaching:
/// the user's target text field is where they're looking when they hit
/// the hotkey, so that's exactly where our instructions need to land.
///
/// Once the user finishes the GCP Setup wizard + `cmd_set_gcp_config`
/// fires, real transcribe() is used and this function stops being called.
pub async fn fake_transcribe(_samples: &Arc<Mutex<VecDeque<f32>>>) -> String {
    // Small pause so the pill's "processing" state reads as real work
    // rather than instantly flashing. 400ms is short enough to feel
    // snappy but long enough for the DotMatrix loader to breathe.
    tokio::time::sleep(Duration::from_millis(400)).await;

    // The exact text that gets pasted at the user's cursor. Short
    // enough to drop into a chat box, long enough to be actionable.
    // Keep it single-line so it survives IDE auto-indent rules.
    "[popo] Add your Google Cloud credentials in Settings → GCP Setup to enable real dictation."
        .to_string()
}

/// Message used on the pill info tooltip when `fake_transcribe` runs.
/// Shorter than the pasted string because it has to fit the 248px
/// tooltip width. Kept in one place so the Rust event and the React
/// ErrorTooltip can't drift out of sync.
pub const GCP_SETUP_HINT: &str =
    "Setup needed. Open Settings → GCP Setup to connect your Google Cloud account.";
