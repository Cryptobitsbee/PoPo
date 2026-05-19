# progress.md — phase checklist, what works, blockers

> Format: each Section-11 step from the brief is a row. Status:
> `[ ]` not started, `[~]` in progress, `[x]` done.

## Phase 1 — Research & Specification

- [x] [0] Initialize Memory Bank
- [x] [1] `docs/COMPETITIVE_ANALYSIS.md`
- [x] [2] `docs/TECHNICAL_SPEC.md`
- [x] [3] `docs/DESIGN_SYSTEM.md`
- [x] [4] `docs/PASTE_MECHANICS.md`

## Phase 2 — Scaffold & Core

- [x] [5] Monorepo scaffold
- [x] [6] Rust core — COMPLETE + RUNTIME-VERIFIED
  - cpal audio capture with per-channel downmix to mono, 45s ring buffer
  - Box-average resample 48kHz→16kHz
  - Google Chirp 3 gRPC to `us-speech.googleapis.com` with rustls TLS
  - Voice-activity detection, session:created event, cmd_update_language
  - OAuth loopback listener, GCP channel once_cell cache + prewarm
- [x] [7] Paste mechanic — enigo Ctrl+V primary + WM_PASTE fallback
  - `PasteContext` respects `restore_clipboard` flag from Settings

## Phase 3 — Pill & MVP Loop

- [x] [8] Pill component — single morphing Framer Motion transparent window
  - 80×14 sleep pill; draggable via cursor-proximity loop (see below)
  - ErrorTooltip above pill 10s; waveform EMA-smoothed (α=0.3)
  - Sound effects: Rust emits `pill:sound` → `usePillSound` Web Audio tones
- [x] [9] Global hotkey → Chirp 3 transcribe → paste (END-TO-END LIVE)
  - RUNTIME CONFIRMED: real spoken words appear at cursor

## Phase 4 — Main Window

- [x] [10] Frameless AppShell + Sidebar + routing
- [x] [11] History page — real Firestore data; Play button live
  - Plays stored audio (local WAV via `cmd_read_audio_bytes` → Blob URL,
    or Firebase Storage `audioDownloadUrl` for cross-device)
- [x] [12] Settings page — ALL options wired for real
  - Recording: hotkey (cmd_set_hotkey), mode toggle, mic (cmd_list_mics),
    silence detection
  - Transcription: language (cmd_update_language)
  - Paste: restore clipboard toggle (keystroke mode REMOVED as buggy)
  - Privacy: storeAudio (writes 16kHz PCM-16 WAV to %APPDATA%), privacyMode
    (gates Firestore session writes)
  - Sound: soundEffects → pill:sound events → Web Audio API tones
  - System: startAtLogin via tauri-plugin-autostart
  - Account: LIVE auth row (loading/unconfigured/signed-in/signed-out)
    with real sign-in + sign-out buttons
- [x] [13] Modes page + ModeEditor modal
- [x] [14] Test page — REAL cpal+GCP pipeline (Phase E)
  - cmd_test_dictate_start / cmd_test_dictate_stop (TestRecordingState)
  - Emits test:waveform (25Hz, EMA-smoothed) + test:transcript events
  - Mic list from cmd_list_mics; simulation fallback for non-Tauri contexts
- [x] [14b] Stats page — real session aggregations
  - Both AccountPage and StatsPage use same `computeMetrics()` + formatters
  - Cost formula: ceil(durationMs/15000) × $0.004 (Chirp 2/3 tier)
- [x] [15] GCP Setup wizard (real: file picker + token test)
- [x] Firebase Phase A — auth foundation (RUNTIME CONFIRMED)
- [x] Firebase Phase B — session persistence to Firestore
- [x] Firebase Phase C — modes + settings Firestore sync
  - `useModesSync` + `useSettingsSync` in AppShell
  - GCP stays machine-local (service account path)
- [x] Firebase debugging (Sessions 18.5–18.7)
  - Named database `popo-flow` (not `(default)`) — SDK must use
    `initializeFirestore(app, {experimentalAutoDetectLongPolling:true}, "popo-flow")`
  - Firestore rules fixed to nested match (parent doc writable too)
  - User profile doc (`users/{uid}`) written on sign-in to fix
    Firebase Console ghost-doc rendering issue
  - Storage rules deployed to `popo-flow.firebasestorage.app`
- [x] Firebase Storage — cloud audio backup
  - `useAudioUpload` hook: reads WAV via `cmd_read_audio_bytes`,
    uploads to `audio/{uid}/{id}.wav`, stores `audioDownloadUrl` in
    Firestore session doc, patches historyStore immediately
  - StorageRules deployed (user-owns-own audio)
- [x] Sync log viewer (AccountPage) — real-time Firestore op visibility
  - `syncLogStore` + `SyncLogViewer` + `FirestoreTestButton`
  - All write paths go through `trackSync()` — errors always visible
- [x] Phase D — Settings wire-through to Rust
  - `cmd_list_mics`, `cmd_set_mic`, `cmd_set_hotkey`,
    `cmd_get_current_hotkey`, `cmd_set_recording_mode`,
    `cmd_set_restore_clipboard`, `cmd_set_silence_detection`,
    `cmd_set_store_audio`, `cmd_set_sound_effects`, `cmd_set_start_at_login`
  - `useApplySettingsToRust` hook pushes all runtime settings with
    300ms debounce per field
  - `HotkeyInput` captures real keystrokes (event.code, requires modifier,
    Escape cancels; `cmd_set_hotkey` called, error surfaced inline)
  - `audio/capture::start(preferred_name: Option<&str>)` — device selection
  - Toggle recording mode: `on_event` branches push-to-talk vs toggle;
    waveform task auto-stops in toggle mode after silence_secs
  - WAV storage: 16kHz PCM-16 (6× smaller than 48kHz f32)
  - PCM snapshot taken at stream drop (not after async transcription)
- [x] Phase E — Test page real pipeline ✅
- [x] Phase F — First release build ✅
  - `popo_0.1.0_x64_en-US.msi` = 3.13 MB
  - `popo_0.1.0_x64-setup.exe` = 2.37 MB
  - Both well under 12 MB target
- [x] Pill UX polish
  - Click-through: sleep = fully transparent (cursor-proximity drag loop
    exposes only 104×36px area centred on actual pill bar, not 260×110)
  - Waveform EMA smoothing α=0.3 (Framer Motion-quality feel)
  - Sound effects via Web Audio (620→840Hz start, 940→1240Hz paste)
- [x] Splash screen — 5-step animated sequence on app launch
  - Window: 360×480 transparent, shadow:true, skipTaskbar, focusable:false
  - Sequence: logo fade → pill sleep → ready → active waveform → processing
    → success → auto-close 5 s after animation ends
- [x] NSIS installer branding
  - `assets/installer/header.png` (150×57) + `sidebar.png` (164×314)
  - Dark #0D0D0D background, popo waveform mark + wordmark
  - Configured in `bundle.windows.nsis` in tauri.conf.json

## Phase 5 — Hardening & Ship

- [~] [16] Paste mechanic full test suite — matrix documented in
  `docs/PASTE_TEST_RESULTS.md` (Session 26). 30-row results table +
  test procedure. Rows currently all `❓` pending live runs on the
  latest NSIS build; whoever has a Windows machine should work
  through the matrix and flip rows to `✅` / `⚠️` / `❌`.
- [x] [17] README.md — comprehensive user-facing doc written Session
  26: what popo is, install/setup walkthrough, GCP wizard steps,
  first dictation, hotkey reference, pill states table, settings
  group breakdown, troubleshooting section (6 common issues),
  privacy/data disclosure, uninstall walkthrough, developer setup,
  project layout, contributing rules.

## Pending / Polish

## Session 31 — Snippets + Dictionary + cleanup

- [x] **Snippets (text expansion)** — FULL STACK + RUNTIME-VERIFIED
  - `hotkey::expand_snippets` runs post-transcript, pre-paste.
    Whole-word Unicode matching, case-insensitive + case-preserving
    replace, longest-trigger-wins, single-pass.
  - `snippetsStore` (Zustand + localStorage) → Firestore
    `users/{uid}/snippets/*` via fire-and-forget writes.
  - `useSnippetsSync` hydrates on sign-in.
  - `SnippetsPage` + modal editor + on-save common-word warning
    (driven by `lib/common-words.ts`).
  - `snippets:expanded` event bumps `usageCount` via
    `useSnippetUsageEvents`.
  - New Rust commands: `cmd_set_snippets`, `cmd_set_dictionary`.
  - `useApplySettingsToRust` pushes snippets + dictionary with 300ms
    debounce + stable content hash.
- [x] **Dictionary (Chirp 3 speech adaptation)** — FULL STACK +
  RUNTIME-VERIFIED across three language configs (en-US single,
  [en-IN, hi-IN] multi, auto-detect with silent skip)
  - `hotkey::build_speech_adaptation` — inline PhraseSet with
    per-phrase boost=10, PhraseSet.boost=0 (proto3 omits).
    **DO NOT FLIP** boost locations; Chirp 3 rejects PhraseSet.boost
    with NOT_FOUND.
  - Attached on both streaming + batch paths via `&[String]` param.
  - `DictionaryPage` with chip list + add-input + autoDetect banner.
  - Firestore `users/{uid}/dictionary/*` + `useDictionarySync`.
  - **auto-detect guard**: when `language_codes == ["auto"]` OR
    empty, adaptation is silently dropped (Chirp 3 requires a
    concrete language). Dictionary entries remain stored.
- [x] **Repo cleanup (pre-Snippets/Dictionary)**
  - Deleted `gcp/gemini.rs` (234 LOC), `maybe_polish_with_gemini`.
  - Deleted dead placeholder `src-tauri/src/db/` and `tray/`.
  - Deleted orphan `apps/desktop/src/types/`, empty `services/`.
  - Deleted `scripts/gen-gcp-proto.sh`.
  - Cargo deps dropped: `rusqlite`, `rubato`, `reqwest`.
  - npm dep dropped: `@tauri-apps/plugin-global-shortcut`.
  - Shared-types dropped: `PasteMethod`, `PasteAttempt`,
    `PasteResult`, `SessionPage`, `Settings.pasteMethod`.
  - Stale `synthetic-data.ts` comment in historyStore fixed.
- [x] **Dup-history + async-listener race guard**
  - `historyStore.setAll` + `appendSessions` dedupe by id.
  - `useSessionSave` + `useAudioUpload` carry `cancelled` flag so
    the race between effect cleanup and async `listen()` resolution
    never leaves two live listeners running.
- [x] **Delete persists to Firestore + orphan-icon cleanup**
  - `HistoryPage.handleDelete` calls `firestoreDeleteSession` +,
    if it was the last session for that app, `deleteAppIcon` both
    locally and on Firestore.

## Session 32 — per-app paste, per-mode apps, snippet markers

- [x] **Per-app paste keystroke overrides** — Settings → Paste →
  "App-specific shortcuts". Cursor/VS Code/Zed users can map
  Ctrl+Shift+V (paste-without-formatting) per app.
  - Shared types: `Settings.pasteOverrides: PasteOverride[]` where
    `PasteOverride = { appName, keystroke, iconBase64? }`.
  - Rust `focus/paste.rs::resolve_paste_keystroke()` matches the
    foreground app; `try_enigo_keystroke()` parses
    "Ctrl+Shift+V"-style strings.
  - `cmd_set_paste_overrides` + `useApplySettingsToRust` push.
  - UI: `PasteOverridesEditor` modal using `AppPicker (single)` +
    `HotkeyInput`.
- [x] **Per-mode app bindings (auto-mode selection)** — modes can
  declare `apps?: string[]`; the right mode picks itself based on
  the foreground app.
  - Shared type: `Mode.apps?: string[]`.
  - Rust `hotkey::resolve_effective_prompt(state, app_name,
    forced_mode_id)` priority: (1) forced_mode_id from per-mode
    hotkey/switcher, (2) auto_format check, (3) app match in
    mode_bindings, (4) default mode, (5) legacy auto_format_prompt.
  - `cmd_set_mode_bindings(bindings)` pushes the full mode list
    with `apps`+`hotkey`+`soundPreset` fields.
  - ModeEditor: "Apply in apps" field with AppPicker (multi).
  - ModeCard: stacked-avatar app icon row (3 max + "+N").
- [x] **Snippet markers in History** — pasted transcripts visually
  distinguish expanded snippets.
  - Shared type: `Session.expandedSnippets?: SnippetExpansion[]`
    where `SnippetExpansion = { snippetId, trigger, value,
    startChar, endChar }`.
  - Rust `expand_snippets()` returns `{ text, matched_ids,
    instances }`; `instances` carry char offsets into FINAL text.
  - `on_release` packs `instances` into `SessionPayload.expanded_snippets`.
  - New shared component `HighlightedTranscript.tsx` with inline +
    interactive variants (interactive uses portal tooltip showing
    `trigger → value`).
  - SessionRow shows snippet name chips (label || trigger fallback,
    dedup by snippetId, max 2 + "+N").
- [x] **Shared infrastructure** built for the three above:
  - `cmd_list_running_apps(refresh: bool)` — Rust enumerates
    `EnumWindows` + walks Start Menu .lnk files, returns running +
    installed merged + deduped, cached in `OnceLock`.
  - `focus/app_enum.rs` — `IShellLinkW` (COM) resolves .lnk targets
    to actual .exe paths. Eliminates shortcut-arrow icon overlay +
    fixes "VS Code vs Visual Studio Code" dedup mismatch.
  - `AppPicker.tsx` shared component — chip multi-select with
    manual-entry escape hatch, refresh button, optional `single`
    prop, `onSelect` callback for icon persistence, `iconHints`
    map for stale-icon display.
  - `appIconsStore.upsert()` now called by ModeEditor on app pick
    (not just by `useSessionSave`) so mode bindings show icons
    even before the user dictates into the bound app.

## Session 33 — polish, Quick switcher, skills audit

- [x] **Bug fix: Firestore writes silently dropping `apps` field** —
  Firebase JS SDK throws on any explicit `undefined` field;
  ModeEditor wrote `apps: apps.length > 0 ? apps : undefined` and
  the throw happened during fire-and-forget `setDoc`. Fix:
  `initializeFirestore({ ignoreUndefinedProperties: true })` in
  `lib/firebase.ts`. **This was silently breaking ALL user-edited
  modes since Session 9.**
- [x] **Bug fix: `modesStore.setAll` wiping user edits to factory
  modes** — When the Firestore snapshot fired, factory-id modes
  were replaced by SEED_MODES wholesale (only `usageCount`
  preserved). User's `apps` binding got reset on every snapshot.
  Fix: only overwrite `systemPrompt` from SEED on factory modes;
  preserve everything else. Same fix in `hydrate()` for the
  version-bump path.
- [x] **ConfirmDialog primitive** + confirm-before-delete on
  ModesPage.
- [x] **Email/Professional prompt tuning** — bumped
  `SEED_MODE_VERSION` 3→4. More directive, MANDATORY rules for
  Professional, no padding for Email.
- [x] **Endpointing sensitivity dropdown in Settings** — UI only;
  proto crate v0.34 has only `Standard`, all values map to
  Standard with comment for future re-enable.
- [x] **Focus-visible rings globally** in `globals.css` with new
  `--accent-focus: #6c8fff` token.
- [x] **Export history as JSON/TXT** —
  `cmd_export_history_to_file` + Settings button + native file
  dialog.
- [x] **Account "Danger zone"** (`AccountDangerZone.tsx`) —
  red-bordered "Delete all my data" button: deletes all Firestore
  docs (sessions/modes/snippets/dictionary/appIcons), invokes
  `cmd_clear_local_user_data`, resets Zustand stores, then
  `deleteUser(auth.currentUser)`.
- [x] **Per-mode hotkeys** (`Mode.hotkey?: string`) —
  `cmd_set_mode_bindings` registers/unregisters per-mode shortcuts;
  conflicts (with primary, with each other) are logged + skipped;
  `forced_mode_id` short-circuits app/default resolution.
- [x] **Per-mode sound presets** (`Mode.soundPreset?: "default" |
  "soft" | "chime" | "bell" | "none"`). `pill:sound` event
  payload changed from string to `{ kind, preset }`;
  `usePillSound.ts` plays distinct glides per preset.
  Backward-compatible with the old string payload.
- [x] **Edit transcript inline in History** —
  `historyStore.updateSession()` + Edit/Done button in
  SessionDetail (audio player hidden during edit) + Firestore
  write via `trackSync`.
- [x] **Pill click zone DOUBLED upward** — was [bottom-36,
  bottom+12] (48 px Y), now [bottom-72, bottom+12] (84 px Y).
  Same MARGIN constant. Prep for future click-to-open pill UI.
- [x] **ESC cancel during recording** —
  `register_cancel_hotkey` / `unregister_cancel_hotkey` only
  register ESC globally WHILE recording is active. New `on_cancel`
  aborts streaming + skips paste + restores clipboard + emits
  "Cancelled" tooltip.
- [x] **Quick mode switcher window (Ctrl+Shift+M)** — new
  transparent always-on-top Tauri window at `/switcher`, 480×380,
  mode list with arrow/Enter/Esc keyboard nav + type-to-search.
  Switcher pick stashes in `pending_forced_mode_id` consumed by
  next `on_press`. Voice-pick inside switcher deferred.
- [x] **Skills audit pass** — re-read DESIGN_SYSTEM §10 + impeccable
  + minimalist-skill, removed 6 box-shadow violations across
  FirstRunOverlay/HotkeyDemo/AppFilter/DateRangePicker/
  HighlightedTranscript/ErrorTooltip. Replaced 3 hardcoded rgba
  values with proper tokens (`--pill-bg`, `--pill-blur`,
  `--accent-error`). Quick switcher uses tokens, not hardcodes.
  Switcher window resized 520×380 → 480×380 to eliminate
  transparent gutter.

## Session 34 — Gemini smart-cleanup + cold-start keep-warm

- [x] **Gemini 3.1 Flash-Lite smart-cleanup post-process** —
  reintroduced LLM polish layer because Chirp's `custom_prompt` is
  a STYLE biasing layer, not an instruction-following LLM. Cannot
  collapse self-corrections ("10:30 p.m. sorry 10:30 a.m." →
  "10:30 a.m.") or fix obvious mis-transcriptions.
  - **Model**: `gemini-3.1-flash-lite` (NOT the old
    gemini-2.0-flash from Session 27/28).
  - **Endpoint**:
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent`
  - **Auth**: `x-goog-api-key` header (NOT Vertex AI/OAuth — user
    chose AI Studio API key path; key from
    https://aistudio.google.com/app/apikey).
  - **Free tier**: 15 RPM / 1500 RPD.
  - **`thinkingConfig.thinkingLevel: "minimal"`** — Flash-Lite's
    native default. **NOT "low"** (tested, timed out at 3 s for
    transcripts >50 chars; "low" adds 1-2 s reasoning step).
    "minimal" lands ~600-1500 ms warm.
  - generationConfig: `temperature: 0.2`, `maxOutputTokens: 2048`.
  - systemInstruction: `BASELINE_CORRECTION + mode.systemPrompt +
    "Output ONLY the cleaned transcript itself…"`.
  - Storage: `GCPSettings.geminiApiKey: string | null`,
    machine-local (NEVER synced — same precedent as
    `serviceAccountJsonPath`).
  - `Settings.smartCleanup: boolean` (default `true`) — synced.
  - Rust `PopoState.gemini_api_key: Mutex<Option<String>>` +
    `cmd_set_gemini_api_key`.
  - Wired in `hotkey::on_release` AFTER prompt-echo guard, BEFORE
    snippet expansion. Fail-open: any error logs warn + falls
    through to raw Chirp.
- [x] **Cold-start latency fix (the post-idle problem)** — Google's
  serving infrastructure tears down warm workers after ~5 min
  idle. Real test: 8 min idle → Chirp gRPC open took 14 s, Gemini
  timed out at 10 s.
  - **Periodic keep-warm task** in `lib.rs`, spawned at boot,
    ticks every 4 minutes, calls `prewarm_streaming` (Chirp) +
    `gemini::prewarm` (Gemini, only when API key set). Cost
    ~$0.001/day. Logs at debug level.
  - **Gemini timeout bumped 3 s → 10 s → 15 s** for cold-start
    safety.
  - New `gcp::gemini::prewarm(api_key)` — 1-token request, 8 s
    timeout, debug logs only.
- [x] **Switcher window white scrollbar fix** — themed scrollbar
  rules in `globals.css` made global (was scoped to
  `html[data-window="main"]`). Removed `box-shadow` from switcher
  card; relies on `--pill-bg` + `--pill-border` tokens.

## Session 35 — Merged smart_cleanup into auto_format

- [x] **Architectural cleanup: collapsed `Settings.smartCleanup` +
  `Settings.autoFormat` into a single `autoFormat` flag.** The
  user pointed out that having both toggles created a confusing
  matrix; the simpler mental model is: "if you want AI to format,
  you want it."
  - **Mental model now**:
    - `autoFormat` ON  + Gemini key set    → Gemini polish (~1s latency)
    - `autoFormat` ON  + no Gemini key     → Chirp `custom_prompt` only
    - `autoFormat` OFF                     → raw Chirp, no prompts at all
  - Removed `Settings.smartCleanup` field (shared types +
    DEFAULT_SETTINGS).
  - Removed `PopoState.smart_cleanup: Mutex<bool>` (Rust).
  - Removed `cmd_set_smart_cleanup` Tauri command (settings.rs +
    lib.rs invoke handler + `useApplySettingsToRust` push).
  - Removed the "Smart cleanup" SettingRow from
    Settings → Transcription.
  - Gemini API key field now conditional on `autoFormat` ON
    (was `smartCleanup && autoFormat`).
  - Auto-format description copy is now dynamic with three
    branches (ON+key / ON+no-key / OFF).
  - Rust `on_release` Gemini gating reads:
    `auto_format_enabled && api_key_present && !used_fake &&
    !transcript.empty && !sys_prompt.empty`.
- [x] **Migration safety** — existing users' stale
  `smartCleanup: true` in localStorage / Firestore is silently
  ignored. TS shape change means unknown fields persist via
  spread-merge but are never read. No data loss, no migration
  script needed.

## Session 36 — Robust prompt rewrite (v5) + timeout/visibility

- [x] **SEED_MODES v5 — full prompt-engineered rewrite of all 5
  factory modes** (highest-impact change of this turn). User
  reported v4 Email mode REMOVING greetings/sign-offs the user
  actually dictated. Root cause: v4 prompt said *"Do NOT add a
  greeting…"* — LLMs misread "add" as "include" and stripped
  content the user dictated.
  - **Fix principles applied to all 5 modes**:
    - Each prompt starts with explicit role declaration
      ("You are a transcript editor for X").
    - Positive language ("preserve what was spoken") replaces
      negative language ("don't add").
    - Email mode now explicitly says *"Preserve EVERYTHING the
      speaker actually said, including any greetings, sign-offs,
      or subject hints they explicitly dictated. Do not invent
      greetings the speaker did not say."* — **load-bearing**,
      do not regress.
    - Code mode preserves dictated tokens including punctuation/
      operators ("open paren", "equals", "arrow").
    - Each prompt ends with explicit output contract ("Output
      only the cleaned transcript. No preamble, no commentary,
      no quotes around the output.").
  - Bumped `SEED_MODE_VERSION` 4 → **5**. Existing users get
    new prompts on next hydration; the Session 33 `setAll`
    factory-mode merge logic preserves their app bindings +
    other edits while overwriting only `systemPrompt`.
- [x] **Gemini timeout bumped 8s → 12s.** User log showed Chirp
  finish at 11:34:16, Gemini timeout at 11:34:24 (exactly 8s
  ceiling) despite keep-warm running every 4 min. 12s gives
  ~6× the warm latency as cold-start headroom.
  Full timeout history (now in code comments):
  3s → 10s → 15s (3.1-flash-lite + thinking) → 8s
  (2.5-flash-lite, no thinking) → **12s** (current).
- [x] **Keep-warm logs bumped from `debug` to `info`** so the
  user can see the 4-minute task firing in their terminal
  without bumping `RUST_LOG`. Visible at default level:
  ```
  INFO keep-warm: re-prewarming Chirp streaming
  INFO keep-warm: re-prewarming Gemini
  INFO gemini prewarm: warmed in NNNms
  ```
  Failures (HTTP non-200, network error) bumped from `debug`
  to `warn`.

## Deferred / post-v0.1


| Task | Notes |
|---|---|
| Verify Session 35-36 fixes | First action of next session — v5 Email/Code prompt smoke tests + 12s Gemini timeout + keep-warm log visibility |
| Opus audio encoding | libopus C dep; currently 16kHz PCM-16 WAV (6× smaller than before) |
| Always-on Gemini fallback (Option B) | If free-tier 15 RPM/1500 RPD limits become a problem; user-named fallback (now gates on `autoFormat`, not the removed `smartCleanup`) |
| Endpointing sensitivity wire-up | UI shipped Session 33; proto crate v0.34 only has Standard. Re-enable when crate gains SHORT/SUPERSHORT or vendor proto. |
| UIAutomation paste fallback | Implement if the PASTE_TEST_RESULTS matrix shows >2 Electron apps need it |
| Populate paste test matrix | User to run through `docs/PASTE_TEST_RESULTS.md` on a real Windows box |
| Cloud VAD events | `enable_voice_activity_events` — could replace local RMS silence detection |
| Interim results on pill | Data flows from Chirp 3; need v0.2 UI treatment |
| Tauri updater plugin | OTA updates instead of manual .exe download |
| Hinglish/Tenglish mode | Dedicated mode with romanization prompt |
| Per-phrase boost UI for dictionary | Currently fixed at 10 |
| Voice-pick inside Quick switcher | Deferred from Session 33 |

## What works TODAY

| Feature | Status |
|---|---|
| Real-time Chirp 3 streaming (~1-2s paste with formatting) | ✅ LIVE (Session 29) |
| CustomPromptConfig formatting (5 modes) | ✅ LIVE (Session 29) |
| Cloud denoiser (always-on) | ✅ |
| AGC for Bluetooth/low-gain mics | ✅ (Session 29) |
| **App icon bubble on pill** | ✅ (Session 29) |
| **Pill polish: 176×40 minimal, wider waveform with edge fade** | ✅ (Session 29) |
| **Stable pill position + bottom-anchored alignment** | ✅ (Session 29) |
| **Transcript-on-clipboard by default** | ✅ (Session 29) |
| Waveform sensitivity tuned (RMS*5.0, SMOOTH_ALPHA 0.4) | ✅ (Session 29) |
| Toggle recording mode + silence auto-stop | ✅ |
| Multi-language code-switching (GA languages) | ✅ (Session 29) |
| Searchable Select + MultiSelect dropdowns | ✅ (Session 29) |
| 98 languages with GA/Preview labels | ✅ (Session 29) |
| Versioned mode prompts (factory auto-update) | ✅ (Session 29) |
| Streaming prewarm at boot | ✅ (Session 29) |
| Tracing to terminal (dev) / log file (release) | ✅ (Session 29) |
| Pill: sleep transparent, EMA-smooth waveform, drag | ✅ |
| Sound effects (ping on start, chime on paste) | ✅ |
| Store audio → 16kHz WAV + Firebase Storage cloud backup | ✅ |
| Privacy mode (sessions stay local when on) | ✅ |
| Start at login (HKCU registry via autostart plugin) | ✅ |
| Audio playback in History (local Blob URL or cloud URL) | ✅ |
| Google Sign-In (system-browser PKCE OAuth) | ✅ |
| Sessions + modes + settings sync to Firestore | ✅ |
| Hotkey reconfigurable from Settings | ✅ |
| Mic selection (real cpal device list) | ✅ |
| Test page real pipeline | ✅ |
| Stats and Account metrics | ✅ |
| Branded NSIS installer (MSI + NSIS, both ≤ 4MB) | ✅ |
