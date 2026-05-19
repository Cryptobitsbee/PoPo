import { useEffect, useState, type ReactNode } from "react";
import type { Mode } from "@popo/shared-types";
import Modal from "../shared/Modal";
import Input from "../shared/Input";
import Textarea from "../shared/Textarea";
import Select from "../shared/Select";
import SegmentedControl from "../shared/SegmentedControl";
import Button from "../shared/Button";
import AppPicker from "../shared/AppPicker";
import HotkeyInput from "../shared/HotkeyInput";
import { useAppIconsStore } from "../../store/appIconsStore";
import { useAuthStore } from "../../store/authStore";
import { saveAppIcon } from "../../lib/firestore";
import { trackSync } from "../../store/syncLogStore";

/**
 * ModeEditor — the modal form for creating or editing a mode.
 *
 * Per brief §3 Modes MODE EDITOR MODAL:
 *   Width 520px · max-height 90vh · padding --sp-8
 *   Entrance: scale 0.96→1 + opacity 0→1, 180ms ease-out (handled by Modal)
 *
 *   Fields:
 *     - Mode name (Input)
 *     - System prompt (Textarea, 6 rows, GeistPixelLine)
 *     - Language override (Select, "Use default" option)
 *     - Output format (SegmentedControl: Paragraph / Bullets / Raw)
 *
 *   Footer: "Cancel" (ghost) + "Save Mode" (primary)
 *
 * Modal is a BRIEF EXCEPTION to impeccable's "no modal-first" rule
 * (DESIGN_SYSTEM §12.3). The mode has enough non-trivial fields that
 * inline editing would cramp the 2-col grid — modal is justified.
 *
 * Gemini Flash integration (which actually runs the mode prompt against
 * a transcript) lives in Phase 2 [6] Rust core + Phase 4 polish. This
 * editor only captures the prompt text.
 */

export interface ModeEditorProps {
  open: boolean;
  /** `null` means "create new". */
  mode: Mode | null;
  onClose: () => void;
  onSave: (mode: Mode) => void;
}

const LANGUAGE_OPTIONS = [
  { value: "", label: "Use default" },
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "en-IN", label: "English (India)" },
  { value: "hi-IN", label: "Hindi" },
  { value: "te-IN", label: "Telugu" },
  { value: "ta-IN", label: "Tamil" },
  { value: "bn-IN", label: "Bengali" },
  { value: "mr-IN", label: "Marathi" },
  { value: "es-ES", label: "Spanish (Spain)" },
  { value: "fr-FR", label: "French" },
  { value: "de-DE", label: "German" },
  { value: "ja-JP", label: "Japanese" },
];

const OUTPUT_OPTIONS = [
  { value: "paragraph", label: "Paragraph" },
  { value: "bullets", label: "Bullets" },
  { value: "raw", label: "Raw" },
] as const;

type OutputFormat = (typeof OUTPUT_OPTIONS)[number]["value"];

const SOUND_PRESET_OPTIONS = [
  { value: "default", label: "Default (soft ping)" },
  { value: "soft", label: "Soft (calm, longer)" },
  { value: "chime", label: "Chime (two-tone bright)" },
  { value: "bell", label: "Bell (crisp high tone)" },
  { value: "none", label: "Silent" },
] as const;

type SoundPreset = (typeof SOUND_PRESET_OPTIONS)[number]["value"];

export default function ModeEditor({
  open,
  mode,
  onClose,
  onSave,
}: ModeEditorProps) {
  const isNew = mode == null;
  const [name, setName] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [language, setLanguage] = useState("");
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("paragraph");
  const [apps, setApps] = useState<string[]>([]);
  const [hotkey, setHotkey] = useState("");
  const [soundPreset, setSoundPreset] = useState<SoundPreset>("default");

  // Shared icon cache (deduped + Firestore-synced). ModeCard reads
  // from the same store so registering here means apps picked in the
  // editor immediately show with icons in the cards below.
  const iconsByName = useAppIconsStore((s) => s.iconsByName);
  const upsertIcon = useAppIconsStore((s) => s.upsert);

  // Reset form whenever the editor opens or the mode switches.
  useEffect(() => {
    if (!open) return;
    setName(mode?.name ?? "");
    setSystemPrompt(mode?.systemPrompt ?? "");
    setLanguage(mode?.language ?? "");
    setOutputFormat(mode?.outputFormat ?? "paragraph");
    setApps(mode?.apps ?? []);
    setHotkey(mode?.hotkey ?? "");
    setSoundPreset((mode?.soundPreset as SoundPreset) ?? "default");
  }, [open, mode]);

  const canSave = name.trim().length > 0;

  const handleSave = () => {
    if (!canSave) return;
    const now = Date.now();
    const id = mode?.id ?? `mode-${now}`;
    const saved: Mode = {
      id,
      name: name.trim(),
      systemPrompt: systemPrompt.trim(),
      language: language || undefined,
      outputFormat,
      apps: apps.length > 0 ? apps : undefined,
      hotkey: hotkey.trim() || undefined,
      soundPreset: soundPreset === "default" ? undefined : soundPreset,
      isDefault: mode?.isDefault ?? false,
      usageCount: mode?.usageCount ?? 0,
      createdAt: mode?.createdAt ?? now,
    };
    onSave(saved);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={520}
      label={isNew ? "New mode" : `Edit mode: ${mode?.name}`}
    >
      {/* Header */}
      <h2
        style={{
          margin: 0,
          fontFamily: "var(--font-pixel-square)",
          fontSize: "var(--text-lg)",
          fontWeight: 500,
          lineHeight: 1.2,
          color: "var(--text-primary)",
        }}
      >
        {isNew ? "New mode" : "Edit mode"}
      </h2>

      {/* Body */}
      <div
        style={{
          marginTop: "var(--sp-6)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-4)",
        }}
      >
        <Field label="Name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Meeting notes"
            autoFocus
            maxLength={60}
          />
        </Field>

        <Field
          label="System prompt"
          description="Instructions the AI applies to every transcript that uses this mode."
        >
          <Textarea
            rows={6}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="Rewrite the transcript as…"
          />
        </Field>

        <Field
          label="Language override"
          description="Force a specific language for this mode, or use the app default."
        >
          <Select
            value={language}
            options={LANGUAGE_OPTIONS}
            onChange={setLanguage}
            aria-label="Language override"
            minWidth={240}
          />
        </Field>

        <Field
          label="Output format"
          description="Shape the rewritten text takes. Raw skips reformatting entirely."
        >
          <SegmentedControl<OutputFormat>
            value={outputFormat}
            onChange={setOutputFormat}
            options={[...OUTPUT_OPTIONS]}
            aria-label="Output format"
          />
        </Field>

        <Field
          label="Apply in apps"
          description="Auto-select this mode when any of these apps are in focus. Leave empty to only use this mode as the default."
        >
          <AppPicker
            values={apps}
            onChange={setApps}
            onSelect={(app) => {
              // Cache the picked app's icon so every consumer —
              // ModeCard footer, the same picker on re-open, the
              // History rows — renders the correct logo even when
              // the app isn't currently running. Manual-entry picks
              // have no iconBase64; skipped (rare + benign).
              if (app.iconBase64) {
                upsertIcon(app.name, app.iconBase64);
                // Also persist to Firestore so the icon follows the
                // user across devices. Fire-and-forget (trackSync
                // already surfaces errors to the sync log viewer).
                // Matches the pattern in useSessionSave.
                const uid = useAuthStore.getState().user?.uid;
                if (uid) {
                  trackSync("write", `users/${uid}/appIcons/${app.name}`, () =>
                    saveAppIcon(uid, app.name, app.iconBase64!),
                  ).catch(() => {
                    /* already logged by trackSync */
                  });
                }
              }
            }}
            iconHints={iconsByName}
            placeholder="No app binding"
            minWidth={300}
            aria-label="Apps where this mode applies"
          />
        </Field>

        <Field
          label="Dedicated hotkey"
          description="Press this shortcut from anywhere to record with this mode forced. Leave empty to only use the default hotkey + app bindings."
        >
          <HotkeyInput value={hotkey} onChange={setHotkey} />
        </Field>

        <Field
          label="Start / paste sound"
          description={
            'Audio cue for this mode. "None" silences pings just for this mode — global sound effects still apply for others.'
          }
        >
          <Select<SoundPreset>
            value={soundPreset}
            options={[...SOUND_PRESET_OPTIONS]}
            onChange={setSoundPreset}
            aria-label="Sound preset"
            minWidth={240}
          />
        </Field>
      </div>

      {/* Footer */}
      <div
        style={{
          marginTop: "var(--sp-8)",
          display: "flex",
          justifyContent: "flex-end",
          gap: "var(--sp-3)",
        }}
      >
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSave} disabled={!canSave}>
          Save mode
        </Button>
      </div>
    </Modal>
  );
}

function Field({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label
        style={{
          display: "block",
          marginBottom: description ? 4 : 6,
          fontFamily: "var(--font-pixel-square)",
          fontSize: "var(--text-sm)",
          lineHeight: 1.3,
          color: "var(--text-primary)",
        }}
      >
        {label}
      </label>
      {description && (
        <div
          style={{
            marginBottom: 8,
            fontFamily: "var(--font-pixel-line)",
            fontSize: "var(--text-xs)",
            lineHeight: 1.4,
            color: "var(--text-secondary)",
          }}
        >
          {description}
        </div>
      )}
      {children}
    </div>
  );
}
