# techContext.md — tech stack, versions, setup

## Language / runtime versions

- **Node**: 20 LTS (required by Vite 5+, Tauri CLI)
- **pnpm**: 9.x (workspaces) — **no npm, no yarn**
- **Rust**: 1.80+ stable (MSRV 1.77 for Tauri v2)
- **Windows SDK**: 10.0.22621.0+ for `windows-rs`
- **WebView2 Runtime**: Evergreen (bundled bootstrapper at install)

## Frontend

| Tech              | Version         | Purpose                          |
| ----------------- | --------------- | -------------------------------- |
| Tauri             | 2.x             | Shell                            |
| React             | 18.x            | UI framework                     |
| TypeScript        | 5.x             | Types                            |
| Vite              | 5.x             | Build (Tauri default)            |
| Tailwind CSS      | 4.x             | Styling                          |
| `geist`           | latest          | Pixel font family                |
| `@phosphor-icons/react` | latest    | Icons (regular, bold for CTAs)   |
| `framer-motion`   | latest 11.x     | Pill morph + page transitions    |
| `zustand`         | latest          | Pill/settings/history stores     |
| `@dotmatrix/dotm-square-3` | via shadcn | All loaders                  |
| `firebase`        | 10.x            | Auth + Firestore                 |

## Rust (`src-tauri/Cargo.toml`)

```toml
[dependencies]
tauri = { version = "2", features = ["tray-icon", "devtools"] }
tauri-plugin-global-shortcut = "2"
tauri-plugin-notification    = "2"
tauri-plugin-fs              = "2"
cpal   = "0.15"
tonic  = "0.12"
prost  = "0.13"
tokio  = { version = "1", features = ["full"] }
serde  = { version = "1", features = ["derive"] }
serde_json = "1"
enigo  = "0.2"
arboard = "3"
windows = { version = "0.58", features = [
    "Win32_UI_WindowsAndMessaging",
    "Win32_Foundation",
    "Win32_UI_Accessibility",
    "Win32_System_Threading",
]}
rubato = "0.15"
gcp-auth = "0.12"
rusqlite = { version = "0.31", features = ["bundled"] }
```

Additional dev dep: `tonic-build` to generate Rust from
`google/cloud/speech/v2/*.proto` during build.

## Initial setup commands

```bash
# One-time, on a fresh clone
pnpm install
pnpm --filter desktop tauri dev            # first run will build Rust

# Rust deps (run by pnpm tauri dev automatically, but useful in isolation)
cd apps/desktop/src-tauri
cargo check

# Regenerate GCP STT v2 proto bindings (only when you bump the proto vendor)
bash scripts/gen-gcp-proto.sh
```

## Env vars (`.env.example`)

```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_GCP_PROJECT_ID=
```

GCP service account JSON path is NOT in env. It is configured per-user in
Settings → GCP Setup and stored in the OS-appropriate app data dir
(`%APPDATA%\popo\gcp-sa.json`). `tauri-plugin-fs` scope allows only that file.

## Audio pipeline specs

- Capture format: `cpal` default input → converted to **16 kHz mono PCM16**
  via `rubato` (sinc interpolator, quality medium).
- Frame size to GCP: 100ms chunks (1600 samples @ 16 kHz, 3200 bytes).
- Silence threshold: RMS < ~0.015 over a 200ms window = silence; used only
  for the waveform color switch and (v0.2) silence auto-stop, NOT for gating
  the gRPC stream.
- Waveform bars: aggregate 40ms of samples → 16 frequency-ordered magnitude
  buckets (simple FFT via `rustfft` if we want real spectrum; v0.1 may use
  time-domain RMS buckets across 16 short windows — both visually acceptable).

## GCP Speech-to-Text config

- API: **Speech-to-Text v2** (`speech.googleapis.com`)
- RPC: `StreamingRecognize`
- Model: `chirp_2` (stable) with upgrade path to `chirp_3` once GA verified at
  build time (as of late 2025, Chirp 3 reached GA in Oct 2025).
- Config:
  ```
  RecognitionConfig {
    features: {
      enable_automatic_punctuation: true,
      enable_word_time_offsets: true,
    },
    language_codes: [<user setting>],   // "auto" supported via Chirp
    model: "chirp_2",
    auto_decoding_config: {},            // let Google decode the 16k PCM
  }
  StreamingRecognitionConfig {
    config: RecognitionConfig,
    streaming_features: { interim_results: true },
  }
  ```
- Auth: `gcp-auth` using the user-provided service account JSON. Token cached
  per-process, refreshed proactively.
- Region: default global endpoint; users may set `us-central1` etc. later.

## Post-processing (v0.2)

- Gemini Flash `gemini-1.5-flash` via REST.
- System prompt = mode's `systemPrompt`.
- Request: `{ contents: [{ role: "user", parts: [{ text: transcript }]}]}`
  with `system_instruction: { parts: [{ text: mode.systemPrompt }]}`.
- Fallback: if call fails or exceeds 800ms, paste the raw transcript.

## Firebase

- Auth: Google OAuth via Firebase JS SDK in the main window webview only.
  ID token shared with Rust via `invoke()` command that takes the token and
  uses it for Firestore writes via REST.
  - Rationale: keeping the Firebase JS SDK out of the Rust side avoids WASM
    surface area; Rust just does signed REST calls.
- Firestore paths: `users/{uid}/settings`, `users/{uid}/modes/{id}`,
  `users/{uid}/sessions/{id}`.
- Rules: read/write only when `request.auth.uid == uid`.
- Local mirror: `rusqlite` (`%APPDATA%\popo\popo.db`). History writes go to
  SQLite synchronously, Firestore async/best-effort.

## Build / distribution

- Windows installer: Tauri's MSI/NSIS bundler with WebView2 bootstrapper
  (`webviewInstallMode: "downloadBootstrapper"`).
- Target size: ≤12MB installer.
- Auto-updates: Tauri updater against GitHub Releases (v1.0+).
