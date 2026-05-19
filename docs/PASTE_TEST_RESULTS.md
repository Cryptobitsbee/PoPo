# PASTE_TEST_RESULTS.md — live paste mechanic test matrix

> This is the **results** companion to `docs/PASTE_MECHANICS.md`.
> PASTE_MECHANICS.md defines the expected behavior; this document
> tracks actual outcomes as we verify against every target app.
>
> Run the procedure in §2 for each row and update the Result column.
> Whenever a row flips from ❓ to ✅ / ⚠️ / ❌, update the timestamp
> and any notes on what happened.

## 1. Why this exists

`docs/PASTE_MECHANICS.md §9` describes the 4-method fallback chain and
the expected primary method per app. But reality varies by Windows
build, app version, and host hardware. Shipping v0.1 requires that the
**primary Ctrl+V path** (enigo `SendInput`) works for at least the
browser / IDE / chat / Office bucket — the 90% of typing surfaces a
user actually dictates into.

Phase 5 [16]: run the full matrix, populate the Result column, and
decide whether we need to implement the UIAutomation fallback before
v0.1 ships.

## 2. How to run a test

1. Install the latest NSIS build of popo (`pnpm tauri build` →
   `target/release/bundle/nsis/popo_*-setup.exe`).
2. Complete the GCP setup wizard (Settings → GCP Setup → Run setup
   wizard) so real Chirp transcription runs, not the guidance fallback.
3. Open `%APPDATA%\popo\logs\paste.log` in a separate window (tail it
   with `Get-Content paste.log -Wait` in PowerShell).
4. For each row in §3:
   1. Open the target app and click into its primary text area.
   2. Hold `Ctrl+Shift+Space` and say a short test phrase:
      `"popo is dictating into this field at {timestamp}"`
   3. Release the hotkey. Watch what lands in the field AND what
      the paste.log prints.
   4. Record the outcome in the Result column:
      - ✅ **Full success** — text appeared, cursor is positioned
        where it should be, clipboard was restored.
      - ⚠️ **Partial** — text appeared but something's off (cursor
        moved, clipboard NOT restored, delay >2s, paste duplicated).
        Note the specifics.
      - ❌ **Failed** — no text appeared at the cursor. Check if
        the text landed on the clipboard (Ctrl+V manually — if that
        works, the paste orchestrator failed but the clipboard write
        succeeded).
      - ❓ **Not tested yet** — initial state, filled in as we go.

## 3. Result matrix

Last updated: _(fill in on change)_

| App | Category | Primary? | Fallback? | Result | Notes |
| --- | --- | --- | --- | --- | --- |
| Notepad | Classic Win32 | enigo | WM_PASTE | ❓ | Canonical acceptance test — must pass before anything else. |
| WordPad | Classic Win32 | enigo | WM_PASTE | ❓ | RichEdit20W. |
| Chrome — address bar | Chromium | enigo | UIA | ❓ | |
| Chrome — Gmail compose | Chromium contenteditable | enigo | UIA | ❓ | |
| Chrome — Google Docs | Chromium contenteditable | enigo | UIA | ❓ | |
| Firefox — URL bar | Gecko | enigo | UIA | ❓ | MozillaWindowClass. |
| Edge — any input | Chromium | enigo | UIA | ❓ | |
| VS Code — editor | Electron | enigo | UIA | ❓ | CEF inside Electron. |
| VS Code — integrated terminal | Electron + xterm.js | enigo | (tricky) | ❓ | xterm canvas can reject SendInput. |
| Cursor — editor | Electron | enigo | UIA | ❓ | Same rendering path as VS Code. |
| Slack desktop | Electron | enigo | UIA | ❓ | |
| Discord desktop | Electron | enigo | UIA | ❓ | |
| Zoom chat | Electron | enigo | UIA | ❓ | |
| Notion desktop | Electron | enigo | UIA | ❓ | |
| Obsidian | Electron | enigo | UIA | ❓ | |
| Microsoft Word | Office | enigo | UIA | ❓ | |
| Microsoft Outlook (compose) | Office | enigo | UIA | ❓ | |
| Excel cell editor | Office | enigo | UIA | ❓ | Cell editing has special paste behavior; watch for cursor placement. |
| PowerPoint text box | Office | enigo | UIA | ❓ | |
| Teams chat | Electron | enigo | UIA | ❓ | |
| Windows Terminal (PowerShell tab) | Modern Win32 | enigo | ATI | ❓ | Ctrl+V is "paste" in wt.exe by default. |
| Windows Terminal (WSL tab) | Modern Win32 | enigo | ATI | ❓ | Same. |
| Legacy cmd.exe | Classic Console | enigo | (tricky) | ❓ | Edit→Paste also works if Ctrl+V fails. |
| Legacy PowerShell (conhost) | Classic Console | enigo | (tricky) | ❓ | Same as cmd. |
| Settings app search | WinUI / modern | enigo | UIA | ❓ | Good UIA fallback canary. |
| File Explorer address bar | Modern Win32 | enigo | WM_PASTE | ❓ | |
| Spotify search | Electron | enigo | UIA | ❓ | |
| WhatsApp desktop | UWP | ? | UIA | ❓ | UWP may require UIA path. |
| UAC prompt | Elevated | expected ❌ | expected ❌ | ❓ | UIPI blocks cross-integrity-level input. Documented as a known limitation. |
| DirectX fullscreen game | Game | expected ❌ | expected ❌ | ❓ | DirectInput doesn't accept SendInput. |
| Remote Desktop (into VM) | Virtualized | enigo | (depends) | ❓ | Works in windowed RDP; full-screen is unreliable. |

## 4. Passing the matrix

v0.1 ships when:
- **Every row in the Classic Win32 + Chromium + Electron + Office
  categories is ✅** (the 90% buckets).
- **Console rows** (Terminal, cmd, PowerShell) are at least ⚠️ — text
  lands on the clipboard even if Ctrl+V doesn't forward cleanly.
- **Expected ❌ rows** stay ❌ — they're OS-level limitations we
  document in the README troubleshooting section, not regressions.
- **`paste.log` method distribution** has no silent escalations —
  every ❌ is documented with a reason in the Notes column.

If more than two Electron apps or any Office app requires the UIA
fallback to succeed, we implement UIAutomation (PASTE_MECHANICS.md §4)
BEFORE shipping v0.1. Otherwise we ship with enigo + WM_PASTE only and
add UIA as a v1.0 hardening item.

## 5. Re-running after a change

Whenever the paste pipeline is touched (e.g. we flip `restoreClipboard`
defaults, add a new method, tweak dwell timings), rerun this matrix.
Keep a changelog at the bottom so regressions are obvious.

### Change log

- _YYYY-MM-DD_ — initial empty matrix, filled in by Phase 5 [16].

## 6. Known workarounds to document in the README

After populating this matrix, anything that needs a user-facing note
goes into the README troubleshooting section:

- Apps that need a particular flag or config (e.g. "Windows Terminal:
  enable 'Paste with Ctrl+V' in Settings → Actions").
- Apps where the paste works but the cursor ends up at an unexpected
  spot (so the user knows to Home-key before dictating).
- Apps where dictation genuinely doesn't work (UAC, games) with a
  one-line explanation of why.
