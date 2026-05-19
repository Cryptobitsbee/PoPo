import { useEffect, useState, type ReactNode } from "react";
import { AppWindow, PencilSimple, Trash } from "@phosphor-icons/react";
import type { PasteOverride } from "@popo/shared-types";
import { useSettingsStore } from "../../store/settingsStore";
import AppPicker from "../shared/AppPicker";
import Button from "../shared/Button";
import HotkeyInput from "../shared/HotkeyInput";
import Modal from "../shared/Modal";

/**
 * PasteOverridesEditor — the per-app paste-keystroke list inside
 * Settings → Paste.
 *
 * A single override is `{ appName, keystroke }`: when `pretty_app_name`
 * of the foreground window matches `appName` (case-insensitive), Rust
 * sends `keystroke` instead of Ctrl+V in the paste orchestrator. Useful
 * for apps like Cursor where plain Ctrl+V auto-formats and users want
 * Ctrl+Shift+V (paste-without-formatting) instead.
 *
 * Not wrapped in a SettingRow — it's a free-form block that renders
 * directly inside the Paste SettingsGroup, modelled after GCPSetup's
 * multi-row layout. Sits below the "Leave on clipboard" SettingRow and
 * visually inherits the row rhythm via the top border.
 *
 * State flow:
 *   - Reads `settings.pasteOverrides` straight from the store.
 *   - Writes go through `update({ pasteOverrides })`, which auto-syncs
 *     to Firestore AND pushes the array to Rust via
 *     `useApplySettingsToRust`. No local persistence to manage here.
 *
 * Modal is a local draft: closing doesn't persist; only Save does.
 * Duplicate `appName` (case-insensitive) is treated as "edit that
 * existing entry" — we never insert a second row for the same app.
 */

export default function PasteOverridesEditor() {
  const overrides = useSettingsStore((s) => s.settings.pasteOverrides);
  const update = useSettingsStore((s) => s.update);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [appNameDraft, setAppNameDraft] = useState("");
  const [keystrokeDraft, setKeystrokeDraft] = useState("");
  // Captured at AppPicker pick-time (or pre-seeded from the existing
  // override when editing). Persisted on Save so future Settings
  // renders can show the icon even if the app is no longer running.
  const [iconBase64Draft, setIconBase64Draft] = useState<string | undefined>(
    undefined,
  );

  // Reset drafts whenever the modal opens. When editing, pre-populate
  // from the chosen entry. When creating, start blank.
  useEffect(() => {
    if (!modalOpen) return;
    if (editingIndex != null && overrides[editingIndex]) {
      setAppNameDraft(overrides[editingIndex].appName);
      setKeystrokeDraft(overrides[editingIndex].keystroke);
      setIconBase64Draft(overrides[editingIndex].iconBase64);
    } else {
      setAppNameDraft("");
      setKeystrokeDraft("");
      setIconBase64Draft(undefined);
    }
    // We intentionally don't re-run on `overrides` — the draft is a
    // snapshot at open time, not a live mirror.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen, editingIndex]);

  const openCreate = () => {
    setEditingIndex(null);
    setModalOpen(true);
  };

  const openEdit = (index: number) => {
    setEditingIndex(index);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingIndex(null);
  };

  const canSave =
    appNameDraft.trim().length > 0 && keystrokeDraft.trim().length > 0;

  const handleSave = () => {
    if (!canSave) return;
    const name = appNameDraft.trim();
    const ks = keystrokeDraft.trim();

    // Drop the entry we're editing first (if any), then look for a
    // duplicate of the target appName in what remains. If one exists,
    // overwrite it; otherwise append. This collapses accidental
    // "rename-into-existing" + "create-duplicate" cases into a single
    // predictable "there is always exactly one row per appName".
    const base =
      editingIndex != null
        ? overrides.filter((_, i) => i !== editingIndex)
        : overrides;

    const dupIdx = base.findIndex(
      (o) => o.appName.trim().toLowerCase() === name.toLowerCase(),
    );

    const entry: PasteOverride = {
      appName: name,
      keystroke: ks,
      iconBase64: iconBase64Draft,
    };

    const next: PasteOverride[] =
      dupIdx !== -1
        ? base.map((o, i) => (i === dupIdx ? entry : o))
        : [...base, entry];

    update({ pasteOverrides: next });
    closeModal();
  };

  const handleRemove = (index: number) => {
    const next = overrides.filter((_, i) => i !== index);
    update({ pasteOverrides: next });
  };

  return (
    <div
      style={{
        // Match SettingRow vertical rhythm so the block reads as a
        // natural continuation of the group above.
        padding: "var(--sp-3) 0 var(--sp-2) 0",
        borderTop: "1px solid var(--border-faint)",
      }}
    >
      {/* Label block — mirrors SettingRow's left column. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
          marginBottom: "var(--sp-3)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-pixel-square)",
            fontSize: "var(--text-sm)",
            lineHeight: 1.3,
            color: "var(--text-primary)",
          }}
        >
          App-specific shortcuts
        </div>
        <div
          style={{
            fontFamily: "var(--font-pixel-line)",
            fontSize: "var(--text-xs)",
            lineHeight: 1.4,
            color: "var(--text-secondary)",
          }}
        >
          Override Ctrl+V for specific apps. Cursor + VS Code usually want
          Ctrl+Shift+V.
        </div>
      </div>

      {/* List (or empty hint) */}
      {overrides.length === 0 ? (
        <div
          style={{
            padding: "var(--sp-2) 0",
            fontFamily: "var(--font-pixel-line)",
            fontSize: "var(--text-xs)",
            color: "var(--text-ghost)",
          }}
        >
          No overrides yet — popo uses Ctrl+V everywhere.
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            marginBottom: "var(--sp-3)",
          }}
        >
          {overrides.map((o, i) => (
            <OverrideRow
              key={`${o.appName.toLowerCase()}-${i}`}
              override={o}
              onEdit={() => openEdit(i)}
              onRemove={() => handleRemove(i)}
            />
          ))}
        </div>
      )}

      {/* Add button — full-width, dashed border, AppWindow icon. */}
      <AddOverrideButton onClick={openCreate} />

      {/* Modal (create + edit share the same form) */}
      <Modal
        open={modalOpen}
        onClose={closeModal}
        width={520}
        label={
          editingIndex == null ? "New paste shortcut" : "Edit paste shortcut"
        }
      >
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
          {editingIndex == null ? "New paste shortcut" : "Edit paste shortcut"}
        </h2>

        <div
          style={{
            marginTop: "var(--sp-6)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--sp-4)",
          }}
        >
          <Field
            label="App"
            description="Pick the application where popo should send a different keystroke instead of Ctrl+V."
          >
            <AppPicker
              single
              values={appNameDraft ? [appNameDraft] : []}
              onChange={(v) => {
                const nextName = v[0] ?? "";
                setAppNameDraft(nextName);
                // Chip removed → drop the stashed icon too so we don't
                // leak it into a different app name.
                if (v.length === 0) setIconBase64Draft(undefined);
              }}
              onSelect={(app) => {
                // Fires on NEW adds only. For manual-entry adds
                // (user typed a name), `iconBase64` is undefined —
                // that's fine, we just won't persist an icon for it.
                setIconBase64Draft(app.iconBase64);
              }}
              iconHints={
                iconBase64Draft && appNameDraft
                  ? { [appNameDraft]: iconBase64Draft }
                  : undefined
              }
              placeholder="Pick an app…"
              minWidth={300}
              aria-label="App for this override"
            />
          </Field>

          <Field
            label="Keystroke"
            description="Press the keys you want popo to send in this app. Most apps use Ctrl+V, but e.g. Cursor uses Ctrl+Shift+V for paste-without-formatting."
          >
            <HotkeyInput value={keystrokeDraft} onChange={setKeystrokeDraft} />
          </Field>
        </div>

        <div
          style={{
            marginTop: "var(--sp-8)",
            display: "flex",
            justifyContent: "flex-end",
            gap: "var(--sp-3)",
          }}
        >
          <Button variant="ghost" onClick={closeModal}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={!canSave}>
            Save
          </Button>
        </div>
      </Modal>
    </div>
  );
}

// ─── Row ──────────────────────────────────────────────────────────

function OverrideRow({
  override,
  onEdit,
  onRemove,
}: {
  override: PasteOverride;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const parts = override.keystroke
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-3)",
        padding: "6px 10px 6px 8px",
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-button)",
        minHeight: 40,
      }}
    >
      {/* App name block (~180px) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: 180,
          flexShrink: 0,
          fontFamily: "var(--font-pixel-square)",
          fontSize: "var(--text-sm)",
          color: "var(--text-primary)",
          whiteSpace: "nowrap",
          overflow: "hidden",
        }}
      >
        {override.iconBase64 ? (
          <img
            src={`data:image/png;base64,${override.iconBase64}`}
            alt=""
            width={18}
            height={18}
            style={{
              borderRadius: 4,
              objectFit: "contain",
              flexShrink: 0,
            }}
          />
        ) : (
          <AppWindow
            size={14}
            weight="regular"
            color="var(--text-secondary)"
            style={{ flexShrink: 0 }}
          />
        )}
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {override.appName}
        </span>
      </div>

      {/* Keystroke chips */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 4,
          minWidth: 0,
        }}
      >
        {parts.length === 0 ? (
          <span
            style={{
              fontFamily: "var(--font-pixel-line)",
              fontSize: "var(--text-xs)",
              color: "var(--text-ghost)",
            }}
          >
            —
          </span>
        ) : (
          parts.map((part, i) => (
            <span
              key={`${part}-${i}`}
              style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              <kbd
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "0 6px",
                  height: 20,
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-micro)",
                  fontFamily: "var(--font-pixel-square)",
                  fontSize: "var(--text-xs)",
                  lineHeight: 1.2,
                  color: "var(--text-primary)",
                  whiteSpace: "nowrap",
                }}
              >
                {part}
              </kbd>
              {i < parts.length - 1 && (
                <span
                  style={{
                    fontFamily: "var(--font-pixel-grid)",
                    fontSize: "var(--text-xs)",
                    color: "var(--text-ghost)",
                  }}
                >
                  +
                </span>
              )}
            </span>
          ))
        )}
      </div>

      {/* Actions — always visible (the enclosing block is already a
          Settings-level row; no further hover affordance needed). */}
      <div
        style={{ display: "flex", gap: 2, flexShrink: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <IconButton label="Edit" onClick={onEdit}>
          <PencilSimple size={14} weight="regular" />
        </IconButton>
        <IconButton label="Remove" onClick={onRemove}>
          <Trash size={14} weight="regular" />
        </IconButton>
      </div>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 28,
        background: hovered ? "var(--bg-surface)" : "transparent",
        border: "1px solid transparent",
        borderRadius: "var(--radius-micro)",
        color: hovered ? "var(--text-primary)" : "var(--text-secondary)",
        cursor: "pointer",
        transition: "color 120ms ease, background-color 120ms ease",
      }}
    >
      {children}
    </button>
  );
}

// ─── Add button ───────────────────────────────────────────────────

function AddOverrideButton({ onClick }: { onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        width: "100%",
        height: 40,
        background: "transparent",
        border: `1px dashed ${
          hovered ? "var(--border-default)" : "var(--border-subtle)"
        }`,
        borderRadius: "var(--radius-button)",
        fontFamily: "var(--font-pixel-square)",
        fontSize: "var(--text-sm)",
        lineHeight: 1.2,
        color: hovered ? "var(--text-primary)" : "var(--text-secondary)",
        cursor: "pointer",
        transition: "color 120ms ease, border-color 120ms ease",
      }}
    >
      <AppWindow size={14} weight="regular" />
      <span>Add override</span>
    </button>
  );
}

// ─── Field helper (copied inline per task spec) ────────────────────

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
