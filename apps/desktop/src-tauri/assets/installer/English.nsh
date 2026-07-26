;
; English.nsh — PoPo's branded overrides for Tauri's NSIS template.
;
; Tauri uses its SHOWREADME finish-page control as the optional desktop
; shortcut checkbox. `createDesktop` must be defined here; omitting it leaves
; a checked but blank row on the final installer page.
;

; ── Install flow ────────────────────────────────────────────────

LangString addOrReinstall ${LANG_ENGLISH} "PoPo is already on this machine. What would you like to do?"
LangString chooseMaintenanceOption ${LANG_ENGLISH} "PoPo is installed. Choose how you'd like to continue."
LangString silentInstall ${LANG_ENGLISH} "PoPo is installing quietly in the background."
LangString appRunningOkKill ${LANG_ENGLISH} "PoPo is still running. Close it so we can finish?"
LangString failedToKillApp ${LANG_ENGLISH} "Couldn't close PoPo automatically. Please quit it from the tray (right-click → Quit) and try again."

; This is the second checkbox shown beside `Run PoPo` on the finish page.
LangString createDesktop ${LANG_ENGLISH} "Create a desktop shortcut"

; ── Uninstall flow ──────────────────────────────────────────────

LangString deleteAppData ${LANG_ENGLISH} "Also delete PoPo's local data?$\r$\n$\r$\nThis removes cached settings, optional stored audio, protected Gemini credentials, and diagnostics from this machine. Your external Google service-account JSON and anything synced to your account are not deleted."
LangString unableToUninstall ${LANG_ENGLISH} "Couldn't finish uninstalling PoPo. Another process may still be using its files — try closing all PoPo windows and running the uninstaller again."
