;
; hooks.nsh — popo's NSIS installer/uninstaller hooks.
;
; Tauri v2 exposes four extension points via `installerHooks`:
;
;   NSIS_HOOK_PREINSTALL    — before copy, keys, shortcuts
;   NSIS_HOOK_POSTINSTALL   — after all install work is done
;   NSIS_HOOK_PREUNINSTALL  — before any file/key removal
;   NSIS_HOOK_POSTUNINSTALL — after uninstall is complete
;
; These macros get inserted into Tauri's NSIS template at the matching
; point. They run WITHIN sections, so `${MUI_*}` defines can't be set.
;
; CRITICAL FIX (Session 26):
;   The user reported that "Uninstall" from Start Menu goes to Settings
;   instead of launching uninstall.exe directly. Two root causes:
;
;   1. There was NO "Uninstall popo" Start Menu shortcut — users expect
;      to find it alongside the main app shortcut (standard Windows
;      practice). We add it in POSTINSTALL.
;
;   2. The registry key name in our hook was wrong ("popo") — Tauri's
;      template uses the BUNDLE IDENTIFIER ("ai.popo.desktop") as the
;      key name. We now match that.
;
;   With both fixes: typing "Uninstall popo" in Start Menu search will
;   find the shortcut and launch uninstall.exe directly, bypassing
;   Settings entirely.
;

!macro NSIS_HOOK_PREINSTALL
  ; No-op. Reserved for future system-requirement checks.
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; ── 0. Clear first-run markers so the welcome screen always shows ──
  ;
  ; popo stores two independent first-run markers:
  ;   (a) Rust:  %APPDATA%\ai.popo.desktop\.installed
  ;   (b) React: localStorage["popo:first-run-complete"] in WebView2
  ;              User Data (AppData\Local\EBWebView or %APPDATA%\popo...)
  ;
  ; Leftover markers from a previous install (or from an update) stop
  ; the welcome screen firing on a new install, so the user never sees
  ; the main window — popo just starts silently in the tray. Deleting
  ; the Rust marker here guarantees detect_first_run() returns true on
  ; the very next boot regardless of install history. The JS marker
  ; can't be safely wiped from NSIS (WebView2 stores are per-user
  ; profile + not reliably at a fixed path), but the Rust flag gating
  ; show_main() is what matters for the window to appear.
  Delete "$APPDATA\ai.popo.desktop\.installed"

  ; ── 1. Create "Uninstall popo" shortcut in the Start Menu ─────────
  ;
  ; This is what was missing: popo's Start Menu folder only had
  ; popo.lnk → popo.exe. Users searching "Uninstall popo" in Start
  ; found nothing. Now there's a dedicated shortcut pointing directly
  ; at uninstall.exe — no Settings detour needed.
  ;
  ; tauri.conf.json `startMenuFolder: "popo"` tells NSIS to put the
  ; main shortcut at $SMPROGRAMS\popo\popo.lnk. We add the uninstall
  ; shortcut in the same folder.
  CreateShortcut "$SMPROGRAMS\popo\Uninstall popo.lnk" \
    "$INSTDIR\uninstall.exe" "" "$INSTDIR\uninstall.exe" 0 \
    SW_SHOWNORMAL "" "Remove popo from this machine"

  ; ── 2. Enrich the uninstall registry entry ────────────────────────
  ;
  ; Tauri's template writes the core entry at:
  ;   SHCTX\Software\Microsoft\Windows\CurrentVersion\Uninstall\{BUNDLE_ID}
  ; where BUNDLE_ID = "ai.popo.desktop" (from tauri.conf.json identifier).
  ;
  ; We write to the SAME key (not "popo" — that was a bug in Session 25)
  ; to add metadata Tauri's template doesn't always set: Publisher,
  ; DisplayIcon, URLInfoAbout, HelpLink, Comments. This makes popo
  ; appear correctly in Settings > Installed Apps with icon + version.
  !define POPO_UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\ai.popo.desktop"

  WriteRegStr SHCTX "${POPO_UNINST_KEY}" "DisplayName"     "popo"
  WriteRegStr SHCTX "${POPO_UNINST_KEY}" "DisplayVersion"  "0.1.0"
  WriteRegStr SHCTX "${POPO_UNINST_KEY}" "Publisher"       "popo"
  WriteRegStr SHCTX "${POPO_UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr SHCTX "${POPO_UNINST_KEY}" "DisplayIcon"     "$INSTDIR\popo.exe,0"
  WriteRegStr SHCTX "${POPO_UNINST_KEY}" "UninstallString"      '"$INSTDIR\uninstall.exe"'
  WriteRegStr SHCTX "${POPO_UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\uninstall.exe" /S'
  WriteRegStr SHCTX "${POPO_UNINST_KEY}" "URLInfoAbout"    "https://popo.ai"
  WriteRegStr SHCTX "${POPO_UNINST_KEY}" "HelpLink"        "https://popo.ai/help"
  WriteRegStr SHCTX "${POPO_UNINST_KEY}" "Comments"        "System-wide voice dictation for Windows."
  WriteRegDWORD SHCTX "${POPO_UNINST_KEY}" "NoModify" 1
  WriteRegDWORD SHCTX "${POPO_UNINST_KEY}" "NoRepair" 1
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Warm goodbye prompt — the first branded moment in the uninstall flow.
  ; /SD IDYES keeps silent uninstalls (/S flag) flowing without hang.
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Sorry to see you go.$\r$\n$\r$\nWe'll walk you through removing popo. \
Your synced history, modes, and settings stay safe in your Google account \
so you can pick up from any machine later.$\r$\n$\r$\nContinue uninstalling?" \
    /SD IDYES \
    IDYES continueUninstall
    Abort "Uninstall cancelled."
  continueUninstall:
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Clean up the "Uninstall popo" shortcut we added in POSTINSTALL.
  ; Tauri's template removes the main shortcut + folder, but might not
  ; know about our extra .lnk. Belt-and-suspenders deletion.
  Delete "$SMPROGRAMS\popo\Uninstall popo.lnk"
  RMDir "$SMPROGRAMS\popo" ; removes only if now empty
!macroend
