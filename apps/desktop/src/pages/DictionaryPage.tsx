import { useMemo, useState } from "react";
import { Plus, Trash, Star } from "@phosphor-icons/react";
import type { DictionaryEntry } from "@popo/shared-types";
import { useDictionaryStore } from "../store/dictionaryStore";
import PageShell from "../components/layout/PageShell";
import Button from "../components/shared/Button";
import Input from "../components/shared/Input";

/**
 * DictionaryPage - custom vocabulary hints for Gemini 3.5 Transcribe Live.
 *
 * Flow: the user adds phrases the model often mis-transcribes (names,
 * place names, technical terms). The Rust side attaches them as
 * `customVocabulary` on every transcription session, biasing the
 * acoustic model toward those words.
 *
 * UX: dead-simple add/list/delete. No modal, no fancy fields.
 * Unlike the old PhraseSet adaptation, this applies even when the`n * language is set to Auto-detect, so there is no longer any reason to`n * disable it.
 */

const MAX_ENTRIES = 1000; // Google accepts up to 1000 terms

export default function DictionaryPage() {
  const entries = useDictionaryStore((s) => s.entries);
  const upsert = useDictionaryStore((s) => s.upsert);
  const remove = useDictionaryStore((s) => s.remove);

  const [input, setInput] = useState("");

  // Pinned first → newest createdAt first within each pinned/unpinned
  // group. (Session 49 — feature #17.) Pinning lets the user keep
  // their most-critical phrases at the top of long dictionaries
  // regardless of when they were added.
  const sorted = useMemo(
    () =>
      [...entries].sort((a, b) => {
        const aPinned = a.pinned ? 1 : 0;
        const bPinned = b.pinned ? 1 : 0;
        if (aPinned !== bPinned) return bPinned - aPinned;
        return b.createdAt - a.createdAt;
      }),
    [entries],
  );

  const atCap = entries.length >= MAX_ENTRIES;
  const duplicate = entries.some(
    (e) => e.phrase.toLowerCase() === input.trim().toLowerCase(),
  );
  const canAdd = input.trim().length > 0 && !atCap && !duplicate;

  const add = () => {
    if (!canAdd) return;
    const now = Date.now();
    upsert({
      id: `dict-${now}`,
      phrase: input.trim(),
      createdAt: now,
    });
    setInput("");
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      add();
    }
  };

  return (
    <PageShell
      maxWidth={1040}
      header={
        <>
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
        Dictionary
      </h1>

      <p
        style={{
          marginTop: "var(--sp-3)",
          marginBottom: "var(--sp-8)",
          fontFamily: "var(--font-pixel-line)",
          fontSize: "var(--text-xs)",
          lineHeight: 1.55,
          color: "var(--text-secondary)",
          maxWidth: 620,
        }}
      >
        Words or short phrases the model should recognise exactly. Good for names
        (Aarav, Bengaluru), technical terms (Kubernetes, ReactJS), or any word
        you've seen mis-transcribed. Up to {MAX_ENTRIES} entries.
      </p>
        </>
      }
    >

      {/* Input row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-2)",
          marginBottom: "var(--sp-6)",
        }}
      >
        <div style={{ flex: 1 }}>
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="e.g. Bengaluru"
            disabled={atCap}
          />
        </div>
        <Button
          variant="primary"
          iconLeft={<Plus size={14} weight="regular" />}
          onClick={add}
          disabled={!canAdd}
        >
          Add
        </Button>
      </div>

      {duplicate && input.trim().length > 0 && (
        <p
          role="alert"
          style={{
            margin: "0 0 var(--sp-4)",
            fontFamily: "var(--font-pixel-line)",
            fontSize: "var(--text-xs)",
            color: "var(--text-secondary)",
          }}
        >
          This phrase is already in your dictionary.
        </p>
      )}

      {atCap && (
        <p
          role="alert"
          style={{
            margin: "0 0 var(--sp-4)",
            fontFamily: "var(--font-pixel-line)",
            fontSize: "var(--text-xs)",
            color: "var(--accent-error)",
          }}
        >
          You've reached the {MAX_ENTRIES}-entry cap. Remove something to add
          more.
        </p>
      )}

      {/* List */}
      {sorted.length === 0 ? (
        <EmptyState />
      ) : (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "var(--sp-2)",
          }}
        >
          {sorted.map((entry) => (
            <PhraseChip
              key={entry.id}
              entry={entry}
              onDelete={() => remove(entry.id)}
              onTogglePin={() => upsert({ ...entry, pinned: !entry.pinned })}
            />
          ))}
        </div>
      )}

      {/* Footer count */}
      {sorted.length > 0 && (
        <p
          style={{
            marginTop: "var(--sp-8)",
            fontFamily: "var(--font-pixel-grid)",
            fontSize: "var(--text-xs)",
            // Session 54: ghost → secondary so "N phrases" is
            // readable. ghost was disappearing on dark backgrounds.
            color: "var(--text-secondary)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {sorted.length} {sorted.length === 1 ? "phrase" : "phrases"}
        </p>
      )}
    </PageShell>
  );
}

// ── Phrase chip ─────────────────────────────────────────────────────

function PhraseChip({
  entry,
  onDelete,
  onTogglePin,
}: {
  entry: DictionaryEntry;
  onDelete: () => void;
  onTogglePin: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const isPinned = !!entry.pinned;
  return (
    <span
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        // Slightly tighter left padding when pinned to leave room
        // for the filled star icon being slightly heavier visually.
        padding: isPinned ? "6px 4px 6px 8px" : "6px 4px 6px 12px",
        background: hovered ? "var(--bg-high)" : "var(--bg-elevated)",
        border: `1px solid ${
          isPinned ? "var(--border-default)" : "var(--border-subtle)"
        }`,
        borderRadius: "var(--radius-pill)",
        fontFamily: "var(--font-pixel-line)",
        fontSize: "var(--text-sm)",
        color: "var(--text-primary)",
        transition: "background-color 120ms ease, border-color 120ms ease",
      }}
    >
      {/* Pin button — visible when pinned (always shown to give the
          user feedback) OR when hovered (so they can pin a fresh
          entry). When unpinned + un-hovered, hidden to keep the
          chip visually quiet. (Session 49 feature #17.) */}
      {(isPinned || hovered) && (
        <button
          type="button"
          aria-label={
            isPinned ? `Unpin ${entry.phrase}` : `Pin ${entry.phrase}`
          }
          aria-pressed={isPinned}
          title={isPinned ? "Unpin" : "Pin to top"}
          onClick={onTogglePin}
          style={{
            width: 22,
            height: 22,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
            border: "none",
            borderRadius: "var(--radius-pill)",
            color: isPinned ? "var(--text-primary)" : "var(--text-ghost)",
            cursor: "pointer",
            transition: "color 120ms ease",
            padding: 0,
            marginRight: 2,
          }}
        >
          <Star size={12} weight={isPinned ? "fill" : "regular"} />
        </button>
      )}
      <span style={{ paddingLeft: !isPinned && !hovered ? 0 : 4 }}>
        {entry.phrase}
      </span>
      <button
        type="button"
        aria-label={`Remove ${entry.phrase}`}
        title="Remove"
        onClick={onDelete}
        style={{
          width: 22,
          height: 22,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
          border: "none",
          borderRadius: "var(--radius-pill)",
          color: hovered ? "var(--text-secondary)" : "var(--text-ghost)",
          cursor: "pointer",
          transition: "color 120ms ease",
          padding: 0,
          marginLeft: 4,
        }}
      >
        <Trash size={12} weight="regular" />
      </button>
    </span>
  );
}

// ── Empty state ─────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div
      style={{
        padding: "var(--sp-8) 0",
        textAlign: "center",
      }}
    >
      <p
        style={{
          margin: 0,
          fontFamily: "var(--font-pixel-line)",
          fontSize: "var(--text-sm)",
          color: "var(--text-ghost)",
        }}
      >
        Nothing here yet. Add a phrase above.
      </p>
    </div>
  );
}
