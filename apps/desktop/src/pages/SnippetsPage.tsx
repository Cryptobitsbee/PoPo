import { useMemo, useState } from "react";
import { Plus, Pencil, Trash, Warning } from "@phosphor-icons/react";
import type { Snippet } from "@popo/shared-types";
import { useSnippetsStore } from "../store/snippetsStore";
import Button from "../components/shared/Button";
import Modal from "../components/shared/Modal";
import Input from "../components/shared/Input";
import Textarea from "../components/shared/Textarea";
import { COMMON_WORDS_LOWERCASE } from "../lib/common-words";

/**
 * SnippetsPage — text expansion shortcuts.
 *
 * Flow: the user dictates a trigger word (say "addr"), the Rust
 * post-processing step substitutes its value ("221B Baker Street, …")
 * before pasting. Matching is whole-word, case-insensitive, case-
 * preserving (see hotkey::expand_snippets).
 *
 * UX:
 *   - Primary table: trigger + preview of value + usageCount badge + actions
 *   - Inline add/edit via a Modal with two fields (trigger, value) + label
 *   - On save, warn (but don't block) if the trigger is a common English word
 *     that would expand mid-sentence constantly (e.g. "the", "address")
 */

export default function SnippetsPage() {
  const snippets = useSnippetsStore((s) => s.snippets);
  const upsert = useSnippetsStore((s) => s.upsert);
  const remove = useSnippetsStore((s) => s.remove);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Snippet | null>(null);

  const openNew = () => {
    setEditing(null);
    setEditorOpen(true);
  };
  const openEdit = (s: Snippet) => {
    setEditing(s);
    setEditorOpen(true);
  };

  // Sort: most-used first, then alphabetical by trigger.
  const sorted = useMemo(
    () =>
      [...snippets].sort((a, b) => {
        const cu = (b.usageCount ?? 0) - (a.usageCount ?? 0);
        if (cu !== 0) return cu;
        return a.trigger.localeCompare(b.trigger);
      }),
    [snippets],
  );

  return (
    <div
      style={{
        padding: "var(--sp-8) var(--sp-10)",
        maxWidth: 1040,
        margin: "0 auto",
      }}
    >
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
          Snippets
        </h1>

        <Button
          variant="subtle"
          iconLeft={<Plus size={14} weight="regular" />}
          onClick={openNew}
        >
          New snippet
        </Button>
      </div>

      <p
        style={{
          marginTop: "var(--sp-3)",
          marginBottom: "var(--sp-8)",
          fontFamily: "var(--font-pixel-line)",
          fontSize: "var(--text-xs)",
          lineHeight: 1.55,
          color: "var(--text-secondary)",
          maxWidth: 560,
        }}
      >
        Dictate a short trigger word, get the full text pasted. Matching is
        whole-word and case-insensitive — "addr" expands but "address" doesn't.
      </p>

      {sorted.length === 0 ? (
        <EmptyState onNew={openNew} />
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
          }}
        >
          {sorted.map((s) => (
            <SnippetRow
              key={s.id}
              snippet={s}
              onEdit={() => openEdit(s)}
              onDelete={() => remove(s.id)}
            />
          ))}
        </div>
      )}

      <SnippetEditor
        open={editorOpen}
        initial={editing}
        onClose={() => setEditorOpen(false)}
        onSave={(snippet) => {
          upsert(snippet);
          setEditorOpen(false);
        }}
      />
    </div>
  );
}

// ── Row ─────────────────────────────────────────────────────────────

function SnippetRow({
  snippet,
  onEdit,
  onDelete,
}: {
  snippet: Snippet;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  // Compact preview: strip newlines, first 100 chars.
  const preview = snippet.value.replace(/\s+/g, " ").slice(0, 100);
  const truncated = snippet.value.length > 100;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onEdit}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-4)",
        minHeight: 64,
        padding: "var(--sp-3) var(--sp-2)",
        borderBottom: "1px solid var(--border-faint)",
        background: hovered ? "var(--bg-surface)" : "transparent",
        cursor: "pointer",
        transition: "background-color 120ms ease",
      }}
    >
      {/* Trigger chip */}
      <div
        style={{
          flexShrink: 0,
          minWidth: 96,
          padding: "4px 10px",
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-badge)",
          fontFamily: "var(--font-pixel-grid)",
          fontSize: "var(--text-xs)",
          color: "var(--text-primary)",
          textAlign: "center",
        }}
      >
        {snippet.trigger}
      </div>

      {/* Value preview */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        {snippet.label && (
          <div
            style={{
              // Session 53: unified section-heading style. SnippetRow
              // captions are inline-row labels rather than full
              // section headers, so we keep them slightly tighter
              // (text-xs vs text-sm) but use the readable square
              // font and secondary color so they're visible.
              fontFamily: "var(--font-pixel-square)",
              fontSize: "var(--text-xs)",
              color: "var(--text-secondary)",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              fontWeight: 500,
            }}
          >
            {snippet.label}
          </div>
        )}
        <div
          style={{
            fontFamily: "var(--font-pixel-line)",
            fontSize: "var(--text-sm)",
            lineHeight: 1.45,
            color: "var(--text-primary)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {preview}
          {truncated ? "…" : ""}
        </div>
      </div>

      {/* Usage count + hover actions */}
      <div
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-2)",
        }}
      >
        {snippet.usageCount > 0 && (
          <span
            style={{
              fontFamily: "var(--font-pixel-grid)",
              fontSize: "var(--text-xs)",
              // Session 54: ghost → secondary so the usage count
              // (e.g. "5×") is readable next to each snippet row.
              color: "var(--text-secondary)",
              fontVariantNumeric: "tabular-nums",
              minWidth: 24,
              textAlign: "right",
            }}
          >
            {snippet.usageCount}×
          </span>
        )}
        <div
          style={{
            display: "flex",
            gap: 4,
            opacity: hovered ? 1 : 0,
            pointerEvents: hovered ? "auto" : "none",
            transition: "opacity 120ms ease",
          }}
        >
          <IconButton
            label="Edit"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
          >
            <Pencil size={14} weight="regular" />
          </IconButton>
          <IconButton
            label="Delete"
            tone="destructive"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash size={14} weight="regular" />
          </IconButton>
        </div>
      </div>
    </div>
  );
}

function IconButton({
  children,
  label,
  onClick,
  tone = "default",
}: {
  children: React.ReactNode;
  label: string;
  onClick: (e: React.MouseEvent) => void;
  tone?: "default" | "destructive";
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 28,
        height: 28,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
        border: "none",
        borderRadius: "var(--radius-micro)",
        color: hovered
          ? tone === "destructive"
            ? "var(--accent-error)"
            : "var(--text-primary)"
          : "var(--text-secondary)",
        cursor: "pointer",
        transition: "color 120ms ease",
      }}
    >
      {children}
    </button>
  );
}

// ── Empty state ─────────────────────────────────────────────────────

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div
      style={{
        marginTop: "var(--sp-10)",
        textAlign: "center",
        padding: "var(--sp-8)",
      }}
    >
      <h2
        style={{
          margin: 0,
          fontFamily: "var(--font-pixel-square)",
          fontSize: "var(--text-lg)",
          fontWeight: 500,
          color: "var(--text-primary)",
        }}
      >
        No snippets yet.
      </h2>
      <p
        style={{
          margin: "var(--sp-3) auto 0",
          maxWidth: 420,
          fontFamily: "var(--font-pixel-line)",
          fontSize: "var(--text-sm)",
          lineHeight: 1.55,
          color: "var(--text-secondary)",
        }}
      >
        Try `addr` for your address, `sig` for an email signature, `omw` for "on
        my way". Short triggers, long expansions.
      </p>
      <div style={{ marginTop: "var(--sp-6)" }}>
        <Button
          variant="primary"
          iconLeft={<Plus size={14} weight="regular" />}
          onClick={onNew}
        >
          Add your first snippet
        </Button>
      </div>
    </div>
  );
}

// ── Editor modal ────────────────────────────────────────────────────

function SnippetEditor({
  open,
  initial,
  onClose,
  onSave,
}: {
  open: boolean;
  initial: Snippet | null;
  onClose: () => void;
  onSave: (snippet: Snippet) => void;
}) {
  const [trigger, setTrigger] = useState(initial?.trigger ?? "");
  const [value, setValue] = useState(initial?.value ?? "");
  const [label, setLabel] = useState(initial?.label ?? "");

  // Reset local state every time the modal opens with a different target.
  useMemo(() => {
    setTrigger(initial?.trigger ?? "");
    setValue(initial?.value ?? "");
    setLabel(initial?.label ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.id, open]);

  // Warn when the trigger is a common English word. Non-blocking.
  const commonWordWarning = useMemo(() => {
    const t = trigger.trim().toLowerCase();
    if (!t) return null;
    if (COMMON_WORDS_LOWERCASE.has(t)) {
      return `"${trigger.trim()}" is a common English word — consider a distinctive trigger like ":${trigger.trim()}" or a short code so it doesn't expand mid-sentence.`;
    }
    return null;
  }, [trigger]);

  const canSave = trigger.trim().length > 0 && value.length > 0;

  const commit = () => {
    if (!canSave) return;
    const now = Date.now();
    const id = initial?.id ?? `snippet-${now}`;
    const saved: Snippet = {
      id,
      trigger: trigger.trim(),
      value,
      label: label.trim() || undefined,
      createdAt: initial?.createdAt ?? now,
      updatedAt: now,
      usageCount: initial?.usageCount ?? 0,
    };
    onSave(saved);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={560}
      label={initial ? "Edit snippet" : "New snippet"}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-5)",
        }}
      >
        {/* Title */}
        <h2
          style={{
            margin: 0,
            fontFamily: "var(--font-pixel-square)",
            fontSize: "var(--text-lg)",
            fontWeight: 500,
            color: "var(--text-primary)",
          }}
        >
          {initial ? "Edit snippet" : "New snippet"}
        </h2>
        {/* Trigger */}
        <Field
          label="Trigger"
          description="The word you dictate to expand this snippet."
        >
          <Input
            value={trigger}
            onChange={(e) => setTrigger(e.target.value)}
            placeholder="e.g. addr"
            monospace
            autoFocus
          />
          {commonWordWarning && (
            <div
              role="alert"
              style={{
                marginTop: 8,
                padding: "8px 10px",
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                background: "var(--bg-surface)",
                border: "1px solid var(--border-default)",
                borderRadius: "var(--radius-micro)",
                fontFamily: "var(--font-pixel-line)",
                fontSize: "var(--text-xs)",
                color: "var(--text-secondary)",
                lineHeight: 1.5,
              }}
            >
              <Warning
                size={14}
                weight="regular"
                color="var(--text-secondary)"
                style={{ flexShrink: 0, marginTop: 1 }}
              />
              <span>{commonWordWarning}</span>
            </div>
          )}
        </Field>

        {/* Value */}
        <Field
          label="Expansion"
          description="What gets pasted in place of the trigger. Multi-line OK."
        >
          <Textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g. 221B Baker Street, London NW1 6XE, United Kingdom"
            rows={5}
          />
        </Field>

        {/* Optional label */}
        <Field
          label="Label (optional)"
          description="Helps you remember what this snippet is for."
        >
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Home address"
          />
        </Field>

        {/* Actions */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "var(--sp-2)",
            marginTop: "var(--sp-2)",
          }}
        >
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={commit} disabled={!canSave}>
            {initial ? "Save" : "Create"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Form field wrapper ──────────────────────────────────────────────

function Field({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div
        style={{
          fontFamily: "var(--font-pixel-square)",
          fontSize: "var(--text-sm)",
          color: "var(--text-primary)",
        }}
      >
        {label}
      </div>
      {description && (
        <div
          style={{
            fontFamily: "var(--font-pixel-line)",
            fontSize: "var(--text-xs)",
            lineHeight: 1.4,
            color: "var(--text-secondary)",
          }}
        >
          {description}
        </div>
      )}
      <div style={{ marginTop: 2 }}>{children}</div>
    </div>
  );
}
