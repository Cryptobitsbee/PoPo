// @popo/shared-types
//
// Types mirrored between Rust (serialized over Tauri IPC) and the React
// frontend. When a type changes on the Rust side, it must be updated here
// by hand — we intentionally do NOT use ts-rs or similar generators in
// Phase 2 so both sides of the contract are reviewed by humans.

// ----- Pill state ------------------------------------------------------

export type PillState =
  | "sleep"
  | "ready"
  | "active"
  | "processing"
  | "success"
  | "error";

export interface PillErrorPayload {
  code: string;
  message: string;
  /**
   * Visual severity of the pill tooltip.
   *   - `"error"` (default): red-bordered tooltip + flips pill state
   *     to "error" for the duration of the hold.
   *   - `"info"`: neutral-bordered tooltip, does NOT change pill
   *     state. Used for soft hints (e.g. "finish GCP setup to start
   *     dictating") that accompany a normal success flow.
   */
  severity?: "error" | "info";
  /**
   * When true, the tooltip stays visible until the user clicks it or
   * Rust emits `pill:state:error:clear`. Used for blocking-status
   * notices like "GCP not configured" that should stay on screen
   * until the condition is resolved. When false/omitted the tooltip
   * auto-dismisses after ~10s.
   */
  persistent?: boolean;
}

export interface PillWaveformPayload {
  /** 16 bars, each in 0..1 */
  bars: number[];
}

// ----- Settings --------------------------------------------------------

/** User-tunable preferences that shape the pill + dictation pipeline. */
export interface Settings {
  // Recording
  /** Global hotkey string, e.g. "Ctrl+Shift+Space". */
  hotkey: string;
  /** Push-to-talk holds the key; Toggle flips on first press, off on second. */
  recordingMode: "push-to-talk" | "toggle";
  /** cpal / WebAudio device id. null = follow system default. */
  micDeviceId: string | null;
  /** Auto-stop after N seconds of silence. 0 disables. Applies to Toggle mode. */
  silenceDetectionSeconds: number;

  // Transcription
  /** BCP-47 code or "auto" for Chirp auto-detect. */
  language: string;
  /**
   * Phase C — BCP-47 codes for Chirp 3 code-switching. When this
   * array is non-empty, it takes precedence over `language`. Pick
   * 2-3 languages you speak and Chirp 3 switches between them
   * mid-sentence (e.g. `["hi-IN", "en-US"]` for Hinglish).
   */
  multiLanguageCodes: string[];
  /** Mode id to use when no override is set. References Mode.id. */
  defaultModeId: string | null;
  /**
   * Master AI-formatting switch. When ON AND `GCPSettings.geminiApiKey`
   * is configured, every Chirp transcript is polished through
   * Gemini 2.5 Flash-Lite using the active mode's system prompt
   * (Code preserves technical terms, Email structures it as a
   * proper email, etc.). Adds ~600-1500 ms latency per dictation.
   *
   * When OFF: pure raw Chirp output. No mode prompt, no Gemini
   * polish, no formatting. Fastest path; for users who want their
   * exact spoken words pasted verbatim.
   *
   * If autoFormat is ON but the API key is missing, falls back to
   * Chirp's own `custom_prompt` biasing for partial style hints —
   * better than raw, weaker than Gemini.
   */
  autoFormat: boolean;
  /**
   * Phase C — Chirp 3 spoken punctuation. "Say 'comma' to get ,".
   * Useful for email dictation; awkward for casual speech.
   */
  spokenPunctuation: boolean;
  /**
   * Phase C — Chirp 3 spoken emojis. "Say 'smiling emoji' to get 😊".
   */
  spokenEmojis: boolean;
  /**
   * Phase C — Chirp 3 profanity filter. Replaces profanity with
   * asterisks ("f\*\*\*").
   */
  profanityFilter: boolean;

  /**
   * Chirp 3 endpointing sensitivity. Controls how quickly the model
   * decides the speaker has finished a phrase and commits a final
   * transcript.
   *
   *   - `"low"`      — patient. Waits for longer pauses before
   *                    finalising. Better for slow / deliberate
   *                    speech + users who pause mid-sentence.
   *   - `"standard"` — default. Google's recommended setting for
   *                    most general-purpose dictation.
   *   - `"high"`     — snappy. Finalises on shorter pauses, shaving
   *                    ~100-300 ms off short-utterance latency, but
   *                    more likely to truncate if the user hesitates.
   *
   * Exposed in Settings → Transcription → Response speed.
   */
  endpointing: "low" | "standard" | "high";

  // Paste
  /** Restore the user's previous clipboard contents after paste. */
  restoreClipboard: boolean;
  /**
   * Per-app paste keystroke overrides. When the foreground app at
   * paste time matches one of these entries by `appName` (the same
   * pretty-name that `focus::app_icon::get_app_name` returns —
   * e.g. "VS Code", "Cursor", "Windows Terminal"), Rust sends the
   * configured `keystroke` instead of the default Ctrl+V.
   *
   * Typical use:
   *   - Cursor / VS Code:        Ctrl+Shift+V  (paste-without-formatting)
   *   - Windows Terminal / WSL:  Ctrl+Shift+V
   *   - Some IRC/chat clients:   Shift+Insert
   *
   * Leave empty to use the default everywhere. Matches are
   * case-insensitive on `appName` and first-match-wins.
   */
  pasteOverrides: PasteOverride[];

  // Privacy
  /** If on, the raw PCM is retained alongside the transcript. Default OFF. */
  storeAudio: boolean;
  /** If on, skip Firestore sync for sessions (settings still sync). */
  privacyMode: boolean;

  // Sound
  /** Ping on record start / soft chime on paste. */
  soundEffects: boolean;

  // System
  /** Register as a Windows startup app via HKCU\Run. */
  startAtLogin: boolean;

  // Pill appearance (Session 49 — feature #20)
  /**
   * Pill opacity when in `sleep` state. Range 0.0–1.0.
   * Default 0.78 — the value the pill had hardcoded since the
   * pill was first drafted. The original Session 49 value of 0.18
   * was a typo on my part: I confused it with a comment in earlier
   * memory-bank notes that mentioned 0.18. The real previous
   * default was always 0.78. Set to 0.0 to make the sleep pill
   * fully invisible (some users want zero visual presence at
   * idle); set lower than 0.78 for quieter ambient presence.
   */
  pillSleepOpacity: number;
  /**
   * Pill opacity when in any non-sleep state (ready / active /
   * processing / success / error). Range 0.0–1.0. Default 1.0.
   * Lower this if the pill feels visually intrusive while
   * dictating (e.g. over fullscreen content).
   */
  pillActiveOpacity: number;
}

export const DEFAULT_SETTINGS: Settings = {
  hotkey: "Ctrl+Shift+Space",
  recordingMode: "push-to-talk",
  micDeviceId: null,
  silenceDetectionSeconds: 3,
  language: "auto",
  multiLanguageCodes: [],
  defaultModeId: "mode-auto",
  autoFormat: false,
  spokenPunctuation: false,
  spokenEmojis: false,
  profanityFilter: false,
  endpointing: "standard",
  restoreClipboard: false,
  pasteOverrides: [],
  storeAudio: false,
  privacyMode: false,
  soundEffects: true,
  // A background daemon should start with Windows by default. On first
  // install, lib.rs also calls autolaunch().enable() explicitly so the
  // registry entry is written even before the frontend mounts. Users
  // can still opt out in Settings → System → Start at login.
  startAtLogin: true,

  // Pill appearance — see Settings interface for rationale.
  pillSleepOpacity: 0.78,
  pillActiveOpacity: 1.0,
};

/** GCP credentials + project metadata. Configured via Settings → GCP Setup. */
export interface GCPSettings {
  /** Absolute path on disk. Stored at %APPDATA%\popo\gcp-sa.json; displayed here. */
  serviceAccountJsonPath: string | null;
  projectId: string;
  /** Timestamp (epoch ms) of the last Test Connection click. */
  lastConnectionTest: number | null;
  /** Result of that last test. null = never tested. */
  lastConnectionOk: boolean | null;
  /**
   * Google AI Studio API key (separate from the GCP service account).
   * When set AND `Settings.autoFormat` is on, transcripts are polished
   * through Gemini 2.5 Flash-Lite using the active mode's prompt.
   * Get one free at ai.dev. Stored locally on this machine only —
   * never synced to Firestore (each machine configures its own).
   *
   * `null` / empty disables Gemini polish even when autoFormat is on;
   * the pipeline gracefully falls back to Chirp's `custom_prompt`
   * biasing for partial formatting.
   */
  geminiApiKey: string | null;
}

export const DEFAULT_GCP_SETTINGS: GCPSettings = {
  serviceAccountJsonPath: null,
  projectId: "",
  lastConnectionTest: null,
  lastConnectionOk: null,
  geminiApiKey: null,
};

// ----- Modes & sessions ------------------------------------------------

export interface Mode {
  id: string;
  name: string;
  systemPrompt: string;
  language?: string;
  outputFormat: "paragraph" | "bullets" | "raw";
  isDefault: boolean;
  usageCount: number;
  createdAt: number;
  /**
   * List of app display names (as returned by `focus::app_icon::
   * get_app_name` — e.g. "VS Code", "Chrome", "Slack") in which
   * this mode should be auto-selected when `Settings.autoFormat`
   * is enabled.
   *
   * Resolution priority at press time:
   *   1. If any mode's `apps` contains the foreground app's
   *      friendly name (case-insensitive), that mode wins.
   *      First match by modes-array order is used when two modes
   *      both claim the same app.
   *   2. Otherwise the mode marked `isDefault === true` is used.
   *
   * Empty / undefined means "not app-scoped" — the mode is only
   * picked when it's the default.
   */
  apps?: string[];
  /**
   * Optional dedicated hotkey for this mode. When registered, pressing
   * this shortcut skips app-based resolution entirely and forces THIS
   * mode for the recording that follows. Release of the shortcut ends
   * the recording (push-to-talk semantics); toggle-mode semantics are
   * preserved from Settings.
   *
   * Format: same as `Settings.hotkey` — "Ctrl+Shift+C", "Alt+F1", etc.
   * Conflicts (two modes with the same hotkey, OR a mode hotkey equal
   * to the main hotkey) are rejected by Rust with a registration error
   * surfaced on save.
   */
  hotkey?: string;
  /**
   * Audio cue played by the pill at record-start + paste-success when
   * this mode is active and Settings → Sound is ON.
   *
   *   - `"default"` — the ascending ping/chime the app shipped with
   *                  (same as existing behavior pre-Session 33).
   *   - `"soft"`    — lower-frequency, longer-decay. Calmer.
   *   - `"chime"`   — two-note triad. Brighter.
   *   - `"bell"`    — higher-pitched single ping.
   *   - `"none"`    — silent. Useful for Code / Focus / Meeting modes.
   *
   * `undefined` inherits `"default"`. The pill's `usePillSound` hook
   * reads the preset from the `pill:sound` event payload and selects
   * the corresponding glide parameters.
   */
  soundPreset?: "default" | "soft" | "chime" | "bell" | "none";
}

/**
 * A single snippet expansion that fired for a specific session.
 * Recorded post-transcription, pre-paste: Rust scans the final
 * transcript, notes each matched trigger, and persists these
 * records alongside the session so the History UI can show
 * "this word was expanded from snippet X" in situ.
 *
 * `startChar` / `endChar` are character indices (NOT byte indices,
 * NOT UTF-16 code units) into the final `formattedTranscript` /
 * `rawTranscript` that gets pasted. Counted via Rust's
 * `char_indices()` so Unicode (Hindi, emoji) is safe.
 */
export interface SnippetExpansion {
  /** `Snippet.id` this expansion came from. */
  snippetId: string;
  /**
   * What the user actually said / was transcribed — e.g. if the
   * trigger is "addr" but Chirp produced "Addr", this holds "Addr".
   */
  trigger: string;
  /** The replacement value that ended up in the paste. */
  value: string;
  /** Character offset (inclusive) of `value` inside the final text. */
  startChar: number;
  /** Character offset (exclusive) of `value` inside the final text. */
  endChar: number;
}

export interface Session {
  id: string;
  createdAt: number;
  durationMs: number;
  wordCount: number;
  language: string;
  modeId?: string;
  rawTranscript: string;
  formattedTranscript?: string;
  audioStoragePath?: string;
  /** Firebase Storage download URL — cross-device audio playback. */
  audioDownloadUrl?: string;
  gcpCostEstimate?: number;
  /**
   * Human-readable name of the app the transcript was pasted into
   * (e.g. "Chrome", "VS Code", "Slack"). Resolved on the Rust side
   * from the foreground window's process image path. Used by the
   * history list as the primary chip + by the App filter dropdown.
   */
  appName?: string;
  /**
   * Base64-encoded PNG of the target app's icon. Rendered as a small
   * circle on each SessionRow for at-a-glance context. Typically ~2–5
   * KB; stored inline on the session doc. Missing when icon extraction
   * failed (very rare) — UI falls back to just the app name label.
   */
  appIcon?: string;
  /**
   * When snippet expansion fired during this dictation, each matched
   * expansion is recorded here (trigger word, replacement value,
   * and its character range in the final text). Used by History to
   * label + highlight the expanded segments so users can see what
   * their snippets produced without having to re-read the raw
   * transcript.
   *
   * Optional / may be empty — older sessions created before this
   * field shipped simply render without highlights.
   */
  expandedSnippets?: SnippetExpansion[];
}

// ----- Paste overrides ------------------------------------------------

/**
 * An entry in `Settings.pasteOverrides`. When the foreground app
 * at paste time matches `appName` (case-insensitive), Rust sends
 * `keystroke` instead of Ctrl+V.
 *
 * `keystroke` is a human-readable shortcut string. Accepted tokens:
 *   - Modifiers: Ctrl / Control / Shift / Alt / Win / Meta / Super
 *   - Main key: single letter A-Z, digit 0-9, F1-F24, plus named
 *     keys Space, Enter, Return, Tab, Escape, Backspace, Delete,
 *     Insert, Home, End, PageUp / PgUp, PageDown / PgDn, Up /
 *     UpArrow, Down, Left, Right
 *
 * Examples: "Ctrl+V" (default), "Ctrl+Shift+V",
 * "Shift+Insert", "Alt+Enter".
 */
export interface PasteOverride {
  /**
   * The app's friendly display name. Must exactly match what
   * `focus::app_icon::get_app_name` produces for the window —
   * case-insensitive. When a user picks from the running-apps
   * list this is set automatically; manual entries are typed.
   */
  appName: string;
  /** Keystroke to send. Parsed by Rust into an enigo sequence. */
  keystroke: string;
  /**
   * Optional base64-encoded PNG of the app's icon, captured at
   * pick-time. Persisted on the override entry so the Settings UI
   * can render the icon in the chip even when the app isn't
   * currently running (and therefore absent from the live
   * `cmd_list_running_apps` result).
   *
   * Rust ignores this field — it's pure display data. Manual-entry
   * overrides (typed app names) save without an icon; Settings
   * falls back to the generic app glyph in that case.
   */
  iconBase64?: string;
}

// ----- Running apps (Settings + Modes pickers) -------------------------

/**
 * A currently-running top-level app as reported by
 * `cmd_list_running_apps`. Used by `AppPicker` (Settings paste
 * overrides, Mode editor app bindings). Icon is a base64 PNG
 * when extraction succeeded, or undefined when it didn't
 * (rare — e.g. system processes we couldn't open).
 *
 * The shape is deduped in Rust by friendly `name` — one entry
 * per unique app, not per window. Chrome with 14 windows open
 * still produces a single "Chrome" entry.
 */
export interface RunningApp {
  /** Friendly name (e.g. "Chrome", "VS Code"). Same key used for matching. */
  name: string;
  /** Full .exe path. Kept for tooltips / debug display only. */
  exePath: string;
  /** Window title of the first visible window we saw for this app. */
  title?: string;
  /** Base64-encoded PNG of the app's icon. Displayed in AppPicker rows. */
  iconBase64?: string;
  /**
   * True when the app has at least one visible window right now.
   * Running apps come from `EnumWindows`; `isRunning = false` means
   * the entry came from the Start Menu scan (installed but not
   * currently open). The picker renders not-running rows with
   * slightly softer color so users can tell them apart.
   */
  isRunning: boolean;
}

// ----- Snippets (text expansion) --------------------------------------

/**
 * A user-defined text-expansion entry. When the user dictates the
 * `trigger` word (matched whole-word, case-insensitive, Unicode-aware),
 * the snippet engine substitutes its `value` before pasting.
 *
 * Example: trigger="addr" + value="221B Baker Street, London".
 * The user says "please mail this to my addr today" → pastes
 * "please mail this to my 221B Baker Street, London today".
 *
 * Expansion rules live in Rust (`hotkey::mod::expand_snippets`):
 *   • whole-word only (Unicode letter/number boundaries)
 *   • case-insensitive match, case-preserving replace
 *     (addr→Hello / Addr→Hello / ADDR→HELLO)
 *   • every occurrence is replaced, single pass (no infinite
 *     substitution loops if a value contains a trigger)
 */
export interface Snippet {
  id: string;
  /** Short keyword the user dictates to trigger expansion. */
  trigger: string;
  /** The text that gets pasted in place of the trigger. */
  value: string;
  /**
   * Optional friendly name for the Snippets list when the trigger
   * itself is cryptic (`hmaddr` → label "Home address"). Not used
   * for matching.
   */
  label?: string;
  createdAt: number;
  updatedAt: number;
  /** Incremented each time this snippet expands during a dictation. */
  usageCount: number;
}

// ----- Dictionary (speech adaptation) ---------------------------------

/**
 * A user-defined phrase hinted to Chirp 3's speech-adaptation layer.
 * Typical use: proper nouns ("Bengaluru", "Aarav"), technical terms
 * ("ReactJS", "Kubernetes"), brand names, or any word the model
 * mis-transcribes.
 *
 * Passed to Chirp 3 as `RecognitionConfig.adaptation.phrase_sets`
 * with a default boost of ~10 (Google recommends binary-searching
 * from there; values 0–20, higher = stronger bias).
 *
 * Up to 1000 entries per request. Matches are deterministic at the
 * acoustic-model layer — different mechanism from `custom_prompt`.
 */
export interface DictionaryEntry {
  id: string;
  /** The word or short phrase the model should recognize correctly. */
  phrase: string;
  /**
   * Optional per-entry boost override (0–20). Falls back to the
   * global default when undefined. Most users never touch this.
   */
  boost?: number;
  createdAt: number;
  /**
   * If true, the entry is pinned to the top of the dictionary list
   * regardless of `createdAt`. Useful for the user's most
   * critical phrases (their name, key product/brand names) so
   * they're always at the top of a long dictionary.
   *
   * Default false. Backward-compatible: existing entries with no
   * `pinned` field are treated as unpinned. Session 49 — feature #17.
   */
  pinned?: boolean;
}

// ----- Audio devices ---------------------------------------------------

/**
 * An input device as reported by Rust (cpal) via `cmd_list_mics`.
 *
 *  - `id`   : empty string ⇒ the synthetic "System default" row.
 *             Any other value is the cpal device name, used as both
 *             display label and the identifier round-tripped back
 *             via `cmd_set_mic`.
 *  - `name` : human-readable label (currently identical to id for
 *             real devices; "System default microphone" for the
 *             synthetic row).
 *  - `isDefault` : true if cpal currently reports this as the host's
 *             default input device.
 */
export interface MicDevice {
  id: string;
  name: string;
  isDefault: boolean;
}
