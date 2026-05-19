# systemPatterns.md — Rust command patterns, windowing, paste mechanic

## High-level architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Rust (src-tauri) — the daemon                               │
│                                                              │
│  cpal audio capture ─┐                                       │
│                      ├─► resample (rubato) ─► tonic gRPC ──► GCP STT v2
│  global-shortcut ────┤                                     Chirp 3 streaming
│                      │                                       │
│  windows-rs focus ───┤                                       ▼
│  arboard clipboard ──┤                                   transcript
│  enigo paste ────────┤                                       │
│  rusqlite local db ──┘                                       ▼
│                                                       (optional) Gemini Flash
│  Tauri events ──► React (main window + pill window)          │
└──────────────────────────────────────────────────────────────┘
```

## Process model

- **One Tauri binary**, two webview windows:
  - `pill` — always created at boot, transparent, 340×80, never focusable.
  - `main` — created at boot with `visible: false`, shown on tray click.
- System tray icon owns the lifecycle: Open popo / Quit.
- Global hotkey is registered once in `main.rs` via
  `tauri-plugin-global-shortcut`, not re-registered per session.

## The canonical dictation state machine (Rust side)

```
Idle ── hotkey_down ──► Arming
                            │ save foreground HWND, save clipboard
                            ▼
                        Recording ── voice ──► bars emitted every 40ms
                            │
                            │ hotkey_up
                            ▼
                       Finalizing ── await gRPC final ──► have transcript?
                                                              │
                                                              ▼
                                                  (opt) Gemini Flash polish
                                                              │
                                                              ▼
                                                          Pasting
                                                              │
                                                              ▼
                                                       Restoring clipboard
                                                              │
                                                              ▼
                                                           Success ─► Idle
```

Any error → emit `pill:state:error`, restore clipboard if we wrote to it,
restore foreground window, log, return to Idle.

## Tauri event protocol (Rust → React)

All pill state lives in Rust. React only listens and renders.

- `pill:state:sleep`       — payload `{}`
- `pill:state:ready`       — payload `{}`
- `pill:state:active`      — payload `{}` (sent once; active is driven by waveform events)
- `pill:state:processing`  — payload `{}`
- `pill:state:success`     — payload `{}`
- `pill:state:error`       — payload `{ code: string, message: string }`
- `pill:waveform`          — payload `{ bars: number[16] }` every ~40ms during Recording

The React `pillStore` (Zustand) is a thin reducer over these events.

## Command protocol (React → Rust)

Invoked via `@tauri-apps/api/core`'s `invoke()`:

- `cmd_get_settings()` → `Settings`
- `cmd_update_settings(partial)` → `Settings`
- `cmd_list_sessions(limit, cursor)` → `SessionPage`
- `cmd_delete_session(id)` → `()`
- `cmd_copy_session(id)` → `()`
- `cmd_test_paste(text)` → `PasteResult` (used by Test page)
- `cmd_list_modes()` / `cmd_save_mode(mode)` / `cmd_delete_mode(id)`
- `cmd_gcp_test_connection(path)` → `GcpTestResult`
- `cmd_sign_in_google()` / `cmd_sign_out()`
- `cmd_open_main_window()` / `cmd_quit()` (also invoked from tray menu)

No long-running commands block — all STT / paste work is spawned on a Tokio
task and communicates via the pill events above.

## Window management rules (non-negotiable)

- **Pill is never focusable.** Applied at setup via Win32:
  `WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW` OR-ed into the ex-style via
  `GetWindowLongPtrW(GWL_EXSTYLE)` / `SetWindowLongPtrW`.
- `set_ignore_cursor_events(true)` in `sleep` state; `false` in ready / active
  / processing / success / error.
- Main window: `decorations: false`, custom 40px drag region on top of both
  sidebar and content (`data-tauri-drag-region`).

## The paste mechanic — canonical ordering

**This ordering is law. Fallback methods must preserve it.**

```
1.  fg_hwnd      = GetForegroundWindow()
2.  prev_clip    = arboard::Clipboard::get_text()      (may be empty/err — fine)
3.  arboard::Clipboard::set_text(final_text)
4.  SetForegroundWindow(fg_hwnd)
5.  sleep(50ms)   ← OS focus handoff
6.  primary:  enigo.key(Control, Press); enigo.key('v', Click); enigo.key(Control, Release)
7.  sleep(100ms)  ← wait for paste to consume clipboard
8.  if paste verified or best-effort: arboard::Clipboard::set_text(prev_clip)
```

Fallback chain when primary fails (detected via heuristic: focus didn't change
back; Edit control accessible and content unchanged; explicit user report):

- (a) `PostMessage(fg_hwnd, WM_PASTE, 0, 0)` — standard Win32 edit controls
- (b) `IUIAutomation` + `TextPattern` / `ValuePattern::SetValue` — WinUI / UWP / Office
- (c) `AttachThreadInput` + `SetFocus` + `SendMessage(WM_PASTE, 0, 0)` — cross-process edge cases

Clipboard restore runs regardless of which method succeeded. See
`docs/PASTE_MECHANICS.md` for method-per-app mapping.

## Zustand store shapes (React side)

```ts
// pillStore.ts
type PillState = 'sleep' | 'ready' | 'active' | 'processing' | 'success' | 'error';
interface PillStore {
  state: PillState;
  bars: number[];                // length 16, 0..1
  error?: { code: string; message: string };
  setState: (s: PillState) => void;
  setBars: (bars: number[]) => void;
  setError: (e: { code: string; message: string }) => void;
}

// settingsStore.ts — mirrors Settings type from shared-types
// historyStore.ts — paginated sessions cache + mutations
```

Pill never transitions itself — only `setState` is called from event
listeners. No timers in the React tree (except the 300ms hold for success,
which is an animation detail inside the single motion.div).

## Error handling philosophy

- Transcription failure → `error` state, log, `Idle` return. Previous clipboard
  restored. No partial paste.
- Paste failure after exhausting fallbacks → `error` state with a clear
  message; clipboard is left containing the transcript so the user can at
  least Ctrl+V manually *if they want*. This is not a "manual paste fallback
  UI" — there is no prompt; it's just the natural side effect of clipboard
  being the last thing we wrote. Previous clipboard is not restored in this
  specific case (logged as known trade-off).

## Threading

- Tokio multi-thread runtime, `#[tokio::main(flavor = "multi_thread")]`.
- `cpal` callback writes PCM into a bounded `tokio::sync::mpsc` channel.
- Resampler (`rubato`) task reads chunks, writes to gRPC send stream.
- gRPC recv stream task consumes recognition events, emits pill events.
- Paste task runs on a dedicated blocking task (`tokio::task::spawn_blocking`)
  because enigo + Win32 calls are synchronous.
