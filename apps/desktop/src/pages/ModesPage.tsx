import { useState } from "react";
import { Plus } from "@phosphor-icons/react";
import type { Mode } from "@popo/shared-types";
import { useModesStore } from "../store/modesStore";
import Button from "../components/shared/Button";
import ModeGrid from "../components/modes/ModeGrid";
import ModeEditor from "../components/modes/ModeEditor";
import ConfirmDialog from "../components/shared/ConfirmDialog";

/**
 * ModesPage — brief §3 Modes.
 *
 *   Padding: --sp-8 --sp-10
 *   Title "Modes" + right-aligned "+ New Mode" button
 *   2-column grid of ModeCard + NewModeCard at the end
 *   ModeEditor modal opens on card click or "New Mode"
 */

export default function ModesPage() {
  const modes = useModesStore((s) => s.modes);
  const upsert = useModesStore((s) => s.upsert);
  const remove = useModesStore((s) => s.remove);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingMode, setEditingMode] = useState<Mode | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const pendingDeleteMode =
    pendingDeleteId != null
      ? (modes.find((m) => m.id === pendingDeleteId) ?? null)
      : null;

  const openNew = () => {
    setEditingMode(null);
    setEditorOpen(true);
  };
  const openEdit = (m: Mode) => {
    setEditingMode(m);
    setEditorOpen(true);
  };
  const handleDuplicate = (m: Mode) => {
    const now = Date.now();
    upsert({
      ...m,
      id: `mode-${now}`,
      name: `${m.name} copy`,
      isDefault: false,
      usageCount: 0,
      createdAt: now,
    });
  };
  const handleDelete = (id: string) => {
    setPendingDeleteId(id);
  };
  const confirmDelete = () => {
    if (pendingDeleteId) {
      remove(pendingDeleteId);
      setPendingDeleteId(null);
    }
  };
  const cancelDelete = () => setPendingDeleteId(null);
  const handleSave = (m: Mode) => {
    upsert(m);
  };

  return (
    <div
      style={{
        padding: "var(--sp-8) var(--sp-10)",
        maxWidth: 1040,
        margin: "0 auto",
      }}
    >
      {/* Title + New Mode button row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--sp-4)",
        }}
      >
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--font-pixel-square)",
            fontSize: "var(--text-xl)",
            fontWeight: 500,
            lineHeight: 1.1,
            color: "var(--text-primary)",
          }}
        >
          Modes
        </h1>

        <Button
          variant="subtle"
          iconLeft={<Plus size={14} weight="regular" />}
          onClick={openNew}
        >
          New Mode
        </Button>
      </div>

      {/* Subtle hint under the title */}
      <p
        style={{
          marginTop: "var(--sp-3)",
          marginBottom: 0,
          fontFamily: "var(--font-pixel-line)",
          fontSize: "var(--text-xs)",
          lineHeight: 1.5,
          color: "var(--text-secondary)",
          maxWidth: 520,
        }}
      >
        Modes are named presets for the AI polish step. Auto-format must be
        enabled in Settings before any mode, app binding, or mode hotkey can
        change a transcript.
      </p>

      {/* Grid */}
      <ModeGrid
        modes={modes}
        onEdit={openEdit}
        onDuplicate={handleDuplicate}
        onDelete={handleDelete}
        onNew={openNew}
      />

      {/* Editor modal */}
      <ModeEditor
        open={editorOpen}
        mode={editingMode}
        onClose={() => setEditorOpen(false)}
        onSave={handleSave}
      />

      {/* Delete-confirmation dialog */}
      <ConfirmDialog
        open={pendingDeleteId !== null}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
        title={`Delete "${pendingDeleteMode?.name ?? "mode"}"?`}
        description={
          <>
            This will permanently remove the mode and any app bindings, hotkey,
            and sound preset configured for it.
            <br />
            <br />
            Factory-default modes (Auto, Casual, Professional, Email, Code)
            re-seed automatically when the app restarts, so deletion is
            reversible for those.
          </>
        }
        confirmLabel="Delete mode"
      />

      {/* Bottom breathing room */}
      <div style={{ height: "var(--sp-12)" }} />
    </div>
  );
}
