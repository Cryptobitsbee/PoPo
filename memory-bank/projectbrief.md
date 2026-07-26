# projectbrief.md — popo foundation

> This file is the distilled "what and why". Full detail lives in `POPO_BRIEF.md`
> at the project root. When in doubt, read the brief. Never contradict it.

## What popo is

popo is a **Windows-only, system-level voice keyboard daemon**. It is not a
transcription app, not a recorder, not a notepad. It is an invisible background
service that:

1. Lives in the system tray.
2. Owns a single **pill overlay** that is always on screen (sleep state is a
   barely-visible ambient element at the bottom-center of the screen).
3. When a global hotkey is held (default `Ctrl+Shift+Space`), the pill morphs
   from sleep → ready → active, captures voice, streams it to GCP Chirp 3 for
   transcription, optionally post-processes through Gemini Flash, and **pastes
   the result at whatever text cursor the user last had focused** in any
   application on the system.
4. Exposes a secondary "main window" — frameless, icon-only sidebar — for
   history, modes, settings, test, stats, and account.

## Scope for v0.1 MVP

- Global hotkey + push-to-talk recording
- Pill: sleep / ready / active / processing / success / error (ONE morphing
  component, never two components being swapped)
- Live 16-bar waveform reflecting PCM amplitude from Rust
- GCP Speech-to-Text v2 streaming (model family: Chirp 2/3)
- Focus capture + restore + auto-paste (enigo Ctrl+V with fallback chain)
- Clipboard save-and-restore around every paste
- System tray (Open popo / Quit)
- In-memory signed-out session history + optional owner-scoped Firestore sync
- Firebase Auth (Google Sign-In)
- History + Settings pages (basic)
- GCP setup wizard

## Out of scope for v0.1

- Mobile app (explicitly deferred — Windows desktop only)
- Offline Whisper fallback (v1.0)
- Screenshot-based context (NEVER — use UIAutomation app name/title only)
- Electron, Flutter, or any non-Tauri shell
- Any icon library other than Phosphor
- Any loader other than DotMatrix

## Goals

- **Latency**: hotkey → pill morph ≤100ms target, ≤200ms max; speech end →
  paste at cursor ≤1.2s target, ≤2s max.
- **Footprint**: ≤50MB RAM idle, ≤150MB recording; installer ≤12MB.
- **Reliability**: auto-paste must just work across browser, IDE, chat, Office,
  terminal. No user-facing manual paste fallback — the system always tries the
  next technical method before giving up.
- **Privacy-respecting**: no screenshots ever. Audio only uploaded when the
  user is actively dictating. Optional storeAudio toggle is off by default.
- **Feel**: "precision instrument, not a product." Quiet, dark, type-forward,
  purposeful motion. Raycast/Linear/Craft tier, not enterprise SaaS tier.

## Success criteria for v0.1 shipping

1. Fresh Windows 10 or 11 install + WebView2 → first dictation works within
   60s of opening the app (counting GCP setup wizard).
2. Paste mechanic passes the Section 9 test matrix for at least: Chrome,
   Firefox, VS Code, Cursor, Slack, Discord, Word, Notepad.
3. Pill never steals focus; clipboard is always restored.
4. All four paste fallback methods implemented and documented.

## Security and release trust baseline (Session 61)

- Official releases use the publisher's production Firebase identifiers;
  source/fork builds use isolated projects or no Firebase configuration.
- Firebase web config and desktop OAuth client IDs are public identifiers.
  OAuth secrets, service-account JSON, Gemini keys, and signing keys must never
  be embedded, committed, logged, or placed in `VITE_*` variables.
- Desktop OAuth is system-browser authorization code + PKCE S256 + random state
  + random-port IPv4 loopback. OAuth/session/test events are routed only to the
  intended webview; custom Tauri commands are centrally origin-gated.
- Gemini AI Studio keys persist only through current-user Windows DPAPI.
  GCP service-account JSON stays external; PoPo persists only its path/project
  metadata and verifies the source remains a regular file before use.
- Raw WAV retention remains off by default. New cloud records store an
  authenticated Storage object path, not a durable bearer download URL or
  machine-local WAV path.
- Public release is blocked until an OSI license, publisher legal/privacy
  contact, deployed/tested Firebase Rules, owner-run deletion/OAuth smoke tests,
  and Microsoft Store or consistently timestamped Authenticode signing exist.
  See `docs/RELEASE_SECURITY_CHECKLIST.md`.
