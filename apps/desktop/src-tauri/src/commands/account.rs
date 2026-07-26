// commands/account.rs — account management commands.
//
// The HEAVY lifting (Firestore document deletion across sessions +
// modes + settings + snippets + dictionary + appIcons collections,
// Firebase Auth deleteUser) happens on the FRONTEND via the Firebase
// JS SDK — that code lives in `components/settings/AccountDangerZone`.
// This file owns the LOCAL-state cleanup: clear on-disk WAV audio,
// clear the first-run marker, and reset PopoState to defaults so
// the user is dropped back at the GCP-not-configured state if they
// stay signed out.
//
// Kept separate from commands::settings so the destructive path has
// its own review surface + explicit audit trail in the commands dir.

use std::path::PathBuf;

use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::hotkey::PopoState;

/// Wipe every piece of local state popo owns on disk + in memory.
///
/// Called by the frontend's Account → Danger Zone → Delete all my
/// data flow AFTER the Firestore + Firebase Auth side has succeeded
/// (so we're only ever tearing down local state we know the user
/// already consented to remove).
///
/// Specifically:
///
///   1. **Audio cache.** Deletes every WAV in
///      `%APPDATA%\\ai.popo.desktop\\audio\\` (the dir the
///      `storeAudio` feature writes to). Directory stub is left
///      behind \u2014 it's cheap, and recreated on next save.
///
///   2. **GCP config.** Clears `PopoState.gcp` so subsequent
///      dictations fall back to the `fake_transcribe` setup hint.
///      The persisted `%APPDATA%\\ai.popo.desktop\\gcp.json` contains
///      only the selected source path/project/language. popo never copies
///      or deletes the external service-account JSON.
///
///   3. **First-run marker.** Removed so the next launch shows the
///      welcome overlay again (fresh-install UX).
///
///   4. **Runtime caches.** Snippets + dictionary + mode bindings +
///      paste overrides in PopoState are cleared. This doesn't touch
///      localStorage on the frontend \u2014 the frontend clears its
///      stores independently, which triggers `cmd_set_*` calls that
///      re-emptiy these same PopoState fields. Doing it here too is
///      defensive + keeps the Rust side consistent even if a
///      frontend-side cleanup step races.
///
/// Returns the number of audio files deleted, purely for the
/// UI's \"cleared N recordings\" confirmation toast.
#[tauri::command]
pub async fn cmd_clear_local_user_data(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, PopoState>,
) -> Result<u64, String> {
    if window.label() != "main" {
        return Err("local user-data erasure is available only from the main window".into());
    }
    let mut deleted_audio: u64 = 0;

    // 1. Audio cache.
    if let Ok(audio_dir) = audio_dir_path(&app) {
        if audio_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(&audio_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() {
                        if std::fs::remove_file(&path).is_ok() {
                            deleted_audio += 1;
                        } else {
                            tracing::warn!(
                                "cmd_clear_local_user_data: failed to delete {:?}",
                                path
                            );
                        }
                    }
                }
            }
        }
    } else {
        tracing::warn!("cmd_clear_local_user_data: couldn't resolve audio dir");
    }

    // 2. GCP/Gemini config in PopoState and on disk. The external
    // service-account JSON selected by the user is never touched.
    if let Ok(mut guard) = state.inner().gcp.lock() {
        *guard = None;
    }
    if let Ok(mut guard) = state.inner().gemini_api_key.lock() {
        *guard = None;
    }
    crate::commands::gcp::delete_persisted_gcp_config(&app)?;
    crate::commands::secrets::delete_gemini_api_key(&app)?;
    schedule_release_log_cleanup();

    // 3. First-run marker.
    if let Ok(marker) = first_run_marker_path(&app) {
        let _ = std::fs::remove_file(&marker);
    }

    // 4. Runtime caches.
    if let Ok(mut g) = state.inner().snippets.lock() {
        *g = Vec::new();
    }
    if let Ok(mut g) = state.inner().dictionary.lock() {
        *g = Vec::new();
    }
    if let Ok(mut g) = state.inner().mode_bindings.lock() {
        *g = Vec::new();
    }
    if let Ok(mut g) = state.inner().paste_overrides.lock() {
        *g = Vec::new();
    }
    if let Ok(mut g) = state.inner().mode_hotkeys.lock() {
        *g = Vec::new();
    }

    tracing::info!(
        "cmd_clear_local_user_data: wiped {} audio file(s) + GCP metadata + protected Gemini key + runtime caches",
        deleted_audio
    );
    Ok(deleted_audio)
}

/// Resolve `%APPDATA%\\ai.popo.desktop\\audio\\` using the same logic
/// `audio::storage` uses when writing. Keeping the path derivation
/// here rather than exposing it from `audio::storage` avoids
/// introducing a public API for something only one consumer needs.
fn audio_dir_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir failed: {e}"))?;
    Ok(base.join("audio"))
}

/// Same resolution as `lib::first_run_marker_path` but duplicated
/// here because `lib` isn't in scope from commands without a cross-
/// crate import. Both point at the same `.installed` file.
fn first_run_marker_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir failed: {e}"))?;
    Ok(base.join(".installed"))
}

/// Release diagnostics are written before Tauri resolves `app_data_dir`, under
/// `%APPDATA%\popo`. Best-effort truncate the active file now, remove its
/// rotated predecessor, and leave a marker that `main::init_tracing` consumes
/// before opening the logger on the next launch. Log cleanup must not make an
/// otherwise-successful account deletion fail because Windows may hold the
/// active writer open.
fn schedule_release_log_cleanup() {
    let Ok(app_data) = std::env::var("APPDATA") else {
        return;
    };
    let log_dir = PathBuf::from(app_data).join("popo");
    if std::fs::create_dir_all(&log_dir).is_err() {
        return;
    }
    let _ = std::fs::remove_file(log_dir.join("popo.log.old"));
    let _ = std::fs::OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(log_dir.join("popo.log"));
    let _ = std::fs::write(log_dir.join(".clear-logs-on-next-start"), b"");
}
