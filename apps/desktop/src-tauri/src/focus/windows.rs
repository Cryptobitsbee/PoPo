// focus/windows.rs — Win32 foreground-window capture + clipboard save/restore.
//
// Phase 2 [6] ships the HWND capture on hotkey-down and the clipboard
// write for the fake transcript. The full 4-method paste chain
// (docs/PASTE_MECHANICS.md: enigo → WM_PASTE → UIAutomation →
// AttachThreadInput) lands in Phase 2 [7].
//
// HWND is stored as `isize` across threads because the raw
// `windows::Win32::Foundation::HWND` is `*mut c_void` (not `Send`).
// We convert back to HWND right before any Win32 call.

use anyhow::{bail, Context, Result};
use arboard::Clipboard;
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, SetForegroundWindow};

/// Grab the HWND of whichever window has the foreground right now.
/// Called the instant the hotkey goes down so we anchor to the user's
/// actual cursor context before the pill does anything.
///
/// Returns `None` if there's no foreground window (rare — usually during
/// desktop transitions or at cold boot).
pub fn get_foreground_hwnd() -> Option<isize> {
    // SAFETY: GetForegroundWindow has no preconditions and returns either
    // a valid HWND or NULL.
    unsafe {
        let hwnd = GetForegroundWindow();
        let raw = hwnd.0 as isize;
        if raw == 0 {
            None
        } else {
            Some(raw)
        }
    }
}

/// Bring the given HWND back to the foreground. Used after the fake
/// (or real) transcription to re-focus the user's original app before
/// pasting.
///
/// Note: `SetForegroundWindow` is restricted on modern Windows —
/// it only works when the calling process has received some user input
/// recently. popo satisfies that because the global hotkey IS user
/// input. If this starts failing in practice, the Phase 2 [7] paste
/// orchestrator fallback includes `AttachThreadInput` for exactly this
/// case; and Phase 5 may globally set `SPI_SETFOREGROUNDLOCKTIMEOUT=0`
/// at boot to disable the lock.
pub fn set_foreground_hwnd(hwnd_raw: isize) -> Result<()> {
    let hwnd = HWND(hwnd_raw as *mut _);
    // SAFETY: HWND is constructed from an isize we captured ourselves.
    // SetForegroundWindow is well-defined for any HWND; returns FALSE
    // if the call is refused by the foreground-lock policy.
    unsafe {
        let ok = SetForegroundWindow(hwnd);
        if !ok.as_bool() {
            bail!("SetForegroundWindow refused (foreground-lock policy)");
        }
    }
    Ok(())
}

/// Read the current clipboard text (UTF-8). `None` if the clipboard is
/// empty, inaccessible, or holds a non-text format we can't decode.
pub fn get_clipboard_text() -> Option<String> {
    Clipboard::new().ok()?.get_text().ok()
}

/// Replace the clipboard contents with the given text.
pub fn set_clipboard_text(text: &str) -> Result<()> {
    let mut clipboard = Clipboard::new().context("failed to open clipboard")?;
    clipboard
        .set_text(text.to_owned())
        .context("failed to set clipboard text")?;
    Ok(())
}
