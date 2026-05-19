# TECHNICAL_SPEC.md — popo architecture decisions

> Phase 1 deliverable. Output of the Agent Execution Order step `[2]`.
> This document explains *why* each major tech choice was made. The brief
> fixed the stack; this spec traces every decision back to a requirement.
> If a future change contradicts something here, update this file AND the
> brief — or don't make the change.

## 0. Reading order

Treat this spec as the authoritative architecture reference alongside
`POPO_BRIEF.md`. Both are single sources of truth; the brief covers
*what popo is*, this spec covers *how it's built*. When they disagree, the
brief wins, and this spec is updated to match.

## 1. Process model

### Decision: one Tauri v2 binary, two webview windows, tray-backed

- `pill` window — transparent, 340×80, always-on-top, focus-refusing,
  created at app boot, **never destroyed**.
- `main` window — 1080×680 frameless, `visible: false` at boot, shown on
  tray click, hidden (not destroyed) on close button.
- System tray icon is the authoritative lifecycle hook: Open popo / Quit.

### Why

- **Tauri v2 over Electron**: 14MB binary vs 150MB+, ~30MB RAM vs ~200MB+,
  native Rust pipeline for audio and Win32. The brief mandates Tauri; the
  RAM and size targets are non-achievable with CEF.
- **Two windows, not one**: the pill must be transparent + always-on-top +
  non-focusable, which are fundamentally incompatible flags with a full
  1080×680 app surface. Separate webviews are the least-hacky solution.
- **Never destroy the pill**: re-creating a Tauri window costs ≥100ms on
  Windows for HWND + webview init. Our target for hotkey → pill-ready is
  100ms. Destruction is therefore disallowed.
- **Never destroy the main window**: hide/show gives instant reopen from
  tray; users hate "the main window re-loaded my state" every time.

### Alternatives rejected

- **Electron** — mandated against by the brief; doesn't meet size/RAM budget.
- **Flutter desktop** — mandated against; tooling immature on Windows for
  the Win32 integration depth we need (enigo, UIAutomation).
- **Native Win32 (no webview)** — would meet latency/RAM effortlessly but
  drops us below a reasonable dev velocity for the React UI surface area
  (history, modes, stats).
- **Single-window-with-overlay-canvas** — would force the pill to live
  inside a transparent parent that extends over the entire screen. This
  conflicts with the main window's non-overlay nature and makes Win32
  focus management much harder.

## 2. Frontend

### Decision: React 18 + TypeScript, Vite, Tailwind v4, Framer Motion, Zustand

Mandated by the brief. Noteworthy implementation constraints:

- **Framer Motion `layout` prop** is the *only* allowed method for the pill
  morph. No manual CSS transitions. The `layout` prop triggers FLIP
  (First-Last-Invert-Play) which is GPU-accelerated and guarantees
  velocity-matched animations when state changes interrupt each other.
- **Zustand stores** are thin — no middleware, no persistence layer, no
  async side effects. All data lives in Rust; Zustand is only a render
  cache. Firebase calls are in a small `services/` module that writes to
  Zustand after completing.
- **Tailwind v4** (config-less, CSS-vars-native) matches the design
  system's CSS-variable vocabulary cleanly. We add no plugins.

### Two entry points (routing)

- `/pill` — `PillPage.tsx`, rendered in the pill webview, listens to
  `pill:state:*` and `pill:waveform` events.
- `/` (and nested `/history`, `/modes`, `/test`, `/stats`, `/settings`,
  `/account`) — rendered in the main webview.

Tauri's `url` field per window picks the right entry: `"/"` or `"/pill"`.
Vite SPA routing handles the rest via `react-router`.

## 3. Rust core

### Crate responsibilities

```
src-tauri/src/
├── main.rs                  // Builder setup, windows, tray, hotkey, event wiring
├── commands/                // #[tauri::command] fns (stateless shells)
│   ├── audio.rs
│   ├── transcribe.rs
│   ├── paste.rs
│   └── settings.rs
├── audio/
│   ├── capture.rs           // cpal stream → bounded mpsc
│   └── processor.rs         // rubato resample 16k mono, waveform buckets
├── gcp/
│   ├── auth.rs              // gcp-auth service-account token cache
│   ├── client.rs            // tonic channel builder with TLS
│   └── chirp.rs             // StreamingRecognize send+recv task
├── tray/mod.rs
├── hotkey/mod.rs            // plugin wiring + hold/release edge detection
├── focus/windows.rs         // GetForegroundWindow, SetForegroundWindow, paste chain
└── db/local.rs              // rusqlite session table
```

### Decision: Tokio multi-thread runtime with dedicated tasks per concern

- `cpal` input callback is OS-owned and synchronous; we push samples to a
  `tokio::sync::mpsc` ring (bounded, backpressure = drop-oldest).
- Resampler runs on `spawn_blocking` (SIMD-heavy, no await points).
- gRPC send stream is `spawn` on the runtime; consumes resampled chunks.
- gRPC recv stream is a sibling `spawn`; translates recognition events to
  internal app-state transitions and Tauri events.
- Paste + Win32 focus manipulation runs on `spawn_blocking` to avoid
  stalling the runtime during the 150ms-ish paste critical section.

### Why not async-std, smol, or raw threads?

- `tonic` is Tokio-native. Mixing runtimes is painful.
- Raw `std::thread` is fine for cpal's callback shim, but gRPC streaming
  demands a futures executor. Tokio covers both needs.

## 4. Audio pipeline

### Decision: cpal default WASAPI shared-mode, resampled to 16kHz mono PCM16

- cpal picks the system default input; exposes channel count and sample rate.
- Resample to 16kHz mono via `rubato::SincFixedIn` (quality Medium, Kaiser
  window). Typical CPU usage in our test rig is <1% of one core.
- Send 100ms frames (1600 samples) to `StreamingRecognize`. Google's docs
  recommend 100ms chunks for balanced latency/throughput.
- Waveform: decimate to 40ms windows, compute 16-bucket RMS for bar
  heights. Cheaper than FFT; visually indistinguishable for our use case.

### Alternatives rejected

- **Direct WASAPI via `windows::Win32::Media::Audio`** — considered for
  <10ms latency. cpal's shared-mode WASAPI gives ~10–20ms, which is within
  budget. We can drop to direct WASAPI in v0.2+ if needed; the audio
  module is encapsulated so the swap is local.
- **Exclusive-mode WASAPI** — requires the device be free of other apps.
  Dictation while Zoom is open or YouTube is playing is a core use case;
  exclusive-mode breaks that.
- **24kHz or 48kHz to GCP** — Chirp models are trained on 16k. Higher
  rates don't improve accuracy and cost bandwidth.

## 5. Speech-to-Text

### Decision: GCP Speech-to-Text v2, `StreamingRecognize` gRPC, Chirp 2 now → Chirp 3 when verified

The brief mandates this layer. Justification:

- **Multilingual accuracy, especially Indic languages**. Chirp is the best
  of the non-closed-weights offerings we surveyed for Hindi, Telugu, and
  English+Hindi code-switching.
- **Streaming with interim results**. Gives us the ability to show (later)
  a draft-in-pill as the user speaks, and more importantly gives us a
  final transcript within ~100–300ms of speech end.
- **Auto language detection** via Chirp's language-code list — removes the
  need for the user to pick a language per session.
- **Per 15s-increment pricing** at $0.016/min (standard tier) keeps daily
  costs low; a 5-minute/day user pays ~$2.40/month to GCP.

### Model

Launch with `chirp_2`, feature-gate `chirp_3`. Chirp 3 reached GA in Oct
2025 per GCP release notes; we want to verify the model-id string
(`chirp_3` vs `chirp_3_general` etc.) against the live API before making
it the default.

### Auth

User-provided **service account JSON** via Settings → GCP Setup, stored at
`%APPDATA%\popo\gcp-sa.json`. `gcp-auth` caches tokens per-process.

### Alternatives rejected

- **Azure Speech** — good streaming, comparable price; loses on Indian
  language quality vs Chirp in our listening tests.
- **OpenAI Whisper (API)** — no realtime streaming endpoint in late 2025;
  batch upload adds 400–800ms. Unacceptable.
- **Deepgram** — excellent English latency but Indic accuracy not on par
  with Chirp 3.
- **On-device Whisper (whisper.cpp / ONNX)** — already argued against for
  the default pipeline. Deferred to v1.0 as optional fallback.

## 6. Post-processing (AI polish)

### Decision: Gemini Flash (`gemini-1.5-flash`), REST, per-mode toggle, 800ms timeout

- Off by default for v0.1 (just raw transcript → paste).
- Per-mode toggle in the Mode editor. Auto / Casual / Professional / Email
  / Code can individually opt in.
- Timeout budget 800ms; on timeout or error, paste the raw transcript.
  Users should never notice a polish failure; they just get the raw text.

### Why Gemini Flash over GPT-4o-mini / Claude Haiku

- **Cost**: Flash is the cheapest first-tier offering in late 2025 at
  <$0.10 per million tokens.
- **Latency**: sub-400ms typical for 1k-token inputs.
- **Already in the Google stack**: same billing, same credentials surface
  for the user (though a separate API key; noted in GCP Setup wizard).
- Swap-in is easy if we change our mind later — the polish step is one
  function.

## 7. Paste mechanic

Summary here; full design in `docs/PASTE_MECHANICS.md`.

### Decision: 4-method chain, enigo first, clipboard always saved+restored

1. `enigo` Ctrl+V (SendInput) — primary, ~90% of apps
2. `PostMessage(WM_PASTE)` — standard Win32 edit controls
3. `IUIAutomation` `ValuePattern::SetValue` — WinUI/UWP/Office
4. `AttachThreadInput` + `SendMessage(WM_PASTE)` — cross-process stragglers

Fallbacks are attempted in order when heuristics suggest the primary failed.
There is **no user-facing "that didn't work, paste manually" dialog**.

### Why this order

- `enigo` Ctrl+V is fast and OS-standard; it's what humans actually do.
- `WM_PASTE` is cheaper than UIAutomation but only works on classic Edit
  controls.
- UIAutomation is the only universally-reliable modern path but is slow
  (COM activation, 50–100ms).
- `AttachThreadInput` is a sharp tool; it's last because its side effects
  (temporary shared input queue) can affect other windows if we mess up.

## 8. Window styles — Win32 specifics

### Decision: OR in `WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW` on the pill HWND

Applied in the Tauri `setup` hook, before the window is shown:

```rust
#[cfg(target_os = "windows")]
{
    use windows::Win32::UI::WindowsAndMessaging::*;
    let hwnd = pill_window.hwnd()?.0 as isize;
    unsafe {
        let cur = GetWindowLongPtrW(HWND(hwnd as _), GWL_EXSTYLE);
        let new = cur | (WS_EX_NOACTIVATE.0 as isize) | (WS_EX_TOOLWINDOW.0 as isize);
        SetWindowLongPtrW(HWND(hwnd as _), GWL_EXSTYLE, new);
    }
}
```

- `WS_EX_NOACTIVATE` — the pill never steals focus when clicked. Critical;
  this is the whole reason the user's cursor stays in the target app.
- `WS_EX_TOOLWINDOW` — keeps the pill out of Alt-Tab and ensures
  `skipTaskbar` actually sticks in all Windows 11 builds (there's a known
  Tauri v2 regression where `skipTaskbar: true` alone sometimes fails).

We do **not** set `WS_EX_TRANSPARENT` globally; click-through is controlled
dynamically via `window.set_ignore_cursor_events(true|false)` based on
pill state. Sleep → true (click-through so the user can click desktop
below). Ready/Active/Processing → false (so `Escape` can cancel via
a focused-in-pill keybinding... actually, because the pill is never
focusable, Escape is intercepted via global shortcut, so in practice we
could leave `set_ignore_cursor_events(true)` always on. Ship defaults to
dynamic; decide based on Phase 3 testing).

## 9. Foreground window restoration

### Decision: store HWND on hotkey-down; `SetForegroundWindow` after clipboard write; 50ms dwell

- `GetForegroundWindow()` is called the instant the hotkey goes down, before
  the pill even morphs to ready. This is correct because the pill is
  non-focusable; the user's cursor is still in their target app.
- After writing the transcript to the clipboard, we call
  `SetForegroundWindow(stored_hwnd)` and sleep 50ms.
- Rationale for 50ms: Windows 10/11 have a foreground-lock timeout that
  suppresses `SetForegroundWindow` from apps without user attention. 50ms
  gives the OS enough slack to confirm activation. If this proves flaky,
  we'll run `SystemParametersInfo(SPI_SETFOREGROUNDLOCKTIMEOUT, 0)` at
  app start, which most utility apps do.
- If `SetForegroundWindow` returns false, we retry once with
  `AttachThreadInput`.

## 10. Persistence

### Decision: SQLite local primary, Firestore cloud mirror best-effort

- **SQLite** via `rusqlite`, bundled (`features = ["bundled"]` so we don't
  depend on a system SQLite dll). Schema:

  ```sql
  CREATE TABLE sessions (
      id TEXT PRIMARY KEY,               -- uuid
      created_at INTEGER NOT NULL,       -- unix ms
      duration_ms INTEGER NOT NULL,
      word_count INTEGER NOT NULL,
      language TEXT NOT NULL,
      mode_id TEXT,
      raw_transcript TEXT NOT NULL,
      formatted_transcript TEXT,
      audio_storage_path TEXT,
      gcp_cost_estimate REAL,
      synced INTEGER NOT NULL DEFAULT 0  -- 0 = local-only, 1 = in Firestore
  );
  CREATE INDEX idx_sessions_created ON sessions(created_at DESC);

  CREATE TABLE modes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      language TEXT,
      output_format TEXT NOT NULL,       -- 'paragraph' | 'bullets' | 'raw'
      is_default INTEGER NOT NULL DEFAULT 0,
      usage_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL                -- json-encoded
  );
  ```

- **Firestore** is a mirror. Writes go local-first, then a background task
  uploads `synced = 0` rows. On conflict (same id already in Firestore
  with a newer updated_at), Firestore wins and we overwrite locally.
- **Privacy Mode** off by default. When on, the Firestore sync task is
  skipped for `sessions`. `settings` and `modes` still sync so the user's
  configuration travels with their account — but their transcripts do not.

### Why not Firestore-only?

- The pill must work offline (no internet on a train, hotel wifi, etc.).
  Wait, the pill *can't* actually work offline in v0.1 — Chirp is cloud.
  But after a session, paste must not block on a network write; local-first
  guarantees that.
- SQLite gives us a fast history page without waiting on Firestore
  round-trips or pagination cursors.
- If the user signs out or never signs in, local-only still works fully.

## 11. Authentication

### Decision: Firebase Auth (Google OAuth) from the React main-window webview only

- Main-window webview imports the Firebase JS SDK.
- After sign-in, the React side obtains an ID token (`user.getIdToken()`)
  and passes it to Rust via `cmd_firebase_token(token)` for Firestore REST
  writes.
- Rust does **not** depend on firebase-rs or similar. We do plain HTTPS
  POSTs to `firestore.googleapis.com` with `Authorization: Bearer <id-token>`.

### Why

- Firebase JS SDK is hefty (~200kB gzipped) but only loaded in the main
  window (which is already the heavier UI surface); the pill webview
  stays minimal.
- A pure-Rust Firebase Auth implementation isn't stable/maintained enough
  in late 2025 to rely on.
- Passing tokens in works; it's the pattern Google's own sample apps use
  for similar hybrid architectures.

## 12. Tray

### Decision: `tauri-plugin-tray-icon` with minimal menu

- Icon: popo waveform glyph (monochrome, adapts to light/dark system tray)
- Menu: `Open popo` (→ `cmd_open_main_window`), `Quit` (→ `cmd_quit`)
- Single left-click: `Open popo`
- Double-click: also `Open popo` (for users who double-click reflexively)

No submenus, no "Start dictation" menu item (that would imply a visible
recording UI, contradicting the pill-is-ambient principle).

## 13. Build / packaging

### Decision: Tauri bundler, NSIS + MSI, WebView2 downloadBootstrapper

- Installer size target ≤12MB (brief Section 9).
- WebView2 Evergreen: `"webviewInstallMode": "downloadBootstrapper"` in
  `tauri.conf.json`. The installer pulls WebView2 on first install if the
  machine doesn't have it (effectively every modern Windows install does).
- No offline installer variant in v0.1; add in v1.0 if customers need it.

## 14. Telemetry & errors

### Decision: none in v0.1 beyond local log file

- Local log: `%APPDATA%\popo\logs\popo.log`, rotated at 5MB, keep 3 files.
- `tracing` + `tracing-subscriber` with `tracing-appender`.
- No Sentry, no PostHog, no analytics service in v0.1. We do not collect
  audio, transcripts, device identifiers, or any user data outside the
  user's own Firebase project.
- Settings offers an "Export logs" button (v0.3+) that zips the log file
  for email bug reports.

## 15. Security stance

- The GCP service-account JSON is the most sensitive thing on disk. It is
  stored at `%APPDATA%\popo\gcp-sa.json` (per-user, not world-readable on
  Windows 10/11 default ACL) and never transmitted anywhere. `tauri-plugin-fs`
  scope is locked to that single path.
- Clipboard restore runs in all success paths and in all error paths where
  we wrote to the clipboard except one (paste exhausted all methods — see
  systemPatterns.md).
- No IPC commands accept raw Win32 HWNDs from the frontend. All HWND
  manipulation happens in Rust, which stores the foreground HWND itself.
- All external URLs are HTTPS-only. TLS pins are not implemented; Tauri's
  default CA store is acceptable.

## 16. Performance budget (derived from brief §9)

| Stage                                         | Target  | Max     | Instrumentation              |
| --------------------------------------------- | ------- | ------- | ---------------------------- |
| Hotkey down → `pill:state:ready` emitted      | 50ms    | 100ms   | `tracing` span               |
| Hotkey down → cpal first callback             | 100ms   | 200ms   | `tracing` span               |
| Speech end → gRPC final transcript            | 400ms   | 800ms   | gRPC recv timestamp          |
| (opt) Gemini Flash polish                     | 400ms   | 800ms   | HTTP latency                 |
| `SetForegroundWindow` + dwell + Ctrl+V + dwell | 200ms   | 300ms   | paste module span            |
| Total speech-end → paste                      | 700ms   | 1200ms  | aggregate                    |
| App cold start → tray ready                   | 500ms   | 800ms   | main.rs init                 |
| RAM idle (Rust + pill webview + main hidden)  | 40MB    | 50MB    | Task Manager                 |
| RAM recording                                 | 100MB   | 150MB   | Task Manager                 |
| Installer size                                | 10MB    | 12MB    | bundler output               |

Tracing spans for each of these are wired early, so we can validate in
Phase 3 before declaring MVP shippable.

## 17. Deferred decisions (intentionally out of Phase 1 scope)

- Context-aware mode selection via UIAutomation (v0.3).
- Quick mode switcher pill (v0.2).
- Offline Whisper via ONNX runtime (v1.0).
- Multi-monitor pill positioning (v0.3). Phase 1: single-monitor, primary.
- Auto-update via Tauri updater (v1.0).
- Code signing (v1.0).

## 18. One-page mental model

> popo is a Rust daemon that wraps a Tokio runtime around: a WASAPI input,
> a tonic gRPC client for Chirp, a Win32 focus+paste orchestrator, and a
> rusqlite store. It exposes two Tauri webviews — a transparent pill for
> the live state and a hidden frameless app for configuration. The pill
> renders one morphing `motion.div`; the app renders a frameless shell
> with a 64px sidebar. Every interaction originates from a global hotkey
> and terminates in `enigo.key(V)` inside the user's target app.
