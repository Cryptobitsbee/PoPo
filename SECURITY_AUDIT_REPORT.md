# PoPo security hardening report

**Date:** July 26, 2026
**Scope:** Tauri/Rust backend, React/Vite frontend, OAuth, Firebase Auth/Firestore/Storage, GCP Speech-to-Text, Gemini, local persistence, dependencies, installer, privacy/release documentation
**Status:** Automated hardening complete; owner-operated production deployment, identity, signing, and end-to-end account tests remain release gates.

This is an engineering assessment, not a penetration-test certificate or legal-compliance claim.

## Executive result

No known critical/high reachable vulnerability remains from this review, and the independent final reviewer reported no blocking finding. The application compiles, tests, builds, and starts cleanly after the remediations below.

PoPo must still **not** be presented as a signed production release until the owner completes the manual actions in `docs/RELEASE_SECURITY_CHECKLIST.md`, including Firebase deployment/testing, publisher/privacy identity, licensing, and Microsoft signing/Store work.

## Implemented controls

### OAuth and Firebase authentication

- Removed all desktop OAuth client-secret requirements. Installed applications cannot keep a client secret confidential.
- Uses system-browser authorization code flow, PKCE S256, independent cryptographic state, random `127.0.0.1` port, exact callback-state validation, bounded reads, connection/overall timeouts, and a concurrency guard.
- Rust validates the exact Google authorization endpoint and required parameters before opening it through the Tauri opener plugin.
- OAuth codes/errors are delivered only to the `main` webview. Callback HTML is static, no-store, framed/script/object denied, and embeds the tracked local Geist Pixel Square font.
- Firebase initializes only with a complete public web configuration. Firestore database ID is configurable for isolated source builds.

### Tauri IPC, events, capabilities, and CSP

- A centralized command-origin gate gives `main` app-command access, permits the Quick Switcher only its three required commands, and denies all custom commands to `pill`/unknown webviews. Unit tests cover this policy.
- Sensitive audio/export/account/OAuth/secret commands retain command-level main-window checks where especially destructive or data-bearing.
- Capabilities are split by webview and no longer grant direct frontend filesystem, notifications, global-shortcut mutation, autostart mutation, path opening/reveal, broad opener, or wildcard asset access.
- Rust routes pill UI events only to `pill`; OAuth/session/snippet/test payloads only to `main`.
- Production/dev CSPs restrict scripts, connections, media/images/fonts, and deny objects, forms, frames, base URI, and framing.

### Secrets and local data

- Gemini AI Studio keys persist only through Windows current-user DPAPI at `%APPDATA%\ai.popo.desktop\gemini-api-key.dpapi` and are excluded from WebView local storage/Firestore/logs. Migration cannot erase a valid protected key during initial hydration.
- The GCP service-account JSON remains external. PoPo stores only its source path/project/language metadata, checks the source remains a regular file before token use, and never deletes the external key file.
- Local audio commands canonicalize both app audio root and requested file, reject junction/path escape, require regular WAV files, and enforce size/bar/format bounds.
- Export no longer accepts an arbitrary frontend path; Rust opens the native save dialog, enforces JSON/TXT, validates the suggested name, and caps content.
- Release logs rotate at 5 MiB with one predecessor. Transcript/prompt text, credential contents, tokens, API keys, and bearer URLs were removed from logging. Account deletion schedules guaranteed next-launch log cleanup.

DPAPI protects against accidental plaintext disclosure and other Windows users; like all current-user stores, it does not defend against malware already executing as the same user. The external service-account key and optional local WAVs share that OS-user threat boundary.

### Cloud data and deletion

- New session writes strip machine-local WAV paths, legacy bearer download URLs, and inline app icons. Cloud audio persists only `audio/{uid}/{sessionId}.wav`; authenticated SDK URLs are resolved on demand. Legacy records remain playback-compatible.
- Individual session deletion removes the constrained local WAV, Firestore record, and cloud WAV even if privacy mode was enabled after the original sync.
- Full deletion queries every known Firestore subcollection directly rather than trusting the 200-row UI cache, recursively deletes owner Storage audio, removes the profile, clears local Rust/browser/DPAPI/GCP metadata, then deletes the Firebase Auth user and uses non-syncing store resets.
- Firestore Rules require authenticated UID ownership, explicit collections, bounded keys/types/string/list sizes, deterministic audio paths, immutable legacy fields, and default deny.
- Storage Rules v2 enforce owner-only read/delete, owner-only non-empty flat WAV writes, strict filename/MIME, 10 MiB maximum, and default deny.

Any future user subcollection must update `firestore.rules`, `apps/desktop/src/lib/cloudDeletion.ts`, privacy inventory, and tests together.

### Dependencies and automation

- Fixed/pruned the audited quick-xml, quinn-proto, undici, protobufjs, websocket-driver, PostCSS, Sharp, gRPC, React Router, Next peer, and native-notification paths.
- `pnpm` does not auto-install Geist's unused Next peer. Geist is pinned to `1.7.2`, and the font copier resolves the pinned workspace dependency before stale virtual-store entries so tracked PoPo fonts do not drift.
- Added PoPo-specific frontend/Windows Rust CI, CodeQL, dependency review, Gitleaks, RustSec, Dependabot, and a reproducible production OSV scan.
- The only accepted OSV result is `GHSA-qwww-vcr4-c8h2` for React Router RSC server actions. PoPo is a static Vite/Tauri BrowserRouter client with no RSC/server action endpoint, and OSV's listed fixed 8.3.0 release is not published. This acceptance must be removed if architecture changes or a compatible fix ships.

## Verification evidence

- `cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --lib`: **20 passed, 0 failed**.
- `cargo fmt ... -- --check`: passed.
- `cargo check --locked --release ...`: passed.
- `pnpm --filter desktop typecheck`: passed.
- `pnpm --filter desktop build`: passed (5,073 modules; only known Node deprecation/chunk-size warnings).
- `pnpm --filter desktop tauri info`: parsed capabilities/CSP successfully.
- `pnpm security:audit:npm`: 98 unique production packages; no applicable known OSV vulnerability.
- `cargo audit`: zero vulnerabilities; remaining warnings are unmaintained target/transitive crates. GTK/glib/memmap warnings are absent from the Windows target graph; `unic-*` remains through Tauri URL-pattern machinery as a maintenance warning.
- Tracked secret-signature scan: no private key, Google API-key, access-token, GitHub-token, AWS-key, or OAuth-secret signature found.
- Firestore Rules compiled in Firebase's official local emulator JAR.
- Storage Rules compiled/linted in Firebase's official rules runtime; recursive-match notices are expected for owner-tree listing/deletion and final default deny.
- `pnpm --filter desktop tauri dev`: Vite and `target/debug/popo.exe` stayed running; hotkeys registered, GCP config restored, Chirp prewarmed, and normal main IPC hydration completed without runtime/blocked-command errors.
- `git diff --check`: passed.
- Independent reviewer: no blocking security finding.

## Residual/manual release risks

1. **Production backend:** repository Rules do nothing until deployed. The owner must deploy to the exact project, configure API restrictions/quotas/budgets/monitoring, and run cross-owner and disposable-account deletion tests.
2. **Desktop App Check:** built-in Firebase web/mobile attestation does not provide a defensible Tauri boundary. A real custom provider needs a backend and meaningful attestation; embedding a static “attestation secret” would be security theater. Until such a system exists, production relies on Auth, Rules, quotas, monitoring, and trusted distribution.
3. **No certificate pinning:** PoPo intentionally uses platform/WebPKI validation for Google-managed endpoints. Static leaf/intermediate pinning would create rotation/outage risk and is not treated as a required control.
4. **Same-user compromise:** same-user malware can inspect process memory, clipboard, optional WAVs, the external service-account key, and invoke DPAPI under that user. Code signing and OS hygiene reduce distribution risk but cannot solve a compromised account.
5. **Distribution trust:** direct Authenticode signing does not guarantee immediate SmartScreen reputation. Microsoft Store is the strongest warning-reduction path; direct files need consistent validated signing, timestamping, Defender review, and published hashes.
6. **Legal/operator identity:** no OSI license or production legal/privacy contact is present. The repository is source-visible, not yet licensed open source, and privacy documentation is a technical baseline pending operator/legal review.
7. **Manual product matrix:** exact release artifacts still require real OAuth, STT, AI Studio, Vertex, sync/audio, interrupted deletion/re-authentication, CSP, pill/switcher, paste, installer/uninstaller, clean-VM, and signed-artifact tests.

## Authoritative follow-up

- Configuration: `docs/OPEN_SOURCE_CONFIGURATION.md`
- Privacy behavior: `PRIVACY.md`
- Vulnerability reporting: `SECURITY.md`
- Release/signing/SmartScreen/malware checklist: `docs/RELEASE_SECURITY_CHECKLIST.md`
