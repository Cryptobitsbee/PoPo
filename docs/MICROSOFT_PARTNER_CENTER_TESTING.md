# Microsoft Partner Center testing

This is an engineering handoff for private Microsoft Store testing. It is not a claim that PoPo is certified, publicly release-ready, or guaranteed to pass Microsoft review.

## Recommended Store path: MSIX

PoPo now has a manual Windows SDK packaging path because Tauri v2 does not generate MSIX itself. Microsoft permits MSIX/AppX Store submissions without a CA-trusted code-signing certificate and re-signs accepted packages after certification. This exception applies to **MSIX/AppX only**; Microsoft does not re-sign submitted MSI/EXE installers.

The package is a full-trust packaged desktop application containing the x64 Tauri executable and MSIX tile assets. Its manifest declares internet, microphone, and `runFullTrust` capabilities. Restricted capabilities and all app behavior remain subject to Store policy and certification.

### 1. Reserve the app and copy its identity

In Partner Center, open the PoPo product and go to:

`Product management → Product identity`

Copy these three values exactly, including case, spaces, punctuation, and the complete publisher distinguished name:

- `Package/Identity/Name`
- `Package/Identity/Publisher`
- `Package/Properties/PublisherDisplayName`

Create the ignored local configuration:

```powershell
Copy-Item `
  apps/desktop/src-tauri/msix/partner-center-identity.example.json `
  apps/desktop/src-tauri/msix/partner-center-identity.local.json
```

Replace every `COPY ...` value in the local file. These identity values are public package metadata, not signing credentials, but the local file is ignored so an unreviewed account-specific identity is not accidentally committed.

Do not substitute `ai.popo.desktop`: that is PoPo's Tauri identifier, not the identity reserved by Partner Center.

### 2. Correct the desktop OAuth build configuration

Before building, `apps/desktop/.env.local` must contain both values from the same Google OAuth client created as **Desktop app**:

```env
VITE_GOOGLE_DESKTOP_CLIENT_ID=...apps.googleusercontent.com
VITE_GOOGLE_DESKTOP_CLIENT_SECRET=...
```

PoPo's existing Desktop client registration requires its Google-issued credential during token exchange. Because Vite embeds it in the executable, that value is extractable public-client metadata—not a confidential authorization boundary. PKCE S256, random OAuth state, and the random loopback callback remain the per-attempt protections. Never substitute a Web/server client secret or commit `.env.local`.

### 3. Build the Partner Center package

```powershell
pnpm install --frozen-lockfile
pnpm --filter desktop tauri:build:msix
```

The script:

1. creates a fresh release executable;
2. generates exact-size Store, 44×44, and 150×150 assets;
3. creates a packaged-classic-app manifest;
4. invokes the newest installed x64 Windows SDK `MakeAppx.exe`;
5. unpacks the result and checks identity, version, architecture, executable name, and payload;
6. writes a SHA-256 sidecar.

Expected output pattern:

```text
apps/desktop/src-tauri/target/release/bundle/msix/PoPo_1.0.0.0_x64.msix
```

MSIX uses `1.0.0.0` for the initial Store package even while PoPo's product version is `0.1.0`: Microsoft requires the first package-version field to be at least 1 and reserves the fourth field for Store use, so it must be 0 at build time.

An unsigned Store package cannot be installed normally from Explorer. Upload it through the MSIX/AppX package flow in the PoPo Partner Center product. The Store will validate the exact identity and, only after successful certification, re-sign the package for customer installation.

## Local unsigned MSIX proof

For Windows 11 packaging/install experiments, build a separate special-OID package:

```powershell
pnpm --filter desktop tauri:build:msix:test
```

Current locally verified proof (July 26, 2026; generated files remain ignored):

| Artifact | Size | SHA-256 | Signature |
|---|---:|---|---|
| `PoPo_1.0.0.0_x64_LocalTest.msix` | 4,021,083 bytes | `F7545EA5E0F0040E5C3AE66A70193B2700413EF0899374D9FE6C10DF88A5EEB4` | `NotSigned` |

MakeAppx 10.0.26100.8249 packed and unpack-verified this x64 package; the payload contains `PoPo.exe` plus exact 50×50, 44×44, and 150×150 assets. Microsoft Defender signature 1.455.353.0 (age 0) reported zero detections for this exact MSIX and the NSIS proof below. This is local evidence, not Store certification.

It uses identity `PoPo.LocalTest` and publisher:

```text
CN=PoPo Local Test, OID.2.25.311729368913984317654407730594956997722=1
```

Microsoft requires that special publisher OID for unsigned local registration. It deliberately cannot share the Store identity and **must not be uploaded to Partner Center**.

On a disposable Windows 11 VM, an administrator can install it with:

```powershell
Add-AppxPackage `
  -Path .\PoPo_1.0.0.0_x64_LocalTest.msix `
  -AllowUnsigned
```

Do not run this over an important developer profile. Test install, launch, OAuth, global hotkeys, microphone access, tray, startup behavior, update behavior, and clean uninstall in the disposable VM. The MSIX package relies on the supported machine's WebView2 Runtime; unlike the standalone NSIS profile, it does not embed the 200 MiB WebView2 offline installer.

## Direct-download NSIS path

The standalone NSIS installer remains available for local/direct testing:

```powershell
pnpm --filter desktop tauri:build:store
```

Expected output:

```text
apps/desktop/src-tauri/target/release/bundle/nsis/PoPo_0.1.0_x64-setup.exe
```

Current rebuilt proof: 209,647,693 bytes, SHA-256 `D5F95DE3E9270866C6CFF2D2021505FA0434D3EA223B5C62284BB45EEE9418F3`, `NotSigned`. Generated NSIS metadata and finish-page source confirm ProductName/Manufacturer/Start Menu folder `PoPo` and the second checkbox label `Create a desktop shortcut`.

It embeds the x64 WebView2 offline installer and uses silent parameter `/S`. Partner Center's MSI/EXE path still requires the installer and every installed PE file to be signed with a certificate chaining to the Microsoft Trusted Root Program. The Store does not re-sign EXE/MSI submissions.

For direct distribution:

1. sign and RFC3161-timestamp `popo.exe`;
2. rebuild NSIS so the signed executable is inside it;
3. sign and timestamp the final installer;
4. verify both signatures report `Valid`;
5. scan the exact files and publish immutable hashes/URLs.

## Validation before submission

- Confirm the three case-sensitive manifest identity values against Partner Center again.
- Confirm `VITE_GOOGLE_DESKTOP_CLIENT_ID` is a Desktop app OAuth client by testing a disposable account in the packaged build.
- Run Windows App Certification Kit on the exact MSIX.
- Test on clean supported Windows 10 and Windows 11 x64 VMs with WebView2 available.
- Exercise microphone permission, selected-device unplug, no-data/muted, global hotkeys, paste, tray, startup, account deletion, and uninstall.
- Complete Store listing, age rating, territories, pricing, support contact, and accurate privacy/data disclosures.
- Preserve the exact source commit, package hash, Partner Center submission ID, and certification report.
- Never replace bytes behind a versioned release URL; publish a new version for changed artifacts.

## Official Microsoft references

- [App package requirements for MSIX apps](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements)
- [View product identity details](https://learn.microsoft.com/en-us/windows/apps/publish/view-app-identity-details)
- [Create an unsigned MSIX package](https://learn.microsoft.com/en-us/windows/msix/package/unsigned-package)
- [Generate MSIX package components manually](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-manual-conversion)
- [App package requirements for MSI/EXE apps](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/app-package-requirements)
- [PoPo release security checklist](RELEASE_SECURITY_CHECKLIST.md)
