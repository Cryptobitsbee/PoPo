// focus — Win32 foreground capture + clipboard ops + paste orchestration.
//
// Phase 2 [6] ships foreground + clipboard helpers (windows.rs).
// Phase 2 [7] fills in the 4-method paste chain per
// docs/PASTE_MECHANICS.md:
//
//   pub mod methods {
//       pub mod enigo;         // primary: SendInput Ctrl+V
//       pub mod wm_paste;      // fallback (a): PostMessage WM_PASTE
//       pub mod uia;           // fallback (b): IUIAutomation ValuePattern
//       pub mod attach_thread; // fallback (c): AttachThreadInput + WM_PASTE
//   }
//   pub mod verify;
//   pub mod orchestrator;

#[cfg(target_os = "windows")]
pub mod windows;

// Phase 2 [7]: paste orchestrator + enigo primary + WM_PASTE fallback.
// Phase 5 polish adds UIAutomation + AttachThreadInput paths per
// docs/PASTE_MECHANICS.md.
#[cfg(target_os = "windows")]
pub mod paste;

#[cfg(target_os = "windows")]
pub mod app_icon;

// focus/app_enum — enumerate top-level running apps for the picker UI.
// Powers `cmd_list_running_apps` which Settings (paste overrides) and
// Modes (per-mode app bindings) both consume.
pub mod app_enum;

// set_foreground_hwnd is used internally by focus::paste (via super::windows
// path), not through this re-export. Keeping the re-export for callers that
// want the flat `focus::*` surface (none yet, but the Tauri commands in
// Phase 2 [6] polish will).
#[cfg(target_os = "windows")]
#[allow(unused_imports)]
pub use self::windows::{
    get_clipboard_text, get_foreground_hwnd, set_clipboard_text, set_foreground_hwnd,
};

// Non-Windows stubs so the crate still compiles on the dev tooling
// surface (e.g., if someone runs `cargo check` from WSL). popo is
// Windows-only at runtime per the brief.
#[cfg(not(target_os = "windows"))]
pub fn get_foreground_hwnd() -> Option<isize> {
    None
}
#[cfg(not(target_os = "windows"))]
pub fn set_foreground_hwnd(_: isize) -> anyhow::Result<()> {
    Ok(())
}
#[cfg(not(target_os = "windows"))]
pub fn get_clipboard_text() -> Option<String> {
    None
}
#[cfg(not(target_os = "windows"))]
pub fn set_clipboard_text(_: &str) -> anyhow::Result<()> {
    Ok(())
}
