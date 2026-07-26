# systemPatterns.md — Rust command patterns, windowing, paste mechanic

## High-level architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Rust (src-tauri) — the daemon                               │
│                                                              │
│  cpal audio capture ─┐                                       │
│                      ├─► hand-rolled resample ─► tonic gRPC ─► GCP STT v2
│  global-shortcut ────┤                                     Chirp 3 streaming
│                      │                                       │
│  windows-rs focus ───┤                                       ▼
│  arboard clipboard ──┤                                   transcript
│  enigo paste ────────┘                                       │
│                                                       (optional) Gemini Flash
│  Tauri events ──► React (main window + pill window)          │
└──────────────────────────────────────────────────────────────┘
```

## Process model

- **One Tauri binary**, three webview windows:
  - `pill` — always created at boot, 300×180 transparent host with a much
    smaller visible pill, never focusable.
  - `main` — 1080×680, created hidden and shown from tray/first run.
  - `switcher` — 360×300 transparent Quick Switcher, hidden until invoked.
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

### Security routing invariant (Session 61)

- `pill:*` events go only to `pill`.
- `oauth:callback`, `session:created`, snippet bookkeeping, and `test:*` go
  only to `main`; never broadcast authorization codes or transcripts.
- Cross-webview store-change notifications are the only intentionally shared
  frontend events.
- Capability JSON restricts plugin/core APIs, and `custom_command_allowed()`
  independently gates all registered app commands: `main` may call app
  commands; `switcher` may call only mode-binding, prompt, and hide commands;
  `pill`/unknown labels may call none.
- Every new custom command or event must update this origin model and tests.


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

## Session 58 reliability boundaries

- **Auto-format is a true master gate.** Resolve it before forced/default/app mode selection; mode prompts and mode-specific sounds must not leak through when off.
- **Selected credential files remain authoritative.** Caching parsed key material or OAuth tokens is allowed for performance, but every credential use must first verify the original configured path still exists as a regular file. Never imply that popo copied a key when it only persisted path metadata.
- **One provider seam.** AI Studio and Vertex share request/response logic through `GeminiBackend`; every test, prewarm, keep-warm, and dictation call must resolve the same persisted provider selection.
- **Model upgrades include payload migration.** Moving to Gemini 3.5 required removing deprecated sampling fields and the 2.5-only thinking budget, not only changing the model string.
- **Development builds must never mutate OS autostart.** Otherwise a source-tree debug executable survives installed-app uninstall and launches a console/pill later. Uninstall cleanup must exist both in-app (plugin disable) and in NSIS (Run-value deletion).


## Session 59 reliability boundaries

- A model ID and a cloud location are one compatibility contract. Before
  changing a model, verify its product-specific location table; Gemini 3.5
  Flash-Lite Vertex calls must use `global`, `us`, or `eu`. Normalize stale
  persisted locations both at the IPC boundary and URL builder.
- Do not keep a latency-optimized preview Speech endpoint after Google removes
  feature availability. Chirp 3 production traffic uses a documented GA
  multi-region (`eu` here); `language_codes=["auto"]` remains the official
  language-agnostic request there.
- A disabled master feature must also disable its selector UX. Retaining a
  saved preference is fine, but do not show an active marker or emit selection
  commands while the master switch is off.

## Session 61 security and data-lifecycle boundaries

- Firebase client config and desktop OAuth client IDs are public identifiers,
  never authorization secrets. Source builds use separate projects or no
  Firebase; backend defense is Auth + Rules + quotas/API restrictions.
- OAuth uses a validated Google endpoint, PKCE S256, independent random state,
  random IPv4 loopback port, bounded/time-limited reads, exact callback state,
  and no client secret.
- Gemini AI Studio keys are transient in frontend memory and persist only via
  Windows current-user DPAPI. Initial `null` must never erase the protected key
  before secure hydration completes.
- Audio/export custom IPC never accepts an unconstrained filesystem primitive:
  audio paths canonicalize under app audio storage and native export selects
  the destination itself.
- New Firestore session writes strip `audioStoragePath`, `audioDownloadUrl`,
  and inline app icons. Cloud playback resolves `audioCloudPath` through the
  authenticated SDK.
- Any future Firestore user subcollection must be added simultaneously to
  `firestore.rules`, `cloudDeletion.ts`, privacy inventory, and tests.
- Account deletion performs cloud documents + Storage while authenticated,
  local Rust data/DPAPI/browser data, then Auth deletion and non-syncing store
  resets. Uninstall local-data choice removes bundle AppData and separate logs;
  uninstall alone does not remove cloud data.
- Release logs rotate at 5 MiB with one predecessor and must never include
  transcript/prompt content, tokens, API keys, service-account contents, or
  bearer URLs. Account deletion schedules guaranteed next-start log removal.
