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
- 🔒 **Privacy-respecting** — the microphone opens only for an active
  dictation/test. Speech audio goes directly to the Google Cloud project
  you configure. Raw WAV retention is off by default; WAVs sync to Firebase
  only when you enable Store audio and sign in. Signed-out sessions are not
  uploaded to Firebase.

## Status

**Pre-release.** Core dictation, STT, Gemini, sync, audio, and Quick
Switcher behavior is implemented. Public distribution remains gated on the
security/privacy/signing checklist and the paste compatibility matrix. See
[`docs/RELEASE_SECURITY_CHECKLIST.md`](docs/RELEASE_SECURITY_CHECKLIST.md)
and `memory-bank/progress.md`.

---

## Install

### Download

When a signed public release is published, obtain it only from the
[official Releases page](https://github.com/Cryptobitsbee/PoPo/releases)
or the verified Microsoft Store listing. Verify the publisher/signature and
published SHA-256 hash before running a direct-download installer. The
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
   select the JSON file you downloaded. popo stores only that file's
   path in `%APPDATA%\ai.popo.desktop\gcp.json`; it does not copy the
   key. Keep the original JSON in place for Speech-to-Text and Vertex
   AI to remain available. Enter your project ID.
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
2. Check `%APPDATA%\popo\popo.log` for the latest `paste` result. If
   the final outcome is successful, the target app may have redirected the
   keystroke (rare).
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
- If logs say `locale auto ... is no longer generally available`, you
  are running a build that still targets Google's preview Mumbai Speech
  endpoint. Current popo uses the documented GA `eu` multi-region, where
  Chirp 3 language-agnostic transcription remains available.
- Check that your mic is correct in Settings → Recording →
  Microphone. The test page is a good way to verify.
- Silence can look like a cough — the silence-threshold is tuned
  around voice. Very quiet speech may not trigger the active state.

### "Vertex AI returns HTTP 404"

Gemini 3.5 Flash-Lite is available on Vertex at `global`, `us`, and
`eu`, not single regions such as `us-central1`. Choose **global** in
Settings → Transcription → Vertex AI. Current popo automatically migrates
older unsupported region settings to `global`.

### "Dictation is fake — it's pasting a message about GCP"

You haven't run the GCP Setup wizard yet. That fallback paste is
popo's way of telling you exactly what's needed. Go to Settings →
GCP Setup and run the wizard.

### "popo opens twice when my laptop wakes from sleep"

It shouldn't — the single-instance plugin guards against this. If it
happens, check Task Manager and kill both `popo.exe` processes, then
relaunch from the Start Menu. Open an issue with the log from
`%APPDATA%\popo\popo.log` so we can look at the sequence of
events around the wake.

### "The pill is invisible / stuck on top of my Start Menu"

The pill is always at bottom-center, always 260 × 110 with most of
that area transparent and click-through. If it gets in the way:

- Right-click the tray icon → Quit, then re-open popo from the Start
  Menu. This repositions the pill to bottom-center.
- Pill position persistence lands in v0.2.

### "Audio playback in History doesn't work"

You need Settings → Privacy → Store audio enabled for popo to keep
the raw WAV. Audio files live at
`%APPDATA%\ai.popo.desktop\audio\{sessionId}.wav` (16 kHz PCM-16
mono, ~320 KB per 10 s). If you're signed in, they also upload to
your configured Firebase Storage.

---

## Privacy & data

PoPo is designed to minimize trust and defaults raw-audio retention off.
See the full [privacy notice](PRIVACY.md), [security policy](SECURITY.md),
and [source-build configuration guide](docs/OPEN_SOURCE_CONFIGURATION.md).

### Stays on your machine

- Preferences, modes, snippets, dictionary phrases, app icons, and
  onboarding state in WebView local storage. The Gemini key is excluded.
- Optional local WAV files under `%APPDATA%\ai.popo.desktop\audio\`.
- Your GCP service-account JSON at the path you selected. PoPo stores only
  its path, project ID, and language in
  `%APPDATA%\ai.popo.desktop\gcp.json`; moving/deleting the original
  disables Speech-to-Text and Vertex AI.
- An AI Studio key, when configured, encrypted for the current Windows
  user in `gemini-api-key.dpapi` through DPAPI.
- Bounded operational logs under `%APPDATA%\popo\`. They are designed not
  to contain transcript/prompt text or credential material; redact before
  sharing.

Signed-out session records are not uploaded and currently remain in memory
for the running app rather than a local SQLite history database.

### Goes to your Google services

- During dictation/test, audio and recognition context go directly to
  Speech-to-Text in your configured Google Cloud project.
- If AI formatting is enabled, the transcript and selected prompt go to
  AI Studio or Vertex AI.
- If you sign in, Firebase can store your profile, session transcripts,
  modes/prompts, settings (never GCP credentials), snippets, dictionary,
  app icons, and diagnostics under `users/{yourUid}`.
- WAVs go to `audio/{yourUid}/{sessionId}.wav` only when Store audio is on.

Firestore/Storage Rules enforce authenticated UID ownership, bounded
schemas/object paths, and default deny. Production quotas, API restrictions,
and monitoring are still required.

### Never happens

- No screenshots. `docs/PRODUCT_CONTEXT.md` prohibits them.
- No product analytics, advertising SDK, third-party crash reporter, or
  PoPo-operated transcription server.
- No idle microphone capture. The mic opens only for an active dictation or
  test.

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
- Asks whether to also delete local app data (preferences, optional WAVs,
  GCP path/project metadata, the DPAPI Gemini key, and diagnostics). The
  external service-account JSON is never deleted.
- Removes popo.exe, the pill webview, tray integration, autostart registry
  entry, and—if selected—the local app-data directories.
- **Does not touch cloud data.** Use **Settings → Account → Delete all my
  data** before uninstalling if you also want Firebase records, cloud WAVs,
  and the Firebase Auth user removed.

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
- Last 50 lines of `%APPDATA%\popo\popo.log`, after reviewing and
  redacting usernames, paths, app/mode identifiers, or other private data.
  Logs should not contain transcripts or credentials; if one does, do not
  post it publicly—report that through `SECURITY.md`.
- Steps to reproduce, including which target app + text field.

---

## License

No license has been selected yet. Until an OSI-approved `LICENSE` is added,
this repository is source-visible but does not grant open-source reuse rights.
License selection is a public-release blocker in
[`docs/RELEASE_SECURITY_CHECKLIST.md`](docs/RELEASE_SECURITY_CHECKLIST.md).
