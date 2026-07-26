// commands/system.rs — OS-level app lifecycle commands.
//
// Currently provides:
//   - cmd_launch_uninstaller() — spawns the NSIS uninstaller that
//     ships alongside popo.exe (same $INSTDIR), then exits popo so
//     the uninstaller can delete files without file-locks getting
//     in the way.
//
// Phase 4 polish: this is the in-app "Uninstall popo" button's
// backend. Frontend shows a branded confirmation modal first and
// only invokes this after the user clicks Uninstall.

use std::path::PathBuf;

use tauri::{AppHandle, WebviewWindow};
use tauri_plugin_opener::OpenerExt;

const MICROPHONE_SETTINGS_URI: &str = "ms-settings:privacy-microphone";

fn mic_settings_allowed_window(label: &str) -> bool {
    matches!(label, "main" | "pill")
}

/// Open the Windows microphone privacy panel. The frontend supplies no URL;
/// this command can launch only the compile-time constant above. Pill access
/// is intentional and limited to this single command by the central IPC gate.
#[tauri::command]
pub fn cmd_open_mic_settings(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    if !mic_settings_allowed_window(window.label()) {
        return Err("microphone settings can be opened only from a PoPo window".into());
    }

    app.opener()
        .open_url(MICROPHONE_SETTINGS_URI, None::<&str>)
        .map_err(|_| "Windows microphone settings could not be opened".to_string())
}

/// Return the path to the NSIS uninstaller. Tauri's NSIS template
/// writes `uninstall.exe` next to the main binary inside `$INSTDIR`
/// (for `installMode: currentUser` this resolves to
/// `%LOCALAPPDATA%\popo\uninstall.exe`).
#[cfg(target_os = "windows")]
fn uninstaller_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("could not locate running exe: {e}"))?;
    let dir = exe
        .parent()
        .ok_or_else(|| "running exe has no parent directory".to_string())?;
    let uninstaller = dir.join("uninstall.exe");
    if !uninstaller.exists() {
        return Err(format!(
            "uninstaller not found at {}. This usually means popo was started from a dev build (pnpm tauri dev) — uninstall.exe only exists inside the NSIS-installed copy.",
            uninstaller.display()
        ));
    }
    Ok(uninstaller)
}

#[cfg(not(target_os = "windows"))]
fn uninstaller_path() -> Result<PathBuf, String> {
    Err("uninstaller is Windows-only".to_string())
}

/// Launch the NSIS uninstaller detached from popo and exit this
/// process so the uninstaller can delete `popo.exe` without file
/// locks. NSIS uninstallers self-copy to a temp directory on launch,
/// so popo can exit cleanly before the actual deletion runs.
///
/// Returns after spawning the uninstaller. The frontend typically
/// doesn't care about the return value — the process will exit
/// before the response round-trips back, which is fine.
#[tauri::command]
pub async fn cmd_launch_uninstaller(app: AppHandle) -> Result<(), String> {
    let path = uninstaller_path()?;
    tracing::info!("launching uninstaller: {}", path.display());

    // Remove the plugin-managed HKCU Run value before the executable
    // disappears. The NSIS hook repeats this cleanup for uninstall
    // flows launched from Start Menu / Installed Apps.
    #[cfg(desktop)]
    {
        use tauri_plugin_autostart::ManagerExt;
        if let Err(e) = app.autolaunch().disable() {
            tracing::warn!("could not disable autostart before uninstall (NSIS will retry): {e}");
        } else {
            tracing::info!("autostart disabled before uninstall");
        }
    }

    // Spawn detached. On Windows NSIS will self-copy to %TEMP% so it
    // survives popo exiting immediately after.
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS so the uninstaller
        // doesn't inherit our console (there isn't one in release, but
        // belt-and-suspenders) and survives this process exit.
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const DETACHED_PROCESS: u32 = 0x0000_0008;

        std::process::Command::new(&path)
            .creation_flags(CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS)
            .spawn()
            .map_err(|e| format!("failed to spawn uninstaller: {e}"))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new(&path)
            .spawn()
            .map_err(|e| format!("failed to spawn uninstaller: {e}"))?;
    }

    // Give the NSIS uninstaller ~400ms to self-copy to %TEMP% and
    // start its own window, then exit popo. If we exit immediately
    // the uninstaller's parent handle dies mid-copy on some Windows
    // configurations and it never actually appears.
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        tracing::info!("exiting popo so uninstaller can delete files");
        handle.exit(0);
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::mic_settings_allowed_window;

    #[test]
    fn microphone_settings_action_is_limited_to_popo_windows() {
        assert!(mic_settings_allowed_window("main"));
        assert!(mic_settings_allowed_window("pill"));
        assert!(!mic_settings_allowed_window("switcher"));
        assert!(!mic_settings_allowed_window("unknown"));
    }
}
