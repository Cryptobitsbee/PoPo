// audio/storage.rs — optional on-disk audio retention.
//
// Controlled by the Settings → Privacy → "Store audio" toggle. When
// enabled, every successful dictation writes its audio to
// `%APPDATA%\ai.popo.desktop\audio\{sessionId}.wav`.
//
// Format: 16 kHz mono PCM-16 WAV.
//
// Why 16 kHz PCM-16 instead of native rate f32:
//   - Native cpal capture is typically 48 kHz at f32 → 192 KB/sec.
//     A 10-second recording = ~1.9 MB.
//   - After downsampling to 16 kHz and converting to i16 (same signal
//     we already send to GCP Chirp), it becomes 32 KB/sec → ~320 KB
//     for 10 seconds. That is 6× smaller with no perceptible quality
//     loss for speech (16 kHz covers all speech frequencies; i16 gives
//     96 dB dynamic range, more than adequate for voice).
//   - The 16 kHz i16 samples are exactly what GCP Chirp receives.
//     No second pass needed — we downsample once.
//   - Standard PCM-16 WAV plays in every player (Windows Media Player,
//     VLC, any browser, HTML5 Audio, etc.).
//
// Future improvement: Opus/OGG encoding (~80 KB per 10 seconds) will be
// added once the libopus vendored build is validated on Windows. For
// now, 16 kHz PCM-16 is a good practical balance.
//
// The file path is returned in the `session:created` event payload as
// `audioStoragePath` → saved to Firestore → enables cross-device lookup
// of the Firebase Storage download URL (`audioDownloadUrl`).

use anyhow::{Context, Result};
use hound::{SampleFormat, WavSpec, WavWriter};
use std::path::PathBuf;

/// Write the recording to disk as a 16 kHz mono PCM-16 WAV file and
/// return the absolute path as a String.
///
/// `samples` is the raw f32 mono PCM at `input_sample_rate` (typically
/// 48 kHz from cpal). This function downsamples via box-average to
/// 16 kHz (same algorithm used by the GCP Chirp pipeline) and converts
/// to i16 before writing.
pub fn save_session_wav(
    app: &tauri::AppHandle,
    session_id: &str,
    samples: &[f32],
    input_sample_rate: u32,
) -> Result<String> {
    use tauri::Manager;

    if samples.is_empty() {
        return Err(anyhow::anyhow!(
            "storeAudio: sample buffer is empty — was storeAudio enabled before recording started?"
        ));
    }

    // Resolve and create the audio directory.
    let mut dir: PathBuf = app
        .path()
        .app_data_dir()
        .context("could not resolve app_data_dir")?;
    dir.push("audio");
    std::fs::create_dir_all(&dir).context("failed to create audio dir")?;
    dir.push(format!("{session_id}.wav"));

    // Normalize the buffer for AUDIBLE playback (Session 46).
    //
    // Why: Session 45 removed the AGC, so we now capture raw mic
    // signal. Built-in laptop mics often deliver peak ~0.001–0.005
    // (about -60 to -46 dBFS). When that gets converted to PCM-16,
    // the sample magnitudes are 30–160 out of 32767 — technically
    // valid audio that Chirp can transcribe (it's designed for
    // weak signal), but completely inaudible to the human ear on
    // playback. The user reported recordings being saved as
    // "silent" even though the transcript was correct.
    //
    // Fix: scan the buffer once for the peak, then scale all samples
    // by a single gain factor that brings peak to ~-3 dBFS (0.7).
    // This is a one-shot post-processing pass, NOT real-time AGC.
    // It only touches the file we save to disk; the live streaming
    // path to Chirp continues to use raw audio (unchanged).
    //
    // Rules:
    //   - peak < 0.0001 (essentially silence): don't amplify (would
    //     just make noise loud).
    //   - peak >= TARGET_PEAK: don't attenuate (loud mic stays loud).
    //   - otherwise: scale uniformly so peak == TARGET_PEAK.
    //
    // Standard practice in voice-recorder apps (Audacity's Normalize
    // effect, Voice Recorder, etc.). Doesn't affect dynamics, only
    // overall level.
    let normalized: Vec<f32> = normalize_for_playback(samples);

    // Downsample from native rate to 16 kHz using box-average.
    const TARGET_RATE: u32 = 16_000;
    let pcm16 = downsample_to_pcm16(&normalized, input_sample_rate, TARGET_RATE);

    let spec = WavSpec {
        channels: 1,
        sample_rate: TARGET_RATE,
        bits_per_sample: 16,
        sample_format: SampleFormat::Int,
    };
    let mut writer = WavWriter::create(&dir, spec).context("WavWriter::create failed")?;
    for s in &pcm16 {
        writer.write_sample(*s).context("WAV write_sample failed")?;
    }
    writer.finalize().context("WAV finalize failed")?;

    let path_str = dir.to_string_lossy().into_owned();
    let kb = (pcm16.len() * 2) as f32 / 1024.0;
    let secs = pcm16.len() as f32 / TARGET_RATE as f32;
    tracing::info!(
        "audio stored: {} ({:.1}s, {:.0} KB → {:.0} KB/s @ 16kHz PCM-16)",
        path_str,
        secs,
        kb,
        kb / secs.max(0.01),
    );
    Ok(path_str)
}

/// Downsample `samples` from `from_rate` to `to_rate` using box-average
/// and convert to i16.
///
/// Box-average (low-pass filter before decimation): sum every `ratio`
/// consecutive samples and divide. Fast, allocation-free per chunk, and
/// produces no aliasing artifacts for speech (voice band tops out at
/// ~8 kHz; 16 kHz Nyquist covers it with headroom).
fn downsample_to_pcm16(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<i16> {
    if from_rate == to_rate {
        // No resampling needed — just convert f32 → i16.
        return samples.iter().map(|&s| f32_to_i16(s)).collect();
    }

    // Compute the integer decimation ratio. If the ratio isn't exact
    // (e.g., 44100 → 16000), we do a best-effort integer box-average
    // which slightly shortens the output but is well within acceptable
    // accuracy for a voice recording.
    let ratio = (from_rate as f64 / to_rate as f64).round() as usize;
    let ratio = ratio.max(1);

    let out_len = samples.len() / ratio;
    let mut out = Vec::with_capacity(out_len);
    for chunk in samples.chunks(ratio) {
        let avg: f32 = chunk.iter().sum::<f32>() / chunk.len() as f32;
        out.push(f32_to_i16(avg));
    }
    out
}

/// Convert a float sample in [-1.0, 1.0] to a signed 16-bit PCM sample.
#[inline]
fn f32_to_i16(s: f32) -> i16 {
    (s.clamp(-1.0, 1.0) * 32767.0) as i16
}

/// One-pass loudness normalization for the saved WAV file. See the
/// big comment in `save_session_wav` above for context.
///
/// Returns a new Vec rather than mutating in-place because the caller
/// already wants an owned buffer (we then downsample it).
fn normalize_for_playback(samples: &[f32]) -> Vec<f32> {
    if samples.is_empty() {
        return Vec::new();
    }

    /// Target peak level for the saved file (~ -3 dBFS).
    /// Comfortable on most playback systems without clipping headroom.
    const TARGET_PEAK: f32 = 0.7;
    /// Below this, the buffer is essentially silence — don't
    /// amplify or we'd just make recorded noise floor loud.
    const SILENCE_THRESHOLD: f32 = 0.0001;

    let peak: f32 = samples.iter().copied().fold(0.0f32, |a, s| a.max(s.abs()));

    if peak < SILENCE_THRESHOLD {
        // True silence (muted mic, etc.). Save as-is.
        return samples.to_vec();
    }
    if peak >= TARGET_PEAK {
        // Already loud enough. Save as-is to preserve original dynamics.
        return samples.to_vec();
    }

    let gain = TARGET_PEAK / peak;
    tracing::info!(
        "audio normalize: peak {:.4} → gain {:.2}× (target peak {:.2})",
        peak,
        gain,
        TARGET_PEAK
    );
    samples
        .iter()
        .map(|s| (s * gain).clamp(-1.0, 1.0))
        .collect()
}
