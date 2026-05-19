// focus/paste.rs — paste orchestrator + fallback chain.
//
// Per docs/PASTE_MECHANICS.md §1, every paste goes through this
// canonical sequence:
//
//   1. fg_hwnd       = GetForegroundWindow()          ← done in hotkey::on_press
//   2. prev_clip     = arboard.get_text()             ← done in hotkey::on_press
//   3. arboard.set_text(transcript)                   ← inside execute()
//   4. SetForegroundWindow(fg_hwnd)                   ← inside execute()
//   5. sleep 50 ms (OS focus handoff)                 ← inside execute()
//   6. primary: enigo Ctrl+V (or per-app override)    ← inside execute()
//   7. sleep 100 ms (paste dwell)                     ← inside execute()
//   8. arboard.set_text(prev_clip)                    ← inside execute()
//
// Feature 1 (Session 32): when the foreground app's friendly name
// matches a `PasteOverride` entry, step 6 sends the override
// keystroke (e.g. Ctrl+Shift+V for Cursor / VS Code) instead of
// the default Ctrl+V. The rest of the sequence is untouched.
//
// Fallback chain when the primary doesn't verify (foreground changed,
// toast stole focus, etc.):
//   (a) PostMessage(WM_PASTE) — classic Win32 Edit controls
//   (b) IUIAutomation ValuePattern::SetValue   ← DEFERRED Phase 5 polish
//   (c) AttachThreadInput + SendMessage        ← DEFERRED Phase 5 polish
//
// Phase 2 [7] ships (a) in a simple form (posts to top-level HWND).
// Phase 5 polish adds proper focused-control lookup via GetGUIThreadInfo,
// plus the UIA and AttachThread fallbacks documented in PASTE_MECHANICS.md.
//
// Verification is a cheap heuristic: `GetForegroundWindow()` still equals
// our captured target HWND. Good enough to catch toast-stole-focus; for
// false-positive detection (focus stayed but keypress went nowhere) we'd
// need UIA text snapshots, which are too slow for the primary path.

use anyhow::{Context, Result};
use std::time::Duration;
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, PostMessageW, WM_PASTE};

use super::windows as focus_win;
use crate::hotkey::PasteOverride;

/// Dwell after SetForegroundWindow, before sending keystrokes.
/// Windows 10/11 need ~50 ms to settle the foreground-lock arbitration
/// so SendInput lands in the right window. See PASTE_MECHANICS.md §2.
const FOCUS_DWELL_MS: u64 = 50;

/// Dwell after Ctrl+V, before restoring the clipboard or verifying.
/// Target app needs time to read `CF_TEXT` / `CF_UNICODETEXT` before we
/// overwrite it with the restored prev_clipboard.
const PASTE_DWELL_MS: u64 = 100;

/// Inputs to the paste flow. Populated by `hotkey::on_release` from the
/// `RecordingSession` state captured on hotkey-down.
pub struct PasteContext {
    /// The text to paste. Owned here so we don't clone unnecessarily.
    pub text: String,
    /// HWND of the app that was foreground at hotkey-down. `None` if
    /// the press happened at the desktop or during a transition.
    pub target_hwnd: Option<isize>,
    /// Whatever was on the clipboard before popo touched it. Restored
    /// after a successful paste when `restore_clipboard` is true.
    /// `None` if the clipboard was empty or held a non-text format.
    pub prev_clipboard: Option<String>,
    /// If false, the transcript stays on the clipboard after paste
    /// (the user's original clipboard is discarded). Default true.
    pub restore_clipboard: bool,
    /// Friendly name of the foreground app at press time (e.g. "VS Code").
    /// Used to look up a per-app keystroke override. `None` means we
    /// couldn't resolve the app; paste uses the default keystroke.
    pub target_app_name: Option<String>,
    /// Configured per-app keystroke overrides (Feature 1). When
    /// `target_app_name` matches an entry's `app_name`
    /// (case-insensitive), `execute` sends the override keystroke
    /// instead of Ctrl+V.
    pub paste_overrides: Vec<PasteOverride>,
}

/// Which method succeeded. Logged but not shown to the user.
#[derive(Debug, Clone, Copy)]
pub enum PasteMethod {
    /// Primary: enigo `SendInput` Ctrl+V. Works ~90% of apps.
    Enigo,
    /// Fallback (a): `PostMessage(WM_PASTE)`. Classic Win32 edits only.
    WmPaste,
}

#[derive(Debug)]
pub enum PasteOutcome {
    Ok { method: PasteMethod },
    Failed { reason: String },
}

/// Run the canonical paste sequence + fallback chain.
///
/// Async because steps 5 and 7 sleep via `tokio::time::sleep`. Called
/// from `hotkey::on_release` which is already running on the tauri
/// async runtime.
pub async fn execute(ctx: PasteContext) -> PasteOutcome {
    // Step 3: write transcript to clipboard.
    if let Err(e) = focus_win::set_clipboard_text(&ctx.text) {
        tracing::error!("paste: clipboard write failed: {e}");
        return PasteOutcome::Failed {
            reason: format!("clipboard write failed: {e}"),
        };
    }

    // Step 4: restore foreground to the user's original window.
    // Without this, SendInput would go to whatever app currently owns
    // focus (likely nothing, since the pill is WS_EX_NOACTIVATE and
    // doesn't take focus, but we anchor to the user's actual context).
    if let Some(hwnd) = ctx.target_hwnd {
        if let Err(e) = focus_win::set_foreground_hwnd(hwnd) {
            tracing::warn!("SetForegroundWindow refused (continuing): {e}");
            // Don't bail — sometimes the target is already foreground
            // and Windows returns FALSE anyway. The dwell + SendInput
            // will still likely work.
        }
    }

    // Step 5: focus dwell.
    tokio::time::sleep(Duration::from_millis(FOCUS_DWELL_MS)).await;

    // Step 6: primary — clipboard + paste keystroke.
    //         If the user has a per-app override configured for this
    //         target app, send THAT keystroke. Otherwise fall back to
    //         the default Ctrl+V.
    let override_ks = resolve_paste_keystroke(&ctx);
    let primary_result = match &override_ks {
        Some(keystroke) => {
            tracing::info!(
                "paste: using override keystroke {keystroke:?} for app {:?}",
                ctx.target_app_name.as_deref().unwrap_or("<unknown>")
            );
            try_enigo_keystroke(keystroke)
        }
        None => try_enigo_ctrl_v(),
    };

    // Step 7: paste dwell.
    tokio::time::sleep(Duration::from_millis(PASTE_DWELL_MS)).await;

    // Verify: target still foreground?
    let primary_ok = primary_result.is_ok();
    let still_foreground = verify_target_still_foreground(ctx.target_hwnd);

    if primary_ok && still_foreground {
        // Step 8: maybe restore prev clipboard.
        if ctx.restore_clipboard {
            restore_clipboard(&ctx.prev_clipboard);
        }
        tracing::info!("paste succeeded via enigo Ctrl+V");
        return PasteOutcome::Ok {
            method: PasteMethod::Enigo,
        };
    }

    if let Err(ref e) = primary_result {
        tracing::warn!("enigo primary paste errored: {e}");
    }
    if !still_foreground {
        tracing::warn!("foreground changed during paste dwell — attempting fallback");
    }

    // Fallback (a): WM_PASTE. Cheap, works for classic Edit/RichEdit.
    // Modern controls (WinUI, Electron contenteditable) ignore it.
    if let Some(hwnd) = ctx.target_hwnd {
        match try_wm_paste(hwnd) {
            Ok(()) => {
                // Give the target a beat to process the message, then
                // restore. We can't cheaply verify WM_PASTE landed —
                // proper verification needs UIA. Trust it and move on.
                tokio::time::sleep(Duration::from_millis(PASTE_DWELL_MS)).await;
                if ctx.restore_clipboard {
                    restore_clipboard(&ctx.prev_clipboard);
                }
                tracing::info!("paste succeeded via WM_PASTE fallback");
                return PasteOutcome::Ok {
                    method: PasteMethod::WmPaste,
                };
            }
            Err(e) => {
                tracing::warn!("WM_PASTE fallback failed: {e}");
            }
        }
    }

    // Fallbacks (b) IUIAutomation + (c) AttachThreadInput — DEFERRED
    // to Phase 5 polish. See PASTE_MECHANICS.md §4–5 for the design.

    // All known methods failed. Per PASTE_MECHANICS.md §7, we leave the
    // transcript on the clipboard (the one intentional exception to
    // "always restore clipboard") so the user can Ctrl+V themselves as
    // a last resort. We do NOT restore prev_clipboard in this branch.
    PasteOutcome::Failed {
        reason: "enigo + WM_PASTE both failed; transcript is on clipboard".into(),
    }
}

/// Primary paste method: simulate Ctrl+V via enigo's `SendInput` wrapper.
///
/// This IS what a human keypress produces — most apps handle it
/// transparently. Known caveats (see PASTE_MECHANICS.md §2):
///   - UIPI blocks elevated targets (UAC prompts, Admin-launched apps)
///   - Foreground-lock policy on Windows 10/11 — mitigated by the 50 ms
///     dwell in step 5
fn try_enigo_ctrl_v() -> Result<()> {
    use enigo::{Direction, Enigo, Key, Keyboard, Settings};
    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| anyhow::anyhow!("failed to create enigo: {e}"))?;
    enigo
        .key(Key::Control, Direction::Press)
        .map_err(|e| anyhow::anyhow!("enigo Ctrl press: {e}"))?;
    enigo
        .key(Key::Unicode('v'), Direction::Click)
        .map_err(|e| anyhow::anyhow!("enigo V click: {e}"))?;
    enigo
        .key(Key::Control, Direction::Release)
        .map_err(|e| anyhow::anyhow!("enigo Ctrl release: {e}"))?;
    Ok(())
}

/// Fallback (a): PostMessage(WM_PASTE).
///
/// Phase 2 [7] posts to the top-level HWND. That works for tiny apps
/// where the Edit IS the top-level (rare) but not for Notepad/WordPad
/// where the Edit is a child. Phase 5 polish walks the focus chain via
/// `GetGUIThreadInfo(thread_id).hwndFocus` to find the actual control.
fn try_wm_paste(hwnd_raw: isize) -> Result<()> {
    let hwnd = HWND(hwnd_raw as *mut _);
    // SAFETY: HWND was captured by us earlier and hasn't been destroyed
    // in the interim (windows live far longer than the <1s paste window).
    // PostMessageW is well-defined for any HWND; returns false if the
    // target doesn't handle WM_PASTE.
    unsafe {
        PostMessageW(hwnd, WM_PASTE, WPARAM(0), LPARAM(0))
            .context("PostMessage(WM_PASTE) failed")?;
    }
    Ok(())
}

/// Heuristic: target window is still foreground = paste probably landed.
///
/// Returns `true` if there's no target to verify against (we don't have
/// an HWND to compare), which is conservative — we'll assume the primary
/// worked. For the common case where we DID capture an HWND, compare
/// against the current foreground.
fn verify_target_still_foreground(target: Option<isize>) -> bool {
    let Some(expected) = target else { return true };
    // SAFETY: GetForegroundWindow has no preconditions.
    let current = unsafe { GetForegroundWindow().0 as isize };
    current == expected
}

/// Write the previously-captured clipboard text back. Best-effort —
/// log and continue on failure (the user's clipboard state isn't worth
/// propagating an error the pill would visually surface).
fn restore_clipboard(prev: &Option<String>) {
    let Some(prev) = prev else { return };
    if let Err(e) = focus_win::set_clipboard_text(prev) {
        tracing::warn!("prev-clipboard restore failed: {e}");
    }
}

// ── Per-app paste override dispatch ──────────────────────────

/// Look up a per-app keystroke override for the active `PasteContext`.
///
/// Returns `None` when:
///   - the target app couldn't be resolved at press time (no name),
///   - no override list entry matches the app name
///     (case-insensitive exact match on the friendly name), OR
///   - the matched entry's keystroke is empty / whitespace.
///
/// When `Some(ks)` is returned, the caller sends `ks` instead of Ctrl+V.
fn resolve_paste_keystroke(ctx: &PasteContext) -> Option<String> {
    let app_name = ctx.target_app_name.as_ref()?;
    if ctx.paste_overrides.is_empty() {
        return None;
    }
    let app_lower = app_name.to_lowercase();
    for ov in &ctx.paste_overrides {
        if ov.app_name.to_lowercase() == app_lower {
            let trimmed = ov.keystroke.trim();
            if trimmed.is_empty() {
                return None;
            }
            // Normalize "Ctrl+V" to the default path (avoids the
            // tracing log + re-parse cost when the user's override
            // happens to be identical to the default).
            if is_default_ctrl_v(trimmed) {
                return None;
            }
            return Some(trimmed.to_string());
        }
    }
    None
}

/// Return true when the given keystroke string resolves to the default
/// Ctrl+V (case-insensitive, tolerant of whitespace + "Control" vs "Ctrl").
fn is_default_ctrl_v(ks: &str) -> bool {
    let parts: Vec<String> = ks
        .split('+')
        .map(|p| p.trim().to_lowercase())
        .filter(|p| !p.is_empty())
        .collect();
    if parts.len() != 2 {
        return false;
    }
    let m = &parts[0];
    let k = &parts[1];
    (m == "ctrl" || m == "control") && k == "v"
}

/// Parse a keystroke string like "Ctrl+Shift+V" into `(modifiers, key)`.
///
/// Supported modifiers (case-insensitive):
///   Ctrl / Control / Shift / Alt / Meta / Win / Windows / Super / Cmd / Command
///
/// Supported keys:
///   - single letters A-Z
///   - single digits 0-9
///   - F1..F24
///   - named: Space, Enter, Return, Tab, Escape / Esc, Backspace,
///            Delete / Del, Insert / Ins, Home, End, PageUp / PgUp,
///            PageDown / PgDn, Up / UpArrow, Down / DownArrow,
///            Left / LeftArrow, Right / RightArrow
///
/// Returns `Err` with a human-readable message on any parse failure;
/// the caller logs the error and falls back to Ctrl+V.
fn parse_paste_keystroke(input: &str) -> Result<(Vec<enigo::Key>, enigo::Key)> {
    use enigo::Key;

    let parts: Vec<&str> = input
        .split('+')
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .collect();
    if parts.is_empty() {
        return Err(anyhow::anyhow!("empty keystroke"));
    }
    let (main_token, mod_tokens) = parts.split_last().unwrap();

    let mut modifiers: Vec<Key> = Vec::with_capacity(mod_tokens.len());
    for token in mod_tokens {
        let m = match token.to_lowercase().as_str() {
            "ctrl" | "control" => Key::Control,
            "shift" => Key::Shift,
            "alt" | "option" => Key::Alt,
            "meta" | "win" | "windows" | "super" | "cmd" | "command" => Key::Meta,
            other => return Err(anyhow::anyhow!("unknown modifier {other:?}")),
        };
        modifiers.push(m);
    }

    let main = parse_main_key(main_token)?;
    Ok((modifiers, main))
}

/// Map the last token of a keystroke string to an `enigo::Key`.
fn parse_main_key(token: &str) -> Result<enigo::Key> {
    use enigo::Key;
    let lower = token.to_lowercase();

    // F1 through F24.
    if let Some(rest) = lower.strip_prefix('f') {
        if let Ok(n) = rest.parse::<u32>() {
            if (1..=24).contains(&n) {
                return Ok(match n {
                    1 => Key::F1,
                    2 => Key::F2,
                    3 => Key::F3,
                    4 => Key::F4,
                    5 => Key::F5,
                    6 => Key::F6,
                    7 => Key::F7,
                    8 => Key::F8,
                    9 => Key::F9,
                    10 => Key::F10,
                    11 => Key::F11,
                    12 => Key::F12,
                    13 => Key::F13,
                    14 => Key::F14,
                    15 => Key::F15,
                    16 => Key::F16,
                    17 => Key::F17,
                    18 => Key::F18,
                    19 => Key::F19,
                    20 => Key::F20,
                    21 => Key::F21,
                    22 => Key::F22,
                    23 => Key::F23,
                    24 => Key::F24,
                    _ => unreachable!(),
                });
            }
        }
    }

    // Single-character letter or digit — let enigo handle layout
    // mapping via Unicode. For letters we lowercase so e.g. "V" and
    // "v" both work (the modifiers already encode Shift).
    if lower.chars().count() == 1 {
        let c = lower.chars().next().unwrap();
        if c.is_ascii_alphanumeric() {
            return Ok(Key::Unicode(c));
        }
    }

    let key = match lower.as_str() {
        "space" => Key::Space,
        "enter" | "return" => Key::Return,
        "tab" => Key::Tab,
        "escape" | "esc" => Key::Escape,
        "backspace" => Key::Backspace,
        "delete" | "del" => Key::Delete,
        "insert" | "ins" => {
            // enigo 0.2 doesn't expose a named Insert variant on all
            // platforms; fall through below.
            return Err(anyhow::anyhow!("Insert is not yet supported"));
        }
        "home" => Key::Home,
        "end" => Key::End,
        "pageup" | "pgup" | "page_up" => Key::PageUp,
        "pagedown" | "pgdn" | "page_down" => Key::PageDown,
        "up" | "uparrow" | "arrowup" => Key::UpArrow,
        "down" | "downarrow" | "arrowdown" => Key::DownArrow,
        "left" | "leftarrow" | "arrowleft" => Key::LeftArrow,
        "right" | "rightarrow" | "arrowright" => Key::RightArrow,
        other => return Err(anyhow::anyhow!("unknown key {other:?}")),
    };
    Ok(key)
}

/// Send an arbitrary keystroke via enigo.
///
/// Sequence:
///   - press each modifier in order
///   - click the main key
///   - release each modifier in reverse order
///
/// Returns `Err` on parse failure OR on any enigo error. Callers log
/// the error; the fallback chain (WM_PASTE) runs next.
fn try_enigo_keystroke(keystroke: &str) -> Result<()> {
    use enigo::{Direction, Enigo, Keyboard, Settings};
    let (modifiers, main) = parse_paste_keystroke(keystroke)
        .with_context(|| format!("invalid paste keystroke {keystroke:?}"))?;

    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| anyhow::anyhow!("failed to create enigo: {e}"))?;

    for m in &modifiers {
        enigo
            .key(*m, Direction::Press)
            .map_err(|e| anyhow::anyhow!("enigo {m:?} press: {e}"))?;
    }
    enigo
        .key(main, Direction::Click)
        .map_err(|e| anyhow::anyhow!("enigo {main:?} click: {e}"))?;
    for m in modifiers.iter().rev() {
        enigo
            .key(*m, Direction::Release)
            .map_err(|e| anyhow::anyhow!("enigo {m:?} release: {e}"))?;
    }
    Ok(())
}
