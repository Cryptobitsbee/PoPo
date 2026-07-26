# productContext.md — pill behavior, workflow, UX goals

## The pill is the product

Everything else (main window, history, modes, settings) is secondary UI for
configuring and reviewing what happens inside the pill + auto-paste loop. If
a design decision clashes between "nicer main window" and "faster/calmer
pill", the pill wins.

## Pill states — user-facing meaning

| State       | What the user perceives                                               | Trigger                                                    |
| ----------- | --------------------------------------------------------------------- | ---------------------------------------------------------- |
| sleep       | Almost-invisible ambient line at screen bottom. Feels like OS chrome. | Idle >4s after last session; also app boot                 |
| ready       | Pill expanded, bars flat, clearly "listening".                        | Hotkey pressed; mic stream opened; no voice yet            |
| active      | Bars move with voice.                                                 | PCM amplitude above silence threshold                      |
| processing  | Bars replaced by a DotMatrix loader.                                  | Hotkey released; audio stream finalized; GCP round-trip    |
| success     | A single Phosphor `Check` icon briefly (300ms), then morph to sleep.  | Paste completed without error                              |
| error       | A single Phosphor `Warning` icon, red-ish border, 2s hold.            | Any step in the pipeline failed                            |

Rules:
- The pill **never unmounts** and **never fully disappears**.
- No timer, no counter, no text label inside the pill. The waveform alone
  communicates recording state.
- No dot indicator. No mic icon in the pill during recording.
- Sleep is a real state, not "hidden". It has a size and an opacity.

## The dictation workflow (user POV)

1. User types/clicks into any text field anywhere in Windows.
2. User holds `Ctrl+Shift+Space` without moving the cursor.
3. Pill wakes up at the bottom-center; user speaks.
4. User releases the hotkey.
5. ~500–1200ms later, the transcribed, optionally AI-polished text appears
   in the field they were typing into. Pill returns to sleep.

The user should never have to:
- Click anywhere else.
- Move their mouse.
- Manually copy/paste.
- Re-select the text field after dictation.
- Wait for a visible "uploading" step.

## Modes

Modes are pre-baked AI post-processing prompts. Defaults:
- **Auto** — light punctuation + filler removal
- **Casual** — messages, chat, Slack-style
- **Professional** — email, formal writing
- **Email** — explicit greetings + sign-offs
- **Code** — dictate variable/function names; preserve identifiers

Users can create custom modes (name + system prompt + language override +
output format: Paragraph / Bullets / Raw). Modes page shows them as cards in
a 2-column grid, default mode marked with a small ◆.

## Mode switching

Quick switcher (v0.2): `Ctrl+Shift+M` pops a small secondary pill *above* the
main pill showing mode options. Arrow keys + Enter picks one. Never replaces
the main pill.

## Context-aware mode selection (v0.3)

Via Win32 UIAutomation **only**:
- Read active window title, process executable name.
- Map to heuristic default mode (e.g., `code.exe` + filename → Code mode).
- **Never** take screenshots. **Never** OCR.

## The main window

Opened from tray (Open popo). Frameless, dark, 1080×680 default, `--bg-void`
sidebar + `--bg-base` content with no border between them.

Pages, in sidebar order:
1. History — full-width session rows, not cards
2. Modes — 2-column card grid
3. Test — two-column: input controls + live output
4. Stats — 4 metric cards + language breakdown + weekly heatmap
5. Settings — grouped setting rows (Recording / Transcription / Paste / Privacy / Sound / System / GCP Setup / Account)
6. Account — sign in/out with Google

## Non-goals for UX

- No onboarding tutorial in v0.1 (saves for v1.0 beyond GCP wizard).
- No "training" or "voice calibration" screens.
- No notification spam — toast only on setup errors or sign-out.
- No in-app advertising, upsell, or social features.

## Trust, privacy, and deletion UX (Session 61)

- Signed-out use is first-class; Firebase sign-in is optional and source builds
  without complete Firebase config must fail closed to local-only behavior.
- Privacy copy must distinguish active Speech-to-Text audio transfer from
  optional raw-WAV retention/upload. Never imply all dictation is local.
- Account deletion is retryable/idempotent and must delete known Firestore
  subcollections, profile, Storage audio, Firebase Auth, local WAVs/browser
  state/GCP metadata/DPAPI key, and next-launch diagnostics without recreating
  cloud defaults. It never deletes the user's external service-account JSON.
- Authentication callback UI may say only that a response was received until
  token exchange and Firebase sign-in actually succeed.
- No analytics/ads/crash reporter. Operational logs are bounded and must not
  contain transcript/prompt text, microphone names, raw backend errors, or
  credential material.
- Microphone failures must distinguish unplugged, busy, blocked, unsupported,
  no-callback, and muted/quiet cases without guessing which app owns a device.
  Windows-permission guidance offers one fixed, keyboard-operable settings
  action while keeping the pill compact and non-focus-stealing.
- Installer/uninstaller and Store privacy copy must match actual local/cloud
  retention. Uninstall alone never deletes cloud data.
