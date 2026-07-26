# Microsoft Partner Center test submission

This is an engineering handoff for a private Microsoft Store test submission, not a claim that the current artifact is certified, signed, or publicly release-ready.

## Chosen path

Use Partner Center's **MSI/EXE app** path with PoPo's x64 NSIS installer.
Microsoft also recommends MSIX, but PoPo's current Tauri release pipeline already supports NSIS. The dedicated Store profile embeds the WebView2 offline installer so the submitted EXE is standalone rather than a downloader stub.

Build from the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm --filter desktop tauri:build:store
```

Store overlay: `apps/desktop/src-tauri/tauri.store.conf.json`
Expected output: `apps/desktop/src-tauri/target/release/bundle/nsis/popo_0.1.0_x64-setup.exe`

The normal Tauri config continues using the smaller WebView2 download bootstrapper for local/direct development builds. Only `tauri:build:store` applies `offlineInstaller`.

## Partner Center package fields

| Field | PoPo value |
|---|---|
| App type | `EXE` |
| Architecture | `x64` |
| Language | `English` / `en` |
| Installer parameters | `/S` |
| Success return code | `0` |
| Package version | `0.1.0` |
| Identity/application ID | `ai.popo.desktop` (repository/Tauri identifier; use Partner Center's reserved Store identity where its form requires that identity instead) |
| Installer URL pattern | `https://github.com/Cryptobitsbee/PoPo/releases/download/v0.1.0/popo_0.1.0_x64-setup.exe` |
| Privacy URL after merge | `https://github.com/Cryptobitsbee/PoPo/blob/main/PRIVACY.md` |
| Support/security URL | `https://github.com/Cryptobitsbee/PoPo/security/advisories/new` for private vulnerability reports; provide the publisher's private support email in the listing |

The package URL must be a direct, immutable, versioned HTTPS URL. Never replace
the bytes behind a submitted URL. Publish a new version/tag/URL for every
changed installer.

## Mandatory blockers before uploading the EXE

Microsoft's MSI/EXE requirements state that the installer and **all PE files it
installs** must be digitally signed by a certificate chaining to the Microsoft
Trusted Root Program. Therefore:

1. Complete publisher/code-signing identity validation.
2. Sign and RFC3161 timestamp `popo.exe` before NSIS packages it.
3. Build the standalone Store installer from that signed executable.
4. Sign and timestamp the final `popo_0.1.0_x64-setup.exe`.
5. Verify both signatures and record SHA-256 hashes.
6. Defender-scan the exact signed files.

An unsigned local build is useful for installation testing but is **not** a
valid Partner Center MSI/EXE upload candidate.

## Verification commands

```powershell
$exe = "apps/desktop/src-tauri/target/release/popo.exe"
$installer = "apps/desktop/src-tauri/target/release/bundle/nsis/popo_0.1.0_x64-setup.exe"

Get-AuthenticodeSignature $exe | Format-List Status,StatusMessage,SignerCertificate,TimeStamperCertificate
Get-AuthenticodeSignature $installer | Format-List Status,StatusMessage,SignerCertificate,TimeStamperCertificate
Get-FileHash $exe -Algorithm SHA256
Get-FileHash $installer -Algorithm SHA256
```

For a signed submission, both statuses must be `Valid`, the signer must match
the production publisher, and a valid timestamp must be present. `/S` is the
standard NSIS silent-install parameter used by Partner Center. Test it on a
clean disposable Windows VM before submission; do not silently install over a
developer machine that contains important PoPo data.

## Private testing sequence

1. Reserve the Store product name under the verified publisher identity.
2. Complete listing, age rating, territories, pricing, support contact, and accurate privacy/data disclosures.
3. Upload the signed standalone EXE through the MSI/EXE package flow using the fields above.
4. Choose private/limited availability or the available Partner Center test audience before public release.
5. Install from the Store on a clean Windows 10/11 account.
6. Run OAuth, GCP setup, STT, both Gemini providers, sync/audio, account deletion, tray/autostart, microphone-error, paste, and uninstall checks.
7. Preserve the Partner Center submission ID, certification report, artifact hashes, signatures, and exact source commit in a private release record.

## Official Microsoft references

- [App package requirements for MSI/EXE apps](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/app-package-requirements)
- [Upload app packages for MSI/EXE apps](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/upload-app-packages)
- [Create an app submission for an MSI/EXE app](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/create-app-submission)
- [PoPo release security checklist](RELEASE_SECURITY_CHECKLIST.md)
