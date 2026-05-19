// gcp/chirp.rs — Speech-to-Text v2 `Recognize` (non-streaming).
//
// Why Recognize and not StreamingRecognize?
//   - popo's push-to-talk has all audio ready at release time — there's
//     no concurrent "speak + transcribe" window where streaming would
//     help visually.
//   - Recognize is a single round-trip, simpler to error-handle.
//   - Typical latency for ≤10s audio: 200–600ms.
//   - When we want live interim-results on the pill (v0.2 feature), we
//     switch to StreamingRecognize without changing the public API.
//
// Audio path:
//   cpal f32 samples (48 kHz mono) ─► rubato ─► 16 kHz f32 ─► i16 PCM bytes
//   └─ gcp::transcribe() caller                                │
//                                                              └─► Google

use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use googleapis_tonic_google_cloud_speech_v2::google::cloud::speech::v2::{
    explicit_decoding_config::AudioEncoding, recognition_config::DecodingConfig, recognize_request,
    speech_client::SpeechClient, CustomPromptConfig, DenoiserConfig, ExplicitDecodingConfig,
    RecognitionConfig, RecognitionFeatures, RecognizeRequest,
};
use tonic::metadata::MetadataValue;

use crate::gcp::auth::Authenticator;

/// Target sample rate Chirp 2 expects for LINEAR16 audio.
pub(crate) const TARGET_SR: usize = 16_000;

/// Build the recognizer resource path for an INLINE config call. The
/// `_` suffix means "use the RecognitionConfig provided in the
/// request, not a pre-registered Recognizer resource."
///
/// The location MUST match the regional endpoint we're calling.
/// `gcp/client.rs::SPEECH_REGION` is the single source of truth.
fn recognizer_resource(project_id: &str) -> String {
    format!(
        "projects/{project_id}/locations/{}/recognizers/_",
        crate::gcp::client::SPEECH_REGION
    )
}

/// Transcribe `samples` (f32 PCM in range [-1.0, 1.0], `input_sr` Hz mono)
/// via Google Speech-to-Text v2 Chirp 3.
///
/// `language_codes` mirrors the streaming API:
///   - `[]` or `["auto"]` → Chirp auto-detect (we normalize empty
///     to `["auto"]` internally — passing empty array errors on v2).
///   - `["en-US"]` → single language
///   - `["hi-IN", "en-US"]` → code-switching
///
/// `_features` is accepted for API parity with the streaming path.
/// It's INTENTIONALLY IGNORED on Chirp 3 (Session 28): Chirp 3
/// doesn't support spoken_punctuation / spoken_emojis /
/// profanity_filter — setting them triggers a gRPC "Invalid
/// argument" error. Automatic punctuation is always on in Chirp 3
/// natively. Kept in the signature so callers don't need to change
/// when we later add multi-model support.
///
/// Returns the joined transcript (trimmed). Errors if auth fails, the
/// gRPC call fails, or Google returns no alternatives.
pub async fn transcribe(
    auth: &Authenticator,
    project_id: &str,
    samples: Vec<f32>,
    input_sr: u32,
    language_codes: &[String],
    _features: RecognitionFeatures,
    custom_prompt: &str,
    // Dictionary phrases to bias recognition toward. Same semantics
    // as the streaming path.
    adaptation_phrases: &[String],
) -> Result<String> {
    if samples.is_empty() {
        return Err(anyhow!("no audio samples captured"));
    }

    // Normalize to what Chirp 3 actually accepts.
    let effective_langs: Vec<String> = if language_codes.is_empty() {
        vec!["auto".to_string()]
    } else {
        language_codes.to_vec()
    };

    // Diagnostic: log audio stats so "empty transcript" bugs are easy
    // to triage. If max_amp is near zero, the mic picked up silence
    // regardless of what Google returns.
    let max_amp = samples.iter().copied().fold(0.0f32, |a, s| a.max(s.abs()));
    let duration_sec = samples.len() as f32 / input_sr as f32;
    tracing::info!(
        "transcribe: samples={} duration={:.2}s input_sr={}Hz max_amp={:.4} model=chirp_3 languages={:?} custom_prompt={}",
        samples.len(),
        duration_sec,
        input_sr,
        max_amp,
        effective_langs,
        if custom_prompt.is_empty() { "off" } else { "on" }
    );

    // 1. Resample to 16 kHz mono if needed.
    let resampled = if input_sr as usize == TARGET_SR {
        samples
    } else {
        resample_to_16k(&samples, input_sr as usize)
    };

    // 2. Convert f32 [-1.0, 1.0] → i16 LINEAR16, then to bytes (little-endian).
    let pcm_bytes = f32_to_pcm16_bytes(&resampled);

    // 3. Build the RecognizeRequest.
    //
    // Chirp 3 config notes (Session 29 — verified against
    // `docs/CHIRP_3_TRANSCRIPTION.md`):
    //   - Model ID: "chirp_3". Only available in `us` + `eu` multi-
    //     regions. Our endpoint + recognizer path are set accordingly
    //     in gcp/client.rs.
    //   - `features: None` — Chirp 3 rejects the unsupported
    //     RecognitionFeatures fields. Automatic punctuation +
    //     capitalization are on natively.
    //   - `denoiser_config { denoise_audio: true, snr_threshold: 0.0 }`
    //     is the Chirp-3-approved denoiser (see the "Enable denoiser"
    //     section of the official docs). snr_threshold is deprecated
    //     on Chirp 3 but must be 0.0 for compatibility.
    //   - LINEAR16 + explicit decoding config is supported (see the
    //     endpointing example in the Chirp 3 docs).
    let request_body = RecognizeRequest {
        recognizer: recognizer_resource(project_id),
        config: Some(RecognitionConfig {
            decoding_config: Some(DecodingConfig::ExplicitDecodingConfig(
                ExplicitDecodingConfig {
                    encoding: AudioEncoding::Linear16 as i32,
                    sample_rate_hertz: TARGET_SR as i32,
                    audio_channel_count: 1,
                },
            )),
            language_codes: effective_langs,
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
            denoiser_config: Some(DenoiserConfig {
                denoise_audio: true,
                snr_threshold: 0.0,
            }),
            adaptation: crate::hotkey::build_speech_adaptation(adaptation_phrases),
            ..Default::default()
        }),
        config_mask: None,
        audio_source: Some(recognize_request::AudioSource::Content(pcm_bytes.into())),
    };

    // 4. Attach auth + set a generous deadline.
    //
    // 90 seconds covers: upload of up to 60s audio over slow networks,
    // Google's processing time, and response download — well above
    // Google's own 60s audio-length limit for sync Recognize.
    let token = auth.access_token().await?;
    let bearer: MetadataValue<_> = format!("Bearer {token}")
        .parse()
        .map_err(|e| anyhow!("bad token value: {e}"))?;

    let mut request = tonic::Request::new(request_body);
    request.set_timeout(Duration::from_secs(90));
    request.metadata_mut().insert("authorization", bearer);

    // 5. Connect + call. The channel is cached process-wide so this is
    // only a real handshake on the first dictation of the session.
    let channel = crate::gcp::client::get_channel().await?;
    let mut client = SpeechClient::new(channel);

    let response = client
        .recognize(request)
        .await
        .context("Speech-to-Text v2 Recognize call failed")?
        .into_inner();

    // 6. Join result transcripts. Each result has >=1 alternative;
    // we take the first (highest confidence).
    let transcript = response
        .results
        .iter()
        .filter_map(|r| r.alternatives.first())
        .map(|alt| alt.transcript.trim())
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" ");

    if transcript.trim().is_empty() {
        return Err(anyhow!(
            "Google returned no transcript (silence? wrong mic?)"
        ));
    }

    Ok(transcript.trim().to_string())
}

/// Resample f32 mono audio from `input_sr` → 16 kHz.
///
/// Uses box-average for downsampling (covers the 44.1 kHz and 48 kHz
/// common microphone rates) and linear interpolation for the rare
/// upsample case. Box-average is a rectangular-window low-pass filter
/// — its sinc-shaped frequency response rolls off near the output
/// Nyquist, which is good enough for speech transcription and
/// completely deterministic (no library panics, no chunk-size quirks).
///
/// Session 15 used rubato's `FftFixedInOut` which failed at runtime
/// with "rubato resample chunk failed" — an FFT chunk-size mismatch
/// that depends on the input/output ratio. The hand-rolled version
/// here can't hit that failure mode.
pub(crate) fn resample_to_16k(input: &[f32], input_sr: usize) -> Vec<f32> {
    if input.is_empty() {
        return Vec::new();
    }
    if input_sr == TARGET_SR {
        return input.to_vec();
    }

    let ratio = input_sr as f64 / TARGET_SR as f64;
    let output_len = (input.len() as f64 / ratio) as usize;
    let mut output = Vec::with_capacity(output_len);

    if ratio >= 1.0 {
        // Downsampling (typical: 48 kHz or 44.1 kHz → 16 kHz).
        // For each output sample, average the input samples that fall
        // within the output sample's time window. This gives implicit
        // anti-aliasing via the rectangular low-pass response.
        for i in 0..output_len {
            let start = (i as f64 * ratio) as usize;
            let end = ((i + 1) as f64 * ratio).ceil() as usize;
            let end = end.min(input.len());
            if start >= end {
                output.push(0.0);
                continue;
            }
            let mut sum = 0.0f32;
            for j in start..end {
                sum += input[j];
            }
            output.push(sum / (end - start) as f32);
        }
    } else {
        // Upsampling (rare: e.g. 8 kHz mic → 16 kHz). Linear
        // interpolation between neighboring input samples.
        for i in 0..output_len {
            let src_idx = i as f64 * ratio;
            let src_i = src_idx as usize;
            let frac = (src_idx - src_i as f64) as f32;
            if src_i + 1 < input.len() {
                let a = input[src_i];
                let b = input[src_i + 1];
                output.push(a + (b - a) * frac);
            } else if src_i < input.len() {
                output.push(input[src_i]);
            }
        }
    }

    output
}

/// Convert f32 [-1.0, 1.0] samples to little-endian i16 PCM bytes.
pub(crate) fn f32_to_pcm16_bytes(samples: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(samples.len() * 2);
    for &s in samples {
        let clamped = s.clamp(-1.0, 1.0);
        let i = (clamped * i16::MAX as f32) as i16;
        out.extend_from_slice(&i.to_le_bytes());
    }
    out
}
