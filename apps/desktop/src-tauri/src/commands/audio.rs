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
// Two commands:
//   - cmd_read_audio_bytes(path) → Vec<u8>
//     Returns the raw WAV bytes for the given absolute path.
//     The frontend creates a Blob URL and plays it inline.
//     Used by useAudioUpload to upload to Firebase Storage.
//
//   - cmd_get_audio_dir() → String
//     Returns the absolute path of the audio directory so the
//     frontend can display it in the Settings panel for the
//     "Store audio" feature.

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

/// Return the absolute path of `%APPDATA%\ai.popo.desktop\audio\`.
///
/// Shown in Settings → Privacy → Store audio so the user can find
/// their recordings in the filesystem.
#[tauri::command]
pub fn cmd_get_audio_dir(app: AppHandle) -> Result<String, String> {
    let mut dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir failed: {e}"))?;
    dir.push("audio");
    Ok(dir.to_string_lossy().into_owned())
}
