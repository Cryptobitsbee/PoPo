// commands/apps.rs — Tauri commands that expose the running-apps enum.
//
// Used by the AppPicker component in:
//   - Settings → Paste → per-app paste shortcut overrides
//   - Modes   → ModeEditor → per-mode app bindings
//
// The enumeration itself lives in `focus::app_enum`. This file just
// wraps it as a Tauri command. Kept separate from `commands::settings`
// so the Settings command surface doesn't balloon.

use crate::focus::app_enum::{list_running_apps, RunningApp};

/// Return every running + installed app on the user's desktop, deduped
/// by friendly name.
///
/// Called on-demand when the user opens an AppPicker (not on boot,
/// not on any hot path). First call walks the Start Menu + extracts
/// ~100-300 icons (2-5 s); subsequent calls hit the module-level
/// cache in `focus::app_enum` (<100 ms total).
///
/// `refresh: bool` — when `true`, invalidates the installed-apps
/// cache and forces a full rescan. Wired to the picker's refresh
/// button. Defaults to `false` when the frontend omits the arg
/// (Tauri deserializes missing bool args as `false`).
///
/// Offloaded to `spawn_blocking` so the Tauri IPC thread stays
/// responsive: EnumWindows + icon extraction are synchronous Win32
/// calls that would otherwise block the async runtime's worker for
/// the full duration.
#[tauri::command]
pub async fn cmd_list_running_apps(refresh: Option<bool>) -> Result<Vec<RunningApp>, String> {
    let refresh_flag = refresh.unwrap_or(false);
    tokio::task::spawn_blocking(move || list_running_apps(refresh_flag))
        .await
        .map_err(|e| format!("running-apps enumeration task failed: {e}"))
}
