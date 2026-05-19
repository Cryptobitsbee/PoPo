// hotkey — global shortcut handler + dictation state machine.
//
// Per brief §5 Core Dictation Flow:
//
//   User HOLDS Ctrl+Shift+Space
//     1. GetForegroundWindow → store target_hwnd
//     2. Read clipboard → store previous_clipboard
//     3. emit pill:state:ready → pill morphs sleep → ready
//     4. Start cpal audio stream
//     5. Every 40ms emit pill:waveform with 16 bars
//
//   User RELEASES
//     6. Drop cpal stream (audio stops)
//     7. emit pill:state:processing
//     8. GCP transcribe (Phase 2 [6] = 800ms fake stub)
//     9. Write transcript to clipboard (arboard)
//    10. [Phase 2 [7] will restore foreground + Ctrl+V here]
//    11. emit pill:state:success
//    12. After ~400ms emit pill:state:sleep
//
// Phase 2 [6] scope: everything above EXCEPT step 10 (the actual paste).
// Transcript sits on the clipboard; user can Ctrl+V themselves. The full
// paste orchestrator lands in Phase 2 [7].

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutEvent, ShortcutState};

use crate::audio::capture::SafeStream;
use crate::audio::{self, processor};
use crate::focus;
use crate::gcp::{self, auth::Authenticator, GcpConfig};

// ── Hotkey definition ────────────────────────────────────────

/// The default push-to-talk hotkey. Brief §5: Ctrl+Shift+Space.
/// Used as the seed for PopoState.current_hotkey at boot; the frontend
/// may override it later via `cmd_set_hotkey` after reading the user's
/// saved preference.
///
/// `Shortcut::new` isn't a const fn, so this is a function rather than
/// a const. Call sites: `lib.rs` setup hook (once, at boot); helper
/// for initializing PopoState::default().
pub fn default_hotkey() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space)
}

/// Canonical string representation of the default hotkey. Kept in
/// lockstep with `default_hotkey()` above.
pub const DEFAULT_HOTKEY_STR: &str = "Ctrl+Shift+Space";

/// True if the given `Shortcut` matches whatever is currently
/// configured as the push-to-talk hotkey in PopoState.
fn is_popo_hotkey(s: &Shortcut, state: &PopoState) -> bool {
    match state.current_hotkey.lock() {
        Ok(current) => *current == *s,
        Err(_) => false,
    }
}

/// Classifier for every hotkey event the global-shortcut plugin
/// reports. Exists so `on_event` can dispatch to the right handler
/// based on WHICH hotkey fired — the primary Ctrl+Shift+Space, one of
/// the per-mode dedicated hotkeys, the ESC-cancel shortcut (only
/// registered during an active recording), or something unrelated.
#[derive(Debug, Clone)]
pub enum HotkeyKind {
    /// Not one of popo's hotkeys — pass through.
    None,
    /// The main push-to-talk shortcut.
    Primary,
    /// A per-mode shortcut. The recording should force the named
    /// mode's prompt regardless of which app is in focus.
    Mode(String),
    /// ESC while recording — cancel + discard + back to sleep.
    Cancel,
    /// Ctrl+Shift+M — open the Quick Mode Switcher window. Doesn't
    /// start a recording; just shows the switcher UI.
    OpenSwitcher,
}

/// Escape key, used for cancel-during-recording. Only registered on
/// the global-shortcut manager WHILE a recording is active; cleaned
/// up on release / cancel. Using a function (not a const) because
/// `Shortcut::new` isn't const.
fn cancel_hotkey() -> Shortcut {
    Shortcut::new(None, Code::Escape)
}

/// Check whether `s` is the cancel shortcut.
fn is_cancel_hotkey(s: &Shortcut) -> bool {
    *s == cancel_hotkey()
}

/// Quick-switcher open shortcut — `Ctrl+Shift+M`. Fixed at boot; a
/// future settings field could make this configurable. Registered
/// persistently in `lib.rs` setup hook (not transient like ESC).
pub fn switcher_hotkey() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyM)
}

/// Check whether `s` is the quick-switcher shortcut.
fn is_switcher_hotkey(s: &Shortcut) -> bool {
    *s == switcher_hotkey()
}

/// Look up `s` in the per-mode hotkey table. Returns the mode id
/// that the shortcut belongs to, or `None` if no mode claims it.
fn lookup_mode_hotkey(s: &Shortcut, state: &PopoState) -> Option<String> {
    let guard = state.mode_hotkeys.lock().ok()?;
    for (shortcut, mode_id) in guard.iter() {
        if *shortcut == *s {
            return Some(mode_id.clone());
        }
    }
    None
}

/// Classify an incoming shortcut event.
fn classify_hotkey(s: &Shortcut, state: &PopoState) -> HotkeyKind {
    if is_popo_hotkey(s, state) {
        return HotkeyKind::Primary;
    }
    if is_switcher_hotkey(s) {
        return HotkeyKind::OpenSwitcher;
    }
    if is_cancel_hotkey(s) {
        // ESC is only meaningful WHILE recording — suppress it at all
        // other times so we don't swallow the user's ESC keystroke.
        // The global-shortcut manager only has ESC registered during
        // active recording (see `register_cancel_hotkey`); if we got
        // an event, a session is (probably) active.
        let has_session = state.recording.lock().map(|g| g.is_some()).unwrap_or(false);
        return if has_session {
            HotkeyKind::Cancel
        } else {
            HotkeyKind::None
        };
    }
    if let Some(mode_id) = lookup_mode_hotkey(s, state) {
        return HotkeyKind::Mode(mode_id);
    }
    HotkeyKind::None
}

// ── Shared state held in Tauri managed state ────────────────────

/// popo's global runtime state. Held in `tauri::State<PopoState>` so
/// commands + hotkey handlers can access it.
pub struct PopoState {
    /// Active recording, if any. `None` means idle.
    pub recording: Mutex<Option<RecordingSession>>,
    /// Cached GCP configuration + authenticator. `None` until the user
    /// runs the setup wizard (or Rust restores it on boot from disk).
    /// When `None`, on_release falls back to gcp::fake_transcribe so
    /// the app still demos without credentials.
    pub gcp: Mutex<Option<(GcpConfig, Authenticator)>>,
    /// The currently-registered push-to-talk hotkey. Mutated by
    /// `cmd_set_hotkey` after it successfully swaps registrations.
    /// Initial value is `default_hotkey()`.
    pub current_hotkey: Mutex<Shortcut>,
    /// Canonical string representation of `current_hotkey`, kept in
    /// sync by `cmd_set_hotkey`. Exposed by `cmd_get_current_hotkey`
    /// so the frontend can sanity-check what's actually bound.
    pub current_hotkey_str: Mutex<String>,
    /// User's chosen input device name, or `None` for system default.
    /// Set by `cmd_set_mic`. Read by `on_press` when opening the cpal
    /// stream for the next recording.
    pub selected_mic_id: Mutex<Option<String>>,
    /// Recording mode: `"push-to-talk"` (default) or `"toggle"`.
    /// Push-to-talk starts on press and ends on release.
    /// Toggle starts on first press and ends on the next press;
    /// the hotkey release is ignored.
    pub recording_mode: Mutex<RecordingMode>,
    /// If true (default), paste.rs restores the user's previous
    /// clipboard after pasting the transcript. If false, the
    /// transcript stays on the clipboard.
    pub restore_clipboard: Mutex<bool>,
    /// Silence-auto-stop threshold in seconds. Only honored in Toggle
    /// mode. 0 disables auto-stop.
    pub silence_detection_seconds: Mutex<u32>,
    /// If true, Rust writes raw PCM to disk after each session.
    /// See audio::storage for the write path.
    pub store_audio: Mutex<bool>,
    /// If true, Rust emits `pill:sound:*` events the pill window plays
    /// via Web Audio API tones. Mutes everything when false.
    pub sound_effects: Mutex<bool>,

    // ── Phase C: Chirp 3 feature flags ──────────────────────────
    /// If true, pass `enable_spoken_punctuation=true` to Chirp 3 so
    /// spoken "comma" / "period" / "question mark" become the
    /// matching symbols in the transcript.
    pub spoken_punctuation: Mutex<bool>,
    /// If true, pass `enable_spoken_emojis=true` to Chirp 3.
    pub spoken_emojis: Mutex<bool>,
    /// If true, pass `profanity_filter=true` to Chirp 3 (masks
    /// profanity with asterisks).
    pub profanity_filter: Mutex<bool>,
    /// If non-empty, pass this array as `language_codes` to Chirp 3 so
    /// it code-switches between the given BCP-47 locales mid-sentence.
    /// Empty + `config.language_code == "auto"` means auto-detect
    /// across all Chirp-supported languages.
    pub multi_language_codes: Mutex<Vec<String>>,

    // ── Phase D: Gemini Flash post-processing ────────────────────
    /// If true, run transcripts through Gemini Flash using
    /// `auto_format_prompt` before pasting. Guarded by the frontend's
    /// `settings.autoFormat` toggle + a resolved default mode prompt.
    pub auto_format_enabled: Mutex<bool>,
    /// The system prompt to feed Gemini. Resolved from
    /// `modes[defaultModeId].systemPrompt` by the frontend.
    pub auto_format_prompt: Mutex<String>,

    // ── Snippets + Dictionary ──────────────────────────────
    /// User-defined text expansion shortcuts. Pushed from the
    /// frontend via `cmd_set_snippets` whenever the user adds /
    /// edits / deletes a snippet. Consumed by `on_release` AFTER
    /// the transcript arrives and BEFORE the paste, to substitute
    /// trigger words with their stored values.
    pub snippets: Mutex<Vec<SnippetEntry>>,

    /// Phrase hints biased into Chirp 3 speech adaptation. Pushed
    /// from the frontend via `cmd_set_dictionary`. Consumed by
    /// `on_press` when building the StreamingRecognize request.
    pub dictionary: Mutex<Vec<String>>,

    // ── Per-mode app bindings + per-app paste overrides ─────────
    /// All modes + their per-app bindings. Pushed from the frontend
    /// via `cmd_set_mode_bindings` whenever modesStore changes. Used
    /// by `on_press` to pick the active Chirp `custom_prompt` based
    /// on the foreground app:
    ///   1. First binding whose `apps` list contains the foreground
    ///      app's friendly name (case-insensitive) wins.
    ///   2. Fall back to whichever binding has `is_default = true`.
    ///   3. Fall back to `auto_format_prompt` (backward-compat path).
    ///
    /// Empty list = frontend hasn't pushed yet → `auto_format_prompt`
    /// is used exactly as before Session 32.
    pub mode_bindings: Mutex<Vec<ModeBinding>>,

    /// Per-app paste keystroke overrides. Pushed from the frontend
    /// via `cmd_set_paste_overrides` whenever Settings → Paste →
    /// Per-app shortcuts changes. Consumed by `focus::paste::execute`
    /// which matches the target app's friendly name against this
    /// list (case-insensitive, first-match-wins) and sends the
    /// configured keystroke instead of the default Ctrl+V.
    pub paste_overrides: Mutex<Vec<PasteOverride>>,

    // ── Chirp 3 endpointing sensitivity ─────────────────────────
    /// Controls how quickly Chirp 3 finalises a transcript after
    /// the speaker pauses. Mirrors `Settings.endpointing` on the
    /// frontend. Read at stream-open time in `gcp::streaming::start`
    /// via `resolve_endpointing_sensitivity`.
    ///
    /// Stored as one of: "low" / "standard" / "high". Default
    /// `"standard"` matches Google's recommended setting.
    pub endpointing_sensitivity: Mutex<String>,

    // ── Per-mode dedicated hotkeys ────────────────────────────
    /// Dedicated shortcuts registered for individual modes. When a
    /// user configures a mode with a `hotkey` (e.g. Code →
    /// Ctrl+Shift+C), pressing it opens a recording that forces
    /// THIS mode's prompt regardless of what app is in focus.
    ///
    /// Maintained via `cmd_set_mode_bindings`: on every bindings
    /// refresh, Rust unregisters old per-mode shortcuts and
    /// registers the new ones. Entries are `(shortcut, mode_id)`;
    /// the ID is looked up against `mode_bindings` at press time to
    /// resolve the prompt + sound preset.
    pub mode_hotkeys: Mutex<Vec<(Shortcut, String)>>,

    // ── Quick Mode Switcher state ──────────────────────────
    /// Mode id the user picked in the Quick Switcher, waiting to be
    /// consumed by the very next recording. Set by
    /// `cmd_set_pending_forced_mode`; consumed + cleared in `on_press`
    /// as if a per-mode hotkey had been used.
    ///
    /// Intentionally no auto-expiry — if the user picks a mode but
    /// never dictates, the choice just waits. Re-opening the switcher
    /// and picking a different mode overwrites it. ESC in the switcher
    /// clears it via `cmd_clear_pending_forced_mode`.
    pub pending_forced_mode_id: Mutex<Option<String>>,
    /// The HWND that was foreground at the moment the Quick Switcher
    /// opened. Restored when the switcher closes so focus returns to
    /// wherever the user was typing before. Mirrors the
    /// foreground-save pattern of the dictation flow itself.
    pub switcher_caller_hwnd: Mutex<Option<isize>>,

    // ── Gemini polish (Session 34, simplified Session 35) ──────
    // Session 35 merged smart_cleanup into auto_format_enabled —
    // one master toggle for AI formatting.
    /// Google AI Studio API key for the Gemini Flash-Lite call.
    /// `None` when the user hasn't configured it. With
    /// `auto_format_enabled=true` AND a non-empty key, polish runs;
    /// otherwise we skip polish (Chirp output passes through, with
    /// its own custom_prompt biasing if auto_format is on).
    pub gemini_api_key: Mutex<Option<String>>,
}

/// Rust-side representation of a Snippet. Mirrors
/// `packages/shared-types/src/index.ts::Snippet` minus the fields
/// the matcher doesn't need (createdAt / updatedAt / usageCount /
/// label). Serde renames are camelCase so JSON round-trips cleanly.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnippetEntry {
    #[serde(default)]
    pub id: String,
    pub trigger: String,
    pub value: String,
}

/// Rust-side representation of a Mode + its app binding list. Pushed
/// as a whole-list replace via `cmd_set_mode_bindings`. Only the
/// fields Rust needs at press time are included — `usageCount`,
/// `createdAt`, `language`, `outputFormat`, etc. are frontend-only.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModeBinding {
    #[serde(default)]
    pub id: String,
    /// Display name — only used in tracing output so the log tells
    /// us WHICH mode matched a given app.
    #[serde(default)]
    pub name: String,
    pub system_prompt: String,
    /// App friendly names (e.g. "VS Code", "Cursor"). First-match-wins
    /// with case-insensitive compare against the foreground app's
    /// `pretty_app_name` at press time.
    #[serde(default)]
    pub apps: Vec<String>,
    /// True when this is the user's default mode (the fallback when
    /// no app-specific binding matches).
    #[serde(default)]
    pub is_default: bool,
    /// Optional dedicated hotkey string (e.g. "Ctrl+Shift+C"). Empty
    /// / missing when the mode has no dedicated shortcut. Parsed by
    /// `commands::settings::parse_shortcut`; invalid strings are
    /// logged + dropped (the mode still works via app/default path).
    #[serde(default)]
    pub hotkey: String,
    /// Audio preset name for the pill's start/paste tones when this
    /// mode is active ("default" / "soft" / "chime" / "bell" /
    /// "none"). Empty / missing => "default". Shipped inside the
    /// `pill:sound` event payload; the frontend's usePillSound
    /// picks the matching glide.
    #[serde(default)]
    pub sound_preset: String,
}

/// Rust-side representation of a per-app paste override. Pushed via
/// `cmd_set_paste_overrides` whenever Settings changes. Consumed by
/// `focus::paste::execute`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PasteOverride {
    /// Friendly name of the app this override applies to
    /// (e.g. "VS Code"). Matched case-insensitively against the
    /// foreground app's `pretty_app_name`.
    pub app_name: String,
    /// Keystroke to send (e.g. "Ctrl+Shift+V"). Parsed lazily in
    /// `focus::paste` via `parse_paste_keystroke`.
    pub keystroke: String,
}

/// Serializable recording mode matching the frontend Settings type.
/// Parsed from strings by `RecordingMode::from_str`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecordingMode {
    PushToTalk,
    Toggle,
}

impl RecordingMode {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "push-to-talk" | "push_to_talk" | "pushToTalk" => Some(Self::PushToTalk),
            "toggle" => Some(Self::Toggle),
            _ => None,
        }
    }
}

impl Default for PopoState {
    fn default() -> Self {
        Self {
            recording: Mutex::new(None),
            gcp: Mutex::new(None),
            current_hotkey: Mutex::new(default_hotkey()),
            current_hotkey_str: Mutex::new(DEFAULT_HOTKEY_STR.to_string()),
            selected_mic_id: Mutex::new(None),
            recording_mode: Mutex::new(RecordingMode::PushToTalk),
            restore_clipboard: Mutex::new(false),
            silence_detection_seconds: Mutex::new(3),
            store_audio: Mutex::new(false),
            sound_effects: Mutex::new(true),
            // Phase C defaults.
            spoken_punctuation: Mutex::new(false),
            spoken_emojis: Mutex::new(false),
            profanity_filter: Mutex::new(false),
            multi_language_codes: Mutex::new(Vec::new()),
            // Phase D defaults. auto_format_enabled stays false until
            // the frontend pushes Settings → Auto-format toggle.
            auto_format_enabled: Mutex::new(false),
            auto_format_prompt: Mutex::new(String::new()),
            snippets: Mutex::new(Vec::new()),
            dictionary: Mutex::new(Vec::new()),
            mode_bindings: Mutex::new(Vec::new()),
            paste_overrides: Mutex::new(Vec::new()),
            endpointing_sensitivity: Mutex::new("standard".to_string()),
            mode_hotkeys: Mutex::new(Vec::new()),
            pending_forced_mode_id: Mutex::new(None),
            switcher_caller_hwnd: Mutex::new(None),
            gemini_api_key: Mutex::new(None),
        }
    }
}

/// One in-flight dictation session. Created on hotkey-down, consumed
/// on hotkey-up.
pub struct RecordingSession {
    /// Keeps the cpal stream alive. Dropping stops audio capture.
    #[allow(dead_code)]
    stream: SafeStream,
    /// Shared ring buffer the audio callback writes into.
    samples: Arc<Mutex<VecDeque<f32>>>,
    sample_rate: u32,
    /// Live diagnostic counters from the audio capture stream. Read
    /// in `on_release` when a recording is rejected for low amplitude
    /// to build a specific error message that names the device and
    /// shows the actual peak level cpal saw. Session 43.
    capture_diag: Arc<crate::audio::capture::CaptureDiagnostics>,
    /// Human-readable device name as cpal reported it. Used in the
    /// pill error tooltip when no audio reaches the buffer.
    capture_device_name: String,
    /// Unix timestamp (ms) when this recording session started.
    /// Used to compute durationMs in the session:created event.
    started_at_ms: u64,
    /// Flipped to `false` on release to stop the waveform-emitter task.
    running: Arc<AtomicBool>,
    /// HWND captured at hotkey-down.
    foreground_hwnd: Option<isize>,
    /// Clipboard text captured at hotkey-down.
    prev_clipboard: Option<String>,
    /// Display-friendly name of the foreground app (e.g. "Chrome",
    /// "VS Code"). Resolved from the process's .exe path at press time.
    /// None when the lookup failed — rare, falls back to "Unknown".
    app_name: Option<String>,
    /// Base64-encoded PNG of the foreground app's icon. Emitted to
    /// the pill webview on press AND stored here so the `session:created`
    /// event at release time can ship it to History — useful for
    /// filtering / grouping sessions by app, and for an at-a-glance
    /// icon bubble on each SessionRow.
    app_icon_b64: Option<String>,
    /// Handle to the active StreamingRecognize gRPC session. `Some` when
    /// GCP is configured and the stream opened successfully at press time.
    /// `None` means we fall back to batch `gcp::transcribe` on release.
    streaming_handle: Option<gcp::streaming::LiveStreamHandle>,
    /// JoinHandle for the chunk-forwarder task that sends audio to GCP
    /// every ~100ms during recording. Aborted/joined on release.
    chunk_forwarder: Option<tokio::task::JoinHandle<()>>,
    /// How many samples have been forwarded to streaming so far.
    /// Used by the chunk-forwarder to only send NEW samples each tick.
    sent_count: Arc<std::sync::atomic::AtomicUsize>,
    /// When this recording was opened via a per-mode hotkey, the id
    /// of that mode. `resolve_effective_prompt` uses it to skip the
    /// normal app/default lookup chain. `None` for the primary hotkey.
    forced_mode_id: Option<String>,
    /// The mode id that actually won resolution at press time. Stored
    /// so the paste-success chime on release can look up the matched
    /// mode's `sound_preset` without re-running the resolver.
    matched_mode_id: Option<String>,
}

// ── Event payloads ──────────────────────────────────────────────────

/// Serializable payload emitted as the `session:created` Tauri event
/// after a successful dictation + paste. The frontend (main window)
/// receives this and writes to Firestore.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SessionPayload {
    id: String,
    created_at: u64,  // unix ms
    duration_ms: u64, // recording duration
    word_count: usize,
    language: String,
    raw_transcript: String,
    gcp_cost_estimate: f64, // rough USD estimate based on duration
    /// Absolute path of the stored WAV (Settings → Privacy → Store audio).
    /// `None` when the feature is disabled. Serialized as camelCase on
    /// the wire via the struct-level `rename_all` attribute so the JS
    /// side sees `audioStoragePath`.
    #[serde(skip_serializing_if = "Option::is_none")]
    audio_storage_path: Option<String>,
    /// Display-friendly name of the app that received the paste.
    /// History uses this for the primary chip label (replaces the
    /// old locale-code chip) and the App filter dropdown.
    #[serde(skip_serializing_if = "Option::is_none")]
    app_name: Option<String>,
    /// Base64-encoded PNG of the target app's icon. The history row
    /// renders it as a small circle; the App filter dropdown dedupes
    /// by name and reuses whichever icon we last saw for that name.
    #[serde(skip_serializing_if = "Option::is_none")]
    app_icon: Option<String>,
    /// One entry per snippet expansion that fired during this session.
    /// Used by History's SessionRow to label + highlight expanded
    /// text in place. Omitted when the list is empty so older
    /// sessions without expansions stay visually unchanged.
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    expanded_snippets: Vec<ExpansionInstance>,
}

/// One snippet expansion recorded during a session — shipped to the
/// frontend as part of the `session:created` payload. Mirrors
/// `packages/shared-types/src/index.ts::SnippetExpansion`.
///
/// `start_char` + `end_char` are CHARACTER indices into the final
/// transcript (the string that was actually pasted). Frontend uses
/// them to mark up the expanded segments in the History row.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExpansionInstance {
    pub snippet_id: String,
    pub trigger: String,
    pub value: String,
    pub start_char: usize,
    pub end_char: usize,
}

/// Matches `PillWaveformPayload` in @popo/shared-types.
#[derive(Serialize, Clone)]
struct WaveformPayload {
    bars: [f32; processor::BARS],
}

// ── Public entry point ──────────────────────────────────────────────

/// Handler wired into `tauri_plugin_global_shortcut::Builder::with_handler`.
/// Called by the plugin on every hotkey event (press + release).
///
/// Offloads real work onto tauri's async runtime so the handler returns
/// immediately — any hiccup (slow clipboard, slow device) won't block
/// the OS's hotkey dispatcher.
pub fn on_event(app: &AppHandle, shortcut: &Shortcut, event: ShortcutEvent) {
    let state = app.state::<PopoState>();
    let kind = classify_hotkey(shortcut, state.inner());
    if matches!(kind, HotkeyKind::None) {
        return;
    }
    let app = app.clone();
    let shortcut_state = event.state();
    tauri::async_runtime::spawn(async move {
        // Cancel is special: ESC press aborts the current recording
        // regardless of push-to-talk / toggle mode. Release of ESC
        // is ignored.
        if matches!(kind, HotkeyKind::Cancel) {
            if matches!(shortcut_state, ShortcutState::Pressed) {
                if let Err(e) = on_cancel(&app).await {
                    tracing::error!("on_cancel failed: {e:?}");
                }
            }
            return;
        }

        // Quick Mode Switcher: Ctrl+Shift+M. Shows the switcher window;
        // doesn't start a recording. Release is ignored.
        if matches!(kind, HotkeyKind::OpenSwitcher) {
            if matches!(shortcut_state, ShortcutState::Pressed) {
                if let Err(e) = crate::commands::switcher::show_mode_switcher(&app).await {
                    tracing::error!("show_mode_switcher failed: {e}");
                }
            }
            return;
        }

        // Resolve whether this press forces a specific mode. Primary
        // hotkey => None (normal resolution). Mode hotkey => Some(id).
        let forced_mode_id: Option<String> = match &kind {
            HotkeyKind::Mode(id) => Some(id.clone()),
            _ => None,
        };

        // Read the current recording mode. Toggle mode reinterprets the
        // Pressed event as start-or-stop; Released is ignored.
        let mode = app
            .state::<PopoState>()
            .inner()
            .recording_mode
            .lock()
            .map(|g| *g)
            .unwrap_or(RecordingMode::PushToTalk);

        match (mode, shortcut_state) {
            // Push-to-talk: press starts, release finishes.
            (RecordingMode::PushToTalk, ShortcutState::Pressed) => {
                if let Err(e) = on_press(&app, forced_mode_id).await {
                    tracing::error!("hotkey press handler failed: {e:?}");
                    let _ = app.emit(
                        "pill:state:error",
                        ErrorPayload::error("press_failed", format!("{e}")),
                    );
                }
            }
            (RecordingMode::PushToTalk, ShortcutState::Released) => {
                if let Err(e) = on_release(&app).await {
                    tracing::error!("hotkey release handler failed: {e:?}");
                    let _ = app.emit(
                        "pill:state:error",
                        ErrorPayload::error("release_failed", format!("{e}")),
                    );
                }
            }

            // Toggle mode: press flips state; release is ignored.
            (RecordingMode::Toggle, ShortcutState::Pressed) => {
                let is_recording = app
                    .state::<PopoState>()
                    .inner()
                    .recording
                    .lock()
                    .map(|g| g.is_some())
                    .unwrap_or(false);

                if is_recording {
                    if let Err(e) = on_release(&app).await {
                        tracing::error!("toggle stop handler failed: {e:?}");
                        let _ = app.emit(
                            "pill:state:error",
                            ErrorPayload::error("release_failed", format!("{e}")),
                        );
                    }
                } else if let Err(e) = on_press(&app, forced_mode_id).await {
                    tracing::error!("toggle start handler failed: {e:?}");
                    let _ = app.emit(
                        "pill:state:error",
                        ErrorPayload::error("press_failed", format!("{e}")),
                    );
                }
            }
            (RecordingMode::Toggle, ShortcutState::Released) => {
                // Intentionally ignored — in toggle mode, only presses
                // change the dictation state.
            }
        }
    });
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ErrorPayload {
    code: String,
    message: String,
    /// Matches `PillErrorPayload.severity` in shared-types. `None` (the
    /// default when we omit the field) deserializes as `undefined` on
    /// the React side which the pillStore treats as the red-border
    /// error variant. Set to `Some("info")` for soft hints like the
    /// GCP-not-configured nudge — those render with a neutral border
    /// and leave the pill's visible state alone.
    #[serde(skip_serializing_if = "Option::is_none")]
    severity: Option<String>,
    /// When true the frontend keeps the tooltip visible until the user
    /// clicks it or Rust emits `pill:state:error:clear`. Used for
    /// blocking status notices (GCP not configured) that should stay
    /// on screen until the underlying condition is resolved.
    #[serde(skip_serializing_if = "Option::is_none")]
    persistent: Option<bool>,
}

impl ErrorPayload {
    /// Red-border, Windows-toast-firing, pill-flips-to-error variant.
    /// Use for any real failure in the dictation pipeline.
    fn error(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            severity: None,
            persistent: None,
        }
    }

    /// Neutral-border, toast-suppressed, state-preserving variant.
    /// Use for soft hints that accompany a normal flow — e.g. the
    /// "finish GCP setup" nudge after a fake-transcribe paste. Auto-
    /// dismisses after ~10 s.
    fn info(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            severity: Some("info".into()),
            persistent: None,
        }
    }
}

/// Current wall-clock time as Unix milliseconds. Used to timestamp
/// recording start + end for the session:created event.
fn unix_now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Walk an anyhow error's `source` chain and join every message with
/// ": ". This is crucial for pipeline errors where our top-level
/// `.context("Speech-to-Text v2 Recognize call failed")` hides the
/// actual Google gRPC Status message underneath — the user needs to
/// see BOTH layers to understand what's wrong.
fn format_error_chain(err: &anyhow::Error) -> String {
    let mut out = format!("{err}");
    let mut current = err.source();
    while let Some(cause) = current {
        out.push_str(": ");
        out.push_str(&cause.to_string());
        current = cause.source();
    }
    out
}

// ── Press ────────────────────────────────────────────────────────────

/// Handle a hotkey-press event. Split into two phases:
///
///   PHASE 1 (synchronous, <30 ms): open mic, claim the `recording`
///   slot in PopoState, spawn the waveform emitter. Critically, this
///   completes BEFORE any async await, so by the time we return from
///   this function the mutex says `recording.is_some()`. This is
///   what fixes bugs 1 (toggle race) + 3 (PTT stray release) from
///   activeContext.md — prior code set `*recording = Some(session)`
///   only AFTER a 200-500 ms `gcp::streaming::start().await`, which
///   left a window where toggle-mode re-presses saw `is_some()==false`
///   and called on_press AGAIN, and PTT fast releases saw
///   `recording==None` and bailed with "stray release".
///
///   PHASE 2 (async, background): open the StreamingRecognize gRPC
///   stream. When it opens, patch the streaming_handle + chunk
///   forwarder into the already-active session. If the session was
///   consumed by on_release before streaming opened, the handle
///   drops (half-closes the stream). Identity is verified with
///   `Arc::ptr_eq(&session.running, &our_running)` so a
///   press→release→press cycle can't accidentally get its streaming
///   handle patched into the NEXT session.
async fn on_press(app: &AppHandle, forced_mode_id: Option<String>) -> anyhow::Result<()> {
    let state = app.state::<PopoState>();

    // If the user picked a mode in the Quick Switcher and HASN'T yet
    // pressed a mode hotkey to override it, consume that pending pick
    // now. The explicit per-mode hotkey (if any) still takes priority.
    let forced_mode_id: Option<String> = forced_mode_id.or_else(|| {
        state
            .inner()
            .pending_forced_mode_id
            .lock()
            .ok()
            .and_then(|mut g| g.take())
    });
    if let Some(ref id) = forced_mode_id {
        tracing::info!("on_press: using forced mode {id:?} (from hotkey or switcher)");
    }

    // Debounce check (advisory — the real guard is the claim below).
    {
        let recording = state
            .inner()
            .recording
            .lock()
            .expect("PopoState mutex poisoned");
        if recording.is_some() {
            tracing::warn!("hotkey press ignored — already recording");
            return Ok(());
        }
    }

    let press_start = std::time::Instant::now();

    // 1. Capture foreground + clipboard BEFORE touching the pill.
    //    The pill is WS_EX_NOACTIVATE so it won't steal focus, but
    //    the user's cursor context is still the anchor of truth.
    let foreground_hwnd = focus::get_foreground_hwnd();
    let prev_clipboard = focus::get_clipboard_text();

    // 1b. Extract and emit the foreground app's icon so the pill can
    //     show WHICH app will receive the transcription. Also capture
    //     a human-readable app name so the session log (history) can
    //     show an icon + label on every row.
    #[cfg(target_os = "windows")]
    let mut app_icon_b64: Option<String> = None;
    #[cfg(target_os = "windows")]
    let mut app_name: Option<String> = None;
    #[cfg(target_os = "windows")]
    if let Some(hwnd) = foreground_hwnd {
        let icon = focus::app_icon::get_app_icon_base64(hwnd);
        if !icon.is_empty() {
            tracing::info!("app icon extracted: {} bytes base64", icon.len());
            let _ = app.emit("pill:app-icon", icon.clone());
            app_icon_b64 = Some(icon);
        } else {
            tracing::warn!("app icon: extraction returned empty for hwnd {hwnd}");
        }
        app_name = focus::app_icon::get_app_name(hwnd);
    }

    // Non-Windows stubs — we don't build this crate for other OSes
    // in production, but keep the bindings so the Rust compile works
    // in CI environments that aren't Windows.
    #[cfg(not(target_os = "windows"))]
    let app_icon_b64: Option<String> = None;
    #[cfg(not(target_os = "windows"))]
    let app_name: Option<String> = None;

    // 2. Start the audio pipeline (honors the user's selected mic if any).
    let selected_mic = state
        .inner()
        .selected_mic_id
        .lock()
        .ok()
        .and_then(|g| g.clone());
    let capture = audio::capture::start(selected_mic.as_deref())?;
    let sample_rate = capture.sample_rate;
    let samples = capture.samples.clone();
    // Capture diagnostics: shared with the audio callback so we can
    // build informative error messages downstream ("max signal: 0.001
    // from Microphone Array") without round-tripping through the
    // ring buffer. Session 43.
    let capture_diag = capture.diag.clone();
    let capture_device_name = capture.device_name.clone();

    // 3. Spin up a 25 Hz waveform-emitter task. Runs until `running` flips.
    let running = Arc::new(AtomicBool::new(true));
    spawn_waveform_task(app.clone(), running.clone(), samples.clone(), sample_rate);

    // 4. Tell the pill we're ready.
    let _ = app.emit("pill:state:ready", ());

    // Sound: soft ping on record-start when soundEffects is on.
    //
    // When a per-mode hotkey was used, we already know the mode id.
    // When the primary hotkey was used, we have to peek at what
    // resolve_effective_prompt WOULD pick so the start ping matches
    // the paste chime. This peek is O(bindings) and lock-brief.
    let sound_on = state
        .inner()
        .sound_effects
        .lock()
        .map(|g| *g)
        .unwrap_or(true);
    // Peek resolution to find the mode that'll be used (either forced
    // or best app match / default). The final value is captured later
    // when we store the session; this pass is for the immediate ping.
    let press_mode_for_ping: Option<String> = {
        if let Some(id) = forced_mode_id.as_deref() {
            Some(id.to_string())
        } else {
            let (_prompt, matched) =
                resolve_effective_prompt(state.inner(), app_name.as_deref(), None);
            matched.map(|(id, _)| id)
        }
    };
    if sound_on {
        let preset = resolve_sound_preset(state.inner(), press_mode_for_ping.as_deref());
        // Payload: { kind: "start", preset: "default"|"soft"|... }.
        let _ = app.emit(
            "pill:sound",
            serde_json::json!({ "kind": "start", "preset": preset }),
        );
    }

    let sent_count = Arc::new(std::sync::atomic::AtomicUsize::new(0));

    // Keep a local copy of app_name for the GCP block below — the
    // original value gets moved into `RecordingSession` when we claim
    // the recording slot. Without this, the per-app mode resolution
    // below can't read the foreground app's name.
    let app_name_for_gcp = app_name.clone();

    // 5. CLAIM THE SESSION SLOT IMMEDIATELY — this is the critical
    //    line for bug fixes 1 and 3. No await has happened yet; from
    //    here on, `recording.is_some()` observably == true.
    {
        let mut recording = state
            .inner()
            .recording
            .lock()
            .expect("PopoState mutex poisoned");
        if recording.is_some() {
            // Another on_press won the race in the microsecond since
            // our debounce check. Abort + clean up.
            running.store(false, Ordering::Relaxed);
            tracing::warn!("on_press lost claim race — aborting new session");
            return Ok(());
        }
        *recording = Some(RecordingSession {
            stream: capture.stream,
            samples: samples.clone(),
            sample_rate,
            capture_diag,
            capture_device_name,
            started_at_ms: unix_now_ms(),
            running: running.clone(),
            foreground_hwnd,
            prev_clipboard,
            app_name,
            app_icon_b64,
            streaming_handle: None,
            chunk_forwarder: None,
            sent_count: sent_count.clone(),
            forced_mode_id: forced_mode_id.clone(),
            matched_mode_id: press_mode_for_ping.clone(),
        });
    }

    // Register ESC as a global shortcut so the user can cancel the
    // active recording. Unregistered in on_release / on_cancel when
    // the recording ends. Best-effort: if registration fails (e.g.
    // another app has ESC globally claimed) we carry on silently
    // — the recording still works via the primary release path.
    register_cancel_hotkey(app);

    let sync_elapsed_ms = press_start.elapsed().as_millis();
    tracing::info!("on_press: session claimed in {sync_elapsed_ms}ms (sync phase complete)");

    // 6. Open StreamingRecognize in the BACKGROUND. No await in the
    //    foreground path — this function returns immediately so the
    //    hotkey dispatch can see the claimed state.
    let gcp_snapshot: Option<(GcpConfig, gcp::auth::Authenticator)> = {
        let guard = state
            .inner()
            .gcp
            .lock()
            .expect("PopoState gcp mutex poisoned");
        guard.as_ref().cloned()
    };

    if let Some((config, auth)) = gcp_snapshot {
        // Resolve features + language list from PopoState. These
        // reflect the user's Settings at press time.
        let language_codes = resolve_language_codes(&config, state.inner());
        let features = resolve_recognition_features(state.inner());

        // Resolve custom_prompt using the per-app mode binding resolver.
        // This picks the mode whose `apps` list matches `app_name`
        // (Feature 2 — per-mode app binding). Fall-through chain:
        // app match → default binding → legacy auto_format_prompt → "".
        //
        // When the press came from a per-mode hotkey, the forced_mode_id
        // short-circuits straight to that mode regardless of app.
        let (effective_prompt_owned, matched_mode) = resolve_effective_prompt(
            state.inner(),
            app_name_for_gcp.as_deref(),
            forced_mode_id.as_deref(),
        );

        // Debug-log the prompt resolution for observability. The
        // ID+name come from resolve_effective_prompt's second tuple
        // element; None means the legacy/empty path was taken.
        if let Some((mode_id, mode_name)) = &matched_mode {
            tracing::info!(
                "on_press: custom_prompt from mode {mode_name:?} ({mode_id}), {} chars",
                effective_prompt_owned.chars().count()
            );
        } else if !effective_prompt_owned.is_empty() {
            tracing::info!(
                "on_press: custom_prompt from legacy auto_format_prompt, {} chars",
                effective_prompt_owned.chars().count()
            );
        } else {
            tracing::info!("on_press: custom_prompt empty (auto-format off or no match)");
        }

        // Snapshot the dictionary phrase list for the streaming
        // adaptation payload. Empty = no adaptation attached.
        //
        // IMPORTANT (Session 31 finding): Chirp 3's adaptation pipeline
        // REQUIRES a specific language_code. When `language_codes` is
        // `["auto"]`, the server rejects any phrase_set with
        // NOT_FOUND / "Requested entity was not found" — there's no
        // language context yet for the acoustic-model biasing to
        // apply to. Empirically verified: same request succeeds on
        // `["en-US"]`, fails on `["auto"]`. Every Google docs
        // adaptation example uses a specific locale for this reason.
        //
        // If the user has Auto-detect language ON and the dictionary
        // is populated, we silently drop the adaptation rather than
        // force them to pick a language. DictionaryPage surfaces
        // this constraint in the UI copy.
        let language_is_auto = language_codes.is_empty()
            || language_codes
                .iter()
                .any(|c| c.eq_ignore_ascii_case("auto"));
        let adaptation_phrases: Vec<String> = if language_is_auto {
            Vec::new()
        } else {
            state
                .inner()
                .dictionary
                .lock()
                .map(|g| g.clone())
                .unwrap_or_default()
        };
        if language_is_auto {
            let have_dict = state
                .inner()
                .dictionary
                .lock()
                .map(|g| !g.is_empty())
                .unwrap_or(false);
            if have_dict {
                tracing::info!(
                    "streaming: skipping adaptation (language is auto-detect; Chirp 3 needs a specific locale for phrase biasing)"
                );
            }
        }

        // Identity tag for the patcher. The Arc we just stored in the
        // session + the one we move into the spawned task are
        // Arc::ptr_eq equal to each other. If a later press replaces
        // the session, its `running` Arc is a different allocation
        // and the patcher skips it.
        let identity = running.clone();

        let app_clone = app.clone();
        let samples_fwd = samples.clone();
        let running_fwd = running.clone();
        let sent_count_fwd = sent_count.clone();
        let project_id = config.project_id.clone();

        tauri::async_runtime::spawn(async move {
            let stream_open_start = std::time::Instant::now();
            match gcp::streaming::start(
                &auth,
                &project_id,
                &language_codes,
                gcp::chirp::TARGET_SR as i32,
                features,
                &effective_prompt_owned,
                &adaptation_phrases,
            )
            .await
            {
                Ok(handle) => {
                    let open_ms = stream_open_start.elapsed().as_millis();
                    tracing::info!("streaming: opened StreamingRecognize session in {open_ms}ms");

                    // Patch into the active session IFF identity matches.
                    let state = app_clone.state::<PopoState>();
                    let mut recording = state
                        .inner()
                        .recording
                        .lock()
                        .expect("PopoState mutex poisoned");

                    match recording.as_mut() {
                        Some(session) if Arc::ptr_eq(&session.running, &identity) => {
                            let tx = handle.clone_tx();
                            let forwarder = spawn_chunk_forwarder(
                                tx,
                                samples_fwd,
                                sample_rate,
                                running_fwd,
                                sent_count_fwd,
                            );
                            session.streaming_handle = Some(handle);
                            session.chunk_forwarder = Some(forwarder);
                            tracing::info!(
                                "streaming: patched handle + forwarder into live session"
                            );
                        }
                        Some(_) => {
                            tracing::info!(
                                "streaming: session identity changed (press/release/press race) — dropping handle"
                            );
                        }
                        None => {
                            tracing::info!(
                                "streaming: session already ended before stream opened — dropping handle (batch fallback will handle)"
                            );
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!(
                        "streaming: failed to open session, on_release will fall back to batch: {e:?}"
                    );
                }
            }
        });
    }

    Ok(())
}

/// Build the `language_codes` vector to send to Chirp 3.
///
/// Priority:
///   1. If `multi_language_codes` in PopoState is non-empty, use that
///      array (enables Chirp 3 code-switching between e.g. `hi-IN`
///      and `en-US`).
///   2. Otherwise, if `config.language_code` is empty or "auto",
///      return `vec![]` — Chirp 3 auto-detects from 125+ languages.
///   3. Otherwise, return `vec![config.language_code.clone()]`.
fn resolve_language_codes(config: &GcpConfig, state: &PopoState) -> Vec<String> {
    let multi = state
        .multi_language_codes
        .lock()
        .map(|g| g.clone())
        .unwrap_or_default();
    if !multi.is_empty() {
        return multi;
    }
    let single = config.language_code.trim();
    if single.is_empty() || single.eq_ignore_ascii_case("auto") {
        return Vec::new();
    }
    vec![single.to_string()]
}

/// Build a `RecognitionFeatures` from current PopoState toggles.
/// `enable_automatic_punctuation` is always on — Chirp 3 handles
/// caps/periods natively and users expect the output to look like
/// prose, not an LLM prompt.
fn resolve_recognition_features(
    state: &PopoState,
) -> googleapis_tonic_google_cloud_speech_v2::google::cloud::speech::v2::RecognitionFeatures {
    use googleapis_tonic_google_cloud_speech_v2::google::cloud::speech::v2::RecognitionFeatures;

    let spoken_punc = state.spoken_punctuation.lock().map(|g| *g).unwrap_or(false);
    let spoken_emo = state.spoken_emojis.lock().map(|g| *g).unwrap_or(false);
    let profanity = state.profanity_filter.lock().map(|g| *g).unwrap_or(false);

    RecognitionFeatures {
        enable_automatic_punctuation: true,
        enable_spoken_punctuation: spoken_punc,
        enable_spoken_emojis: spoken_emo,
        profanity_filter: profanity,
        ..Default::default()
    }
}

/// Resolve the effective Chirp `custom_prompt` for the upcoming
/// dictation session.
///
/// Priority:
///   1. `forced_mode_id` — when set (the user pressed a per-mode
///      hotkey), that mode ALWAYS wins. No app lookup, no default
///      fallback. Returns `(prompt, Some(id, name))` or `("", None)`
///      if the id doesn't exist in bindings.
///   2. `auto_format_enabled == false` → empty string (no prompt).
///      This is the master switch: Settings → Transcription →
///      Auto-format. When off, Chirp runs naked.
///   3. Walk `mode_bindings`. If any binding's `apps` list contains
///      the foreground app's friendly name (case-insensitive), use
///      that binding's `system_prompt`. First match wins (tracing
///      log warns when a second match is found so users can spot
///      conflicts in their configuration).
///   4. Fall back to the binding with `is_default == true`.
///   5. Final fallback: `auto_format_prompt` (the legacy field
///      pushed by `cmd_set_auto_format_prompt`). This keeps the
///      flow working for users on an old frontend build that hasn't
///      started pushing mode_bindings yet.
///
/// Returns the resolved prompt + an optional (mode id, mode name)
/// tuple describing which binding matched — useful for the tracing
/// log. `None` means no binding matched (fell through to legacy or
/// an empty prompt).
///
/// **Every non-empty returned prompt is prefixed with
/// `BASELINE_CORRECTION`** so factual cleanups (self-corrections,
/// stutter collapse, obvious mis-transcriptions, grammar) apply
/// uniformly across all modes. Only when auto-format is OFF do we
/// return empty — that path produces truly raw Chirp output for
/// users who want unmodified text.
fn resolve_effective_prompt(
    state: &PopoState,
    app_name: Option<&str>,
    forced_mode_id: Option<&str>,
) -> (String, Option<(String, String)>) {
    // Snapshot bindings once so we drop the lock quickly.
    let bindings: Vec<ModeBinding> = state
        .mode_bindings
        .lock()
        .map(|g| g.clone())
        .unwrap_or_default();

    // Priority 1: explicit forced mode from a per-mode hotkey.
    // Overrides the auto_format_enabled master switch — the user
    // explicitly asked for this mode by pressing its hotkey, so
    // they clearly want formatting applied.
    if let Some(fid) = forced_mode_id {
        if let Some(m) = bindings.iter().find(|b| b.id == fid) {
            tracing::info!(
                "mode resolution: forced via hotkey → mode {:?} ({})",
                m.name,
                m.id
            );
            return (
                combine_with_baseline(&m.system_prompt),
                Some((m.id.clone(), m.name.clone())),
            );
        }
        tracing::warn!(
            "mode resolution: forced_mode_id {fid:?} didn't match any binding; falling through"
        );
    }

    let auto_format_on = state
        .auto_format_enabled
        .lock()
        .map(|g| *g)
        .unwrap_or(false);
    if !auto_format_on {
        return (String::new(), None);
    }

    // Priority 2: app-specific match.
    if let Some(app) = app_name {
        let app_lower = app.to_lowercase();
        let mut first_match: Option<&ModeBinding> = None;
        let mut second_match: Option<&ModeBinding> = None;
        for b in bindings.iter() {
            if b.apps.iter().any(|a| a.to_lowercase() == app_lower) {
                if first_match.is_none() {
                    first_match = Some(b);
                } else if second_match.is_none() {
                    second_match = Some(b);
                    break;
                }
            }
        }
        if let Some(first) = first_match {
            if let Some(second) = second_match {
                tracing::warn!(
                    "mode resolution: app {app:?} matches both {:?} and {:?} — using first",
                    first.name,
                    second.name
                );
            } else {
                tracing::info!("mode resolution: app {app:?} → mode {:?}", first.name);
            }
            return (
                combine_with_baseline(&first.system_prompt),
                Some((first.id.clone(), first.name.clone())),
            );
        }
    }

    // Priority 3: default mode.
    if let Some(def) = bindings.iter().find(|b| b.is_default) {
        tracing::info!(
            "mode resolution: no app match for {:?} → default mode {:?}",
            app_name.unwrap_or("<unknown>"),
            def.name
        );
        return (
            combine_with_baseline(&def.system_prompt),
            Some((def.id.clone(), def.name.clone())),
        );
    }

    // Priority 4: legacy fallback.
    let legacy = state
        .auto_format_prompt
        .lock()
        .map(|g| g.clone())
        .unwrap_or_default();
    if !legacy.is_empty() {
        tracing::info!(
            "mode resolution: falling back to legacy auto_format_prompt for app {:?}",
            app_name.unwrap_or("<unknown>")
        );
        return (combine_with_baseline(&legacy), None);
    }
    (String::new(), None)
}

/// Baseline transcript cleanup rules that prefix EVERY mode prompt
/// when `auto_format` is on. Ensures basic quality fixes happen
/// regardless of whether the user's in Casual / Code / Email / etc.
///
/// Design goals:
///   - Conservative: never invents content, never paraphrases
///     beyond fixing obvious errors.
///   - Mode-orthogonal: doesn't force formality, doesn't add
///     structure. Every mode's specific instructions still apply
///     on top.
///   - Concise + directive: short numbered rules, no example
///     parade. The model follows principles better than it
///     imitates examples.
///
/// Exposed as `pub const` so a future settings page / mode editor
/// could show these rules to users who want to understand what
/// popo's doing to their transcript.
pub const BASELINE_CORRECTION: &str = concat!(
    "Before applying the mode-specific formatting below, clean up the ",
    "raw transcript with these rules:\n\n",
    "1. Honor self-corrections. If the speaker overrides an earlier ",
    "statement (with cues like \"sorry\", \"actually\", \"no wait\", ",
    "\"I meant\"), keep only the final corrected version and drop the ",
    "earlier one entirely.\n\n",
    "2. Remove stutters and immediate word / phrase repetitions caused ",
    "by hesitation. Render each utterance once, cleanly.\n\n",
    "3. Correct obvious mis-transcriptions only when surrounding context ",
    "makes the intended word unambiguous. Never guess.\n\n",
    "4. Fix basic grammar, capitalisation, and punctuation.\n\n",
    "5. Preserve the speaker's voice, vocabulary, and level of ",
    "formality. Never paraphrase beyond these rules. Never invent, ",
    "add, or remove content.\n\n",
    "Mode-specific formatting instructions:\n\n"
);

/// Prepend `BASELINE_CORRECTION` to a mode's system prompt, unless
/// the mode prompt is empty/whitespace — in which case return empty
/// (preserves the auto-format-off / no-binding-matched semantics of
/// "no prompt at all").
fn combine_with_baseline(mode_prompt: &str) -> String {
    let trimmed = mode_prompt.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    format!("{BASELINE_CORRECTION}{trimmed}")
}

/// Look up a mode's `sound_preset` by id. Returns "default" when
/// the mode doesn't exist in bindings or has no preset set — never
/// returns empty, so pill sound-effect emitters always have a
/// canonical string to ship in the event payload.
fn resolve_sound_preset(state: &PopoState, mode_id: Option<&str>) -> String {
    let Some(id) = mode_id else {
        return "default".to_string();
    };
    let bindings = state
        .mode_bindings
        .lock()
        .map(|g| g.clone())
        .unwrap_or_default();
    bindings
        .iter()
        .find(|b| b.id == id)
        .map(|b| b.sound_preset.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "default".to_string())
}

// ── Cancel recording (ESC hotkey) ───────────────────────

/// Register the ESC shortcut with the global-shortcut plugin.
/// Idempotent: if the manager fails because it's already registered,
/// we log and carry on (the handler still fires fine either way).
pub(crate) fn register_cancel_hotkey(app: &AppHandle) {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    if let Err(e) = app.global_shortcut().register(cancel_hotkey()) {
        // Non-fatal: recording still works without ESC-cancel, the
        // user just has to wait for the natural release.
        tracing::warn!("failed to register ESC cancel shortcut: {e}");
    } else {
        tracing::debug!("ESC cancel shortcut registered");
    }
}

/// Unregister the ESC shortcut so it stops claiming the ESC key
/// globally when no recording is active. Called from on_release /
/// on_cancel / any terminal branch.
pub(crate) fn unregister_cancel_hotkey(app: &AppHandle) {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    if let Err(e) = app.global_shortcut().unregister(cancel_hotkey()) {
        // Likely wasn't registered; safe to ignore.
        tracing::debug!("ESC cancel unregister (ignored): {e}");
    }
}

/// Abort the active recording + discard any in-flight transcription.
/// Triggered by ESC during a recording. Differs from on_release:
///   - Skips the transcribe + paste pipeline entirely.
///   - Restores the user's original clipboard (nothing new to paste).
///   - Shows a brief "Cancelled" hint above the pill, then sleeps.
///   - Aborts any in-flight gRPC stream to release Chirp billing slot.
async fn on_cancel(app: &AppHandle) -> anyhow::Result<()> {
    // Take the session. If there's nothing to cancel, just make sure
    // ESC is no longer registered and return.
    let session_opt = {
        let state = app.state::<PopoState>();
        let mut g = state
            .inner()
            .recording
            .lock()
            .expect("PopoState mutex poisoned");
        g.take()
    };
    let Some(session) = session_opt else {
        unregister_cancel_hotkey(app);
        return Ok(());
    };

    // Stop waveform + audio capture immediately.
    session.running.store(false, Ordering::Relaxed);
    // (cpal::Stream drops at end of scope when we move out of `session`.)

    // Destructure out just the fields we need to move/use. Doing this
    // in one shot avoids partial-move errors when we later access
    // `prev_clipboard` after taking `streaming_handle` + `chunk_forwarder`.
    let RecordingSession {
        streaming_handle,
        chunk_forwarder,
        prev_clipboard,
        ..
    } = session;

    // Abort streaming + chunk forwarder to release GCP resources.
    if let Some(handle) = streaming_handle {
        handle.abort();
    }
    if let Some(forwarder) = chunk_forwarder {
        forwarder.abort();
    }

    // Restore the user's original clipboard — we haven't written the
    // transcript yet, so there's nothing "sticky" to worry about, but
    // we might have nudged it earlier in some edge cases.
    if let Some(prev) = prev_clipboard.as_ref() {
        let _ = focus::set_clipboard_text(prev);
    }

    unregister_cancel_hotkey(app);
    tracing::info!("recording cancelled via ESC");

    // Visual feedback: info-severity tooltip "Cancelled", brief hold.
    let _ = app.emit(
        "pill:state:error",
        ErrorPayload::info("cancelled", "Cancelled"),
    );
    tokio::time::sleep(Duration::from_millis(700)).await;
    let _ = app.emit("pill:state:sleep", ());
    Ok(())
}

/// Map `Settings.endpointing` into the Chirp 3 enum value.
///
/// Used by `gcp::streaming::start` when constructing the streaming
/// config.
///
/// **Status note (2026-05):** the `googleapis-tonic-google-cloud-speech-v2`
/// crate v0.34 only exposes `Unspecified` and `Standard` on the
/// `EndpointingSensitivity` enum. Google's Chirp 3 docs document LOW /
/// HIGH values, but they aren't in the proto crate yet. Until the
/// crate ships those variants, this resolver maps ALL user choices
/// ("low" / "standard" / "high") to `Standard` and logs an info line
/// when a non-standard value was requested. The frontend plumbing +
/// PopoState field stay in place so re-enabling is a one-line flip
/// when the proto updates.
///
/// Returns the raw i32 the proto expects.
pub fn resolve_endpointing_sensitivity(state: &PopoState) -> i32 {
    use googleapis_tonic_google_cloud_speech_v2::google::cloud::speech::v2::streaming_recognition_features::EndpointingSensitivity;
    let v = state
        .endpointing_sensitivity
        .lock()
        .map(|g| g.clone())
        .unwrap_or_else(|_| "standard".to_string());
    let want = v.to_lowercase();
    if want != "standard" {
        tracing::info!(
            "endpointing: requested {want:?} but proto crate only supports Standard; using Standard"
        );
    }
    EndpointingSensitivity::Standard as i32
}

/// Spawn a background task that reads NEW samples from the ring buffer every
/// ~100ms, resamples to 16 kHz, converts to PCM16 bytes, and sends them to
/// the active StreamingRecognize session via the mpsc sender.
///
/// The task runs until `running` is flipped to false (on hotkey release).
// ── Snippet expansion ─────────────────────────────────────────────
//
// Post-dictation substitution: scan the transcript for any snippet's
// `trigger` word and replace it with the snippet's `value`. Rules:
//
//   • Whole-word only. A trigger matches only when surrounded by
//     non-letter/non-digit characters (including start/end of text).
//     So a snippet with trigger="addr" matches "addr" in "my addr"
//     but NOT inside "address" or "readdr". Uses Unicode letter/
//     digit classes via char::is_alphanumeric so Hindi / Telugu
//     triggers work correctly.
//
//   • Case-insensitive match, case-preserving replace:
//       addr   → hello, world
//       Addr   → Hello, world   (title-case preserved on first char)
//       ADDR   → HELLO, WORLD   (all-caps uppercased whole value)
//
//   • Every occurrence is replaced. Single pass over the original
//     text, so if a snippet's VALUE contains another trigger we
//     don't recursively expand (prevents infinite loops).
//
//   • Longest trigger wins when two triggers would match starting
//     at the same position (e.g. "email" vs "emailaddress").
//
// Returns the transformed transcript and the list of snippet ids
// that actually expanded at least once.

/// Result of `expand_snippets`: the new text + which snippets hit.
///
/// `instances` records EVERY expansion that fired (one entry per
/// occurrence) with character offsets into the returned `text`.
/// `matched_ids` is kept as a deduped id list for the
/// `snippets:expanded` frontend event (used to bump usageCount).
pub struct SnippetExpansion {
    pub text: String,
    pub matched_ids: Vec<String>,
    pub instances: Vec<ExpansionInstance>,
}

pub fn expand_snippets(text: &str, snippets: &[SnippetEntry]) -> SnippetExpansion {
    if snippets.is_empty() || text.is_empty() {
        return SnippetExpansion {
            text: text.to_string(),
            matched_ids: Vec::new(),
            instances: Vec::new(),
        };
    }

    // Sort triggers by length desc so "emailaddress" matches before
    // "email" when both are registered.
    let mut sorted: Vec<&SnippetEntry> = snippets.iter().collect();
    sorted.sort_by_key(|s| std::cmp::Reverse(s.trigger.chars().count()));

    let chars: Vec<char> = text.chars().collect();
    let n = chars.len();
    let is_word = |c: char| c.is_alphanumeric() || c == '_';

    let mut out = String::with_capacity(text.len());
    // Track the CHARACTER position inside `out` as we build it, so we
    // can record accurate start/end offsets for each expansion.
    // `out.chars().count()` would be O(n) per step; we maintain it
    // incrementally instead.
    let mut out_char_pos: usize = 0;
    let mut matched_ids: Vec<String> = Vec::new();
    let mut instances: Vec<ExpansionInstance> = Vec::new();
    let mut i = 0usize;

    while i < n {
        let at_boundary = i == 0 || !is_word(chars[i - 1]);
        let mut consumed = 0usize;
        let mut replacement: Option<String> = None;
        let mut matched_id: Option<String> = None;

        if at_boundary {
            for entry in &sorted {
                let trigger_chars: Vec<char> = entry.trigger.chars().collect();
                let tlen = trigger_chars.len();
                if tlen == 0 || i + tlen > n {
                    continue;
                }
                // Case-insensitive compare via .to_lowercase().
                let matches = trigger_chars
                    .iter()
                    .zip(chars[i..i + tlen].iter())
                    .all(|(a, b)| {
                        let al: String = a.to_lowercase().collect();
                        let bl: String = b.to_lowercase().collect();
                        al == bl
                    });
                if !matches {
                    continue;
                }
                let right_ok = i + tlen == n || !is_word(chars[i + tlen]);
                if !right_ok {
                    continue;
                }
                let actual: String = chars[i..i + tlen].iter().collect();
                let propagated = propagate_case(&actual, &entry.value);
                replacement = Some(propagated.clone());
                consumed = tlen;
                matched_id = Some(entry.id.clone());
                // Record the expansion inline. `trigger` captures the
                // transcript-side spelling ("Addr") since that's what
                // the user literally said. `end_char` is patched in
                // once we know the replacement's length (below).
                instances.push(ExpansionInstance {
                    snippet_id: entry.id.clone(),
                    trigger: actual,
                    value: propagated,
                    start_char: out_char_pos,
                    end_char: 0,
                });
                break;
            }
        }

        if let (Some(rep), Some(id)) = (replacement, matched_id) {
            let rep_len = rep.chars().count();
            out.push_str(&rep);
            // Patch the just-pushed instance's end_char with the real
            // end position. Unwrap is safe because we just pushed.
            if let Some(last) = instances.last_mut() {
                last.end_char = out_char_pos + rep_len;
            }
            out_char_pos += rep_len;
            if !matched_ids.contains(&id) {
                matched_ids.push(id);
            }
            i += consumed;
        } else {
            out.push(chars[i]);
            out_char_pos += 1;
            i += 1;
        }
    }

    SnippetExpansion {
        text: out,
        matched_ids,
        instances,
    }
}

/// Mirror the case of `source` onto `target`:
///   - source ALL UPPERCASE  → uppercase `target`
///   - source Title Case     → capitalize `target`'s first letter
///   - otherwise             → leave `target` as-authored
fn propagate_case(source: &str, target: &str) -> String {
    let letter_count = source.chars().filter(|c| c.is_alphabetic()).count();
    if letter_count == 0 {
        return target.to_string();
    }

    let all_upper = letter_count > 1
        && source
            .chars()
            .filter(|c| c.is_alphabetic())
            .all(|c| c.is_uppercase());
    if all_upper {
        return target.to_uppercase();
    }

    let first_upper = source
        .chars()
        .find(|c| c.is_alphabetic())
        .map(|c| c.is_uppercase())
        .unwrap_or(false);
    if first_upper {
        let mut chars = target.chars();
        match chars.next() {
            Some(c) => c.to_uppercase().chain(chars).collect(),
            None => String::new(),
        }
    } else {
        target.to_string()
    }
}

// ── Dictionary / speech adaptation ─────────────────────────────────
//
// Build a Chirp 3 `SpeechAdaptation` payload from the user's
// dictionary phrases. Returns `None` when the list is empty so the
// caller can skip the field entirely (Chirp errors if `adaptation`
// is Some-but-empty).
//
// WIRE SHAPE MATTERS (Session 31 fix):
//   Google's official Chirp 3 adaptation example in the Python docs
//   sets boost ONLY at the per-phrase level (or omits it entirely),
//   NEVER at the PhraseSet level. Proto3 omits default-value fields
//   from the wire, so `PhraseSet.boost = 0.0` is effectively
//   "unset" and matches the working Python request shape.
//
//   When we originally sent `PhraseSet.boost = 10.0` + per-phrase
//   `boost = 0.0`, the per-phrase boost was omitted (default) but
//   the PhraseSet-level boost stayed on the wire. Google's server
//   returned NOT_FOUND / "Requested entity was not found" on every
//   call (both EU and US regions) because that particular shape
//   isn't recognized by Chirp 3's adaptation validator.
//
//   Fix: boost lives on each Phrase; PhraseSet.boost is left at 0.0
//   (proto3 omits it). 10.0 is Google's recommended starting point.

use googleapis_tonic_google_cloud_speech_v2::google::cloud::speech::v2::{
    phrase_set::Phrase, speech_adaptation::adaptation_phrase_set::Value as PhraseSetValue,
    speech_adaptation::AdaptationPhraseSet, PhraseSet, SpeechAdaptation,
};

pub fn build_speech_adaptation(phrases: &[String]) -> Option<SpeechAdaptation> {
    if phrases.is_empty() {
        return None;
    }
    let phrase_entries: Vec<Phrase> = phrases
        .iter()
        .map(|p| Phrase {
            value: p.clone(),
            boost: 10.0, // per-phrase biasing; Google-recommended mid-range
        })
        .collect();
    Some(SpeechAdaptation {
        phrase_sets: vec![AdaptationPhraseSet {
            value: Some(PhraseSetValue::InlinePhraseSet(PhraseSet {
                phrases: phrase_entries,
                // Keep at 0.0 so proto3 omits this field — matches
                // Google's working Python example exactly.
                boost: 0.0,
                ..Default::default()
            })),
        }],
        custom_classes: vec![],
    })
}

fn spawn_chunk_forwarder(
    tx: tokio::sync::mpsc::Sender<googleapis_tonic_google_cloud_speech_v2::google::cloud::speech::v2::StreamingRecognizeRequest>,
    samples: Arc<Mutex<VecDeque<f32>>>,
    input_sample_rate: u32,
    running: Arc<AtomicBool>,
    sent_count: Arc<std::sync::atomic::AtomicUsize>,
) -> tokio::task::JoinHandle<()> {
    use crate::gcp::chirp::{f32_to_pcm16_bytes, resample_to_16k, TARGET_SR};
    use googleapis_tonic_google_cloud_speech_v2::google::cloud::speech::v2::{
        streaming_recognize_request, StreamingRecognizeRequest,
    };

    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_millis(100));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        let start = std::time::Instant::now();
        let mut chunk_count: u32 = 0;

        while running.load(Ordering::Relaxed) {
            ticker.tick().await;

            // Read all samples currently in the buffer.
            let (new_samples, total_len) = {
                let guard = match samples.lock() {
                    Ok(g) => g,
                    Err(_) => continue,
                };
                let total = guard.len();
                let already_sent = sent_count.load(Ordering::Relaxed);
                if total <= already_sent {
                    continue;
                }
                // Extract only the NEW samples (from `already_sent` to current end).
                let new: Vec<f32> = guard.iter().skip(already_sent).copied().collect();
                (new, total)
            };

            if new_samples.is_empty() {
                continue;
            }

            // Resample to 16 kHz if needed.
            let resampled = if input_sample_rate as usize == TARGET_SR {
                new_samples
            } else {
                resample_to_16k(&new_samples, input_sample_rate as usize)
            };

            // Convert to PCM16 bytes.
            let pcm_bytes = f32_to_pcm16_bytes(&resampled);

            if pcm_bytes.is_empty() {
                continue;
            }

            // Google caps streaming audio chunks at 25600 bytes per message.
            // On the first tick after session setup (~800ms of buffered audio),
            // the accumulated PCM can exceed this. Split into multiple sends.
            const MAX_CHUNK_BYTES: usize = 25_600;

            let chunks: Vec<&[u8]> = pcm_bytes.chunks(MAX_CHUNK_BYTES).collect();
            let num_sub_chunks = chunks.len();
            let total_bytes = pcm_bytes.len();
            let mut send_failed = false;

            for sub_chunk in chunks {
                let msg = StreamingRecognizeRequest {
                    recognizer: String::new(),
                    streaming_request: Some(streaming_recognize_request::StreamingRequest::Audio(
                        sub_chunk.to_vec().into(),
                    )),
                };

                if tx.send(msg).await.is_err() {
                    tracing::warn!("streaming: chunk forwarder channel closed, stopping");
                    send_failed = true;
                    break;
                }
            }

            if send_failed {
                break;
            }

            chunk_count += 1;
            if chunk_count == 1 {
                // Log the first chunk prominently — this is the
                // visible "real-time streaming is active" signal.
                tracing::info!(
                    "streaming: first chunk sent at +{}ms ({} bytes, {} sub-chunks)",
                    start.elapsed().as_millis(),
                    total_bytes,
                    num_sub_chunks
                );
            } else if chunk_count % 10 == 0 {
                tracing::debug!(
                    "streaming: chunk #{chunk_count} sent at +{}ms",
                    start.elapsed().as_millis()
                );
            }

            // Mark these samples as sent.
            sent_count.store(total_len, Ordering::Relaxed);
        }

        tracing::info!(
            "streaming: chunk forwarder stopped after {chunk_count} chunks over {}ms",
            start.elapsed().as_millis()
        );
    })
}

fn spawn_waveform_task(
    app: AppHandle,
    running: Arc<AtomicBool>,
    samples: Arc<Mutex<VecDeque<f32>>>,
    sample_rate: u32,
) {
    tauri::async_runtime::spawn(async move {
        // Tiny preroll so the first frames aren't [0; 16] (audio buffer
        // needs a moment to fill after stream.play()).
        tokio::time::sleep(Duration::from_millis(40)).await;

        let mut ticker = tokio::time::interval(Duration::from_millis(40));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        // Voice-detection flag. Once any bar crosses the silence threshold
        // (0.06 RMS-normalized = roughly a clearly-audible consonant), we
        // emit pill:state:active ONCE and stay there until release.
        //
        // Why sticky rather than per-tick toggling: flickering between
        // ready and active during pauses would wash out the waveform's
        // color signal. Brief §2 says the transition is one-way within
        // a session — release is what brings us back to sleep.
        let mut voice_detected = false;
        const VOICE_THRESHOLD: f32 = 0.06;

        // EMA (exponential moving average) smoothing for the waveform bars.
        // Each bar decays toward the raw value over several frames instead
        // of jumping instantly. Alpha = 0.3 means:
        //   new = 0.3 * raw + 0.7 * prev
        // Rise time: ~3 frames to reach 87% of a step change (3 × 40ms = 120ms)
        // Decay time: same symmetrically, so peaks dissolve gently.
        // EMA smoothing: 0.4 = 40% new + 60% previous. This feels
        // "middle ground" — responsive enough to track speech syllables
        // without being twitchy. Lower (0.3) = more sluggish; higher
        // (0.5+) = bars jitter on every peak.
        const SMOOTH_ALPHA: f32 = 0.4;
        let mut smoothed = [0.0f32; 16];

        // Silence-detection bookkeeping. Only used in Toggle mode with
        // silence_detection_seconds > 0. `last_voice_at` anchors the
        // countdown; it's reset every time a voiced frame arrives.
        // If `voice_detected` stays false forever (user never speaks),
        // auto-stop never fires — they'd use the hotkey to cancel.
        let mut last_voice_at = std::time::Instant::now();
        let mut auto_stop_fired = false;

        while running.load(Ordering::Relaxed) {
            ticker.tick().await;
            let raw_bars = processor::compute_bars(&samples, sample_rate);
            let max_bar = raw_bars.iter().cloned().fold(0.0f32, f32::max);
            let voiced = max_bar > VOICE_THRESHOLD;

            // Apply EMA smoothing so the pill bars rise and fall gracefully
            // instead of jumping between frames. The smoothed bars are what
            // gets emitted; raw values are used only for voice detection.
            for i in 0..16 {
                smoothed[i] = SMOOTH_ALPHA * raw_bars[i] + (1.0 - SMOOTH_ALPHA) * smoothed[i];
            }
            let bars: [f32; 16] = smoothed;

            // Flip to active state on first voiced frame.
            if !voice_detected && voiced {
                voice_detected = true;
                let _ = app.emit("pill:state:active", ());
            }

            // Refresh the silence countdown anchor every voiced frame.
            if voiced {
                last_voice_at = std::time::Instant::now();
            }

            let _ = app.emit("pill:waveform", WaveformPayload { bars });

            // Auto-stop: only after voice was first detected, only in
            // Toggle mode, only if silence_detection_seconds > 0.
            // Fire exactly once per session; subsequent ticks no-op.
            if voice_detected && !auto_stop_fired {
                let state = app.state::<PopoState>();
                let mode = state
                    .inner()
                    .recording_mode
                    .lock()
                    .map(|g| *g)
                    .unwrap_or(RecordingMode::PushToTalk);
                let silence_secs = state
                    .inner()
                    .silence_detection_seconds
                    .lock()
                    .map(|g| *g)
                    .unwrap_or(0);

                if mode == RecordingMode::Toggle && silence_secs > 0 {
                    let elapsed = last_voice_at.elapsed().as_secs() as u32;
                    if elapsed >= silence_secs {
                        auto_stop_fired = true;
                        tracing::info!("silence auto-stop: {silence_secs}s elapsed in toggle mode");
                        let app2 = app.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Err(e) = on_release(&app2).await {
                                tracing::error!("silence auto-stop release failed: {e:?}");
                            }
                        });
                    }
                }
            }
        }
    });
}

// ── Release ──────────────────────────────────────────────────────────

async fn on_release(app: &AppHandle) -> anyhow::Result<()> {
    // Take the session out of the Mutex ASAP so we don't hold the lock
    // across the awaits below. Extract only the Send-safe fields we need
    // for the rest of the flow — this keeps the spawned future Send
    // (cpal::Stream is wrapped in SafeStream but still best kept local).
    let (
        samples,
        sample_rate,
        started_at_ms,
        foreground_hwnd,
        prev_clipboard,
        pcm_snapshot,
        streaming_handle,
        chunk_forwarder,
        sent_count,
        app_name,
        app_icon_b64,
        forced_mode_id,
        matched_mode_id,
        capture_diag,
        capture_device_name,
    ) = {
        let session_opt = {
            let state = app.state::<PopoState>();
            let mut g = state
                .inner()
                .recording
                .lock()
                .expect("PopoState mutex poisoned");
            g.take()
        };
        let Some(session) = session_opt else {
            // Stray release (no matching press). ESC might still be
            // registered from a previous race; clear it defensively.
            unregister_cancel_hotkey(app);
            return Ok(());
        };

        // Stop the waveform task first so we don't emit bars during processing.
        session.running.store(false, Ordering::Relaxed);
        // Stream drops at end of this block (partial-move of the fields
        // below leaves the rest of the session to fall out of scope).
        // cpal's callback thread stops when the stream drops.
        //
        // IMPORTANT: capture the PCM snapshot HERE, inside the block,
        // so we drain the buffer at the exact moment audio stops flowing.
        // Doing it later (after async transcription) risks reading a
        // modified buffer or missing the lock window.
        let pcm_snapshot: Vec<f32> = session
            .samples
            .lock()
            .map(|g| g.iter().copied().collect())
            .unwrap_or_default();
        (
            session.samples,
            session.sample_rate,
            session.started_at_ms,
            session.foreground_hwnd,
            session.prev_clipboard,
            pcm_snapshot,
            session.streaming_handle,
            session.chunk_forwarder,
            session.sent_count,
            session.app_name,
            session.app_icon_b64,
            session.forced_mode_id,
            session.matched_mode_id,
            session.capture_diag,
            session.capture_device_name,
        )
    };

    // The recording has ended — ESC cancel is no longer meaningful.
    // Release it so the user's ESC key is free for their focused app
    // during the paste + any downstream UI work.
    unregister_cancel_hotkey(app);

    // ── Pre-API guards ──────────────────────────────────────────────────
    //
    // Three protections run BEFORE any paid Chirp 3 API activity:
    //
    //   1. Minimum recording duration (400 ms). Accidental hotkey taps
    //      never reach the API.
    //   2. Minimum audio amplitude (max |sample| >= 0.02, ~ -34 dBFS).
    //      Sessions held in silence (muted mic, hotkey stuck) are
    //      rejected without charge.
    //   3. Any active streaming handle is `abort()`ed — drops the
    //      send side so GCP half-closes and stops billing, and cancels
    //      the response collector so we don't wait on a transcript we
    //      don't want.
    //
    // These guards ALSO prevent a known Chirp 3 misbehavior: when
    // audio is mostly silence AND custom_prompt_config is set, the
    // model can hallucinate the prompt text itself as the returned
    // transcript (the prompt-echo bug). We double-guard against that
    // below with a post-transcript check, but skipping the API call
    // entirely is the cleanest fix for the common case.
    let duration_ms = unix_now_ms().saturating_sub(started_at_ms);
    let max_amp: f32 = pcm_snapshot
        .iter()
        .copied()
        .fold(0.0f32, |a, s| a.max(s.abs()));
    const MIN_DURATION_MS: u64 = 400;
    // Session 48 — retuned for the 8× fixed input boost added to
    // `audio::capture`. Real signals are now post-boost, so the
    // threshold can go up without rejecting quiet built-in mics:
    //
    //   Built-in mic raw peak 0.001 → boosted 0.008  (passes 0.005)
    //   Built-in mic raw peak 0.0005 → boosted 0.004 (just under)
    //   Muted mic raw peak ~0.0001 → boosted 0.0008 (correctly rejected)
    //
    // 0.005 (~-46 dBFS post-boost) is comfortably above the noise
    // floor for muted-mic / hotkey-on-desk cases while still
    // accepting the realistic dictation envelope.
    const MIN_AMPLITUDE: f32 = 0.005;
    let too_short = duration_ms < MIN_DURATION_MS;
    let too_quiet = max_amp < MIN_AMPLITUDE;

    if too_short || too_quiet {
        // Pull diagnostics so the error message can name the device
        // and report what the audio callback ACTUALLY saw. Lets the
        // user tell at a glance whether the issue is "hotkey tapped
        // too fast" vs "selected mic delivered no audio". Session 43.
        let cb_count = capture_diag.callbacks.load(Ordering::Relaxed);
        let samples_count = capture_diag.samples_written.load(Ordering::Relaxed);
        let peak_pre = capture_diag.peak_pre_agc();
        let peak_post = capture_diag.peak_post_agc();
        tracing::info!(
            "on_release: skipping transcribe (duration={}ms max_amp={:.4} too_short={} too_quiet={}) | device={} callbacks={} samples_written={} peak_pre_agc={:.4} peak_post_agc={:.4}",
            duration_ms, max_amp, too_short, too_quiet,
            capture_device_name, cb_count, samples_count, peak_pre, peak_post
        );
        // Kill streaming cleanly so GCP releases the recognizer slot.
        if let Some(handle) = streaming_handle {
            handle.abort();
        }
        if let Some(forwarder) = chunk_forwarder {
            forwarder.abort();
        }
        // Build a specific error message. Three cases:
        //   - too_short: simple guard, no need to mention audio.
        //   - too_quiet + zero callbacks: cpal opened the device but
        //     the audio thread never delivered a single buffer. The
        //     device's default config is broken or the OS is gating
        //     it. Tell the user explicitly.
        //   - too_quiet + callbacks fired: the device DID deliver
        //     audio but it was too quiet (mic muted, mic far from
        //     mouth, gain too low). Show the actual peak so they can
        //     see whether it's near silence (≈0.0) or near threshold.
        let reason: String = if too_short {
            "Too short — hold longer".to_string()
        } else if cb_count == 0 {
            format!(
                "No audio from {} — the device opened but delivered nothing. Try a different mic in Settings.",
                capture_device_name
            )
        } else {
            format!(
                "No speech detected from {} (peak signal {:.3}). Check mic isn't muted, or pick a different mic in Settings.",
                capture_device_name, peak_pre
            )
        };
        let _ = app.emit("pill:state:error", ErrorPayload::info("no_speech", &reason));
        tokio::time::sleep(Duration::from_millis(900)).await;
        let _ = app.emit("pill:state:sleep", ());
        return Ok(());
    }

    // Resolve the custom_prompt once so we can use it for the
    // post-transcript prompt-echo guard below. (The streaming path
    // already baked this into the stream at on_press time; the batch
    // fallback paths resolve it locally for the API call. We only
    // need it here for the echo check.)
    //
    // Uses the same per-app resolver as on_press so per-mode app
    // bindings apply consistently on the batch-fallback path.
    let effective_prompt_for_guard: String = {
        let st = app.state::<PopoState>();
        resolve_effective_prompt(st.inner(), app_name.as_deref(), forced_mode_id.as_deref()).0
    };

    // Dictionary phrases for any batch-transcribe fallback below.
    // The streaming path already baked them in at on_press time via
    // `adaptation_phrases`; this snapshot covers PATH B (no streaming)
    // and PATH A's error-retry branches.
    //
    // Same auto-detect guard as the streaming path: Chirp 3 rejects
    // adaptation + `["auto"]` with NOT_FOUND. Resolve the effective
    // language here (same logic as resolve_language_codes would
    // apply during the batch call) and short-circuit to empty
    // phrases when auto is active.
    let adaptation_phrases_batch: Vec<String> = {
        let st = app.state::<PopoState>();
        // Peek at the current language to decide whether to attach
        // phrases at all. If GCP config isn't present yet, the batch
        // path won't run anyway; falling through with empty phrases
        // is correct for that edge case too.
        let auto_detect = {
            let guard = st.inner().gcp.lock().ok();
            let lang = guard
                .as_ref()
                .and_then(|g| g.as_ref())
                .map(|(c, _)| c.language_code.clone())
                .unwrap_or_default();
            lang.trim().is_empty() || lang.eq_ignore_ascii_case("auto")
        };
        if auto_detect {
            Vec::new()
        } else {
            st.inner()
                .dictionary
                .lock()
                .map(|g| g.clone())
                .unwrap_or_default()
        }
    };

    // Pill: processing
    let _ = app.emit("pill:state:processing", ());

    // ── Transcribe ───────────────────────────────────────────────────────
    //
    // Three paths:
    //   A) Streaming was active → stop forwarder, send remaining samples,
    //      call handle.finish() to get transcript (~200-500ms).
    //   B) GCP configured but streaming failed at start → batch fallback
    //      via gcp::transcribe (old path, slow but reliable).
    //   C) GCP not configured → fake_transcribe (setup hint).

    let (transcript, used_fake) = if let Some(handle) = streaming_handle {
        // PATH A: Streaming was active. Fast finish.
        let finish_start = std::time::Instant::now();
        tracing::info!("streaming: finishing session (fast path)");

        // 1. Wait for the chunk forwarder to stop (it checks `running`).
        //    Timeout tightened from 500 → 150 ms: the forwarder
        //    ticks at 100 ms intervals, so worst-case it sees
        //    `running=false` within ~100 ms plus one final send.
        //    500 ms was leaving 300-400 ms of dead time on every
        //    release — the visible "streaming is slow" symptom
        //    in activeContext.md bug 2.
        if let Some(forwarder) = chunk_forwarder {
            let join_start = std::time::Instant::now();
            let joined = tokio::time::timeout(Duration::from_millis(150), forwarder).await;
            tracing::info!(
                "streaming: forwarder joined in {}ms (ok={})",
                join_start.elapsed().as_millis(),
                joined.is_ok()
            );
        }

        // 2. Send any remaining un-forwarded samples as a final chunk.
        {
            let already_sent = sent_count.load(Ordering::Relaxed);
            let remaining: Vec<f32> = {
                match samples.lock() {
                    Ok(g) => g.iter().skip(already_sent).copied().collect(),
                    Err(_) => Vec::new(),
                }
            };
            if !remaining.is_empty() {
                let resampled = if sample_rate as usize == gcp::chirp::TARGET_SR {
                    remaining
                } else {
                    gcp::chirp::resample_to_16k(&remaining, sample_rate as usize)
                };
                let pcm_bytes = gcp::chirp::f32_to_pcm16_bytes(&resampled);
                if !pcm_bytes.is_empty() {
                    if let Err(e) = handle.send_audio(pcm_bytes).await {
                        tracing::warn!("streaming: failed to send final chunk: {e:?}");
                    }
                }
            }
        }

        // 3. Half-close and collect the final transcript.
        match handle.finish().await {
            Ok(t) => {
                tracing::info!(
                    "streaming: finish() returned transcript in {}ms total",
                    finish_start.elapsed().as_millis()
                );
                (t, false)
            }
            Err(e) => {
                let full = format_error_chain(&e);
                tracing::error!("streaming finish failed: {full}");
                // Fall back to batch transcribe as a last resort.
                //
                // If the streaming failure mentions "not found" AND we had
                // a non-empty dictionary, Chirp 3 rejected speech-adaptation
                // for this request. Docs claim adaptation is GA in both
                // `us` and `eu` but Google's own examples only ever show
                // the `us` region; in practice EU returns NOT_FOUND for
                // inline phrase sets on some projects. Drop the adaptation
                // on the retry so the user still gets their transcript.
                let streaming_was_not_found = full.to_lowercase().contains("not found")
                    || full.to_lowercase().contains("requested entity");
                let batch_adaptation_for_this_attempt: Vec<String> = if streaming_was_not_found
                    && !adaptation_phrases_batch.is_empty()
                {
                    tracing::warn!(
                            "streaming failure is NotFound — retrying batch without {} adaptation phrase(s)",
                            adaptation_phrases_batch.len()
                        );
                    Vec::new()
                } else {
                    adaptation_phrases_batch.clone()
                };
                tracing::info!("streaming: falling back to batch transcribe");
                let gcp_snapshot: Option<(GcpConfig, Authenticator)> = {
                    let state = app.state::<PopoState>();
                    let guard = state
                        .inner()
                        .gcp
                        .lock()
                        .expect("PopoState gcp mutex poisoned");
                    guard.as_ref().cloned()
                };
                match gcp_snapshot {
                    Some((ref config, ref auth)) => {
                        let language_codes =
                            resolve_language_codes(config, app.state::<PopoState>().inner());
                        let features =
                            resolve_recognition_features(app.state::<PopoState>().inner());
                        // Same per-app resolver as on_press.
                        let effective_prompt = resolve_effective_prompt(
                            app.state::<PopoState>().inner(),
                            app_name.as_deref(),
                            forced_mode_id.as_deref(),
                        )
                        .0;
                        let features_clone = features.clone();
                        match gcp::transcribe(
                            auth,
                            config,
                            &samples,
                            sample_rate,
                            &language_codes,
                            features,
                            &effective_prompt,
                            &batch_adaptation_for_this_attempt,
                        )
                        .await
                        {
                            Ok(t) => (t, false),
                            Err(e2) => {
                                let full2 = format_error_chain(&e2);
                                // If "invalid argument" and we had a custom prompt,
                                // retry without prompt (multi-lang + prompt incompatibility)
                                if full2.to_lowercase().contains("invalid argument")
                                    && !effective_prompt.is_empty()
                                {
                                    tracing::warn!("batch fallback: retrying without custom_prompt (multi-language + prompt may be incompatible)");
                                    match gcp::transcribe(
                                        auth,
                                        config,
                                        &samples,
                                        sample_rate,
                                        &language_codes,
                                        features_clone,
                                        "",
                                        &batch_adaptation_for_this_attempt,
                                    )
                                    .await
                                    {
                                        Ok(t) => (t, false),
                                        Err(e3) => {
                                            let full3 = format_error_chain(&e3);
                                            tracing::error!(
                                                "batch fallback (no prompt) also failed: {full3}"
                                            );
                                            let _ = app.emit(
                                                "pill:state:error",
                                                ErrorPayload::error("transcribe_failed", full3),
                                            );
                                            tokio::time::sleep(Duration::from_millis(2000)).await;
                                            let _ = app.emit("pill:state:sleep", ());
                                            return Ok(());
                                        }
                                    }
                                } else {
                                    tracing::error!("batch fallback also failed: {full2}");
                                    let _ = app.emit(
                                        "pill:state:error",
                                        ErrorPayload::error("transcribe_failed", full2),
                                    );
                                    tokio::time::sleep(Duration::from_millis(2000)).await;
                                    let _ = app.emit("pill:state:sleep", ());
                                    return Ok(());
                                }
                            }
                        }
                    }
                    None => {
                        // GCP config vanished between press and release — shouldn't
                        // happen, but surface the streaming error.
                        let _ = app.emit(
                            "pill:state:error",
                            ErrorPayload::error("transcribe_failed", full),
                        );
                        tokio::time::sleep(Duration::from_millis(2000)).await;
                        let _ = app.emit("pill:state:sleep", ());
                        return Ok(());
                    }
                }
            }
        }
    } else {
        // PATH B or C: No streaming handle. Use batch or fake.
        let gcp_snapshot: Option<(GcpConfig, Authenticator)> = {
            let state = app.state::<PopoState>();
            let guard = state
                .inner()
                .gcp
                .lock()
                .expect("PopoState gcp mutex poisoned");
            guard.as_ref().cloned()
        };

        match gcp_snapshot {
            Some((ref config, ref auth)) => {
                // PATH B: batch transcribe fallback.
                let language_codes =
                    resolve_language_codes(config, app.state::<PopoState>().inner());
                let features = resolve_recognition_features(app.state::<PopoState>().inner());
                // Same per-app resolver as on_press.
                let effective_prompt = resolve_effective_prompt(
                    app.state::<PopoState>().inner(),
                    app_name.as_deref(),
                    forced_mode_id.as_deref(),
                )
                .0;
                let features_clone = features.clone();
                let features_for_retry = features_clone.clone();
                match gcp::transcribe(
                    auth,
                    config,
                    &samples,
                    sample_rate,
                    &language_codes,
                    features,
                    &effective_prompt,
                    &adaptation_phrases_batch,
                )
                .await
                {
                    Ok(t) => (t, false),
                    Err(e) => {
                        let full = format_error_chain(&e);
                        // If the failure looks like speech-adaptation was
                        // rejected (NOT_FOUND / "Requested entity was not
                        // found") AND we actually had a dictionary, retry
                        // without adaptation. See the streaming-error
                        // branch above for why this happens on EU region.
                        if (full.to_lowercase().contains("not found")
                            || full.to_lowercase().contains("requested entity"))
                            && !adaptation_phrases_batch.is_empty()
                        {
                            tracing::warn!(
                                "batch: NotFound error with {} adaptation phrases — retrying without adaptation",
                                adaptation_phrases_batch.len()
                            );
                            match gcp::transcribe(
                                auth,
                                config,
                                &samples,
                                sample_rate,
                                &language_codes,
                                features_for_retry,
                                &effective_prompt,
                                &[],
                            )
                            .await
                            {
                                Ok(t) => (t, false),
                                Err(e_noadapt) => {
                                    let full_noadapt = format_error_chain(&e_noadapt);
                                    tracing::error!(
                                        "batch (no adaptation) also failed: {full_noadapt}"
                                    );
                                    let _ = app.emit(
                                        "pill:state:error",
                                        ErrorPayload::error("transcribe_failed", full_noadapt),
                                    );
                                    tokio::time::sleep(Duration::from_millis(2000)).await;
                                    let _ = app.emit("pill:state:sleep", ());
                                    return Ok(());
                                }
                            }
                        }
                        // If "invalid argument" and we had a custom prompt,
                        // retry without prompt (multi-lang + prompt incompatibility)
                        else if full.to_lowercase().contains("invalid argument")
                            && !effective_prompt.is_empty()
                        {
                            tracing::warn!("batch: retrying without custom_prompt (multi-language + prompt may be incompatible)");
                            match gcp::transcribe(
                                auth,
                                config,
                                &samples,
                                sample_rate,
                                &language_codes,
                                features_clone,
                                "",
                                &adaptation_phrases_batch,
                            )
                            .await
                            {
                                Ok(t) => (t, false),
                                Err(e2) => {
                                    let full2 = format_error_chain(&e2);
                                    tracing::error!("batch (no prompt) also failed: {full2}");
                                    let _ = app.emit(
                                        "pill:state:error",
                                        ErrorPayload::error("transcribe_failed", full2),
                                    );
                                    tokio::time::sleep(Duration::from_millis(2000)).await;
                                    let _ = app.emit("pill:state:sleep", ());
                                    return Ok(());
                                }
                            }
                        } else {
                            tracing::error!("GCP transcribe failed: {full}");
                            let _ = app.emit(
                                "pill:state:error",
                                ErrorPayload::error("transcribe_failed", full),
                            );
                            tokio::time::sleep(Duration::from_millis(2000)).await;
                            let _ = app.emit("pill:state:sleep", ());
                            return Ok(());
                        }
                    }
                }
            }
            None => {
                // PATH C: no GCP config.
                tracing::info!("no GCP config yet — using fake transcribe");
                (gcp::fake_transcribe(&samples).await, true)
            }
        }
    };

    // Chirp 3's `CustomPromptConfig.custom_prompt` (Session 29) now
    // handles mode-aware formatting during transcription. No separate
    // post-processing round-trip is needed — the transcript arriving
    // from Chirp is already formatted when Settings → Auto-format is
    // enabled.

    // ── Prompt-echo guard ───────────────────────────────────────────────────────────
    //
    // Second layer of defence against Chirp 3's prompt-echo
    // hallucination: even after the duration + amplitude guards above,
    // edge cases (e.g. half a second of a voiced consonant that didn't
    // quite parse) can still trigger the model to echo the prompt.
    //
    // Heuristic: take the transcript's first 30 lowercase chars and
    // see whether that substring appears anywhere inside the lowercase
    // custom_prompt. If it does, Chirp is echoing the prompt and we
    // discard the transcript rather than pasting it.
    //
    // This only runs when auto-format is on (non-empty prompt) and
    // when we actually hit GCP (not the fake path).
    if !effective_prompt_for_guard.is_empty() && !used_fake && !transcript.trim().is_empty() {
        let t_norm = transcript.to_lowercase();
        let p_norm = effective_prompt_for_guard.to_lowercase();
        let t_head: String = t_norm.chars().take(30).collect();
        // Require at least 12 chars to avoid false positives on short
        // real transcripts like "ok" or "hello there".
        if t_head.chars().count() >= 12 && p_norm.contains(&t_head) {
            tracing::warn!(
                "prompt-echo detected: transcript head {:?} found in custom_prompt — discarding",
                t_head
            );
            let _ = app.emit(
                "pill:state:error",
                ErrorPayload::info("no_speech", "No speech detected"),
            );
            tokio::time::sleep(Duration::from_millis(900)).await;
            let _ = app.emit("pill:state:sleep", ());
            return Ok(());
        }
    }

    // Phase 2 [7]: execute the canonical paste sequence.
    // Per docs/PASTE_MECHANICS.md §1, this handles:
    //   clipboard write → SetForegroundWindow → 50 ms dwell →
    //   enigo Ctrl+V → 100 ms dwell → restore clipboard,
    // with WM_PASTE fallback if the primary doesn't verify.

    // ── Gemini smart-cleanup (Session 34) ────────────────────────
    //
    // Chirp's custom_prompt is a STYLE biasing layer — it handles
    // tone / domain vocabulary / punctuation density but cannot do
    // semantic rewrites like "the speaker said sorry + re-stated,
    // keep only the correction". For that we need an LLM pass.
    //
    // When the user has `Settings.autoFormat = true` AND configured
    // a Gemini API key (free from ai.dev), we call Gemini 2.5
    // Flash-Lite with BASELINE_CORRECTION + the mode prompt as
    // system instruction, and the Chirp transcript as the user turn.
    // Gemini returns a polished transcript that Chirp's acoustic
    // layer alone couldn't produce.
    //
    // Fail-open: any Gemini error (timeout, network, blocked
    // content, API quota) falls back to the raw Chirp transcript
    // so the user still gets a paste. Logged for diagnosis.
    let transcript = {
        let st = app.state::<PopoState>();
        // Session 35: gate Gemini polish on auto_format_enabled
        // directly (not a separate smart_cleanup flag).
        let auto_on = st
            .inner()
            .auto_format_enabled
            .lock()
            .map(|g| *g)
            .unwrap_or(false);
        let api_key_present = st
            .inner()
            .gemini_api_key
            .lock()
            .map(|g| g.as_ref().map(|s| !s.trim().is_empty()).unwrap_or(false))
            .unwrap_or(false);
        let sys_prompt = effective_prompt_for_guard.clone();

        if auto_on
            && api_key_present
            && !used_fake
            && !transcript.trim().is_empty()
            && !sys_prompt.trim().is_empty()
        {
            // Snapshot the key out from under the lock before await.
            let api_key = st
                .inner()
                .gemini_api_key
                .lock()
                .ok()
                .and_then(|g| g.clone())
                .unwrap_or_default();

            // Reinforce the output contract so Gemini never prepends
            // "Here's the cleaned transcript:" or similar chatter.
            let gemini_system = format!(
                "{sys_prompt}\n\nOutput ONLY the cleaned transcript \
                 itself, as plain text. No preamble, no explanation, \
                 no quotes around the output."
            );

            match gcp::gemini::polish(&api_key, &gemini_system, &transcript).await {
                Ok(polished) => {
                    tracing::info!("gemini: smart-cleanup applied");
                    polished
                }
                Err(e) => {
                    tracing::warn!(
                        "gemini: smart-cleanup failed ({e:#}); pasting Chirp output raw"
                    );
                    transcript
                }
            }
        } else {
            // Smart cleanup not applicable — either the toggle is off,
            // the API key isn't set, we're on the fake-transcribe path,
            // or there's no prompt / transcript. Skip silently.
            transcript
        }
    };

    // Snippet expansion: replace any trigger words with their values
    // BEFORE the paste. Snippets were pushed from the frontend via
    // cmd_set_snippets and live in PopoState.snippets. This runs
    // locally, is O(text), and never hits the network.
    let snippets_snapshot: Vec<SnippetEntry> = {
        let st = app.state::<PopoState>();
        let guard = st.inner().snippets.lock();
        match guard {
            Ok(g) => g.clone(),
            Err(_) => Vec::new(),
        }
    };
    // `expansion_instances` is the per-session record of every
    // snippet expansion that fired — passed to the SessionPayload
    // so History can highlight the substituted spans.
    let mut expansion_instances: Vec<ExpansionInstance> = Vec::new();
    let transcript = if snippets_snapshot.is_empty() {
        transcript
    } else {
        let expansion = expand_snippets(&transcript, &snippets_snapshot);
        if !expansion.matched_ids.is_empty() {
            tracing::info!(
                "snippets: expanded {} trigger(s), {} occurrence(s): {:?}",
                expansion.matched_ids.len(),
                expansion.instances.len(),
                expansion.matched_ids
            );
            // Notify the frontend so it can bump usageCount on the
            // matched snippets. Non-blocking.
            let _ = app.emit("snippets:expanded", &expansion.matched_ids);
        }
        expansion_instances = expansion.instances;
        expansion.text
    };

    // Snapshot the paste-override list so execute() can dispatch to
    // a non-default keystroke for this foreground app if the user
    // has one configured (Feature 1).
    let paste_overrides_snapshot: Vec<PasteOverride> = {
        let st = app.state::<PopoState>();
        st.inner()
            .paste_overrides
            .lock()
            .map(|g| g.clone())
            .unwrap_or_default()
    };

    let restore_clip = app
        .state::<PopoState>()
        .inner()
        .restore_clipboard
        .lock()
        .map(|g| *g)
        .unwrap_or(true);
    let outcome = focus::paste::execute(focus::paste::PasteContext {
        text: transcript.clone(),
        target_hwnd: foreground_hwnd,
        prev_clipboard,
        restore_clipboard: restore_clip,
        target_app_name: app_name.clone(),
        paste_overrides: paste_overrides_snapshot,
    })
    .await;

    match outcome {
        focus::paste::PasteOutcome::Ok { method } => {
            tracing::info!("paste succeeded via {method:?}");

            // Sound: paste chime if the user has soundEffects on.
            // Uses the same mode's preset as the start ping so the
            // start + end tones feel coherent.
            let sound_on = app
                .state::<PopoState>()
                .inner()
                .sound_effects
                .lock()
                .map(|g| *g)
                .unwrap_or(true);
            if sound_on {
                let preset = resolve_sound_preset(
                    app.state::<PopoState>().inner(),
                    matched_mode_id.as_deref(),
                );
                let _ = app.emit(
                    "pill:sound",
                    serde_json::json!({ "kind": "paste", "preset": preset }),
                );
            }

            // Compute session metadata.
            let now_ms = unix_now_ms();
            let duration_ms = now_ms.saturating_sub(started_at_ms);
            let word_count = transcript.split_whitespace().count();
            // Chirp 3 pricing: $0.004 per 15-second increment (rounded up).
            // Matches the formula in the frontend's stats-compute.ts.
            let billed_increments = ((duration_ms as f64 / 15_000.0).ceil()) as u64;
            let cost = (billed_increments as f64 * 0.004 * 10000.0).round() / 10000.0;
            let lang = {
                let state = app.state::<PopoState>();
                let guard = state.inner().gcp.lock().ok();
                guard
                    .as_ref()
                    .and_then(|g| g.as_ref())
                    .map(|(c, _)| c.language_code.clone())
                    .unwrap_or_else(|| "en-US".into())
            };

            let session_id = uuid::Uuid::new_v4().to_string();

            // Optional raw-PCM retention — Settings → Privacy →
            // Store audio. On failure we log and carry on; the
            // session still gets created with no audio path.
            let audio_path: Option<String> = {
                let store = app
                    .state::<PopoState>()
                    .inner()
                    .store_audio
                    .lock()
                    .map(|g| *g)
                    .unwrap_or(false);
                if store {
                    match crate::audio::storage::save_session_wav(
                        app,
                        &session_id,
                        &pcm_snapshot, // use the pre-captured snapshot
                        sample_rate,
                    ) {
                        Ok(p) => Some(p),
                        Err(e) => {
                            tracing::error!("storeAudio write failed: {e:?}");
                            None
                        }
                    }
                } else {
                    None
                }
            };

            let _ = app.emit(
                "session:created",
                SessionPayload {
                    id: session_id,
                    created_at: started_at_ms,
                    duration_ms,
                    word_count,
                    language: if lang.is_empty() {
                        "en-US".into()
                    } else {
                        lang
                    },
                    raw_transcript: transcript.clone(),
                    gcp_cost_estimate: (cost * 10000.0).round() / 10000.0,
                    audio_storage_path: audio_path,
                    app_name: app_name.clone(),
                    app_icon: app_icon_b64.clone(),
                    expanded_snippets: expansion_instances.clone(),
                },
            );

            // Pill: success flash (brief §2: 300ms hold).
            let _ = app.emit("pill:state:success", ());
            tokio::time::sleep(Duration::from_millis(300)).await;
        }
        focus::paste::PasteOutcome::Failed { reason } => {
            tracing::warn!("paste failed, transcript stays on clipboard: {reason}");
            // Pill: error state (brief §2: 2s hold, border --accent-error).
            let _ = app.emit(
                "pill:state:error",
                ErrorPayload::error(
                    "paste_failed",
                    format!("Couldn't paste — Ctrl+V to try. {reason}"),
                ),
            );
            tokio::time::sleep(Duration::from_millis(2000)).await;
        }
    }

    // Pill: back to ambient sleep.
    let _ = app.emit("pill:state:sleep", ());

    // If we just ran the fake-transcribe path because GCP isn't
    // configured, surface a soft hint above the pill so the user
    // knows this wasn't a real transcription — the pasted string
    // already tells them where to go, and the tooltip reinforces it
    // with a 10s persistent reminder. severity="info" means the
    // pill keeps its sleep state + no Windows toast fires.
    if used_fake {
        let _ = app.emit(
            "pill:state:error",
            ErrorPayload::info("gcp_not_configured", gcp::GCP_SETUP_HINT),
        );
    }

    Ok(())
}
