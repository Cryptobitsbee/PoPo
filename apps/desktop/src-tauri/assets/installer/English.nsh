;
; English.nsh — popo's branded overrides for Tauri's NSIS template.
;
; Tauri's NSIS template exposes a handful of LangStrings that we can
; override via `bundle.windows.nsis.customLanguageFiles`. These strings
; appear in the installer and uninstaller dialogs and are the only
; safe way to rebrand the NSIS UI without hand-rolling a full template.
;
; Every LangString ID below matches the ones documented in the Tauri
; bundler source (crates/tauri-bundler/src/bundle/windows/templates/installer.nsi).
; Adding/renaming any of them requires keeping in sync with Tauri
; upstream, so we stick to what's documented and stable.
;
; These strings are for `${LANG_ENGLISH}`. When popo ships in other
; locales we'll add matching `.nsh` files per language.
;

; ── Install flow ────────────────────────────────────────────────

; Shown when the user re-runs the installer over an existing popo.
; Default: "Add/Reinstall components — Uninstall before installing"
LangString addOrReinstall ${LANG_ENGLISH} "popo is already on this machine. What would you like to do?"

; Shown in the maintenance / modify screen (existing-install detection).
; Default: "Choose the maintenance option to perform."
LangString chooseMaintenanceOption ${LANG_ENGLISH} "popo is installed. Choose how you'd like to continue."

; Shown during silent install when the install actually happens in the
; background. We never use silent-install from CI so this is cosmetic.
LangString silentInstall ${LANG_ENGLISH} "popo is installing quietly in the background."

; Shown when popo.exe is running during install/uninstall and needs
; to be closed before the operation can continue.
; Default: "App is running. Do you want to kill it to continue?"
LangString appRunningOkKill ${LANG_ENGLISH} "popo is still running. Close it so we can finish?"

; Shown if we try to kill popo.exe and the kill fails.
; Default: "Failed to kill the app with name: $1 You may need to close it manually."
LangString failedToKillApp ${LANG_ENGLISH} "Couldn't close popo automatically. Please quit it from the tray (right-click → Quit) and try again."

; ── Uninstall flow ──────────────────────────────────────────────

; Shown on the confirmation page BEFORE the files are removed.
; This is the prompt the user sees asking whether to also wipe
; their local data (%APPDATA%\popo — history db, audio files,
; settings cache, gcp-sa.json).
;
; We want the copy here to be warm but honest about what happens:
; local data goes away, anything synced to Firebase stays safe.
; Default: "Do you want to remove the application data as well?"
LangString deleteAppData ${LANG_ENGLISH} "Also delete popo's local data?$\r$\n$\r$\nThis removes your cached settings, local history, and stored audio from this machine. Anything synced to your account stays safe in the cloud."

; Shown when the uninstaller can't remove popo (usually because
; something on disk is still locked). Rare — our in-app flow
; exits popo.exe before invoking the uninstaller, which avoids
; the most common cause.
; Default: "Unable to uninstall."
LangString unableToUninstall ${LANG_ENGLISH} "Couldn't finish uninstalling popo. Another process may still be using its files — try closing all popo windows and running the uninstaller again."
