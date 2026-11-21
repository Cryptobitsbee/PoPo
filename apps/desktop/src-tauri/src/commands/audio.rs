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
    let reader = WavReader::open(&safe_path).map_err(|e| format!("failed to open WAV: {e}"))?;
    peaks_from_reader(reader, bar_count)
}

/// Peak-per-bucket on channel 0, normalized to 0..1 by the global max.
///
/// Generic over the reader so the local-file and cloud-download commands
/// share one implementation and cannot produce different waveforms for
/// the same audio.
fn peaks_from_reader<R: std::io::Read>(
    reader: hound::WavReader<R>,
    bar_count: usize,
) -> Result<Vec<f32>, String> {
    let bar_count = bar_count.clamp(1, 256);
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
    // Channel 0 only. Averaging channels dilutes a mic-array recording
    // (Session 45), so this must match `audio/capture.rs`.
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

/// Host that Firebase Storage download URLs must come from.
const FIREBASE_STORAGE_HOST: &str = "firebasestorage.googleapis.com";

/// Cap on a cloud audio download. Storage rules already limit objects to
/// 10 MiB; this is the client-side belt to that braces.
const MAX_CLOUD_AUDIO_BYTES: usize = 12 * 1024 * 1024;

/// Validate a Firebase Storage download URL before Rust fetches it.
///
/// This command makes an outbound request on the frontend's behalf, so the
/// URL is treated as untrusted input even though it originates from
/// Firebase's own `getDownloadURL`. Without these checks the command would
/// be an SSRF primitive: any webview could ask Rust to GET an arbitrary
/// host, including link-local metadata endpoints.
///
/// Requirements: HTTPS, exactly the Firebase Storage host (no subdomain
/// suffix tricks), and a path under the per-user `audio/` prefix that
/// Storage Rules already scope to the owner's UID.
fn validate_cloud_audio_url(raw: &str) -> Result<(), String> {
    let rest = raw
        .strip_prefix("https://")
        .ok_or_else(|| "cloud audio URL must use https".to_string())?;

    let host_end = rest.find('/').unwrap_or(rest.len());
    let host = &rest[..host_end];
    if host != FIREBASE_STORAGE_HOST {
        return Err(format!("unexpected cloud audio host: {host}"));
    }

    // Firebase percent-encodes the object path, so `audio/` arrives as
    // `audio%2F`. Accept either form rather than assuming one.
    let path = &rest[host_end..];
    if !(path.contains("/o/audio%2F") || path.contains("/o/audio/")) {
        return Err("cloud audio URL is not under the audio/ prefix".into());
    }

    Ok(())
}

/// Compute waveform peaks for a recording that exists only in the cloud.
///
/// Why this is a Rust command rather than a `fetch` in the webview:
/// Firebase Storage does not return an `Access-Control-Allow-Origin`
/// header, so a cross-origin `fetch` is blocked by CORS. `<audio>` plays
/// the same URL fine because media elements are exempt from CORS, which
/// is why playback works while the waveform did not. Rust has no CORS, so
/// the download happens here and only the tiny peak array crosses IPC.
///
/// Needed because sessions can legitimately have no local WAV: since
/// Session 61 new session documents do not persist a machine-local path,
/// and older documents may point at a file that no longer exists on this
/// machine (`os error 2`).
#[tauri::command]
pub async fn cmd_get_cloud_audio_peaks(
    window: WebviewWindow,
    url: String,
    bar_count: usize,
) -> Result<Vec<f32>, String> {
    require_main_window(&window)?;
    validate_cloud_audio_url(&url)?;

    let response = reqwest::Client::new()
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("cloud audio download failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "cloud audio download returned HTTP {}",
            response.status().as_u16()
        ));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("cloud audio body read failed: {e}"))?;

    if bytes.len() > MAX_CLOUD_AUDIO_BYTES {
        return Err("cloud audio file is larger than expected".into());
    }

    peaks_from_wav_bytes(&bytes, bar_count)
}

/// Shared peak extraction so the local-file and cloud paths cannot drift.
fn peaks_from_wav_bytes(bytes: &[u8], bar_count: usize) -> Result<Vec<f32>, String> {
    use hound::WavReader;
    let reader = WavReader::new(std::io::Cursor::new(bytes))
        .map_err(|e| format!("failed to parse WAV: {e}"))?;
    peaks_from_reader(reader, bar_count)
}

#[cfg(test)]
mod tests {
    use super::validate_cloud_audio_url;

    const OK_URL: &str = "https://firebasestorage.googleapis.com/v0/b/popo-flow.firebasestorage.app/o/audio%2Fuid123%2Fsess.wav?alt=media&token=abc";

    #[test]
    fn accepts_a_real_firebase_audio_url() {
        assert!(validate_cloud_audio_url(OK_URL).is_ok());
    }

    #[test]
    fn rejects_plain_http() {
        let http = OK_URL.replace("https://", "http://");
        assert!(validate_cloud_audio_url(&http).is_err());
    }

    #[test]
    fn rejects_other_hosts() {
        assert!(
            validate_cloud_audio_url("https://evil.example.com/v0/b/x/o/audio%2Fa.wav").is_err()
        );
    }

    #[test]
    fn rejects_host_suffix_spoofing() {
        // A naive `ends_with` check would accept this.
        assert!(validate_cloud_audio_url(
            "https://firebasestorage.googleapis.com.evil.test/v0/b/x/o/audio%2Fa.wav"
        )
        .is_err());
    }

    #[test]
    fn rejects_link_local_metadata_endpoint() {
        // The SSRF case this validation exists to prevent.
        assert!(validate_cloud_audio_url("https://169.254.169.254/latest/meta-data/").is_err());
    }

    #[test]
    fn rejects_objects_outside_the_audio_prefix() {
        assert!(validate_cloud_audio_url(
            "https://firebasestorage.googleapis.com/v0/b/popo-flow/o/secrets%2Fkey.json"
        )
        .is_err());
    }
}

#[cfg(test)]
mod path_tests {
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
