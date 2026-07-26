# techContext.md — tech stack, versions, setup

## Authoritative security/release snapshot (Session 61)

This section supersedes legacy planning snippets later in this file.

- Rust uses Tauri 2 with tray-icon plus global-shortcut, dialog, opener,
  autostart, and single-instance plugins. Direct filesystem/notification
  plugins, wildcard asset protocol, unconditional devtools, `rubato`, and
  `rusqlite` are absent. `tauri-plugin-fs` is only a transitive implementation
  dependency of the native dialog plugin and is not initialized/granted.
- Audio resampling is hand-rolled; signed-out history is in memory, not SQLite.
- Production CSP is default-deny for objects/forms/frames and allowlists only
  required Firebase/Google endpoints, Tauri IPC, local/data fonts, profile
  images, and blob/audio sources. Capabilities are split main/pill/switcher;
  custom app commands also pass a centralized webview-label allowlist.
- Rust emits pill events only to `pill`, OAuth/session/test data only to `main`,
  and cross-webview store notifications explicitly. Do not revert to global
  broadcast for payloads containing codes, transcripts, or test output.
- Gemini AI Studio persistence is current-user Windows DPAPI at
  `%APPDATA%\ai.popo.desktop\gemini-api-key.dpapi`; it is excluded from
  localStorage/Firestore/logs. GCP JSON remains external and only
  path/project/language metadata is persisted in `gcp.json`.
- Firebase requires all public web config fields. Firestore DB ID is
  configurable (`(default)` for normal forks, `popo-flow` for official
  production). New session sync strips machine-local WAV paths, embedded app
  icons, and legacy bearer URLs; cloud audio stores only
  `audio/{uid}/{sessionId}.wav`.
- Firestore/Storage Rules are schema/path/size bounded and default-deny.
  `cloudDeletion.ts` must be updated with every future subcollection.
- CI uses Node 20.19.1/pnpm 9.12.0, frontend type/build, Windows Rust tests and
  release check, CodeQL, dependency review, Gitleaks, RustSec, and an OSV scan.
  The sole accepted npm advisory is React Router's RSC/server-action issue,
  unreachable in this static Vite/Tauri client.
- `geist` is pinned exactly to `1.7.2`. `scripts/copy-geist-fonts.mjs` resolves
  the desktop workspace's direct dependency before pnpm virtual-store fallback,
  preventing stale package versions from rewriting tracked WOFF2 assets. The
  canonical Square asset is 28,540 bytes with SHA-256
  `80887AFEDE26BC861E92DBFBB17A775D769E46E7C84F336B1C9F17959F60606D`.



## Language / runtime versions

- **Node**: 20 LTS (required by Vite 5+, Tauri CLI)
- **pnpm**: 9.x (workspaces) — **no npm, no yarn**
- **Rust**: 1.80+ stable (MSRV 1.77 for Tauri v2)
- **Windows SDK**: 10.0.22621.0+ for `windows-rs`
- **WebView2 Runtime**: Evergreen. Normal builds use Tauri's download
  bootstrapper; Partner Center EXE builds run `pnpm --filter desktop
  tauri:build:store`, whose config overlay embeds the x64 offline installer to
  satisfy Microsoft's standalone-installer requirement.

## Frontend

| Tech              | Version         | Purpose                          |
| ----------------- | --------------- | -------------------------------- |
| Tauri             | 2.x             | Shell                            |
| React             | 18.x            | UI framework                     |
| TypeScript        | 5.x             | Types                            |
| Vite              | 5.x             | Build (Tauri default)            |
| Tailwind CSS      | 4.x             | Styling                          |
| `geist`           | 1.7.2 (exact)    | Pixel font family                |
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
VITE_FIRESTORE_DATABASE_ID=(default)
VITE_GOOGLE_DESKTOP_CLIENT_ID=
```

These are public client identifiers. There is intentionally no desktop OAuth
client secret and no runtime GCP/Gemini credential in `VITE_*`.

GCP service account JSON path is NOT in env. It is configured per-user in
Settings → GCP Setup. popo stores only path/project/language metadata in
`%APPDATA%\ai.popo.desktop\gcp.json`; the original selected JSON is never
copied and must remain available for Speech-to-Text and Vertex AI.

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
- Speech region: `eu` GA multi-region. The former preview `asia-south1`
  endpoint rejected Chirp 3 locale `auto` as no longer generally available.
- Gemini Vertex location: `global` by default; only `global`, `us`, and `eu`
  are offered for Gemini 3.5 Flash-Lite. Legacy single-region values normalize
  to `global`.

## Post-processing

- Model: stable GA `gemini-3.5-flash-lite` via REST `generateContent`.
- Provider is explicit and machine-local:
  - AI Studio uses the configured API key.
  - Vertex AI reuses the GCP service-account OAuth token/project and selected location.
- Auto-format is the master gate for all modes and Gemini polish.
- Request keeps `maxOutputTokens`; deprecated 3.5 sampling fields and
  2.5-only `thinkingBudget` are omitted. Default thinking is minimal.
- 12-second ceiling; any error fails open to the raw Chirp transcript.

## Firebase

- Google sign-in uses system-browser authorization code + PKCE S256 + random
  state + random-port `127.0.0.1` callback in Tauri. No client secret exists.
- Firebase JS SDK owns Auth, Firestore, and Storage. Main-window hooks own
  sign-in, history/settings/data sync, audio upload, and account deletion.
- Firestore paths are explicit under `users/{uid}`: profile plus `sessions`,
  `modes`, `snippets`, `dictionary`, `appIcons`, `settings/doc`, and
  `_diagnostics/ping`. Rules require authenticated ownership, bounded schemas,
  and default deny.
- Storage is owner-only flat WAV objects at `audio/{uid}/{sessionId}.wav`,
  `audio/wav`, non-empty, at most 10 MiB. Playback resolves authenticated
  download URLs on demand; legacy persisted URLs remain read-compatible only.
- Signed-out session history is process memory. There is no SQLite local mirror.
- Complete deletion queries all known cloud subcollections directly (not the
  200-row UI cache), recursively deletes Storage audio, then clears local Rust
  and browser state before deleting the Auth user/resetting stores.


## Build / distribution

- Normal Tauri installer profile: NSIS/MSI uses WebView2
  `downloadBootstrapper` for smaller local/direct builds.
- Standalone NSIS profile: `pnpm --filter desktop tauri:build:store` overlays
  `offlineInstaller`, emits `PoPo_<version>_x64-setup.exe`, and embeds the x64
  WebView2 runtime. Partner Center EXE submission still requires trusted
  Authenticode on the inner executable and installer.
- Partner Center MSIX: `pnpm --filter desktop tauri:build:msix` invokes
  `scripts/build-msix.ps1` and Windows SDK MakeAppx. It requires the exact
  case-sensitive Product identity Name, Publisher, and PublisherDisplayName in
  ignored `partner-center-identity.local.json`. Store MSIX may be unsigned;
  Microsoft re-signs it only after certification.
- Local unsigned MSIX: `tauri:build:msix:test` uses Microsoft's required
  special-OID `PoPo.LocalTest` identity. It is installable only through the
  Windows 11 `Add-AppxPackage -AllowUnsigned` test path and must never be
  uploaded as the Store product.
- MSIX is x64 packagedClassicApp/mediumIL with internet, microphone, and
  runFullTrust declarations; it relies on the machine's WebView2 runtime.
- User-facing Windows product casing is `PoPo`; stable Tauri ID
  `ai.popo.desktop`, Rust binary `popo.exe`, and data paths remain unchanged.
- Auto-updates: Tauri updater against GitHub Releases (v1.0+); Store update
  behavior still requires packaged-build testing before release.
