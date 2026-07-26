import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  User,
  SignOut,
  Download,
  DownloadSimple,
  ArrowRight,
} from "@phosphor-icons/react";
import { invoke } from "@tauri-apps/api/core";
import type { MicDevice } from "@popo/shared-types";
import { useSettingsStore } from "../store/settingsStore";
import { useAuthStore } from "../store/authStore";
import { useHistoryStore } from "../store/historyStore";
import { signInWithGoogle, signOut as fbSignOut } from "../lib/firebase";
import { useModesStore } from "../store/modesStore";
import SettingsGroup from "../components/settings/SettingsGroup";
import SettingRow from "../components/settings/SettingRow";
import GCPSetup from "../components/settings/GCPSetup";
import GeminiSetup from "../components/settings/GeminiSetup";
import CloudHint from "../components/settings/CloudHint";
import PasteOverridesEditor from "../components/settings/PasteOverridesEditor";
import AccountDangerZone from "../components/settings/AccountDangerZone";
import Toggle from "../components/shared/Toggle";
import Select from "../components/shared/Select";
import SegmentedControl from "../components/shared/SegmentedControl";
import HotkeyInput from "../components/shared/HotkeyInput";
import Button from "../components/shared/Button";
import MultiSelect from "../components/shared/MultiSelect";

/**
 * SettingsPage — brief §3 Settings.
 *
 *   Max-width 600px (center when window wide).
 *   Title "Settings".
 *   Groups: RECORDING · TRANSCRIPTION · PASTE · PRIVACY · SOUND ·
 *           SYSTEM · GCP SETUP · ACCOUNT.
 *
 * Phase 4 [12] ships the full row grammar + localStorage persistence.
 * Real Rust IPC for settings replaces the persistence hook in
 * Phase 2 [6].
 */

const LANGUAGE_OPTIONS: {
  value: string;
  label: string;
  description?: string;
}[] = [
  {
    value: "auto",
    label: "Auto-detect",
    description: "Chirp detects from 125+ languages",
  },

  // ── GA languages (reliable for streaming + all features) ──
  { value: "en-US", label: "English (US)", description: "GA" },
  { value: "en-GB", label: "English (UK)", description: "GA" },
  { value: "en-IN", label: "English (India)", description: "GA" },
  { value: "en-AU", label: "English (Australia)", description: "GA" },
  { value: "hi-IN", label: "Hindi", description: "GA" },
  { value: "fr-FR", label: "French (France)", description: "GA" },
  { value: "fr-CA", label: "French (Canada)", description: "GA" },
  { value: "de-DE", label: "German", description: "GA" },
  { value: "es-ES", label: "Spanish (Spain)", description: "GA" },
  { value: "es-US", label: "Spanish (US)", description: "GA" },
  { value: "it-IT", label: "Italian", description: "GA" },
  { value: "ja-JP", label: "Japanese", description: "GA" },
  { value: "ko-KR", label: "Korean", description: "GA" },
  { value: "pt-BR", label: "Portuguese (Brazil)", description: "GA" },
  { value: "pt-PT", label: "Portuguese (Portugal)", description: "GA" },
  { value: "nl-NL", label: "Dutch", description: "GA" },
  { value: "pl-PL", label: "Polish", description: "GA" },
  { value: "ru-RU", label: "Russian", description: "GA" },
  { value: "sv-SE", label: "Swedish", description: "GA" },
  { value: "da-DK", label: "Danish", description: "GA" },
  { value: "fi-FI", label: "Finnish", description: "GA" },
  { value: "el-GR", label: "Greek", description: "GA" },
  { value: "tr-TR", label: "Turkish", description: "GA" },
  { value: "uk-UA", label: "Ukrainian", description: "GA" },
  { value: "vi-VN", label: "Vietnamese", description: "GA" },
  { value: "ro-RO", label: "Romanian", description: "GA" },
  { value: "hr-HR", label: "Croatian", description: "GA" },
  { value: "ca-ES", label: "Catalan", description: "GA" },
  { value: "cmn-Hans-CN", label: "Chinese (Simplified)", description: "GA" },

  // ── Indian languages (Preview — may have limited streaming support) ──
  { value: "te-IN", label: "Telugu", description: "Preview" },
  { value: "ta-IN", label: "Tamil", description: "Preview" },
  { value: "bn-IN", label: "Bengali (India)", description: "Preview" },
  { value: "bn-BD", label: "Bengali (Bangladesh)", description: "Preview" },
  { value: "mr-IN", label: "Marathi", description: "Preview" },
  { value: "gu-IN", label: "Gujarati", description: "Preview" },
  { value: "kn-IN", label: "Kannada", description: "Preview" },
  { value: "ml-IN", label: "Malayalam", description: "Preview" },
  { value: "pa-Guru-IN", label: "Punjabi", description: "Preview" },
  { value: "or-IN", label: "Odia", description: "Preview" },
  { value: "as-IN", label: "Assamese", description: "Preview" },
  { value: "ne-NP", label: "Nepali", description: "Preview" },

  // ── East & Southeast Asian (Preview) ──
  {
    value: "cmn-Hant-TW",
    label: "Chinese (Traditional)",
    description: "Preview",
  },
  { value: "yue-Hant-HK", label: "Cantonese", description: "Preview" },
  { value: "id-ID", label: "Indonesian", description: "Preview" },
  { value: "ms-MY", label: "Malay", description: "Preview" },
  { value: "th-TH", label: "Thai", description: "Preview" },
  { value: "fil-PH", label: "Filipino", description: "Preview" },
  { value: "jv-ID", label: "Javanese", description: "Preview" },
  { value: "km-KH", label: "Khmer", description: "Preview" },
  { value: "lo-LA", label: "Lao", description: "Preview" },
  { value: "my-MM", label: "Burmese", description: "Preview" },

  // ── Middle East & Central Asia (Preview) ──
  { value: "ar-SA", label: "Arabic (Saudi Arabia)", description: "Preview" },
  { value: "ar-EG", label: "Arabic (Egypt)", description: "Preview" },
  { value: "ar-AE", label: "Arabic (UAE)", description: "Preview" },
  { value: "fa-IR", label: "Persian", description: "Preview" },
  { value: "iw-IL", label: "Hebrew", description: "Preview" },
  { value: "az-AZ", label: "Azerbaijani", description: "Preview" },
  { value: "kk-KZ", label: "Kazakh", description: "Preview" },
  { value: "uz-UZ", label: "Uzbek", description: "Preview" },
  { value: "ky-KG", label: "Kyrgyz", description: "Preview" },

  // ── European (Preview) ──
  { value: "cs-CZ", label: "Czech", description: "Preview" },
  { value: "hu-HU", label: "Hungarian", description: "Preview" },
  { value: "sk-SK", label: "Slovak", description: "Preview" },
  { value: "bg-BG", label: "Bulgarian", description: "Preview" },
  { value: "sr-RS", label: "Serbian", description: "Preview" },
  { value: "sl-SI", label: "Slovenian", description: "Preview" },
  { value: "et-EE", label: "Estonian", description: "Preview" },
  { value: "lv-LV", label: "Latvian", description: "Preview" },
  { value: "lt-LT", label: "Lithuanian", description: "Preview" },
  { value: "no-NO", label: "Norwegian", description: "Preview" },
  { value: "is-IS", label: "Icelandic", description: "Preview" },
  { value: "mk-MK", label: "Macedonian", description: "Preview" },
  { value: "sq-AL", label: "Albanian", description: "Preview" },
  { value: "eu-ES", label: "Basque", description: "Preview" },
  { value: "gl-ES", label: "Galician", description: "Preview" },
  { value: "ka-GE", label: "Georgian", description: "Preview" },
  { value: "hy-AM", label: "Armenian", description: "Preview" },
  { value: "mt-MT", label: "Maltese", description: "Preview" },
  { value: "lb-LU", label: "Luxembourgish", description: "Preview" },
  { value: "cy-GB", label: "Welsh", description: "Preview" },

  // ── African (Preview) ──
  { value: "sw-KE", label: "Swahili", description: "Preview" },
  { value: "am-ET", label: "Amharic", description: "Preview" },
  { value: "af-ZA", label: "Afrikaans", description: "Preview" },
  { value: "ha-NG", label: "Hausa", description: "Preview" },
  { value: "yo-NG", label: "Yoruba", description: "Preview" },
  { value: "zu-ZA", label: "Zulu", description: "Preview" },
  { value: "xh-ZA", label: "Xhosa", description: "Preview" },
  { value: "wo-SN", label: "Wolof", description: "Preview" },

  // ── Latin American (Preview) ──
  { value: "es-MX", label: "Spanish (Mexico)", description: "Preview" },
];

// Multi-language code-switching only works with GA languages on Chirp 3.
// Preview languages (te-IN, ta-IN, etc.) cause "Invalid argument" when
// combined with other languages. They work fine as single-language selection.
const MULTI_LANGUAGE_OPTIONS = LANGUAGE_OPTIONS.filter(
  (o) => o.value !== "auto" && o.description === "GA",
);

const MIC_FALLBACK: MicDevice[] = [
  { id: "", name: "System default microphone", isDefault: true },
];

const SILENCE_OPTIONS = [
  { value: "0", label: "Off" },
  { value: "1", label: "1 second" },
  { value: "2", label: "2 seconds" },
  { value: "3", label: "3 seconds" },
  { value: "5", label: "5 seconds" },
  { value: "8", label: "8 seconds" },
];

export default function SettingsPage() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const gcp = useSettingsStore((s) => s.gcp);
  const modes = useModesStore((s) => s.modes);

  // Real mic list from cpal via Rust. Loaded on mount; refreshed when
  // the user flips the dropdown open (cheap call). Falls back to a
  // single "System default" row if Rust isn't reachable (plain Vite
  // preview) so the UI still renders.
  const [micDevices, setMicDevices] = useState<MicDevice[]>(MIC_FALLBACK);
  useEffect(() => {
    let cancelled = false;
    invoke<MicDevice[]>("cmd_list_mics")
      .then((list) => {
        if (!cancelled && Array.isArray(list) && list.length > 0) {
          setMicDevices(list);
          // Stale-selection guard (Session 42 bug fix). If the user
          // picked a specific mic earlier (e.g. earphones) and that
          // device is no longer connected, the dropdown would keep
          // displaying the disconnected name and Rust would silently
          // fall back to the system default. The user couldn't see
          // the discrepancy. Auto-reset to system default in that
          // case so the UI tells the truth: nothing's pinned.
          const currentId = useSettingsStore.getState().settings.micDeviceId;
          if (currentId) {
            const stillPresent = list.some(
              (d) => d.id !== "" && d.id === currentId,
            );
            if (!stillPresent) {
              // eslint-disable-next-line no-console
              console.warn(
                `[popo] selected mic "${currentId}" not connected; resetting to system default`,
              );
              useSettingsStore.getState().update({ micDeviceId: null });
            }
          }
        }
      })
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.warn("[popo] cmd_list_mics failed:", e);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Non-blocking error shown under the HotkeyInput when Rust rejects
  // a new combo (unparseable or registration conflict). Cleared when
  // the user picks a different hotkey.
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);

  // ── Check for updates button (System group) ──
  // Real Tauri updater signing + `latest.json` hosting is future
  // release-engineering work. Until then, this button just opens the
  // GitHub Releases page in the system browser so the user can check
  // manually. The status state is kept so we can wire a proper updater
  // later without reshuffling the UI.
  const [updateStatus, setUpdateStatus] = useState<
    "idle" | "checking" | "current" | "error"
  >("idle");
  const [updateError, setUpdateError] = useState<string | null>(null);

  const handleCheckUpdates = async () => {
    setUpdateStatus("checking");
    setUpdateError(null);
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl("https://github.com/Cryptobitsbee/PoPo/releases");
      // We don't actually know if the user updated — reset to idle.
      setUpdateStatus("idle");
    } catch (e) {
      setUpdateStatus("error");
      setUpdateError(e instanceof Error ? e.message : String(e));
    }
  };

  // ── Export history (Privacy group) ──
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const sessions = useHistoryStore.getState().sessions;
      if (sessions.length === 0) {
        alert("No sessions to export yet.");
        setExporting(false);
        return;
      }
      const suggested = `popo-history-${new Date().toISOString().slice(0, 10)}.json`;
      // Build both representations before opening the trusted Rust-side
      // save dialog. Rust chooses the matching contents from the user-
      // approved .json/.txt extension and performs the write itself.
      const payload = {
        exportedAt: new Date().toISOString(),
        appVersion: "0.1.0",
        sessionCount: sessions.length,
        sessions: sessions.map((s) => ({
          id: s.id,
          createdAt: s.createdAt,
          durationMs: s.durationMs,
          wordCount: s.wordCount,
          language: s.language,
          appName: s.appName,
          modeId: s.modeId,
          rawTranscript: s.rawTranscript,
          formattedTranscript: s.formattedTranscript,
          expandedSnippets: s.expandedSnippets,
        })),
      };
      const jsonContents = JSON.stringify(payload, null, 2);
      const textContents = sessions
        .map(
          (s) =>
            `[${new Date(s.createdAt).toISOString()}] ${s.appName ?? "unknown"} \u2014 ${s.formattedTranscript ?? s.rawTranscript}`,
        )
        .join("\n\n");

      const result = await invoke<{
        bytesWritten: number;
        path: string;
      } | null>("cmd_export_history", {
        jsonContents,
        textContents,
        suggestedName: suggested,
      });
      if (result) {
        // eslint-disable-next-line no-console
        console.info(
          `[popo] exported ${result.bytesWritten} bytes to ${result.path}`,
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(`Export failed: ${msg}`);
    } finally {
      setExporting(false);
    }
  };

  // When the user changes the language in the Transcription group,
  // immediately tell Rust so the next dictation uses the right locale.
  // Also: if switching FROM "auto" to a specific language, clear the
  // multi-language codes (they only apply when language = "auto").
  const handleLanguageChange = (language: string) => {
    if (language !== "auto" && settings.multiLanguageCodes.length > 0) {
      update({ language, multiLanguageCodes: [] });
    } else {
      update({ language });
    }
    invoke("cmd_update_language", { languageCode: language }).catch((e) =>
      console.warn("[popo] cmd_update_language failed:", e),
    );
  };

  const handleHotkeyChange = async (hotkey: string) => {
    setHotkeyError(null);
    try {
      await invoke("cmd_set_hotkey", { hotkey });
      update({ hotkey });
    } catch (e) {
      setHotkeyError(String(e));
    }
  };

  // System default's actual resolved name (e.g. "OnePlus Buds 3" if
  // earphones are connected, or "Microphone Array" for the built-in).
  // Surfaced both inline on the "System default" dropdown row AND
  // in the SettingRow description below, so the user always knows
  // what popo will actually capture from when nothing is pinned.
  const systemDefaultResolvedName = micDevices.find(
    (d) => d.id !== "" && d.isDefault,
  )?.name;

  const micOptions = micDevices.map((d) => ({
    value: d.id,
    label: d.name,
    description:
      d.id === ""
        ? systemDefaultResolvedName
          ? `→ ${systemDefaultResolvedName}`
          : undefined
        : d.isDefault
          ? "Current system default"
          : undefined,
  }));

  const modeOptions = modes.length
    ? modes.map((m) => ({ value: m.id, label: m.name }))
    : [{ value: "mode-auto", label: "Auto" }];

  return (
    <div
      style={{
        padding: "var(--sp-8) var(--sp-10)",
        maxWidth: 680,
        margin: "0 auto",
      }}
    >
      <h1
        style={{
          fontFamily: "var(--font-pixel-square)",
          fontSize: "var(--text-xl)",
          lineHeight: 1.1,
          fontWeight: 500,
          color: "var(--text-primary)",
          margin: 0,
        }}
      >
        Settings
      </h1>

      {/* ── RECORDING ────────────────────────────── */}
      <SettingsGroup label="Recording" first>
        <SettingRow
          label="Hotkey"
          description={
            hotkeyError
              ? `Rejected: ${hotkeyError}`
              : "Hold anywhere. Release to paste."
          }
        >
          <HotkeyInput value={settings.hotkey} onChange={handleHotkeyChange} />
        </SettingRow>

        <SettingRow label="Mode" description="Hold to talk, or tap to toggle.">
          <SegmentedControl
            value={settings.recordingMode}
            onChange={(recordingMode) => update({ recordingMode })}
            options={[
              { value: "push-to-talk", label: "Push to talk" },
              { value: "toggle", label: "Toggle" },
            ]}
            aria-label="Recording mode"
          />
        </SettingRow>

        <SettingRow
          label="Microphone"
          hint={(() => {
            if (settings.micDeviceId) {
              const picked = micDevices.find(
                (d) => d.id === settings.micDeviceId,
              );
              return picked
                ? `Capturing from ${picked.name}.`
                : `Selected mic isn't connected — will fall back to ${systemDefaultResolvedName ?? "system default"}.`;
            }
            return systemDefaultResolvedName
              ? `System default — capturing from ${systemDefaultResolvedName}.`
              : "Follows Windows default.";
          })()}
        >
          <Select
            value={settings.micDeviceId ?? ""}
            options={micOptions}
            onChange={(v) => update({ micDeviceId: v === "" ? null : v })}
            aria-label="Input device"
            minWidth={240}
          />
        </SettingRow>

        <SettingRow
          label="Silence timeout"
          description="Auto-stops Toggle mode after this much silence."
          last
        >
          <Select
            value={String(settings.silenceDetectionSeconds)}
            options={SILENCE_OPTIONS}
            onChange={(v) => update({ silenceDetectionSeconds: Number(v) })}
            aria-label="Silence detection"
            minWidth={140}
          />
        </SettingRow>
      </SettingsGroup>

      {/* ── TRANSCRIPTION ────────────────────── */}
      <SettingsGroup label="Transcription">
        <SettingRow
          label="Language"
          description={
            settings.language === "auto"
              ? "Detected automatically."
              : "Only this language."
          }
        >
          <Select
            value={settings.language}
            options={LANGUAGE_OPTIONS}
            onChange={handleLanguageChange}
            aria-label="Language"
          />
        </SettingRow>

        {settings.language === "auto" && (
          <SettingRow
            label="Restrict to"
            description={
              settings.multiLanguageCodes.length > 0
                ? "Faster than scanning all 125."
                : "Pick up to 3. Empty = all languages."
            }
          >
            <MultiSelect
              values={settings.multiLanguageCodes}
              options={MULTI_LANGUAGE_OPTIONS}
              onChange={(codes) => update({ multiLanguageCodes: codes })}
              placeholder="All languages"
              maxSelections={3}
              minWidth={260}
              aria-label="Restrict detection"
            />
          </SettingRow>
        )}

        <SettingRow
          label="Auto-format"
          hint={
            settings.autoFormat
              ? gcp.geminiProvider === "vertex"
                ? gcp.serviceAccountJsonPath && gcp.projectId.trim()
                  ? "On. Each transcript is polished through Gemini 3.5 Flash-Lite on Vertex AI using the active mode's prompt. The selected GCP JSON must remain available."
                  : "On, but Vertex AI needs a valid GCP service-account path and project ID below."
                : gcp.geminiApiKey
                  ? "On. Each transcript is polished through Gemini 3.5 Flash-Lite on AI Studio using the active mode's prompt."
                  : "On, but no AI Studio API key is set yet. Add one below or switch the provider to Vertex AI."
              : "Off. Transcripts paste exactly as spoken. Modes, app bindings, mode hotkeys, and Gemini polish are all bypassed."
          }
        >
          <Toggle
            checked={settings.autoFormat}
            onChange={(autoFormat) => update({ autoFormat })}
            label="Auto-format"
          />
        </SettingRow>

        {settings.autoFormat && (
          <SettingRow
            label="Formatting mode"
            description="Edit prompts in Modes."
          >
            <Select
              value={settings.defaultModeId ?? modeOptions[0].value}
              options={modeOptions}
              onChange={(defaultModeId) => update({ defaultModeId })}
              aria-label="Formatting mode"
            />
          </SettingRow>
        )}

        <SettingRow
          label="Response speed"
          hint="How quickly popo decides you're done speaking. Snappier responses mean faster paste but can truncate slow speech."
        >
          <Select
            value={settings.endpointing}
            options={[
              { value: "low", label: "Patient (longer pauses)" },
              { value: "standard", label: "Standard" },
              { value: "high", label: "Snappy (shorter pauses)" },
            ]}
            onChange={(v) =>
              update({ endpointing: v as "low" | "standard" | "high" })
            }
            aria-label="Response speed"
            minWidth={180}
          />
        </SettingRow>

        {/* AI provider (AI Studio vs Vertex AI) + key/region + a
            single connection test. Lives in its own component so the
            rows stay tidy and the Vertex setup guide has a home. */}
        {settings.autoFormat && <GeminiSetup />}


        {/*
          Phase C spoken-punctuation / spoken-emoji / profanity-filter
          toggles are HIDDEN (Session 28). Chirp 3 doesn't support
          these RecognitionFeatures fields — setting them to true
          makes the gRPC request fail with "Invalid argument". The
          frontend state + Rust commands are preserved so we can
          re-expose these the moment they gain Chirp 3 support, OR
          when we add a Chirp-2 fallback model.
        */}
      </SettingsGroup>

      {/* ── PASTE ──────────────────────────────── */}
      <SettingsGroup label="Paste">
        <SettingRow
          label="Leave on clipboard"
          description="Keep the transcript copied after pasting."
        >
          <Toggle
            checked={!settings.restoreClipboard}
            onChange={(keep) => update({ restoreClipboard: !keep })}
            label="Leave on clipboard"
          />
        </SettingRow>
        {/* Per-app paste keystroke overrides. Renders its own full-
            width block (label + list + add button) directly inside the
            group — see GCPSetup for the same "unwrapped" pattern. */}
        <PasteOverridesEditor />
      </SettingsGroup>

      {/* ── PRIVACY ──────────────────────────── */}
      <SettingsGroup label="Privacy">
        <SettingRow
          label="Store audio"
          description={
            <>
              Save the recording with each transcript.
              <CloudHint
                when="signed-in"
                inlineNote="Also backed up to your Google account."
                signedOutNote="Local only. Sign in to back up."
              />
            </>
          }
        >
          <Toggle
            checked={settings.storeAudio}
            onChange={(storeAudio) => update({ storeAudio })}
            label="Store audio"
          />
        </SettingRow>

        <SettingRow
          label="Export history"
          hint="Save all your session transcripts as a JSON file. Useful for backup or migrating to another app."
        >
          <Button
            variant="subtle"
            iconLeft={<DownloadSimple size={14} weight="regular" />}
            onClick={handleExport}
            disabled={exporting}
          >
            {exporting ? "Exporting\u2026" : "Export\u2026"}
          </Button>
        </SettingRow>

        <SettingRow
          label="Keep sessions local"
          hint="Don't sync transcripts to the cloud. Settings and modes still sync."
          last
        >
          <Toggle
            checked={settings.privacyMode}
            onChange={(privacyMode) => update({ privacyMode })}
            label="Privacy mode"
          />
        </SettingRow>
      </SettingsGroup>

      {/* ── SOUND ───────────────────────────────── */}
      <SettingsGroup label="Sound">
        <SettingRow
          label="Sound effects"
          description="Ping on record, chime on paste."
          last
        >
          <Toggle
            checked={settings.soundEffects}
            onChange={(soundEffects) => update({ soundEffects })}
            label="Sound effects"
          />
        </SettingRow>
      </SettingsGroup>

      {/* ── SYSTEM ───────────────────────────────── */}
      <SettingsGroup label="System">
        <SettingRow
          label="Start at login"
          description="Launch popo with Windows."
        >
          <Toggle
            checked={settings.startAtLogin}
            onChange={(startAtLogin) => update({ startAtLogin })}
            label="Start at login"
          />
        </SettingRow>

        <SettingRow
          label="Check for updates"
          description={
            updateStatus === "checking"
              ? "Checking\u2026"
              : updateStatus === "current"
                ? "You're on the latest version."
                : updateStatus === "error"
                  ? (updateError ??
                    "Couldn't check \u2014 check your connection.")
                  : "Opens the GitHub Releases page where new popo builds are published."
          }
          last
        >
          <Button
            variant="subtle"
            iconLeft={<Download size={14} weight="regular" />}
            onClick={handleCheckUpdates}
            disabled={updateStatus === "checking"}
          >
            {updateStatus === "checking"
              ? "Checking\u2026"
              : "Check for updates"}
          </Button>
        </SettingRow>
      </SettingsGroup>

      {/* ── GCP SETUP ─────────────────────────────────────────────── */}
      <SettingsGroup label="GCP setup">
        <GCPSetup />
      </SettingsGroup>

      {/* ── ACCOUNT ───────────────────────────────────────────────── */}
      <SettingsGroup label="Account">
        <AccountRow />
        {/* Danger zone renders below the account row as a full-width
            block. Hides itself when the user is signed out. */}
        <AccountDangerZone />
      </SettingsGroup>

      {/* Bottom breathing room so last row doesn't hug the viewport bottom */}
      <div style={{ height: "var(--sp-12)" }} />
    </div>
  );
}

// ─── Account row ────────────────────────────────────

/**
 * Live Account row inside the Settings page. Mirrors the four
 * authStore states:
 *   - `loading`      → subtle placeholder label
 *   - `unconfigured` → "Firebase not configured" hint, disabled
 *   - `signed-out`   → pill says "Not signed in" + real sign-in button
 *   - `signed-in`    → pill shows display name + sign-out button +
 *                      link to the fuller Account page
 *
 * Uses the same signInWithGoogle / signOut helpers the AccountPage
 * uses, so the Tauri system-browser OAuth flow fires here too.
 */
function AccountRow() {
  const navigate = useNavigate();
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const authError = useAuthStore((s) => s.error);
  const setAuthError = useAuthStore((s) => s.setError);
  const [busy, setBusy] = useState(false);

  const handleSignIn = async () => {
    setAuthError(null);
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAuthError(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    setBusy(true);
    try {
      await fbSignOut();
    } finally {
      setBusy(false);
    }
  };

  if (status === "loading") {
    return (
      <SettingRow label="Signed in" description="Checking your account…" last>
        <span />
      </SettingRow>
    );
  }

  if (status === "unconfigured") {
    return (
      <SettingRow
        label="Signed in"
        description="Firebase is not configured. Local usage still works; cross-device sync is off."
        last
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "0 10px",
            height: 28,
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-pill)",
            fontFamily: "var(--font-pixel-grid)",
            fontSize: "var(--text-xs)",
            color: "var(--text-secondary)",
          }}
        >
          <User size={12} color="var(--text-ghost)" />
          Unconfigured
        </span>
      </SettingRow>
    );
  }

  if (status === "signed-in" && user) {
    return (
      <SettingRow
        label="Signed in"
        description={authError ?? (user.email || "Synced via Google.")}
        last
      >
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Button
            variant="ghost"
            iconRight={<ArrowRight size={12} weight="regular" />}
            onClick={() => navigate("/account")}
          >
            Manage
          </Button>
          <Button
            variant="ghost"
            iconLeft={<SignOut size={14} weight="regular" />}
            disabled={busy}
            onClick={handleSignOut}
          >
            {busy ? "Signing out…" : "Sign out"}
          </Button>
        </div>
      </SettingRow>
    );
  }

  // signed-out
  return (
    <SettingRow
      label="Signed in"
      description={
        authError ??
        "Sign in to sync sessions, modes, and settings across devices."
      }
      last
    >
      <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "0 10px",
            height: 28,
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-pill)",
            fontFamily: "var(--font-pixel-grid)",
            fontSize: "var(--text-xs)",
            color: "var(--text-secondary)",
          }}
        >
          <User size={12} color="var(--text-ghost)" />
          Not signed in
        </span>
        <Button
          variant="subtle"
          iconLeft={<SignOut size={14} weight="regular" />}
          disabled={busy}
          onClick={handleSignIn}
        >
          {busy ? "Signing in…" : "Sign in with Google"}
        </Button>
      </div>
    </SettingRow>
  );
}
