;
; hooks.nsh — PoPo's NSIS installer/uninstaller hooks.
;
; Tauri v2 exposes four extension points via `installerHooks`. These macros
; run inside installer sections, so finish-page language belongs in English.nsh.
;

!macro NSIS_HOOK_PREINSTALL
  ; Session 25 wrote metadata to a bundle-id key that Tauri never owned.
  ; Remove only that stale uninstall-list entry; application data is untouched.
  DeleteRegKey SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\ai.popo.desktop"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Always show onboarding after a fresh NSIS install. The external GCP JSON is
  ; never touched; this removes only PoPo's first-run marker.
  Delete "$APPDATA\ai.popo.desktop\.installed"

  ; Tauri creates the main shortcut under startMenuFolder. Add the direct
  ; uninstaller shortcut beside it so Start Menu search can find it.
  CreateShortcut "$SMPROGRAMS\PoPo\Uninstall PoPo.lnk" \
    "$INSTDIR\uninstall.exe" "" "$INSTDIR\uninstall.exe" 0 \
    SW_SHOWNORMAL "" "Remove PoPo from this machine"

  ; Tauri's current template keys uninstall metadata by PRODUCTNAME, not by
  ; bundle identifier. Enrich that same entry instead of creating a duplicate.
  !define POPO_UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}"

  WriteRegStr SHCTX "${POPO_UNINST_KEY}" "DisplayName"          "${PRODUCTNAME}"
  WriteRegStr SHCTX "${POPO_UNINST_KEY}" "DisplayVersion"       "${VERSION}"
  WriteRegStr SHCTX "${POPO_UNINST_KEY}" "Publisher"            "${MANUFACTURER}"
  WriteRegStr SHCTX "${POPO_UNINST_KEY}" "InstallLocation"      "$INSTDIR"
  WriteRegStr SHCTX "${POPO_UNINST_KEY}" "DisplayIcon"          "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "${POPO_UNINST_KEY}" "UninstallString"      '"$INSTDIR\uninstall.exe"'
  WriteRegStr SHCTX "${POPO_UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\uninstall.exe" /S'
  WriteRegStr SHCTX "${POPO_UNINST_KEY}" "URLInfoAbout"         "https://github.com/Cryptobitsbee/PoPo"
  WriteRegStr SHCTX "${POPO_UNINST_KEY}" "HelpLink"             "https://github.com/Cryptobitsbee/PoPo/issues"
  WriteRegStr SHCTX "${POPO_UNINST_KEY}" "Comments"             "System-wide voice dictation for Windows."
  WriteRegDWORD SHCTX "${POPO_UNINST_KEY}" "NoModify" 1
  WriteRegDWORD SHCTX "${POPO_UNINST_KEY}" "NoRepair" 1
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Warm goodbye prompt. /SD IDYES keeps silent uninstalls (/S) non-blocking.
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Sorry to see you go.$\r$\n$\r$\nWe'll walk you through removing PoPo. \
Your synced history, modes, and settings stay safe in your Google account \
so you can pick up from any machine later.$\r$\n$\r$\nContinue uninstalling?" \
    /SD IDYES \
    IDYES continueUninstall
    Abort "Uninstall cancelled."
  continueUninstall:

  ; Remove current and historical plugin-managed autostart value names.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "popo"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "ai.popo.desktop"
  DeleteRegKey SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\ai.popo.desktop"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Tauri removes bundle-id AppData when the user chooses data deletion.
  ; Diagnostics intentionally remain in the historical lowercase path.
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    RmDir /r "$APPDATA\popo"
  ${EndIf}

  Delete "$SMPROGRAMS\PoPo\Uninstall PoPo.lnk"
  RMDir "$SMPROGRAMS\PoPo"
!macroend
