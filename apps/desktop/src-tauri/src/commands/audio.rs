// commands/audio.rs — audio file commands for the History page.
//
// These commands give the frontend filesystem access to the audio
// files that `audio::storage::save_session_wav` writes to
// `%APPDATA%\ai.popo.desktop\audio\{sessionId}.wav`.
//
// Why Rust commands instead of @tauri-apps/plugin-fs:
//   In Tauri v2, the fs plugin is scoped — every file read must be
//   explicitly allowed via a path glob in tauri.conf.json or the
//   capabilities JSON. Without a scope entry, readFile() fails
//   SILENTLY with a permission error that surfaces only in the
//   Rust log. Rust commands have no such restriction.
//
// Commands:
//   - cmd_read_audio_bytes(path) → Vec<u8>
//   - cmd_get_audio_peaks(path, bar_count) → Vec<f32>   [Session 56]
//   - cmd_get_audio_dir() → String

use tauri::{AppHandle, Manager};

/// Read a local audio file and return its raw bytes.
///
/// Used by the frontend to:
///   1. Upload the WAV to Firebase Storage (useAudioUpload).
///   2. Play it inline via a Blob URL (SessionRow).
///
/// Errors if the path does not exist or is not readable.
#[tauri::command]
pub async fn cmd_read_audio_bytes(path: String) -> Result<Vec<u8>, String> {
    tokio::fs::read(&path)
        .await
        .map_err(|e| format!("failed to read audio file at {path:?}: {e}"))
}

/// Compute waveform peaks from a local WAV file.
///
/// Session 56: replaces the old approach of sending raw bytes to the
/// frontend and trying to decode them with Web Audio API's
/// `decodeAudioData` — which silently failed in WebView2 for Tauri's
/// asset:// protocol URLs AND was fragile for the Blob URL path.
///
/// This Rust-side approach:
///   1. Reads the WAV file directly (via `hound::WavReader`).
///   2. Decodes ALL samples to f32.
///   3. Buckets into `bar_count` segments.
///   4. For each bucket, computes the peak absolute amplitude.
///   5. Normalizes so the loudest peak = 1.0.
///   6. Returns `Vec<f32>` — just 64 tiny JSON numbers.
///
/// The frontend renders these directly as bar heights. No Web Audio
/// dependency, no ArrayBuffer gymnastics, no decoding failures.
#[tauri::command]
pub fn cmd_get_audio_peaks(path: String, bar_count: usize) -> Result<Vec<f32>, String> {
    use hound::WavReader;

    let bar_count = bar_count.max(1).min(256); // sanity clamp

    let reader =
        WavReader::open(&path).map_err(|e| format!("failed to open WAV at {path:?}: {e}"))?;

    let spec = reader.spec();
    let samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Int => {
            let bits = spec.bits_per_sample;
            let max_val = (1u32 << (bits - 1)) as f32;
            reader
                .into_samples::<i32>()
                .filter_map(|s| s.ok())
                .map(|s| s as f32 / max_val)
                .collect()
        }
        hound::SampleFormat::Float => reader
            .into_samples::<f32>()
            .filter_map(|s| s.ok())
            .collect(),
    };

    if samples.is_empty() {
        return Ok(vec![0.0; bar_count]);
    }

    // If stereo+, take only channel 0.
    let channels = spec.channels as usize;
    let mono: Vec<f32> = if channels <= 1 {
        samples
    } else {
        samples.iter().step_by(channels).copied().collect()
    };

    let per_bucket = mono.len().max(1) / bar_count.max(1);
    let per_bucket = per_bucket.max(1);

    let mut peaks = Vec::with_capacity(bar_count);
    let mut global_max: f32 = 0.0;

    for i in 0..bar_count {
        let start = i * per_bucket;
        let end = ((i + 1) * per_bucket).min(mono.len());
        let mut peak: f32 = 0.0;
        for j in start..end {
            let v = mono[j].abs();
            if v > peak {
                peak = v;
            }
        }
        peaks.push(peak);
        if peak > global_max {
            global_max = peak;
        }
    }

    // Pad if fewer buckets than requested (very short file).
    while peaks.len() < bar_count {
        peaks.push(0.0);
    }

    // Normalize to 0..1.
    if global_max > 0.0 {
        for p in &mut peaks {
            *p /= global_max;
        }
    }

    Ok(peaks)
}

/// Return the absolute path of `%APPDATA%\ai.popo.desktop\audio\`.
#[tauri::command]
pub fn cmd_get_audio_dir(app: AppHandle) -> Result<String, String> {
    let mut dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir failed: {e}"))?;
    dir.push("audio");
    Ok(dir.to_string_lossy().into_owned())
}
