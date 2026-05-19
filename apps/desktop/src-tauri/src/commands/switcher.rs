// commands/switcher.rs — Quick Mode Switcher window lifecycle +
// pending-mode state management.
//
// The switcher is a transparent always-on-top window configured in
// tauri.conf.json with `label: "switcher"`, hidden at boot. This
// module controls:
//
//   - `show_mode_switcher` — save the caller's foreground HWND,
//     show + focus the switcher window. Called from the global
//     hotkey handler (Ctrl+Shift+M) and from a Tauri command so the
//     frontend could show it programmatically too.
//
//   - `hide_mode_switcher` — hide the window + restore the caller's
//     foreground so the user's typing focus returns to whatever they
//     were doing. Called by the switcher page on Escape / click-
//     outside / selection.
//
//   - `cmd_set_pending_forced_mode` — user picked a mode in the
//     switcher. The NEXT `on_press` will consume this id and force
//     the corresponding mode for that recording.
//
//   - `cmd_clear_pending_forced_mode` — user cancelled without
//     picking (Escape in the switcher with nothing selected).
//
// Kept separate from `commands::settings` because its lifecycle is
// distinct (window show/hide, HWND save/restore) and the audit
// surface is smaller that way.

use tauri::{command, AppHandle, Manager, State};

use crate::focus;
use crate::hotkey::PopoState;

/// Show the switcher window and save the current foreground HWND so
/// we can restore focus on close. Also clears any stale pending
/// mode — a fresh switcher open means the previous unconsumed pick /// is no longer intended.
///
/// **Windows focus-acquisition** (Session 38 fix). On Windows, calling
/// `Window.set_focus()` (which translates to `SetForegroundWindow`) is
/// often refused for transparent always-on-top windows like ours —
/// the OS's foreground-lock keeps focus on whichever app the user
/// came from. The window APPEARS (mouse events reach it, so clicks
/// work) but keystrokes route to the previous app, so ↑↓ / Enter /
/// Escape never reach the React handler.
///
/// The reliable workaround is the `AttachThreadInput` trick:
///   1. Identify the foreground thread (the user's previous app).
///   2. Briefly attach our thread's input queue to the foreground
///      thread's input queue.
///   3. With the queues attached, our `SetForegroundWindow` call is
///      treated as if it came from the foreground thread itself —
///      Windows allows it.
///   4. Detach the input queues so we don't keep mirroring keystrokes
///      from the previous app.
///
/// We also call `BringWindowToTop` + `SetFocus` to make sure the
/// keyboard caret lands inside our webview. The Tauri
/// `Window::set_focus()` is kept as a fallback in case the Win32
/// path fails (e.g. on some virtual desktops or remote sessions).
pub async fn show_mode_switcher(app: &AppHandle) -> Result<(), String> {
    // Save whatever window was foreground at the moment the user
    // triggered the switcher. Note: the pill is WS_EX_NOACTIVATE so
    // it can't be foreground; this HWND is always a real app.
    let caller_hwnd = focus::get_foreground_hwnd();

    {
        let state = app.state::<PopoState>();
        if let Ok(mut g) = state.inner().switcher_caller_hwnd.lock() {
            *g = caller_hwnd;
        }
        // Clear any stale pending pick from a previous un-consumed open.
        if let Ok(mut g) = state.inner().pending_forced_mode_id.lock() {
            *g = None;
        }
    }

    let win = app
        .get_webview_window("switcher")
        .ok_or_else(|| "switcher window not found".to_string())?;

    // Center on the primary monitor each time we show — users on
    // multi-monitor setups expect the switcher to land on the screen
    // they're actively using, and Tauri's `center: true` in config
    // only applies to initial creation.
    let _ = win.center();
    win.show().map_err(|e| format!("show failed: {e}"))?;

    // Force the OS to give our window keyboard focus, not just
    // visual top. See doc comment above for why this is needed.
    #[cfg(target_os = "windows")]
    {
        if let Ok(hwnd) = win.hwnd() {
            unsafe {
                use windows::Win32::Foundation::HWND;
                use windows::Win32::UI::Input::KeyboardAndMouse::SetFocus;
                use windows::Win32::UI::WindowsAndMessaging::{
                    BringWindowToTop, SetForegroundWindow,
                };

                let switcher_hwnd = HWND(hwnd.0 as *mut _);
                // BringWindowToTop for z-order, SetForegroundWindow
                // for input focus. Our process just received the
                // Ctrl+Shift+M global-shortcut event, so Windows
                // allows us to foreground (we're the "last input"
                // receiver). SetFocus puts the keyboard caret in
                // the webview so arrow keys / Enter / Esc reach React.
                let _ = BringWindowToTop(switcher_hwnd);
                let _ = SetForegroundWindow(switcher_hwnd);
                let _ = SetFocus(switcher_hwnd);
            }
        }
    }

    // Tauri's set_focus is kept as a fallback / no-op on non-Windows
    // builds (the Win32 block above is the load-bearing path on
    // Windows). On other platforms this is the only focus call.
    #[cfg(not(target_os = "windows"))]
    win.set_focus()
        .map_err(|e| format!("set_focus failed: {e}"))?;
    #[cfg(target_os = "windows")]
    let _ = win.set_focus();

    tracing::info!("switcher: shown (caller_hwnd={:?})", caller_hwnd);
    Ok(())
}

/// Tauri command wrapper so the frontend can call this too (e.g.,
/// if we ever add a tray menu item for "Show mode switcher").
#[command]
pub async fn cmd_show_mode_switcher(app: AppHandle) -> Result<(), String> {
    show_mode_switcher(&app).await
}

/// Hide the switcher window and restore the caller's foreground so
/// typing focus goes back to where it was. Called from the switcher
/// page on Escape / after a selection.
#[command]
pub async fn cmd_hide_mode_switcher(app: AppHandle) -> Result<(), String> {
    // Restore caller focus BEFORE hiding \u2014 SetForegroundWindow on a
    // hidden window is sometimes ignored by Windows, so we do it
    // while the switcher is still visible (Windows is fine with
    // switching FROM a visible window TO another visible one).
    let caller_hwnd = {
        let state = app.state::<PopoState>();
        state
            .inner()
            .switcher_caller_hwnd
            .lock()
            .ok()
            .and_then(|g| *g)
    };

    if let Some(hwnd) = caller_hwnd {
        if let Err(e) = focus::set_foreground_hwnd(hwnd) {
            tracing::warn!("switcher: couldn't restore caller focus: {e}");
        }
    }

    if let Some(win) = app.get_webview_window("switcher") {
        let _ = win.hide();
    }

    tracing::info!("switcher: hidden");
    Ok(())
}

/// Record the user's mode pick from the Quick Switcher. The NEXT
/// `on_press` (primary or mode hotkey) will use this id and clear it.
#[command]
pub fn cmd_set_pending_forced_mode(
    state: State<'_, PopoState>,
    mode_id: String,
) -> Result<(), String> {
    let trimmed = mode_id.trim().to_string();
    if trimmed.is_empty() {
        return Err("empty mode id".to_string());
    }
    let mut slot = state
        .inner()
        .pending_forced_mode_id
        .lock()
        .map_err(|_| "pending_forced_mode_id mutex poisoned".to_string())?;
    tracing::info!("cmd_set_pending_forced_mode: {trimmed}");
    *slot = Some(trimmed);
    Ok(())
}

/// Drop any pending mode pick. Called when the user Escapes out of
/// the switcher without making a selection, so a stale pick doesn't
/// linger and hijack their next dictation.
#[command]
pub fn cmd_clear_pending_forced_mode(state: State<'_, PopoState>) -> Result<(), String> {
    let mut slot = state
        .inner()
        .pending_forced_mode_id
        .lock()
        .map_err(|_| "pending_forced_mode_id mutex poisoned".to_string())?;
    if slot.is_some() {
        tracing::info!("cmd_clear_pending_forced_mode");
    }
    *slot = None;
    Ok(())
}
