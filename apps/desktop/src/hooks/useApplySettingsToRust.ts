import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "../store/settingsStore";
import { useModesStore } from "../store/modesStore";
import { useSnippetsStore } from "../store/snippetsStore";
import { useDictionaryStore } from "../store/dictionaryStore";

/**
 * useApplySettingsToRust — one-way push of Settings → Rust PopoState.
 *
 * Mounted once in AppShell. Rust keeps runtime flags in `PopoState`,
 * but the canonical source of truth is `settingsStore` on the
 * frontend (backed by localStorage and synced to Firestore).
 *
 * Every relevant field gets its own debounced effect so only the
 * field that changed round-trips to Rust. 300 ms debounce prevents
 * register/unregister storms when the user is still typing / dragging.
 *
 * Fields pushed to Rust:
 *   - hotkey                   → cmd_set_hotkey
 *   - micDeviceId              → cmd_set_mic
 *   - recordingMode            → cmd_set_recording_mode
 *   - silenceDetectionSeconds  → cmd_set_silence_detection
 *   - restoreClipboard         → cmd_set_restore_clipboard
 *   - storeAudio               → cmd_set_store_audio
 *   - soundEffects             → cmd_set_sound_effects
 *   - startAtLogin             → cmd_set_start_at_login
 *
 *   ─ Phase C (Chirp 3 feature flags) ─
 *   - spokenPunctuation        → cmd_set_spoken_punctuation
 *   - spokenEmojis             → cmd_set_spoken_emojis
 *   - profanityFilter          → cmd_set_profanity_filter
 *   - multiLanguageCodes       → cmd_set_multi_language_codes
 *
 *   ─ Phase D (Gemini Flash) ─
 *   - autoFormat               → cmd_set_auto_format
 *   - [defaultModeId + modes]  → cmd_set_auto_format_prompt
 *     (resolved: the selected mode's systemPrompt; pushed whenever
 *      either the default mode changes or its prompt is edited)
 *
 * Fields NOT pushed (front-end only):
 *   - language          → SettingsPage calls cmd_update_language directly
 *   - defaultModeId     → consumed via the modes lookup for Gemini above
 *   - privacyMode       → gates Firestore writes in useSessionSave
 *
 * Guarded by `isTauriContext()` so plain Vite preview doesn't error
 * on `invoke` calls. Errors from Rust (e.g. unparseable hotkey) are
 * logged via `console.warn`; they're surfaced in the UI by whatever
 * component originally invoked the setting (see SettingsPage).
 */
export function useApplySettingsToRust() {
  const hotkey = useSettingsStore((s) => s.settings.hotkey);
  const micDeviceId = useSettingsStore((s) => s.settings.micDeviceId);
  const recordingMode = useSettingsStore((s) => s.settings.recordingMode);
  const silenceDetectionSeconds = useSettingsStore(
    (s) => s.settings.silenceDetectionSeconds,
  );
  const restoreClipboard = useSettingsStore((s) => s.settings.restoreClipboard);
  const storeAudio = useSettingsStore((s) => s.settings.storeAudio);
  const soundEffects = useSettingsStore((s) => s.settings.soundEffects);
  const startAtLogin = useSettingsStore((s) => s.settings.startAtLogin);

  // Phase C
  const spokenPunctuation = useSettingsStore(
    (s) => s.settings.spokenPunctuation,
  );
  const spokenEmojis = useSettingsStore((s) => s.settings.spokenEmojis);
  const profanityFilter = useSettingsStore((s) => s.settings.profanityFilter);
  const multiLanguageCodes = useSettingsStore(
    (s) => s.settings.multiLanguageCodes,
  );

  // Phase D
  const autoFormat = useSettingsStore((s) => s.settings.autoFormat);
  const defaultModeId = useSettingsStore((s) => s.settings.defaultModeId);
  const modes = useModesStore((s) => s.modes);
  // Resolve the default mode's systemPrompt. When no match (modes
  // still hydrating, or defaultModeId points at a deleted mode),
  // pass an empty string — Rust treats that as "fall back to raw".
  const autoFormatPrompt =
    modes.find((m) => m.id === defaultModeId)?.systemPrompt ?? "";

  // Snippets + Dictionary
  const snippets = useSnippetsStore((s) => s.snippets);
  const dictionaryEntries = useDictionaryStore((s) => s.entries);
  // Rust only needs {id, trigger, value} per snippet — strip the rest.
  // Also serialize to a stable key so reference-equality on the array
  // doesn't trigger a push on every unrelated render.
  const snippetsPayload = snippets.map((s) => ({
    id: s.id,
    trigger: s.trigger,
    value: s.value,
  }));
  const snippetsKey = snippetsPayload
    .map((s) => `${s.id}␟${s.trigger}␟${s.value}`)
    .join("\n");
  const dictionaryPhrases = dictionaryEntries.map((e) => e.phrase);
  const dictionaryKey = dictionaryPhrases.join("\n");

  // Mode bindings (Feature 2) — pushed whenever modesStore OR the
  // default mode id flips. Rust resolves the active custom_prompt at
  // press time by looking up the foreground app's name in each
  // binding's `apps` list. Trimmed to just the fields Rust needs.
  const modeBindingsPayload = modes.map((m) => ({
    id: m.id,
    name: m.name,
    systemPrompt: m.systemPrompt,
    apps: m.apps ?? [],
    // Settings.defaultModeId is the AUTHORITATIVE source of truth for
    // which mode is the user's default. SEED_MODES ships `isDefault:
    // true` on the Auto mode as a first-install fallback, but once
    // the user picks a default in Settings, their choice wins.
    //
    // Earlier code used `m.id === defaultModeId || m.isDefault` which
    // flagged BOTH `mode-auto` (its seed flag) AND the user's chosen
    // mode as default. Rust's `find(|b| b.is_default)` returned the
    // first match (Auto), so the user's choice was ignored. Fixed
    // Session 37.
    //
    // When defaultModeId is null (legacy users with no explicit
    // pick), fall back to the seeded m.isDefault so somebody is
    // marked default.
    isDefault: defaultModeId ? m.id === defaultModeId : m.isDefault,
    // Per-mode dedicated hotkey (Session 33). Empty string when
    // the user hasn't set one; Rust skips registration accordingly.
    hotkey: (m.hotkey ?? "").trim(),
    // Per-mode sound preset (Session 33). Empty/undefined defaults
    // to "default" on the Rust side via `resolve_sound_preset`.
    soundPreset: m.soundPreset ?? "default",
  }));
  const modeBindingsKey = modeBindingsPayload
    .map(
      (m) =>
        `${m.id}␟${m.name}␟${m.systemPrompt}␟${m.apps.join("|")}␟${m.isDefault}␟${m.hotkey}␟${m.soundPreset}`,
    )
    .join("\n");

  // Paste overrides (Feature 1) — pushed whenever Settings → Paste →
  // App-specific shortcuts changes.
  const pasteOverrides = useSettingsStore((s) => s.settings.pasteOverrides);
  const pasteOverridesPayload = pasteOverrides.map((o) => ({
    appName: o.appName,
    keystroke: o.keystroke,
  }));
  const pasteOverridesKey = pasteOverridesPayload
    .map((o) => `${o.appName}␟${o.keystroke}`)
    .join("\n");

  // Endpointing sensitivity (Session 33). Pushed as a plain
  // lowercase string; Rust normalises unknowns to "standard".
  const endpointing = useSettingsStore((s) => s.settings.endpointing);

  // Gemini API key (Session 34, simplified Session 35). Pushed
  // whenever the user updates Settings → Transcription → Gemini API
  // key. Lives on GCPSettings (machine-local, never synced to
  // Firestore). Gating happens in Rust on `auto_format_enabled +
  // key_present` — there's no separate smartCleanup toggle anymore.
  const geminiApiKey = useSettingsStore((s) => s.gcp.geminiApiKey);
  // Gemini provider + Vertex region (machine-local on GCPSettings).
  // Provider is chosen explicitly in Settings; pushed to Rust so the
  // dictation path reads it directly (no per-paste auto-detect).
  const geminiProvider = useSettingsStore((s) => s.gcp.geminiProvider);
  const vertexLocation = useSettingsStore((s) => s.gcp.vertexLocation);

  useDebouncedInvoke("cmd_set_hotkey", { hotkey }, [hotkey]);
  useDebouncedInvoke("cmd_set_mic", { id: micDeviceId ?? null }, [micDeviceId]);
  useDebouncedInvoke("cmd_set_recording_mode", { mode: recordingMode }, [
    recordingMode,
  ]);
  useDebouncedInvoke(
    "cmd_set_silence_detection",
    { seconds: silenceDetectionSeconds },
    [silenceDetectionSeconds],
  );
  useDebouncedInvoke(
    "cmd_set_restore_clipboard",
    { enabled: restoreClipboard },
    [restoreClipboard],
  );
  useDebouncedInvoke("cmd_set_store_audio", { enabled: storeAudio }, [
    storeAudio,
  ]);
  useDebouncedInvoke("cmd_set_sound_effects", { enabled: soundEffects }, [
    soundEffects,
  ]);
  useDebouncedInvoke("cmd_set_start_at_login", { enabled: startAtLogin }, [
    startAtLogin,
  ]);

  // Phase C
  useDebouncedInvoke(
    "cmd_set_spoken_punctuation",
    { enabled: spokenPunctuation },
    [spokenPunctuation],
  );
  useDebouncedInvoke("cmd_set_spoken_emojis", { enabled: spokenEmojis }, [
    spokenEmojis,
  ]);
  useDebouncedInvoke("cmd_set_profanity_filter", { enabled: profanityFilter }, [
    profanityFilter,
  ]);
  // Arrays compare by reference; serialize to a stable key so we only
  // re-push when contents actually change.
  const langsKey = multiLanguageCodes.join(",");
  useDebouncedInvoke(
    "cmd_set_multi_language_codes",
    { codes: multiLanguageCodes },
    [langsKey],
  );

  // Phase D
  useDebouncedInvoke("cmd_set_auto_format", { enabled: autoFormat }, [
    autoFormat,
  ]);
  useDebouncedInvoke(
    "cmd_set_auto_format_prompt",
    { prompt: autoFormatPrompt },
    [autoFormatPrompt],
  );

  // Snippets + Dictionary
  useDebouncedInvoke("cmd_set_snippets", { snippets: snippetsPayload }, [
    snippetsKey,
  ]);
  useDebouncedInvoke("cmd_set_dictionary", { phrases: dictionaryPhrases }, [
    dictionaryKey,
  ]);

  // Mode bindings (Feature 2). Key includes apps + isDefault so a
  // per-mode app change OR a default-mode flip re-pushes.
  useDebouncedInvoke(
    "cmd_set_mode_bindings",
    { bindings: modeBindingsPayload },
    [modeBindingsKey],
  );

  // Paste overrides (Feature 1).
  useDebouncedInvoke(
    "cmd_set_paste_overrides",
    { overrides: pasteOverridesPayload },
    [pasteOverridesKey],
  );

  // Endpointing sensitivity (Session 33).
  useDebouncedInvoke(
    "cmd_set_endpointing_sensitivity",
    { sensitivity: endpointing },
    [endpointing],
  );

  // Gemini API key (Session 34, simplified Session 35).
  useDebouncedInvoke("cmd_set_gemini_api_key", { key: geminiApiKey ?? null }, [
    geminiApiKey ?? "",
  ]);

  // Gemini provider + Vertex region. Pushed together so a provider
  // switch and a region edit both land. Defaults applied defensively.
  useDebouncedInvoke(
    "cmd_set_gemini_provider",
    {
      provider: geminiProvider ?? "aistudio",
      location: vertexLocation ?? "us-central1",
    },
    [geminiProvider ?? "aistudio", vertexLocation ?? "us-central1"],
  );
}

/**
 * Debounced `invoke` with per-command isolation. Each call gets its
 * own timer ref so two fast-changing settings don't stomp each other.
 */
function useDebouncedInvoke(
  command: string,
  args: Record<string, unknown>,
  deps: ReadonlyArray<unknown>,
  delay = 300,
) {
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (!isTauriContext()) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      invoke(command, args).catch((e) => {
        // eslint-disable-next-line no-console
        console.warn(`[popo] ${command} failed:`, e);
      });
    }, delay);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

function isTauriContext(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "__TAURI_INTERNALS__" in window ||
    "__TAURI__" in window ||
    navigator.userAgent.includes("Tauri")
  );
}
