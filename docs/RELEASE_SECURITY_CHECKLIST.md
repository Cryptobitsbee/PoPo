# Security and Windows release checklist

This is a release gate, not a claim of certification or legal compliance. Check every applicable item for the exact commit and artifacts being published. Record evidence (command output, hashes, screenshots, Partner Center submission ID) in a private release record.

## 0. Current release blockers

Do not call an official build release-ready until all are resolved:

- [ ] Choose and add an OSI-approved `LICENSE`. Source visibility without a license is **not** an open-source grant.
- [ ] Add the production publisher's legal identity, country, and private privacy email to `PRIVACY.md`; obtain qualified privacy/legal review for actual markets and users.
- [ ] Enable GitHub private vulnerability reporting, secret scanning/push protection, Dependabot alerts, and protected `main` with required CI/security reviews.
- [ ] Obtain/validate the publisher identity for Microsoft Store and/or Artifact Signing/a trusted Authenticode CA.
- [ ] Deploy the reviewed Firebase Rules and complete disposable-account deletion tests using owner credentials.
- [ ] Complete the manual end-to-end matrix below on a clean supported Windows machine.

## 1. Source and dependency gate

- [ ] Release from a protected tag/commit with reviewed changes only; do not build from an unexplained dirty tree.
- [ ] Confirm no `.env.local`, service-account/Admin JSON, Gemini/API key, OAuth secret, PFX/P12/PVK/P8/JKS/keystore, password, token, or Store credential is tracked or present in the build context.
- [ ] Review every dependency/lockfile change and any `pnpm.overrides` acceptance.
- [ ] Run:

  ```powershell
  pnpm install --frozen-lockfile
  pnpm --filter desktop typecheck
  pnpm --filter desktop build
  pnpm --filter desktop tauri info
  pnpm security:audit:npm
  cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
  cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
  cargo check --locked --release --manifest-path apps/desktop/src-tauri/Cargo.toml
  cargo audit --file apps/desktop/src-tauri/Cargo.lock
  git diff --check
  ```

- [ ] Review RustSec warnings separately. Current GTK3/unic/memmap warnings are target/transitive maintenance notices, not confirmed reachable Windows vulnerabilities; re-evaluate on every Tauri/plugin update.
- [ ] Review the explicit OSV acceptance for React Router. `GHSA-qwww-vcr4-c8h2` concerns React Server Components/server actions; PoPo is a static Vite/Tauri client with neither. Remove the acceptance immediately if PoPo adds RSC/server actions or when a published compatible fixed release exists.
- [ ] Ensure CI, CodeQL, dependency review, Gitleaks, and RustSec are green. Investigate failures; never bypass them just to ship.

## 2. Firebase, OAuth, and privacy gate

- [ ] Official artifacts contain only the intended production **public** Firebase web config, Firestore database ID, Storage bucket, and desktop OAuth client ID.
- [ ] Fork/PR/dev builds use isolated projects or blank Firebase configuration; they do not consume production.
- [ ] Firebase Google sign-in is enabled and the consent/branding configuration matches the publisher.
- [ ] Deploy `firestore.rules` and `storage.rules` to the exact production project; preserve deployment output.
- [ ] Verify API restrictions, Authentication/Firestore/Storage quotas, billing budgets/alerts, and monitoring. Desktop App Check is not treated as protection unless a real custom attestation backend exists.
- [ ] Verify `PRIVACY.md`, in-app copy, Store privacy URL, and actual network behavior agree. Do not claim “local only” when signed-in sync, audio backup, Speech-to-Text, or Gemini is enabled.
- [ ] Confirm logs contain no transcript/prompt text, tokens, API keys, service-account contents, or bearer download URLs.
- [ ] On a disposable account, test cross-user denial and complete deletion of profile, sessions (including >200/remote-only), modes, settings, snippets, dictionary, app icons, diagnostics, Storage audio, Auth user, local WAVs, browser stores, GCP metadata, DPAPI key, and next-launch logs.
- [ ] Confirm individual session deletion removes local WAV, Firestore record, and cloud WAV even if privacy mode was enabled after the original sync.

## 3. Manual application smoke matrix

Run against the exact release candidate, with DevTools disabled and production CSP/capabilities:

- [ ] Google system-browser sign-in succeeds without a client secret; cancellation, wrong state, spoofed loopback request, timeout, and concurrent sign-in fail safely.
- [ ] Sign-out/sign-in persistence and Firebase token refresh work.
- [ ] Speech-to-Text dictation works with auto and explicit languages.
- [ ] AI Studio Gemini works and the key survives restart via DPAPI without appearing in local storage/logs.
- [ ] Vertex Gemini works in `global`, `us`, and/or `eu` as configured.
- [ ] Firestore session/settings/modes/snippets/dictionary/icon sync works across two devices/accounts as expected.
- [ ] Optional audio local save, cloud upload, authenticated playback, legacy playback, and deletion work.
- [ ] History export permits only the user-approved `.json`/`.txt` save path.
- [ ] Main, pill, and Quick Switcher behavior works under split capabilities; the pill can invoke only the fixed no-argument `cmd_open_mic_settings`, unknown webviews cannot invoke app commands, and OAuth/session/test events reach only their intended webviews.
- [ ] Push-to-talk, toggle, silence stop, clipboard restore, per-app paste overrides, mode hotkeys, tray, autostart, wake/single-instance behavior, uninstall, and the paste-target matrix pass.
- [ ] CSP causes no unexpected blocked Firebase/OAuth/audio/font requests and permits no unexpected remote script/frame/object/form load.
- [ ] Account deletion is retried after simulated network interruption and Firebase recent-login failure.

## 4. Choose the Windows distribution path

### Preferred: Microsoft Store

The Store is the strongest path for reducing download warnings. Microsoft states that Store-distributed apps are Microsoft-signed and are not subject to SmartScreen download warnings. Start with:

- [SmartScreen reputation for Windows app developers](https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation)
- [Code-signing options for Windows app developers](https://learn.microsoft.com/windows/apps/package-and-deploy/code-signing-options)
- [Publish Windows apps](https://learn.microsoft.com/windows/apps/publish/)

- [ ] Create/verify the Partner Center account under the exact publisher identity users should see.
- [ ] Reserve the product name and create the Store listing, privacy URL, support contact, age rating, territories, pricing, and accurate capability/data disclosures.
- [ ] Decide packaged MSIX versus the Store's supported existing desktop-installer path. Validate the current Tauri/NSIS install, update, repair, and uninstall behavior against the chosen Store requirements.
- [ ] Ensure versioning and publisher identity in the package/installer match Partner Center exactly.
- [ ] Run Windows App Certification Kit/Partner Center preflight as applicable, submit a private flight, install from the Store, and repeat the smoke/deletion matrix.
- [ ] Do not assume Store acceptance validates privacy, backend Rules, or all malware/security behavior; retain the independent gates above.

### Direct download: Artifact Signing or trusted Authenticode certificate

For GitHub/direct installers, sign consistently under one validated publisher identity. Microsoft Artifact Signing is the preferred managed-key option when available; a reputable OV/EV Authenticode certificate is an alternative.

- [Set up integrations for Artifact Signing](https://learn.microsoft.com/azure/artifact-signing/how-to-signing-integrations)
- [Sign an app package with SignTool](https://learn.microsoft.com/windows/msix/package/sign-app-package-using-signtool)

- [ ] Complete identity validation and create the Artifact Signing account/certificate profile, or acquire an OV/EV certificate under the production publisher.
- [ ] Keep keys non-exportable where possible. For Artifact Signing, use short-lived CI identity/OIDC/RBAC; for hardware/CA certificates, use the provider-backed key store. Never put a PFX or password in the repo, artifact, command line, or plaintext CI log.
- [ ] Restrict signing permission to the protected release workflow/environment with required human approval. Contributors and pull requests must never have signing access.
- [ ] Pin and verify signing tools/integrations. Record tool versions and the certificate/profile used.
- [ ] Build unsigned artifacts reproducibly in a clean runner; scan them; then sign the inner `popo.exe` and each distributed installer/package. Ensure bundling does not invalidate an inner signature.
- [ ] Use SHA-256 file digest and an RFC 3161 timestamp with SHA-256 (`/fd SHA256`, `/tr <provider timestamp URL>`, `/td SHA256`) when using SignTool/CA signing. Follow Artifact Signing's current integration command rather than inventing a local certificate export.
- [ ] Verify every final file independently:

  ```powershell
  Get-AuthenticodeSignature .\path\to\popo.exe | Format-List *
  Get-AuthenticodeSignature .\path\to\popo_*_setup.exe | Format-List *
  signtool verify /pa /all /v .\path\to\popo.exe
  signtool verify /pa /all /v .\path\to\popo_*_setup.exe
  Get-FileHash -Algorithm SHA256 .\path\to\popo.exe
  Get-FileHash -Algorithm SHA256 .\path\to\popo_*_setup.exe
  ```

- [ ] Verification must show a valid chain, expected subject/publisher, SHA-256 digest, and valid timestamp. Test on a clean machine with normal network/certificate-revocation checks.
- [ ] Publish SHA-256 hashes and an artifact manifest from a separately protected release record. A hash does not replace a signature.

Authenticode proves publisher/integrity; it does **not** guarantee immediate SmartScreen reputation or safety. Reputation can depend on publisher history, file prevalence, download source, and Microsoft signals. Never promise “no warning” for a direct download. Keep publisher identity/certificate profile and download URL consistent, avoid frequently renaming/repacking identical releases, and prefer Store distribution when warning-free acquisition is required.

## 5. Malware and false-positive review

- [ ] Scan source/build dependencies in CI and scan both unsigned and final signed artifacts with current Microsoft Defender on a clean machine:

  ```powershell
  Update-MpSignature
  Start-MpScan -ScanType CustomScan -ScanPath .\path\to\release-directory
  Get-MpThreatDetection
  ```

  If PowerShell Defender cmdlets are unavailable, use the installed `MpCmdRun.exe` equivalent.

- [ ] Inspect the installer's files, autorun entry, permissions, network destinations, and uninstall behavior. Confirm no unexpected DLLs/scripts/binaries are bundled.
- [ ] Test Windows 10 21H2+ and current Windows 11 using a fresh VM/snapshot and a non-admin account.
- [ ] If Defender/SmartScreen produces a false positive, stop distribution, preserve exact SHA-256/signature/build provenance, investigate first, then submit the **public release binary only** through [Microsoft Security Intelligence file submission](https://www.microsoft.com/wdsi/filesubmission). Do not upload source, private symbols, credentials, user data, or unreleased secrets.
- [ ] Do not ask users to disable Defender/SmartScreen or run an unsigned replacement. Publish a corrected/reviewed signed build under a new version if contents change.

## 6. Publish and rollback

- [ ] Tag/version, in-app version, filename, release notes, Store listing, and Firebase/privacy documentation agree.
- [ ] Release notes disclose security/privacy-impacting changes and known limitations without exposing exploit details before users can update.
- [ ] Upload only verified signed artifacts from the protected release job; download them again and re-verify signature/hash.
- [ ] Test the actual public URL/Store install, first run, update path, and uninstall/data-retention choices.
- [ ] Retain private build provenance, SBOM/dependency locks, hashes, signing evidence, Firebase ruleset version, and test results.
- [ ] Have a rollback/revocation plan: remove compromised downloads, revoke/disable credentials or signing access, rotate API/OAuth resources where appropriate, publish an advisory, and ship a newly signed fixed version. Never overwrite a released binary in place under the same version/hash.

## Residual risks to re-evaluate

- Desktop code and public identifiers can be extracted; client-side checks cannot protect a backend without Rules/quotas/monitoring.
- A static secret cannot provide meaningful desktop App Check attestation.
- Direct-download SmartScreen reputation is not guaranteed by a valid signature.
- User-selected service-account JSON remains a long-lived external private key outside PoPo's deletion boundary.
- Firebase/Google provider retention and legal obligations are controlled partly by project configuration and provider terms.
- CSP/capability/rule correctness still requires runtime/emulator testing; compilation alone is insufficient.
