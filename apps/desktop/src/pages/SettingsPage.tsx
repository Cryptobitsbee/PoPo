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
import PageShell from "../components/layout/PageShell";
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
    description: "Detects across 85+ languages, switches mid-sentence",
  },

  // ── Supported ──────────────────────────────────────────────
  // Google's own readiness rating for Gemini 3.5 Transcribe. These
  // are the locales it is fully tuned for.
  { value: "en-US", label: "English (US)", description: "Supported" },
  { value: "en-GB", label: "English (UK)", description: "Supported" },
  { value: "en-IN", label: "English (India)", description: "Supported" },
  { value: "en-AU", label: "English (Australia)", description: "Supported" },
  { value: "hi-IN", label: "Hindi", description: "Supported" },
  { value: "es-ES", label: "Spanish (Spain)", description: "Supported" },
  { value: "es-US", label: "Spanish (US)", description: "Supported" },
  { value: "fr-FR", label: "French", description: "Supported" },
  { value: "fr-CA", label: "French (Canada)", description: "Supported" },
  { value: "de-DE", label: "German", description: "Supported" },
  { value: "it-IT", label: "Italian", description: "Supported" },
  { value: "pt-BR", label: "Portuguese (Brazil)", description: "Supported" },
  { value: "pt-PT", label: "Portuguese (Portugal)", description: "Supported" },
  { value: "nl-NL", label: "Dutch", description: "Supported" },
  { value: "pl-PL", label: "Polish", description: "Supported" },
  { value: "ro-RO", label: "Romanian", description: "Supported" },
  { value: "ru-RU", label: "Russian", description: "Supported" },
  { value: "uk-UA", label: "Ukrainian", description: "Supported" },
  { value: "hr-HR", label: "Croatian", description: "Supported" },
  { value: "ca-ES", label: "Catalan", description: "Supported" },
  { value: "da-DK", label: "Danish", description: "Supported" },
  { value: "fi-FI", label: "Finnish", description: "Supported" },
  { value: "sv-SE", label: "Swedish", description: "Supported" },
  { value: "el-GR", label: "Greek", description: "Supported" },
  { value: "tr-TR", label: "Turkish", description: "Supported" },
  { value: "ja-JP", label: "Japanese", description: "Supported" },
  { value: "ko-KR", label: "Korean", description: "Supported" },
  {
    value: "cmn-Hans-CN",
    label: "Mandarin Chinese (Simplified)",
    description: "Supported",
  },
  { value: "vi-VN", label: "Vietnamese", description: "Supported" },

  // ── Experimental ───────────────────────────────────────────
  // Recognised, but Google rates accuracy as experimental. Note that
  // Tamil is absent from this model entirely, so it is not listed.
  { value: "bn-IN", label: "Bengali (India)", description: "Experimental" },
  {
    value: "bn-BD",
    label: "Bengali (Bangladesh)",
    description: "Experimental",
  },
  { value: "te-IN", label: "Telugu", description: "Experimental" },
  { value: "mr-IN", label: "Marathi", description: "Experimental" },
  { value: "gu-IN", label: "Gujarati", description: "Experimental" },
  { value: "kn-IN", label: "Kannada", description: "Experimental" },
  { value: "ml-IN", label: "Malayalam", description: "Experimental" },
  { value: "pa-IN", label: "Punjabi", description: "Experimental" },
  {
    value: "pa-Guru-IN",
    label: "Punjabi (Gurmukhi)",
    description: "Experimental",
  },
  { value: "or-IN", label: "Oriya", description: "Experimental" },
  { value: "as-IN", label: "Assamese", description: "Experimental" },
  { value: "sd-Arab-IN", label: "Sindhi (Arabic)", description: "Experimental" },
  { value: "ne-NP", label: "Nepali", description: "Experimental" },
  { value: "ar-EG", label: "Arabic (Egypt)", description: "Experimental" },
  { value: "fa-IR", label: "Farsi", description: "Experimental" },
  { value: "he-IL", label: "Hebrew", description: "Experimental" },
  { value: "id-ID", label: "Indonesian", description: "Experimental" },
  { value: "jv-ID", label: "Javanese", description: "Experimental" },
  { value: "ms-MY", label: "Malay", description: "Experimental" },
  { value: "fil-PH", label: "Filipino", description: "Experimental" },
  { value: "ceb", label: "Cebuano", description: "Experimental" },
  { value: "th-TH", label: "Thai", description: "Experimental" },
  { value: "km-KH", label: "Khmer", description: "Experimental" },
  { value: "my-MM", label: "Burmese", description: "Experimental" },
  {
    value: "yue-Hant-HK",
    label: "Cantonese (Traditional)",
    description: "Experimental",
  },
  { value: "cs-CZ", label: "Czech", description: "Experimental" },
  { value: "sk-SK", label: "Slovak", description: "Experimental" },
  { value: "sl-SI", label: "Slovenian", description: "Experimental" },
  { value: "hu-HU", label: "Hungarian", description: "Experimental" },
  { value: "bg-BG", label: "Bulgarian", description: "Experimental" },
  {
    value: "rup-BG",
    label: "Bulgarian (Aromanian)",
    description: "Experimental",
  },
  { value: "sr-RS", label: "Serbian", description: "Experimental" },
  { value: "bs-BA", label: "Bosnian", description: "Experimental" },
  { value: "mk-MK", label: "Macedonian", description: "Experimental" },
  { value: "et-EE", label: "Estonian", description: "Experimental" },
  { value: "lv-LV", label: "Latvian", description: "Experimental" },
  { value: "lt-LT", label: "Lithuanian", description: "Experimental" },
  { value: "be-BY", label: "Belarusian", description: "Experimental" },
  { value: "nb-NO", label: "Norwegian", description: "Experimental" },
  { value: "is-IS", label: "Icelandic", description: "Experimental" },
  { value: "gl-ES", label: "Galician", description: "Experimental" },
  {
    value: "es-419",
    label: "Spanish (Latin America)",
    description: "Experimental",
  },
  { value: "mt-MT", label: "Maltese", description: "Experimental" },
  { value: "hy-AM", label: "Armenian", description: "Experimental" },
  { value: "ka-GE", label: "Georgian", description: "Experimental" },
  { value: "az-AZ", label: "Azerbaijani", description: "Experimental" },
  { value: "kk-KZ", label: "Kazakh", description: "Experimental" },
  { value: "ky-KG", label: "Kyrgyz", description: "Experimental" },
  { value: "uz-UZ", label: "Uzbek", description: "Experimental" },
  { value: "tg-TJ", label: "Tajik", description: "Experimental" },
  { value: "mn-MN", label: "Mongolian", description: "Experimental" },
  { value: "af-ZA", label: "Afrikaans", description: "Experimental" },
  { value: "am-ET", label: "Amharic", description: "Experimental" },
  { value: "sw-KE", label: "Swahili (Kenya)", description: "Experimental" },
  { value: "ha-NG", label: "Hausa", description: "Experimental" },
  { value: "ln-CD", label: "Lingala", description: "Experimental" },
  { value: "kea-CV", label: "Kabuverdianu", description: "Experimental" },
];

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
  const handleLanguageChange = (language: string) => {
    update({ language });
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
    <PageShell
      maxWidth={680}
      header={
        <>
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
        </>
      }
    >

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


        {/* AI provider (AI Studio vs Vertex AI) + key/region + a
            single connection test. Lives in its own component so the
            rows stay tidy and the Vertex setup guide has a home. */}
        {settings.autoFormat && <GeminiSetup />}
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
    </PageShell>
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
