//
// Narrow IPC access to WAV files created by
// `audio::storage::save_session_wav` under:
//   %APPDATA%\ai.popo.desktop\audio\{sessionId}.wav
//
// Frontend-provided paths are untrusted. Every command canonicalizes both
// the app audio directory and requested file, rejects path/junction escapes,
// requires a regular .wav file, and is callable only from the main webview.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, WebviewWindow};

const MAX_AUDIO_FILE_BYTES: u64 = 64 * 1024 * 1024;

fn require_main_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("audio file commands are available only to the main window".into());
    }
    Ok(())
}

fn audio_dir_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|base| base.join("audio"))
        .map_err(|e| format!("app_data_dir failed: {e}"))
}

fn validate_audio_file(requested: &Path, audio_dir: &Path) -> Result<PathBuf, String> {
    let canonical_dir = std::fs::canonicalize(audio_dir)
        .map_err(|e| format!("audio directory is unavailable: {e}"))?;
    let canonical_file =
        std::fs::canonicalize(requested).map_err(|e| format!("audio file is unavailable: {e}"))?;

    if !canonical_file.starts_with(&canonical_dir) {
        return Err("requested audio file is outside PoPo's audio directory".into());
    }
    if canonical_file
        .extension()
        .and_then(|value| value.to_str())
        .is_none_or(|extension| !extension.eq_ignore_ascii_case("wav"))
    {
        return Err("requested audio file must have a .wav extension".into());
    }

    let metadata = std::fs::metadata(&canonical_file)
        .map_err(|e| format!("could not inspect audio file: {e}"))?;
    if !metadata.is_file() {
        return Err("requested audio path is not a regular file".into());
    }
    if metadata.len() > MAX_AUDIO_FILE_BYTES {
        return Err("audio file is too large to read safely".into());
    }

    Ok(canonical_file)
}

fn validated_path(
    app: &AppHandle,
    window: &WebviewWindow,
    requested: &str,
) -> Result<PathBuf, String> {
    require_main_window(window)?;
    let audio_dir = audio_dir_path(app)?;
    validate_audio_file(Path::new(requested), &audio_dir)
}

/// Read a local PoPo WAV for upload or Blob-based playback.
#[tauri::command]
pub async fn cmd_read_audio_bytes(
    app: AppHandle,
    window: WebviewWindow,
    path: String,
) -> Result<Vec<u8>, String> {
    let safe_path = validated_path(&app, &window, &path)?;
    tokio::fs::read(&safe_path)
        .await
        .map_err(|e| format!("failed to read audio file: {e}"))
}

/// Delete one local PoPo WAV. The same path validation as reads applies.
#[tauri::command]
pub async fn cmd_delete_audio_file(
    app: AppHandle,
    window: WebviewWindow,
    path: String,
) -> Result<(), String> {
    let safe_path = validated_path(&app, &window, &path)?;
    tokio::fs::remove_file(&safe_path)
        .await
        .map_err(|e| format!("failed to delete audio file: {e}"))
}

/// Compute normalized waveform peaks from a local PoPo WAV.
#[tauri::command]
pub fn cmd_get_audio_peaks(
    app: AppHandle,
    window: WebviewWindow,
    path: String,
    bar_count: usize,
) -> Result<Vec<f32>, String> {
    use hound::WavReader;

    let safe_path = validated_path(&app, &window, &path)?;
    let bar_count = bar_count.clamp(1, 256);
    let reader = WavReader::open(&safe_path).map_err(|e| format!("failed to open WAV: {e}"))?;

    let spec = reader.spec();
    let samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Int => {
            let bits = spec.bits_per_sample;
            if !(1..=32).contains(&bits) {
                return Err(format!("unsupported WAV bit depth: {bits}"));
            }
            let max_val = (1u64 << (bits - 1)) as f32;
            reader
                .into_samples::<i32>()
                .filter_map(Result::ok)
                .map(|sample| sample as f32 / max_val)
                .collect()
        }
        hound::SampleFormat::Float => reader
            .into_samples::<f32>()
            .filter_map(Result::ok)
            .collect(),
    };

    if samples.is_empty() {
        return Ok(vec![0.0; bar_count]);
    }

    let channels = spec.channels as usize;
    let mono: Vec<f32> = if channels <= 1 {
        samples
    } else {
        samples.iter().step_by(channels).copied().collect()
    };

    let per_bucket = (mono.len() / bar_count).max(1);
    let mut peaks = Vec::with_capacity(bar_count);
    let mut global_max = 0.0_f32;

    for index in 0..bar_count {
        let start = index.saturating_mul(per_bucket).min(mono.len());
        let end = ((index + 1).saturating_mul(per_bucket)).min(mono.len());
        let peak = mono[start..end]
            .iter()
            .map(|sample| sample.abs())
            .fold(0.0_f32, f32::max);
        global_max = global_max.max(peak);
        peaks.push(peak);
    }

    if global_max > 0.0 {
        for peak in &mut peaks {
            *peak /= global_max;
        }
    }

    Ok(peaks)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn test_root() -> PathBuf {
        std::env::temp_dir().join(format!("popo-audio-test-{}", uuid::Uuid::new_v4()))
    }

    #[test]
    fn accepts_regular_wav_inside_audio_directory() {
        let root = test_root();
        let audio_dir = root.join("audio");
        fs::create_dir_all(&audio_dir).unwrap();
        let wav = audio_dir.join("session.wav");
        fs::write(&wav, b"RIFF").unwrap();

        let result = validate_audio_file(&wav, &audio_dir);
        assert!(result.is_ok());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_files_outside_audio_directory() {
        let root = test_root();
        let audio_dir = root.join("audio");
        fs::create_dir_all(&audio_dir).unwrap();
        let outside = root.join("outside.wav");
        fs::write(&outside, b"RIFF").unwrap();

        let error = validate_audio_file(&outside, &audio_dir).unwrap_err();
        assert!(error.contains("outside"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_non_wav_files_inside_audio_directory() {
        let root = test_root();
        let audio_dir = root.join("audio");
        fs::create_dir_all(&audio_dir).unwrap();
        let text = audio_dir.join("notes.txt");
        fs::write(&text, b"not audio").unwrap();

        let error = validate_audio_file(&text, &audio_dir).unwrap_err();
        assert!(error.contains(".wav"));
        fs::remove_dir_all(root).unwrap();
    }
}
