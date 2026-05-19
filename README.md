# popo

> **Windows system-level AI voice dictation.** Invisible in the tray,
> ambient at the bottom of your screen, auto-pastes at your cursor in
> any app. One hotkey. No manual copy-paste. No window switching.

---

## What you get

- 🎙️ **Hold `Ctrl+Shift+Space`, speak, release** — your words appear
  at your cursor in whatever app was focused.
- 🫥 **Lives in the tray** — there's no main window demanding your
  attention. A barely-visible pill at the bottom of the screen is
  the only ambient UI.
- 🌍 **Real Google Chirp 3 transcription** — supports English, Hindi,
  Telugu, Tamil, Bengali, Marathi, Spanish, French, German, Japanese
  and more, with `auto` language detection.
- 🎛️ **Modes** — reusable AI post-processing prompts (Casual,
  Professional, Email, Code, and any you write).
- ☁️ **Optional cloud sync** — sign in with Google and your history,
  settings, and modes follow you to every machine you install popo
  on. Skip it if you don't want Firebase in the mix; popo works just
  as well signed out.
- 🔒 **Privacy-respecting** — audio is only uploaded while you're
  dictating, and only if you enable it. No screenshots, ever. Local
  history stays local unless you turn cloud sync on.

## Status

**v0.1 feature-complete** as of Session 25. Shipping gated on the
`docs/PASTE_TEST_RESULTS.md` matrix populating to ✅ across the
browser / IDE / Office / Electron buckets. See
`memory-bank/progress.md` for the live phase checklist.

---

## Install

### Download

Grab the latest `popo_0.1.0_x64-setup.exe` from the
[Releases page](https://github.com/yourorg/popo/releases) _(link
placeholder — real URL goes here once tagged)_ and run it. The
installer:

- Walks you through a branded wizard (150 × 57 header tile, 164 × 314
  sidebar, both dark).
- Installs to `%LOCALAPPDATA%\popo` (no admin rights required).
- Registers popo to auto-start with Windows.
- Drops `uninstall.exe` next to the binary for clean removal via
  **Start Menu → right-click popo → Uninstall**.

### System requirements

- Windows 10 21H2+ or Windows 11
- WebView2 Runtime (installed by default on Windows 11; the installer
  fetches it for you on Windows 10)
- Microphone + internet connection
- A Google Cloud account (free tier works for casual use)

---

## First-run setup

After install, popo opens a 3-phase welcome experience in the main
window:

1. **Brand reveal** — logo fades in (the warm-white waveform tile is
   the canonical popo mark; same glyph in taskbar, tray, splash).
2. **Hotkey demo** — an animated walkthrough showing
   `⎈ + ⇧ + ␣` being held, the pill expanding with a pumping
   waveform, and sample text typing into a mock input field.
3. **Welcome** — "Make popo yours." Sign in with Google (syncs across
   machines) or click **Maybe later** to continue without an account.

After dismissal, you land on the **History** page of the main window.

### Connect Google Cloud Speech-to-Text

popo needs your own GCP credentials to transcribe. This keeps costs
transparent (billed to you, not us) and privacy clean (audio goes
directly from your machine to Google, never through a middleman).

1. In popo, go to **Settings → GCP Setup → Run setup wizard**. The
   wizard opens a modal with 5 steps; each has a direct link that
   opens your browser to the right GCP Console page.
2. **Step 1 · Create project** — spin up a new Google Cloud project
   (or pick an existing one).
3. **Step 2 · Enable Speech-to-Text v2** — one click on the enable
   button in the Console.
4. **Step 3 · Create service account** — name it `popo-stt`, grant it
   the `roles/speech.client` role, and generate a JSON key.
5. **Step 4 · Point popo at your key** — use the **Browse…** button to
   pick the JSON file you just downloaded. popo copies it to
   `%APPDATA%\popo\gcp-sa.json`. Enter your project ID.
6. **Step 5 · Test** — popo validates the path + project ID format
   and confirms reachability.

The wizard closes and real Chirp 3 dictation is live.

> **If you skip GCP setup and press the hotkey anyway:** popo pastes
> a branded reminder (`[popo] Add your Google Cloud credentials in
> Settings → GCP Setup to enable real dictation.`) at your cursor and
> shows a matching tooltip above the pill for 10 seconds. No silent
> failure, no confusing fake output.

### Your first dictation

1. Click into any text field anywhere in Windows — Gmail compose,
   VS Code, Slack, Notepad, doesn't matter.
2. Hold `Ctrl+Shift+Space` and speak one sentence.
3. Release.
4. ~500–1200 ms later, your words appear right where your cursor was.

The pill at the bottom of the screen morphs through its states:
**sleep → ready → active (waveform pumping) → processing (dot-matrix
loader) → success (check flash) → sleep**. Always one component,
always the same motion.div. Never unmounts.

---

## Core reference

### Hotkey

Default: `Ctrl+Shift+Space`. Change it in **Settings → Recording →
Hotkey**. Click the chip, press your new combination, release. Escape
cancels the capture.

### Recording modes

- **Push-to-talk** (default) — hold the hotkey to record, release to
  stop.
- **Toggle** — press once to start, press again to stop. Pairs with
  the optional silence auto-stop (Settings → Recording → Auto-stop
  after N seconds of silence).

### Pill states

| State        | Visual                                               | Triggered by                              |
| ------------ | ---------------------------------------------------- | ----------------------------------------- |
| `sleep`      | Near-invisible bar at screen bottom. Click-through.  | Idle, or 4s after last session            |
| `ready`      | Expanded pill, bars flat, clearly listening          | Hotkey press, mic stream opened           |
| `active`     | Bars pump with your voice                            | PCM amplitude above silence threshold     |
| `processing` | Dot-matrix loader                                    | Hotkey released, awaiting Chirp response  |
| `success`    | Check icon, 300 ms hold                              | Paste succeeded                           |
| `error`      | Warning icon, red border, 2 s hold + 10 s tooltip    | Any step in the pipeline failed           |

### Main window

Click the tray icon (or right-click → Open popo) to show the main
window. Sidebar nav:

- **History** — every past dictation. Copy, delete, play the audio
  (if Store audio was on). Search the transcripts.
- **Modes** — 2-column grid of AI post-processing prompts. Create,
  edit, duplicate, delete. One can be marked default.
- **Test** — live dictation practice. Pick a mic, hold the big
  button, see the transcript appear to the right.
- **Stats** — 4-metric grid (words / sessions / dictated time / est.
  GCP cost), language breakdown bars, 7-day heatmap.
- **Settings** — grouped rows for every preference (see below).
- **Account** — sign in / out, sync log, raw Firestore test button.

### Settings groups

- **Recording** — hotkey, push-to-talk vs toggle, mic selection,
  silence auto-stop seconds.
- **Transcription** — language, default mode, optional Gemini
  auto-format.
- **Paste** — restore clipboard after paste (default on).
- **Privacy** — store raw audio (off by default; warns about cloud
  upload when signed in), privacy mode (skip Firestore sync for
  sessions while keeping settings + modes synced).
- **Sound** — soft ping on record start, chime on paste.
- **System** — start at login, check for updates.
- **GCP Setup** — service account JSON path, project ID, Test
  Connection, Run setup wizard.
- **Account** — live auth row mirroring the Account page.

Cloud-dependent toggles (Store audio, Privacy mode) show a small
inline hint (`☁✓` when signed in, `☁✗` when signed out) so you
always know exactly what each switch will do in your current state.

---

## Troubleshooting

### "The paste didn't land at my cursor"

1. The transcript is still on your clipboard. Press `Ctrl+V` to
   paste manually.
2. Check `%APPDATA%\popo\logs\paste.log` for the last attempt. If
   `method: "enigo"` and `final_outcome: "ok"`, the paste succeeded
   but the target app may have redirected the keystroke (rare).
3. Known limitations (see `docs/PASTE_TEST_RESULTS.md`):
   - **UAC prompts** — Windows blocks cross-integrity input. Can't
     work.
   - **DirectX fullscreen games** — DirectInput doesn't accept
     `SendInput`. Can't work.
   - **Windows Terminal** — you may need to enable "Paste with
     Ctrl+V" in wt's own Settings → Actions.

### "My transcript is nonsense / wrong language"

- Settings → Transcription → Language. Change from `auto` to the
  specific language you're speaking. Chirp's auto-detection is very
  good but not perfect.
- Check that your mic is correct in Settings → Recording →
  Microphone. The test page is a good way to verify.
- Silence can look like a cough — the silence-threshold is tuned
  around voice. Very quiet speech may not trigger the active state.

### "Dictation is fake — it's pasting a message about GCP"

You haven't run the GCP Setup wizard yet. That fallback paste is
popo's way of telling you exactly what's needed. Go to Settings →
GCP Setup and run the wizard.

### "popo opens twice when my laptop wakes from sleep"

It shouldn't — the single-instance plugin guards against this. If it
happens, check Task Manager and kill both `popo.exe` processes, then
relaunch from the Start Menu. Open an issue with the log from
`%APPDATA%\popo\logs\popo.log` so we can look at the sequence of
events around the wake.

### "The pill is invisible / stuck on top of my Start Menu"

The pill is always at bottom-center, always 260 × 110 with most of
that area transparent and click-through. If it gets in the way:

- Right-click the tray icon → Quit, then re-open popo from the Start
  Menu. This repositions the pill to bottom-center.
- Pill position persistence lands in v0.2.

### "Audio playback in History doesn't work"

You need Settings → Privacy → Store audio enabled for popo to keep
the raw WAV. Audio files live at `%APPDATA%\popo\audio\{sessionId}.wav`
(16 kHz PCM-16 mono, ~320 KB per 10 s). If you're signed in with
cloud sync, they also upload to your Firebase Storage.

---

## Privacy & data

popo is designed to be the minimum-trust voice input.

### Stays on your machine

- All settings (`%APPDATA%\popo\` + `localStorage`).
- Local history SQLite (`%APPDATA%\popo\popo.db`).
- Local audio WAVs (only if Store audio is on).
- Your GCP service account JSON (`%APPDATA%\popo\gcp-sa.json`).

### Goes to your Google Cloud (only while you're dictating)

- PCM audio chunks (16 kHz mono) streaming to
  `speech.googleapis.com:443`.
- Transcripts returned over the same gRPC stream.

### Goes to your Firebase (only if you sign in + sync is on)

- Session records at `users/{yourUid}/sessions/{sessionId}`.
- Modes at `users/{yourUid}/modes/{modeId}`.
- Settings (non-GCP fields) at `users/{yourUid}/settings`.
- Audio WAVs at `audio/{yourUid}/{sessionId}.wav` (only if Store
  audio is on).

Firestore security rules scope every read/write to
`request.auth.uid == yourUid`. Nobody else on Firebase can see your
data.

### Never happens

- No screenshots. Ever. `docs/PRODUCT_CONTEXT.md` prohibits them.
- No telemetry, usage analytics, or crash reports to any popo
  server — popo has no server.
- No audio upload when idle. The mic is only open while you're
  holding the hotkey.

---

## Uninstall

**From Windows Start Menu:** Type `popo`, right-click → **Uninstall**.
Windows may route you through Settings → Installed Apps → Uninstall
on Windows 10 builds (OS behavior we can't override); on Windows 11
with the new Start Menu it typically launches popo's uninstaller
directly.

**Directly:** Run `%LOCALAPPDATA%\popo\uninstall.exe`.

Either path launches our NSIS uninstaller, which:
- Shows a warm popo "Sorry to see you go" prompt first.
- Asks whether to also delete your local cache (`%APPDATA%\popo` —
  settings, history, audio). Pick No if you plan to reinstall; your
  local history survives the reinstall.
- Removes popo.exe, the pill webview, the tray integration, the
  autostart registry entry, and (if you agreed) the local cache.
- **Does not touch cloud data.** Your Firebase-synced sessions,
  modes, and settings stay under your Google account. Reinstall
  and sign back in to restore everything.

---

## For developers

### Toolchain

- [Node.js](https://nodejs.org/) 20 LTS
- [pnpm](https://pnpm.io/) 9.x — `npm i -g pnpm`
- [Rust](https://rustup.rs/) 1.80+ stable (Tauri v2 requires 1.77)
- Microsoft Visual Studio Build Tools 2022 (C++ workload, Windows
  10/11 SDK)
- WebView2 Runtime (usually pre-installed on Windows 11)

### Clone + run

```sh
git clone <this-repo> popo
cd popo
pnpm install
pnpm tauri dev
```

First run takes 3–5 minutes (Rust dependency compilation). Subsequent
runs are near-instant.

### Common commands

```sh
# Type-check only
pnpm --filter desktop typecheck

# Frontend production build (no Rust)
pnpm --filter desktop build

# Full release bundle (MSI + NSIS installers)
pnpm --filter desktop tauri build

# Rust-only check (faster than pnpm tauri build)
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml

# Regenerate icons from the canonical SVG
node scripts/gen-icons-from-svg.mjs

# Regenerate installer BMPs (warm-white tile on dark backgrounds)
node scripts/gen-installer-images.mjs

# Deploy Firestore + Storage rules
firebase deploy --project popo-flow --only firestore:rules
firebase deploy --project popo-flow --only storage
```

### Project layout

```
popo/
├── POPO_BRIEF.md              # Single source of truth for product + design
├── .clinerules                # Cline Memory Bank rules
├── memory-bank/               # Session-start context (read these first)
├── docs/                      # Phase 1 specs + live tracking docs
│   ├── COMPETITIVE_ANALYSIS.md
│   ├── TECHNICAL_SPEC.md
│   ├── DESIGN_SYSTEM.md
│   ├── PASTE_MECHANICS.md
│   └── PASTE_TEST_RESULTS.md  # Live matrix — populated during Phase 5 [16]
├── apps/desktop/              # The Tauri app
│   ├── src/                   # React 18 + TS 5 frontend
│   │   ├── components/        # Pill, layout, shared, first-run, settings, etc.
│   │   ├── hooks/             # useAuth, usePillEvents, useSessionSave, …
│   │   ├── store/             # Zustand stores (pill / auth / history / modes / …)
│   │   ├── lib/               # firestore, firebase, stats-compute, time-format
│   │   └── pages/             # History / Modes / Test / Stats / Settings / …
│   └── src-tauri/             # Rust daemon
│       ├── src/
│       │   ├── lib.rs         # Tauri setup, tray, hotkey, first-run detection
│       │   ├── hotkey/        # Global shortcut + state machine
│       │   ├── audio/         # cpal capture, resample, WAV storage
│       │   ├── gcp/           # Chirp 3 gRPC + auth + fake_transcribe stub
│       │   ├── focus/         # Win32 HWND + clipboard + paste orchestrator
│       │   └── commands/      # Tauri invoke handlers (settings, gcp, system, …)
│       └── assets/installer/  # NSIS hooks.nsh + English.nsh + BMPs
├── packages/shared-types/     # Types shared between Rust bindings and React
├── scripts/                   # Build helpers (icons, installer images, proto)
└── pnpm-workspace.yaml
```

### Contributing

1. Read every file in `memory-bank/` — enforced by `.clinerules`.
   The latest active task lives in `memory-bank/activeContext.md`.
2. Follow the Phase 11 Agent Execution Order in
   [`POPO_BRIEF.md`](./POPO_BRIEF.md). Don't skip ahead.
3. Before touching UI code, read `docs/DESIGN_SYSTEM.md §12` (skill
   application matrix). Before touching the paste pipeline, read
   `docs/PASTE_MECHANICS.md` end-to-end.
4. Every commit that touches the paste pipeline must also update
   `docs/PASTE_TEST_RESULTS.md` with the rows retested.
5. No hex colors outside `apps/desktop/src/styles/globals.css` — use
   `var(--token-name)` or Tailwind arbitrary-value syntax.

### Reporting bugs

Include:

- Windows version (`winver`).
- popo version (bottom of sidebar, e.g. `v0.1`).
- Whether you're signed in.
- Last 50 lines of `%APPDATA%\popo\logs\popo.log` (NEVER transcripts
  — the log rotates transcripts out intentionally, but if you see
  any, redact before posting).
- Steps to reproduce, including which target app + text field.

---

## License

TBD.
