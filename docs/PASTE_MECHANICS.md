# PASTE_MECHANICS.md — Win32 focus + paste implementation plan

> Phase 1 deliverable. Output of the Agent Execution Order step `[4]`.
> The auto-paste mechanic is popo's most failure-prone system. It lives
> at the intersection of Win32 focus, clipboard, cross-process input,
> and every application's own input pipeline. This document specifies
> the exact sequence, the four fallback methods, per-app expectations,
> verification heuristics, and the test matrix.

## 0. Non-negotiable rules (restated from the brief)

- **Auto-paste must always attempt to work.** No user-facing "it failed,
  please paste manually" prompt. The system always tries the next method.
- **Clipboard is always restored** after any successful path.
- **The pill never steals focus.** All focus handoffs are target-window
  focused; the pill window sits at `WS_EX_NOACTIVATE`.
- **Previous foreground HWND is captured the moment the hotkey goes
  down**, not after. The user's cursor placement is ground truth.

## 1. The canonical sequence (primary path)

Every paste goes through this sequence. Fallback methods substitute
step 6 while keeping every other step identical.

```rust
// on_hotkey_down:
let fg_hwnd = unsafe { GetForegroundWindow() };           // 1. capture target
let prev_clip = Clipboard::new()?.get_text().ok();         // 2. save clipboard
// … record audio, transcribe, optional polish …

// on paste:
Clipboard::new()?.set_text(&final_text)?;                  // 3. write transcript
unsafe { SetForegroundWindow(fg_hwnd); }                   // 4. restore focus
std::thread::sleep(Duration::from_millis(50));             // 5. focus dwell
execute_primary_paste()?;                                   // 6. send Ctrl+V
std::thread::sleep(Duration::from_millis(100));            // 7. paste dwell
if let Some(prev) = prev_clip {
    Clipboard::new()?.set_text(&prev)?;                    // 8. restore clipboard
}
```

### Why each step exists

| Step | Purpose                                                                 | Consequence if skipped                                           |
| ---- | ----------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 1    | Anchor to user's cursor before the pill touches anything.               | The pill (or any transient toast) can steal target; paste goes elsewhere. |
| 2    | Save clipboard so we can restore after paste.                           | User's clipboard is silently overwritten forever.                |
| 3    | Put transcript on clipboard.                                            | Ctrl+V has nothing to paste.                                     |
| 4    | Ensure target is foreground again (hotkey release may have wobbled it). | Ctrl+V lands in wrong window.                                    |
| 5    | Windows needs ~50ms to settle foreground lock / activation IPC.         | SendInput arrives before app has focus; keystroke is lost.       |
| 6    | Actually paste.                                                         | —                                                                |
| 7    | App needs time to process the paste and read the clipboard.             | Clipboard restore (step 8) races the paste and wipes the transcript before the app reads it. |
| 8    | Restore user's original clipboard.                                      | User loses their previous clipboard content.                     |

## 2. Primary: `enigo` `SendInput` Ctrl+V

```rust
use enigo::{Enigo, Key, Keyboard, Settings, Direction};

fn primary_paste() -> Result<()> {
    let mut enigo = Enigo::new(&Settings::default())?;
    enigo.key(Key::Control, Direction::Press)?;
    enigo.key(Key::Unicode('v'), Direction::Click)?;
    enigo.key(Key::Control, Direction::Release)?;
    Ok(())
}
```

### Why first

- Highest compatibility — every app that accepts Ctrl+V from a human
  keyboard accepts it from `SendInput`.
- Fast (<5ms).
- Works through UIPI at the same integrity level or lower.

### Known constraints

- **UIPI blocks elevated targets.** If the target is elevated (UAC prompt,
  Admin-launched app), SendInput from our non-elevated daemon silently
  fails. This is expected and documented in §9.
- **Race with foreground-lock.** If `SetForegroundWindow` is suppressed
  (the Win10 foreground-lock policy), the keystroke goes to whatever
  window IS foreground. Mitigations: (a) 50ms dwell (step 5); (b) run
  `SystemParametersInfo(SPI_SETFOREGROUNDLOCKTIMEOUT, 0)` at app start
  to disable the lock entirely for our process.
- **Keyboard-layout sensitivity.** `SendInput` uses virtual key codes;
  Enigo translates `'v'` to `VK_V`. Works on QWERTY, AZERTY, QWERTZ.
  For exotic layouts where V is not a single-press key, we fall back to
  the layout-independent `SendInput` with scancode (Enigo 0.2+ supports
  this). Verified in Phase 3.

## 3. Fallback (a): `PostMessage(WM_PASTE)`

```rust
use windows::Win32::UI::WindowsAndMessaging::{PostMessageW, WM_PASTE};
use windows::Win32::Foundation::HWND;

unsafe fn fallback_wm_paste(target: HWND) -> Result<()> {
    let edit_hwnd = find_focused_edit_control(target)?;
    PostMessageW(Some(edit_hwnd), WM_PASTE, None, None)?;
    Ok(())
}
```

### Why second

- Works asynchronously; doesn't require focus at the moment of the call
  (because the message queues on the target's thread).
- Cheaper than UIAutomation (no COM activation).

### Known constraints

- **Only works on standard Win32 Edit/RichEdit controls** (Notepad, older
  Win32 dialogs, classic WinForms text boxes).
- **Modern controls ignore it.** WinUI/UWP, WPF TextBox, Electron
  contenteditable, browser inputs — all ignore `WM_PASTE`.
- **Needs the actual focused HWND,** not the top-level window. We walk
  the focus chain via `GetGUIThreadInfo(fg_thread)`.
- If the target's clipboard format doesn't include `CF_TEXT`/`CF_UNICODETEXT`,
  `WM_PASTE` is a no-op. arboard writes both; we're fine.

### When it applies

Tried only when the primary Ctrl+V verifiably did nothing (see §7
verification). Expected to succeed in: Notepad, SciTE, some legacy LOB
apps.

## 4. Fallback (b): `IUIAutomation` `ValuePattern::SetValue`

```rust
// Pseudocode — full impl lives in focus/windows.rs under a #[cfg(windows)] gate
let ui: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)?;
let element: IUIAutomationElement = ui.ElementFromHandle(focused_hwnd)?;
let pattern = element.GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)?;
pattern.SetValue(&bstr(&final_text))?;
```

Alternative pattern: `TextPattern` for rich text controls where
`ValuePattern` isn't supported.

### Why third

- Works on modern controls (WinUI, UWP, many WPF controls, Office text
  controls).
- Survives UIPI better than `SendInput` in some edge cases because it's
  message-driven, not input-driven.

### Known constraints

- **Slow.** COM init + pattern lookup: ~50–100ms.
- **Not all controls support ValuePattern.** Rich text editors often
  require `TextPattern` with `DocumentRange` manipulation, which is
  much more involved.
- **Doesn't preserve caret position** in some controls — `SetValue`
  *replaces* the entire value, not inserts at cursor. This is unsuitable
  for editing a half-written message; popo's current use case is
  append/insert-at-empty, which works, but we document this sharp edge.
  Where it misbehaves, we fall through to (c).
- **CoInitializeEx** must be called on the thread that uses COM. We do
  this lazily in the paste task with `CoInitializeEx(None, COINIT_APARTMENTTHREADED)`.

### When it applies

Tried when (a) is inapplicable (not a Win32 Edit) or failed. Expected to
succeed in: WinUI 3 apps, UWP apps, Office text boxes that expose
UIAutomation.

## 5. Fallback (c): `AttachThreadInput` + `SendMessage(WM_PASTE)`

```rust
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::WindowsAndMessaging::{
    AttachThreadInput, GetWindowThreadProcessId, SendMessageW, SetFocus, WM_PASTE,
};

unsafe fn fallback_attach_thread(target: HWND) -> Result<()> {
    let target_tid = GetWindowThreadProcessId(target, None);
    let our_tid = GetCurrentThreadId();
    if target_tid == 0 { bail!("no thread for target"); }
    AttachThreadInput(our_tid, target_tid, true);
    let focused = SetFocus(Some(target));
    SendMessageW(target, WM_PASTE, None, None);
    AttachThreadInput(our_tid, target_tid, false);
    let _ = focused;
    Ok(())
}
```

### Why fourth (last)

- Solves the "cross-process focus" edge case where `SetForegroundWindow`
  returns but `SetFocus` silently refuses because we're not in the
  target's thread input queue.
- Dangerous-ish: while threads are attached, input state is shared —
  keystrokes to us would route through the target's queue momentarily.
  We keep the attachment window tiny (<10ms).

### Known constraints

- Still requires WM_PASTE-compatible target (classic Edit or RichEdit).
- If `AttachThreadInput` succeeds but `SendMessage` blocks (rare — if
  the target's thread is hung), our paste task blocks. Mitigation: run
  with a watchdog timeout; if >500ms, bail and report failure.
- `SendMessage` is synchronous. For a hung app, replace with
  `PostMessage` or wrap in a timeout.

## 6. Method selection flowchart

```
                          ┌──────────────────┐
                          │ primary: enigo   │
                          │ Ctrl+V           │
                          └─────────┬────────┘
                     verification: ok?
                     ├── yes → done
                     └── no ─┐
                             ▼
                 ┌──────────────────────────┐
                 │ is focused control       │
                 │ a Win32 Edit/RichEdit?   │
                 └─────────┬────────────────┘
                    yes    │    no
                     │     ▼
                     │   ┌──────────────────────┐
                     │   │ UIAutomation         │
                     │   │ ValuePattern /       │
                     │   │ TextPattern          │
                     │   └─────────┬────────────┘
                     │         verification: ok?
                     │         ├── yes → done
                     │         └── no ─┐
                     ▼                ▼
           ┌────────────────────────────┐
           │ fallback WM_PASTE          │ ← also reached for classic controls
           └─────────┬──────────────────┘
                 verification: ok?
                 ├── yes → done
                 └── no ─┐
                         ▼
                 ┌──────────────────────────────┐
                 │ AttachThreadInput +          │
                 │ SendMessage WM_PASTE         │
                 └─────────┬────────────────────┘
                       verification: ok?
                       ├── yes → done
                       └── no → emit error, clipboard keeps transcript
```

### "Is focused control a Win32 Edit?" detection

- Walk focused HWND → `GetClassNameW`. If it's one of:
  `Edit`, `RichEdit`, `RichEdit20A`, `RichEdit20W`, `RICHEDIT50W`, `SysMonthCal32`,
  treat as classic Edit.
- Electron/CEF apps report `Chrome_WidgetWin_1` or similar — NOT an Edit.
- WinUI apps report various `Microsoft.UI.*` class names — NOT classic.

## 7. Verification (did the paste succeed?)

Heuristic, cheap, best-effort. We never block the user on verification
longer than ~150ms.

### Primary signal: foreground HWND changed?

After step 6 (Ctrl+V) + step 7 (100ms dwell):

- If `GetForegroundWindow()` no longer equals `fg_hwnd`, paste almost
  certainly failed (something else stole foreground, e.g., a toast).
- If foreground is still `fg_hwnd`, we **assume** success for the primary
  path. Users who paste into contenteditable/web inputs can't be verified
  without UIAutomation inspection of the control's text; we accept this
  false-positive risk for the primary path.

### Secondary signal (optional, v0.2): UIAutomation text snapshot

- Before paste: read `ValuePattern::CurrentValue` or
  `TextPattern::DocumentRange.GetText()` if available → `before`.
- After paste + dwell: read again → `after`.
- If `after == before`, paste failed → escalate to next fallback.
- If `after.ends_with(&transcript)` or `after != before`, succeeded.

This is too slow for v0.1 primary path (adds ~100ms round-trip) but
valuable for the explicit fallback chain where the primary already
failed.

### What we do on definitive failure

After exhausting all 4 methods:

1. Emit `pill:state:error` with `{ code: "paste_failed", message: "Couldn't paste — transcript kept in clipboard" }`.
2. **Do not** restore the previous clipboard. The transcript remains
   available for the user to Ctrl+V themselves if they choose. (This is
   the one exception to the "always restore clipboard" rule, logged as
   a known trade-off.)
3. Error state holds for 2s, then pill returns to sleep.

## 8. Clipboard handling details

- Library: `arboard` 3.x. We prefer `Clipboard::new()?.set_text(s)` over
  direct Win32 `SetClipboardData` because arboard handles CF_TEXT +
  CF_UNICODETEXT + owner-draw edge cases already.
- Clipboard is a serialized global resource. Opening + reading + closing
  takes <5ms typically; occasionally blocks for ~50ms when another app
  has the clipboard open. We retry up to 3 times with 20ms backoff.
- When restoring the previous clipboard, we only restore if we
  successfully read it at step 2. An empty original clipboard is fine —
  we still set it to empty string to restore that state.

## 9. Per-app expectations (initial matrix)

This is the expected-path table for Phase 2 testing. Actual results go
into a "Result" column as we validate. First pass, expected method per
app:

| App                          | Category          | Expected primary | Expected fallback | Notes                                                    |
| ---------------------------- | ----------------- | ---------------- | ----------------- | -------------------------------------------------------- |
| Notepad                      | Classic Win32     | enigo            | WM_PASTE          | Canonical Edit control. Must work flawlessly.            |
| WordPad                      | Classic Win32     | enigo            | WM_PASTE          | RichEdit20W.                                             |
| Chrome text input            | Chromium          | enigo            | UIAutomation      | CEF Chrome_WidgetWin_1.                                  |
| Chrome contenteditable       | Chromium          | enigo            | UIAutomation      | Google Docs, Gmail compose.                              |
| Firefox text input           | Gecko             | enigo            | UIAutomation      | MozillaWindowClass.                                      |
| Edge text input              | Chromium          | enigo            | UIAutomation      | Same as Chrome.                                          |
| VS Code editor               | Electron          | enigo            | UIAutomation      | CEF inside Electron. Ctrl+V routes through Electron kbd handler. |
| Cursor editor                | Electron          | enigo            | UIAutomation      | Same as VS Code.                                         |
| Slack desktop                | Electron          | enigo            | UIAutomation      | Contenteditable.                                         |
| Discord desktop              | Electron          | enigo            | UIAutomation      | Contenteditable.                                         |
| Microsoft Word               | Office            | enigo            | UIAutomation      | Office exposes rich UIAutomation patterns; UIA is a strong fallback. |
| Microsoft Outlook (compose)  | Office            | enigo            | UIAutomation      | Same.                                                    |
| Excel cell                   | Office            | enigo            | UIAutomation      | Cell editing has special paste behavior; monitor closely. |
| Windows Terminal             | Modern Win32      | enigo            | UIAutomation/ATI  | wt.exe. Ctrl+V is "paste" in wt by default. May need WT-specific handling. |
| Legacy cmd.exe               | Classic Console   | enigo            | (tricky)          | Console paste is Edit→Paste in the system menu; Ctrl+V works on Win10 1809+. |
| PowerShell (conhost)         | Classic Console   | enigo            | (tricky)          | Same as cmd.                                             |
| UAC prompt                   | Elevated          | expected fail    | expected fail     | UIPI blocks. Documented; no workaround.                  |
| DirectX fullscreen game      | Game              | expected fail    | expected fail     | DirectInput doesn't accept SendInput text.               |
| Remote Desktop (into VM)     | Virtualized       | enigo            | (depends)         | Works if RDP is focused and running in windowed mode. Expected caveat. |
| Zoom chat                    | Electron          | enigo            | UIAutomation      |                                                          |
| Notion desktop               | Electron          | enigo            | UIAutomation      | Contenteditable.                                         |
| Obsidian                     | Electron          | enigo            | UIAutomation      |                                                          |

The full "Result" column is populated during Phase 2 item [7] and Phase
5 item [16]. This file is updated with actual outcomes as tests run.

## 10. Instrumentation

Every paste attempt logs a structured event:

```json
{
  "ts": 1700000000000,
  "method": "enigo" | "wm_paste" | "uia" | "attach_thread",
  "target_hwnd": 12345,
  "target_class": "Edit",
  "target_process": "notepad.exe",
  "duration_ms": 12,
  "verified": true | false | "unknown",
  "escalated_to": null | "wm_paste" | ...,
  "final_outcome": "ok" | "failed",
  "error": null | "…"
}
```

Written to `%APPDATA%\popo\logs\paste.log` (separate file from general
log). Rotated at 2MB, keep 5. No transcript content is ever logged —
only metadata about the paste attempt.

This log powers the Phase 5 test suite's results column and helps
debug real-world failures reported by users.

## 11. Code structure

```
src-tauri/src/focus/
├── mod.rs                          // public API: PasteOrchestrator
└── windows.rs                      // Win32-gated impl
    ├── capture_foreground_hwnd()
    ├── detect_focused_control_class()
    ├── methods/
    │   ├── enigo.rs                // primary_paste
    │   ├── wm_paste.rs             // fallback_wm_paste
    │   ├── uia.rs                  // fallback_uiautomation
    │   └── attach_thread.rs        // fallback_attach_thread
    ├── verify.rs                   // verification heuristics
    └── orchestrator.rs             // runs the chain, logs to paste.log
```

Public API exposed to the app:

```rust
pub struct PasteOrchestrator { ... }

impl PasteOrchestrator {
    pub fn capture_target() -> Result<CapturedTarget>;
    pub fn paste(target: CapturedTarget, text: &str) -> Result<PasteOutcome>;
}

pub struct CapturedTarget {
    hwnd: HWND,
    thread_id: u32,
    process_name: String,
    class_name: String,
}

pub enum PasteOutcome {
    Ok { method: PasteMethod, verified: bool, duration: Duration },
    Failed { attempts: Vec<PasteAttempt> },
}
```

The orchestrator is the single entry point from the dictation state
machine. It owns the clipboard save/restore, the method selection
flowchart, verification, and logging.

## 12. Phase-2 acceptance for the paste mechanic

Before declaring Section-11 item [7] done:

1. All four methods compile on Windows.
2. Notepad round-trips clean (primary path, no fallback needed).
3. A CEF app (Chrome or Electron) round-trips clean via primary.
4. A Win11 WinUI app (Settings, Snipping Tool search) round-trips via
   UIAutomation fallback.
5. Paste-log file is produced for each attempt with correct metadata.
6. Clipboard restoration is verified by running `Get-Clipboard` in
   PowerShell immediately after a paste and confirming it matches what
   was there before the paste began.
7. `SetForegroundWindow` failures are handled gracefully — paste still
   attempts via AttachThreadInput path if dwell check fails.
