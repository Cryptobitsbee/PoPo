// gcp - Vertex AI Live API speech-to-text + Gemini post-processing.
//
// Speech-to-text lives in `transcribe_live`; cost math in `cost`.
// `fake_transcribe` stays available as an explicit fallback when the user
// hasn't configured their GCP credentials yet — NO silent fallback on
// real-call errors (those should surface to the pill error state so the
// user knows something's wrong).

pub mod auth;
pub mod cost;
pub mod gemini;
pub mod transcribe_live;

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
    /// Language code for transcription ("auto", "en-US", "hi-IN", etc.).
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

/// Transcribe a finished buffer of audio.
///
/// Used by the Test page, which has all its audio in hand rather than
/// streaming it. Runs over the same Gemini 3.5 Transcribe Live socket as
/// real dictation so the Test page can never disagree with the hotkey
/// path about what the engine does.
///
/// `language_codes` empty means automatic language identification.
/// `custom_vocabulary` biases recognition and, unlike the old PhraseSet
/// adaptation, works alongside auto-detection.
pub async fn transcribe(
    auth: &Authenticator,
    config: &GcpConfig,
    samples: &Arc<Mutex<VecDeque<f32>>>,
    input_sample_rate: u32,
    language_codes: &[String],
    custom_vocabulary: &[String],
) -> Result<String> {
    let drained: Vec<f32> = {
        let guard = samples
            .lock()
            .map_err(|_| anyhow::anyhow!("audio sample mutex poisoned"))?;
        guard.iter().copied().collect()
    };

    let resampled = if input_sample_rate as usize == crate::audio::pcm::TARGET_SR {
        drained
    } else {
        crate::audio::pcm::resample_to_16k(&drained, input_sample_rate as usize)
    };
    let pcm = crate::audio::pcm::f32_to_pcm16_bytes(&resampled);

    let mut vocab = custom_vocabulary.to_vec();
    vocab.truncate(transcribe_live::MAX_CUSTOM_VOCABULARY);

    // The Test page shows what the engine heard, so VERBATIM: no
    // cleanup, no mode prompt. It is a microphone check, not a
    // formatting demo.
    let session_config = transcribe_live::SessionConfig {
        mode: transcribe_live::TranscribeMode::Verbatim,
        language_codes: language_codes.to_vec(),
        custom_vocabulary: vocab,
    };

    let token = auth.access_token().await?;
    let mut session =
        transcribe_live::LiveSession::open(&token, &config.project_id, session_config).await?;

    session.begin_utterance().await?;
    // Same chunking as the live forwarder so one oversized frame can't
    // stall the socket on a long test recording.
    for chunk in pcm.chunks(25_600) {
        session.send_audio(chunk.to_vec()).await?;
    }
    let transcript = session.end_utterance().await?;
    session.close().await;

    if transcript.trim().is_empty() {
        return Err(anyhow::anyhow!(
            "No transcript returned (silence, or the wrong microphone?)"
        ));
    }
    Ok(transcript)
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
