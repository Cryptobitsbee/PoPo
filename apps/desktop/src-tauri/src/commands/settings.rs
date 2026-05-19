// commands/settings.rs — Settings-driven runtime reconfiguration.
//
// Phase D commands (Session 19):
//
//   - cmd_list_mics()          → Vec<MicDevice>
//     Enumerate every input device cpal can see on the current host.
//     The frontend Settings page populates its microphone dropdown
//     from this list on mount.
//
//   - cmd_set_mic(id)          → ()
//     Store the user's chosen device name in PopoState. None means
//     "follow system default". On the next recording, cpal opens the
//     device whose name matches this string; if no match is found,
//     we fall back to the default.
//
//   - cmd_set_hotkey(hotkey)   → ()
//     Parse the hotkey string (e.g. "Ctrl+Shift+Space"), unregister
//     the current shortcut, register the new one, and update
//     PopoState.current_hotkey so hotkey::is_popo_hotkey matches it.
//     Returns Err(String) if parsing fails; the frontend shows that
//     message and doesn't persist the invalid hotkey.
//
// All three commands are invoked by the frontend's
// `useApplySettingsToRust` hook (mounted in AppShell) whenever the
// settings store changes.

use cpal::traits::{DeviceTrait, HostTrait};
use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

use crate::hotkey::{PopoState, RecordingMode};

/// A single audio input device as reported by cpal. The frontend
/// uses `name` as BOTH the display label and the id we round-trip
/// back via `cmd_set_mic`.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MicDevice {
    /// The device name (cpal's identifier on Windows WASAPI).
    pub id: String,
    /// Human-readable label; currently identical to `id`.
    pub name: String,
    /// True if this is the current host's default input device.
    pub is_default: bool,
}

// ── cmd_list_mics ────────────────────────────────────────────────────

/// Enumerate all input devices cpal can see. First entry is always
/// a synthetic "System default" row with id = empty string; following
/// entries are real devices. Frontend maps empty-id to "default".
#[tauri::command]
pub fn cmd_list_mics() -> Result<Vec<MicDevice>, String> {
    let host = cpal::default_host();

    let default_name = host
        .default_input_device()
        .and_then(|d| d.name().ok())
        .unwrap_or_default();

    let devices = host
        .input_devices()
        .map_err(|e| format!("cpal::input_devices failed: {e}"))?;

    let mut out = vec![MicDevice {
        id: String::new(),
        name: "System default microphone".into(),
        is_default: true,
    }];

    for dev in devices {
        let name = dev.name().unwrap_or_else(|_| "<unknown>".into());
        let is_default = !default_name.is_empty() && name == default_name;
        out.push(MicDevice {
            id: name.clone(),
            name,
            is_default,
        });
    }

    Ok(out)
}

// ── cmd_set_mic ──────────────────────────────────────────────────────

/// Set the selected input device. Pass `None` (or an empty string
/// from the frontend) to follow the system default. Takes effect on
/// the NEXT recording — in-flight sessions are unaffected.
#[tauri::command]
pub fn cmd_set_mic(state: State<'_, PopoState>, id: Option<String>) -> Result<(), String> {
    let normalized = id.and_then(|s| {
        let t = s.trim().to_string();
        if t.is_empty() {
            None
        } else {
            Some(t)
        }
    });

    let mut slot = state
        .inner()
        .selected_mic_id
        .lock()
        .map_err(|_| "PopoState mic mutex poisoned".to_string())?;
    *slot = normalized.clone();
    tracing::info!(
        "cmd_set_mic: selected mic = {}",
        normalized.as_deref().unwrap_or("<system default>")
    );
    Ok(())
}

// ── cmd_set_hotkey ───────────────────────────────────────────────────

/// Reconfigure the push-to-talk hotkey at runtime.
///
/// Flow:
///   1. Parse `hotkey` into a `Shortcut`. Return Err on parse failure
///      so the frontend can keep the old value visible and show the
///      error inline.
///   2. If the new shortcut equals the current one, no-op.
///   3. Unregister the old shortcut from the global-shortcut manager.
///   4. Register the new one.
///   5. Swap both in PopoState so `hotkey::is_popo_hotkey` matches.
///
/// The global-shortcut plugin's `.unregister(...)` is idempotent and
/// safe even if the hotkey isn't registered (first-time boot). We
/// don't special-case that.
#[tauri::command]
pub fn cmd_set_hotkey(
    app: AppHandle,
    state: State<'_, PopoState>,
    hotkey: String,
) -> Result<(), String> {
    let new_shortcut = parse_shortcut(&hotkey)?;

    let mut current = state
        .inner()
        .current_hotkey
        .lock()
        .map_err(|_| "PopoState hotkey mutex poisoned".to_string())?;
    let mut current_str = state
        .inner()
        .current_hotkey_str
        .lock()
        .map_err(|_| "PopoState hotkey-string mutex poisoned".to_string())?;

    if *current == new_shortcut {
        // Same as what's already registered; nothing to do. Still
        // refresh the canonical string in case the user typed a
        // different representation of the same combo (e.g. "CTRL+A"
        // vs "Ctrl+A").
        *current_str = hotkey;
        return Ok(());
    }

    let gs = app.global_shortcut();

    // Unregister old first so we can't end up with two hotkeys
    // competing. If this errors (e.g. wasn't registered), log + ignore.
    if let Err(e) = gs.unregister(*current) {
        tracing::warn!("unregister previous hotkey failed (ignored): {e}");
    }

    // Register new. If this fails, try to restore the old binding so
    // the user isn't left with no hotkey at all.
    if let Err(e) = gs.register(new_shortcut) {
        let msg = format!("failed to register hotkey {hotkey:?}: {e}");
        tracing::error!("{msg}");
        if let Err(e2) = gs.register(*current) {
            tracing::error!("could not re-register previous hotkey: {e2}");
        }
        return Err(msg);
    }

    tracing::info!("cmd_set_hotkey: {} → {}", *current_str, hotkey);
    *current = new_shortcut;
    *current_str = hotkey;
    Ok(())
}

// ── cmd_get_current_hotkey ───────────────────────────────────────────

/// Return the currently-registered hotkey string. Frontend reads this
/// on boot so the Settings UI reflects what Rust actually has bound
/// (rather than trusting localStorage, which may disagree after a
/// failed set).
#[tauri::command]
pub fn cmd_get_current_hotkey(state: State<'_, PopoState>) -> Result<String, String> {
    let s = state
        .inner()
        .current_hotkey_str
        .lock()
        .map_err(|_| "PopoState hotkey-string mutex poisoned".to_string())?;
    Ok(s.clone())
}

// ── cmd_set_recording_mode ──────────────────────────────

/// Store the recording mode. Accepts "push-to-talk" or "toggle".
/// Any in-flight recording is unaffected; the new mode applies to
/// the next hotkey press.
#[tauri::command]
pub fn cmd_set_recording_mode(state: State<'_, PopoState>, mode: String) -> Result<(), String> {
    let parsed =
        RecordingMode::parse(&mode).ok_or_else(|| format!("unknown recording mode: {mode:?}"))?;
    let mut slot = state
        .inner()
        .recording_mode
        .lock()
        .map_err(|_| "PopoState recording_mode mutex poisoned".to_string())?;
    *slot = parsed;
    tracing::info!("cmd_set_recording_mode: {mode}");
    Ok(())
}

// ── cmd_set_restore_clipboard ─────────────────────────────

/// Toggle whether paste.rs restores the previous clipboard.
#[tauri::command]
pub fn cmd_set_restore_clipboard(state: State<'_, PopoState>, enabled: bool) -> Result<(), String> {
    let mut slot = state
        .inner()
        .restore_clipboard
        .lock()
        .map_err(|_| "PopoState restore_clipboard mutex poisoned".to_string())?;
    *slot = enabled;
    tracing::info!("cmd_set_restore_clipboard: {enabled}");
    Ok(())
}

// ── cmd_set_silence_detection ─────────────────────────────

/// Store the silence-auto-stop threshold in seconds. 0 disables.
/// Applies in Toggle mode only; ignored in push-to-talk.
#[tauri::command]
pub fn cmd_set_silence_detection(state: State<'_, PopoState>, seconds: u32) -> Result<(), String> {
    let mut slot = state
        .inner()
        .silence_detection_seconds
        .lock()
        .map_err(|_| "PopoState silence mutex poisoned".to_string())?;
    *slot = seconds;
    tracing::info!("cmd_set_silence_detection: {seconds}s");
    Ok(())
}

// ── cmd_set_store_audio ──────────────────────────────────

/// Toggle whether the post-dictation pipeline writes the raw PCM to
/// `%APPDATA%\\popo\\audio\\{id}.wav`.
#[tauri::command]
pub fn cmd_set_store_audio(state: State<'_, PopoState>, enabled: bool) -> Result<(), String> {
    let mut slot = state
        .inner()
        .store_audio
        .lock()
        .map_err(|_| "PopoState store_audio mutex poisoned".to_string())?;
    *slot = enabled;
    tracing::info!("cmd_set_store_audio: {enabled}");
    Ok(())
}

// ── cmd_set_sound_effects ────────────────────────────────

/// Toggle whether Rust emits `pill:sound:*` events that the pill
/// window plays via Web Audio API tones.
#[tauri::command]
pub fn cmd_set_sound_effects(state: State<'_, PopoState>, enabled: bool) -> Result<(), String> {
    let mut slot = state
        .inner()
        .sound_effects
        .lock()
        .map_err(|_| "PopoState sound_effects mutex poisoned".to_string())?;
    *slot = enabled;
    tracing::info!("cmd_set_sound_effects: {enabled}");
    Ok(())
}

// ── cmd_set_start_at_login ─────────────────────────────

/// Enable or disable autostart at login via tauri-plugin-autostart.
/// On Windows this writes / removes the HKCU\\Software\\Microsoft\\
/// Windows\\CurrentVersion\\Run entry.
#[tauri::command]
pub async fn cmd_set_start_at_login(app: AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let mgr = app.autolaunch();
    let result = if enabled { mgr.enable() } else { mgr.disable() };
    match result {
        Ok(()) => {
            tracing::info!("cmd_set_start_at_login: {enabled}");
            Ok(())
        }
        Err(e) => {
            let msg = format!("autostart update failed: {e}");
            tracing::error!("{msg}");
            Err(msg)
        }
    }
}

// ── Phase C: Chirp 3 feature-flag commands ─────────────────────

/// Toggle Chirp 3's spoken-punctuation feature ("say 'comma' → ,").
#[tauri::command]
pub fn cmd_set_spoken_punctuation(
    state: State<'_, PopoState>,
    enabled: bool,
) -> Result<(), String> {
    let mut slot = state
        .inner()
        .spoken_punctuation
        .lock()
        .map_err(|_| "PopoState spoken_punctuation mutex poisoned".to_string())?;
    *slot = enabled;
    tracing::info!("cmd_set_spoken_punctuation: {enabled}");
    Ok(())
}

/// Toggle Chirp 3's spoken-emoji feature ("say 'smiling emoji' → 😊").
#[tauri::command]
pub fn cmd_set_spoken_emojis(state: State<'_, PopoState>, enabled: bool) -> Result<(), String> {
    let mut slot = state
        .inner()
        .spoken_emojis
        .lock()
        .map_err(|_| "PopoState spoken_emojis mutex poisoned".to_string())?;
    *slot = enabled;
    tracing::info!("cmd_set_spoken_emojis: {enabled}");
    Ok(())
}

/// Toggle Chirp 3's profanity filter (masks profane words with asterisks).
#[tauri::command]
pub fn cmd_set_profanity_filter(state: State<'_, PopoState>, enabled: bool) -> Result<(), String> {
    let mut slot = state
        .inner()
        .profanity_filter
        .lock()
        .map_err(|_| "PopoState profanity_filter mutex poisoned".to_string())?;
    *slot = enabled;
    tracing::info!("cmd_set_profanity_filter: {enabled}");
    Ok(())
}

/// Set the Chirp 3 endpointing sensitivity. Accepts "low" / "standard"
/// / "high" as strings; unknown values default to "standard".
///
/// **Limitation:** the `googleapis-tonic-google-cloud-speech-v2` crate
/// version in use (v0.34) only supports the `Standard` variant on
/// the enum. Non-standard values are stored in PopoState for forward
/// compatibility but `resolve_endpointing_sensitivity` currently
/// returns Standard unconditionally. When the proto crate ships LOW /
/// HIGH, the resolver can be re-enabled without frontend changes.
#[tauri::command]
pub fn cmd_set_endpointing_sensitivity(
    state: State<'_, PopoState>,
    sensitivity: String,
) -> Result<(), String> {
    let normalized = match sensitivity.to_lowercase().trim() {
        "low" => "low",
        "high" => "high",
        _ => "standard",
    }
    .to_string();
    let mut slot = state
        .inner()
        .endpointing_sensitivity
        .lock()
        .map_err(|_| "PopoState endpointing mutex poisoned".to_string())?;
    tracing::info!("cmd_set_endpointing_sensitivity: {normalized}");
    *slot = normalized;
    Ok(())
}

/// Set the multi-language code list for Chirp 3 code-switching.
/// Empty list → fall back to `GcpConfig.language_code` in the hotkey
/// press path. Non-empty → Chirp detects + switches between them.
#[tauri::command]
pub fn cmd_set_multi_language_codes(
    state: State<'_, PopoState>,
    codes: Vec<String>,
) -> Result<(), String> {
    // Normalize: drop empty strings + trim each code.
    let cleaned: Vec<String> = codes
        .into_iter()
        .map(|c| c.trim().to_string())
        .filter(|c| !c.is_empty() && !c.eq_ignore_ascii_case("auto"))
        .collect();

    let mut slot = state
        .inner()
        .multi_language_codes
        .lock()
        .map_err(|_| "PopoState multi_language_codes mutex poisoned".to_string())?;
    tracing::info!("cmd_set_multi_language_codes: {cleaned:?}");
    *slot = cleaned;
    Ok(())
}

// ── Phase D: Gemini auto-format commands ───────────────────────

/// Toggle Gemini Flash post-processing (Settings → Auto-format with AI).
/// When enabled, every successful Chirp transcript is passed through
/// `gcp::gemini::polish` with the current `auto_format_prompt`.
#[tauri::command]
pub fn cmd_set_auto_format(state: State<'_, PopoState>, enabled: bool) -> Result<(), String> {
    let mut slot = state
        .inner()
        .auto_format_enabled
        .lock()
        .map_err(|_| "PopoState auto_format_enabled mutex poisoned".to_string())?;
    *slot = enabled;
    tracing::info!("cmd_set_auto_format: {enabled}");
    Ok(())
}

/// Set the Gemini system prompt. The frontend resolves
/// `modes[defaultModeId].systemPrompt` and pushes it here whenever
/// the default mode changes or its prompt edits land.
#[tauri::command]
pub fn cmd_set_auto_format_prompt(
    state: State<'_, PopoState>,
    prompt: String,
) -> Result<(), String> {
    let mut slot = state
        .inner()
        .auto_format_prompt
        .lock()
        .map_err(|_| "PopoState auto_format_prompt mutex poisoned".to_string())?;
    let trimmed = prompt.trim();
    tracing::info!(
        "cmd_set_auto_format_prompt: {} chars (preview: {:?})",
        trimmed.len(),
        trimmed.chars().take(60).collect::<String>()
    );
    *slot = trimmed.to_string();
    Ok(())
}

/// Replace the active snippet list. Called by the frontend via
/// `useApplySettingsToRust` whenever snippetsStore changes.
///
/// Called with empty-trigger / empty-value entries filtered out
/// because a "blank" snippet would never match and is just noise
/// in the expansion pass.
#[tauri::command]
pub fn cmd_set_snippets(
    state: State<'_, PopoState>,
    snippets: Vec<crate::hotkey::SnippetEntry>,
) -> Result<(), String> {
    let cleaned: Vec<_> = snippets
        .into_iter()
        .filter(|s| !s.trigger.trim().is_empty() && !s.value.is_empty())
        .collect();
    let mut slot = state
        .inner()
        .snippets
        .lock()
        .map_err(|_| "PopoState snippets mutex poisoned".to_string())?;
    tracing::info!("cmd_set_snippets: {} entries", cleaned.len());
    *slot = cleaned;
    Ok(())
}

/// Replace the active dictionary phrase list. Called by the frontend
/// via `useApplySettingsToRust` whenever dictionaryStore changes.
///
/// Chirp 3 allows up to 1000 phrases per request. We don't enforce
/// that here — if a future user has that many, Google's error
/// message will be clearer than any guard we could write.
#[tauri::command]
pub fn cmd_set_dictionary(state: State<'_, PopoState>, phrases: Vec<String>) -> Result<(), String> {
    let cleaned: Vec<String> = phrases
        .into_iter()
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .collect();
    let mut slot = state
        .inner()
        .dictionary
        .lock()
        .map_err(|_| "PopoState dictionary mutex poisoned".to_string())?;
    tracing::info!("cmd_set_dictionary: {} phrases", cleaned.len());
    *slot = cleaned;
    Ok(())
}

// ── Per-mode app bindings + per-app paste overrides ────────────────

/// Replace the full mode-bindings list.
///
/// Called by the frontend whenever `modesStore` changes (mode added,
/// edited, deleted, or `apps` binding updated) or when
/// `defaultModeId` flips. The list Rust receives is the modes array
/// trimmed down to just the fields the press-time resolver needs:
/// id / name / system_prompt / apps / is_default / hotkey /
/// sound_preset.
///
/// At press time `resolve_effective_prompt` walks this list with the
/// foreground app's friendly name and returns the first matching
/// mode's prompt (or falls through to the default / legacy prompt).
///
/// Per-mode hotkeys are also (re-)registered here: every binding
/// with a non-empty `hotkey` field is parsed + registered on the
/// global-shortcut manager. Old per-mode shortcuts are unregistered
/// first so the set is always fresh. Primary-hotkey conflicts
/// (mode hotkey == Settings.hotkey) and in-list duplicates are
/// detected + logged + skipped (the mode still works via app/default
/// resolution; its hotkey just doesn't fire).
#[tauri::command]
pub fn cmd_set_mode_bindings(
    app: AppHandle,
    state: State<'_, PopoState>,
    bindings: Vec<crate::hotkey::ModeBinding>,
) -> Result<(), String> {
    // Store the full list first so any hotkey that DOES fire can
    // look up its mode id immediately.
    {
        let mut slot = state
            .inner()
            .mode_bindings
            .lock()
            .map_err(|_| "PopoState mode_bindings mutex poisoned".to_string())?;
        let default_count = bindings.iter().filter(|b| b.is_default).count();
        let apps_count: usize = bindings.iter().map(|b| b.apps.len()).sum();
        let hotkey_count = bindings
            .iter()
            .filter(|b| !b.hotkey.trim().is_empty())
            .count();
        tracing::info!(
            "cmd_set_mode_bindings: {} mode(s), {} default, {} total app bindings, {} per-mode hotkey(s)",
            bindings.len(),
            default_count,
            apps_count,
            hotkey_count
        );
        *slot = bindings.clone();
    }

    // Rebuild the per-mode hotkey registration set.
    let gs = app.global_shortcut();
    let primary = state.inner().current_hotkey.lock().map(|g| *g).ok();

    // 1. Unregister anything we previously registered.
    {
        let old_list: Vec<Shortcut> = state
            .inner()
            .mode_hotkeys
            .lock()
            .map(|g| g.iter().map(|(s, _)| *s).collect())
            .unwrap_or_default();
        for s in old_list {
            if let Err(e) = gs.unregister(s) {
                tracing::debug!("unregister per-mode hotkey (ignored): {e}");
            }
        }
    }

    // 2. Parse + register the new set. Track successfully-registered
    //    (shortcut, mode_id) pairs so classify_hotkey can route events
    //    back to the correct mode.
    let mut registered: Vec<(Shortcut, String)> = Vec::new();
    let mut seen_in_set: Vec<Shortcut> = Vec::new();
    for b in bindings.iter() {
        let trimmed = b.hotkey.trim();
        if trimmed.is_empty() {
            continue;
        }
        let shortcut = match parse_shortcut(trimmed) {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!(
                    "mode {:?} has invalid hotkey {:?}: {e}; skipping",
                    b.name,
                    trimmed
                );
                continue;
            }
        };
        // Conflict: matches the primary push-to-talk hotkey.
        if primary.as_ref().map(|p| *p == shortcut).unwrap_or(false) {
            tracing::warn!(
                "mode {:?} hotkey {:?} conflicts with primary push-to-talk; skipping",
                b.name,
                trimmed
            );
            continue;
        }
        // Conflict: duplicate within this mode-bindings batch.
        if seen_in_set.iter().any(|s| *s == shortcut) {
            tracing::warn!(
                "mode {:?} hotkey {:?} duplicates another mode's hotkey; skipping",
                b.name,
                trimmed
            );
            continue;
        }
        match gs.register(shortcut) {
            Ok(()) => {
                tracing::info!(
                    "registered per-mode hotkey {:?} → mode {:?}",
                    trimmed,
                    b.name
                );
                registered.push((shortcut, b.id.clone()));
                seen_in_set.push(shortcut);
            }
            Err(e) => {
                tracing::warn!(
                    "failed to register per-mode hotkey {:?} for mode {:?}: {e}",
                    trimmed,
                    b.name
                );
            }
        }
    }

    // 3. Store the registered set back into PopoState.
    {
        let mut slot = state
            .inner()
            .mode_hotkeys
            .lock()
            .map_err(|_| "PopoState mode_hotkeys mutex poisoned".to_string())?;
        *slot = registered;
    }

    Ok(())
}

// ── Gemini commands (Session 34, simplified Session 35) ─────────
// Session 35 removed `cmd_set_smart_cleanup`. Gemini polish gates on
// `auto_format_enabled` directly:
//   autoFormat = true  + key set  → Gemini polish + Chirp prompt
//   autoFormat = true  + no key   → Chirp prompt only (legacy)
//   autoFormat = false             → raw Chirp

/// Set the Gemini API key used by smart-cleanup. `None` / empty
/// string clears it (and smart-cleanup then silently no-ops on the
/// next dictation, falling through to Chirp raw).
#[tauri::command]
pub fn cmd_set_gemini_api_key(
    state: State<'_, PopoState>,
    key: Option<String>,
) -> Result<(), String> {
    let normalized = key.and_then(|s| {
        let t = s.trim().to_string();
        if t.is_empty() {
            None
        } else {
            Some(t)
        }
    });
    let mut slot = state
        .inner()
        .gemini_api_key
        .lock()
        .map_err(|_| "PopoState gemini_api_key mutex poisoned".to_string())?;
    tracing::info!(
        "cmd_set_gemini_api_key: {}",
        if normalized.is_some() {
            "<key set>"
        } else {
            "<cleared>"
        }
    );
    *slot = normalized;
    Ok(())
}

/// Replace the full per-app paste override list (Feature 1).
///
/// Called by the frontend whenever Settings → Paste → App-specific
/// shortcuts changes. Consumed by `focus::paste::execute` which
/// matches the target app's friendly name against these entries
/// and sends the configured keystroke instead of Ctrl+V.
///
/// Empty-keystroke or empty-appName entries are filtered out (they'd
/// never match anything useful).
#[tauri::command]
pub fn cmd_set_paste_overrides(
    state: State<'_, PopoState>,
    overrides: Vec<crate::hotkey::PasteOverride>,
) -> Result<(), String> {
    let cleaned: Vec<_> = overrides
        .into_iter()
        .filter(|o| !o.app_name.trim().is_empty() && !o.keystroke.trim().is_empty())
        .collect();
    let mut slot = state
        .inner()
        .paste_overrides
        .lock()
        .map_err(|_| "PopoState paste_overrides mutex poisoned".to_string())?;
    tracing::info!("cmd_set_paste_overrides: {} entries", cleaned.len());
    *slot = cleaned;
    Ok(())
}

// ── Hotkey string parsing ────────────────────────────────────────────

/// Parse a human-friendly hotkey string into a `Shortcut`.
///
/// Accepted formats (case-insensitive):
///   - Modifiers: Ctrl / Control / Cmd / Command / CmdOrCtrl /
///                CommandOrControl / Shift / Alt / Option / Super /
///                Meta / Win / Windows
///   - Keys:      A-Z, 0-9, F1-F24, Space, Enter, Return, Tab,
///                Escape / Esc, Backspace, Delete, Insert, Home,
///                End, PageUp, PageDown, Up, Down, Left, Right,
///                and common punctuation names (Comma, Period, …).
///
/// Returns Err(String) on any unrecognized token. The caller
/// surfaces this verbatim to the user.
pub fn parse_shortcut(s: &str) -> Result<Shortcut, String> {
    let parts: Vec<&str> = s
        .split('+')
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .collect();

    if parts.is_empty() {
        return Err("empty hotkey".into());
    }

    // Last token is the key; everything before is modifiers.
    let (key_tok, mod_toks) = parts.split_last().unwrap();

    let mut modifiers = Modifiers::empty();
    for m in mod_toks {
        let flag = match m.to_ascii_lowercase().as_str() {
            "ctrl" | "control" | "cmdorctrl" | "commandorcontrol" => Modifiers::CONTROL,
            "shift" => Modifiers::SHIFT,
            "alt" | "option" => Modifiers::ALT,
            "super" | "cmd" | "command" | "meta" | "win" | "windows" => Modifiers::SUPER,
            _ => return Err(format!("unknown modifier: {}", m)),
        };
        if modifiers.contains(flag) {
            return Err(format!("modifier {} repeated", m));
        }
        modifiers |= flag;
    }

    let code = parse_key_code(key_tok)?;

    let mods_opt = if modifiers.is_empty() {
        None
    } else {
        Some(modifiers)
    };
    Ok(Shortcut::new(mods_opt, code))
}

fn parse_key_code(s: &str) -> Result<Code, String> {
    // Single-char keys first: letters A-Z and digits 0-9.
    if s.len() == 1 {
        let c = s.chars().next().unwrap().to_ascii_uppercase();
        if c.is_ascii_alphabetic() {
            return Ok(letter_to_code(c));
        }
        if c.is_ascii_digit() {
            return Ok(digit_to_code(c));
        }
    }

    // Named keys.
    match s.to_ascii_lowercase().as_str() {
        "space" => Ok(Code::Space),
        "enter" | "return" => Ok(Code::Enter),
        "tab" => Ok(Code::Tab),
        "escape" | "esc" => Ok(Code::Escape),
        "backspace" => Ok(Code::Backspace),
        "delete" | "del" => Ok(Code::Delete),
        "insert" | "ins" => Ok(Code::Insert),
        "home" => Ok(Code::Home),
        "end" => Ok(Code::End),
        "pageup" | "page_up" | "pgup" => Ok(Code::PageUp),
        "pagedown" | "page_down" | "pgdn" => Ok(Code::PageDown),
        "arrowup" | "up" => Ok(Code::ArrowUp),
        "arrowdown" | "down" => Ok(Code::ArrowDown),
        "arrowleft" | "left" => Ok(Code::ArrowLeft),
        "arrowright" | "right" => Ok(Code::ArrowRight),
        "comma" => Ok(Code::Comma),
        "period" | "dot" => Ok(Code::Period),
        "slash" => Ok(Code::Slash),
        "backslash" => Ok(Code::Backslash),
        "semicolon" => Ok(Code::Semicolon),
        "quote" => Ok(Code::Quote),
        "minus" | "dash" => Ok(Code::Minus),
        "equal" | "equals" => Ok(Code::Equal),
        "bracketleft" | "openbracket" => Ok(Code::BracketLeft),
        "bracketright" | "closebracket" => Ok(Code::BracketRight),
        "backquote" | "backtick" | "grave" => Ok(Code::Backquote),
        other => {
            // F1..F24
            if let Some(rest) = other.strip_prefix('f') {
                if let Ok(n) = rest.parse::<u8>() {
                    return match n {
                        1 => Ok(Code::F1),
                        2 => Ok(Code::F2),
                        3 => Ok(Code::F3),
                        4 => Ok(Code::F4),
                        5 => Ok(Code::F5),
                        6 => Ok(Code::F6),
                        7 => Ok(Code::F7),
                        8 => Ok(Code::F8),
                        9 => Ok(Code::F9),
                        10 => Ok(Code::F10),
                        11 => Ok(Code::F11),
                        12 => Ok(Code::F12),
                        _ => Err(format!("F{n} not supported; use F1..F12")),
                    };
                }
            }
            Err(format!("unknown key: {s}"))
        }
    }
}

fn letter_to_code(c: char) -> Code {
    match c {
        'A' => Code::KeyA,
        'B' => Code::KeyB,
        'C' => Code::KeyC,
        'D' => Code::KeyD,
        'E' => Code::KeyE,
        'F' => Code::KeyF,
        'G' => Code::KeyG,
        'H' => Code::KeyH,
        'I' => Code::KeyI,
        'J' => Code::KeyJ,
        'K' => Code::KeyK,
        'L' => Code::KeyL,
        'M' => Code::KeyM,
        'N' => Code::KeyN,
        'O' => Code::KeyO,
        'P' => Code::KeyP,
        'Q' => Code::KeyQ,
        'R' => Code::KeyR,
        'S' => Code::KeyS,
        'T' => Code::KeyT,
        'U' => Code::KeyU,
        'V' => Code::KeyV,
        'W' => Code::KeyW,
        'X' => Code::KeyX,
        'Y' => Code::KeyY,
        'Z' => Code::KeyZ,
        _ => Code::Space, // unreachable: guarded by is_ascii_alphabetic
    }
}

fn digit_to_code(c: char) -> Code {
    match c {
        '0' => Code::Digit0,
        '1' => Code::Digit1,
        '2' => Code::Digit2,
        '3' => Code::Digit3,
        '4' => Code::Digit4,
        '5' => Code::Digit5,
        '6' => Code::Digit6,
        '7' => Code::Digit7,
        '8' => Code::Digit8,
        '9' => Code::Digit9,
        _ => Code::Space, // unreachable
    }
}
