import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Copy, Paperclip, Play, Trash } from "@phosphor-icons/react";
import type { Session, Mode } from "@popo/shared-types";
import Chip from "../shared/Chip";
import SessionDetail from "./SessionDetail";
import HighlightedTranscript from "./HighlightedTranscript";
import { useAppIconsStore } from "../../store/appIconsStore";
import { useSnippetsStore } from "../../store/snippetsStore";
import {
  relativeTime,
  formatDuration,
  formatWordCount,
} from "../../lib/time-format";

/**
 * SessionRow — full-width row in the History list.
 *
 * Per brief §3 History:
 *   Height 72px · padding --sp-4 --sp-2
 *   Hover: bg --bg-surface (120ms ease)
 *   Bottom border: 1px solid --border-faint
 *   Line 1: transcript preview (GeistPixelLine --text-base --text-primary,
 *           2 lines max, fade gradient mask)
 *   Line 2: [language chip] [mode chip]  ·  [date]  ·  [duration]
 *           GeistPixelGrid --text-xs --text-secondary
 *   Right actions (hover-revealed, 120ms): Copy · Play · Delete
 *   Active/selected: bg --bg-high · 2px left edge line --text-primary
 *
 * Notes:
 *   - The 2px left edge on active is a BRIEF EXCEPTION to impeccable's
 *     "no side-stripe borders > 1px" rule (logged in DESIGN_SYSTEM §12.3).
 *     Kept intentionally; do not propagate the pattern elsewhere.
 *   - Play is enabled when `audioStoragePath` (local) or `audioDownloadUrl`
 *     (cloud) is available. Local files use `convertFileSrc` + HTML5 audio
 *     element. Cloud files use the Firebase Storage download URL directly.
 */

export interface SessionRowProps {
  session: Session;
  mode?: Mode;
  selected: boolean;
  onSelect: () => void;
  onCopy: () => void;
  onDelete: () => void;
}

const itemVariants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.15 } },
  exit: { opacity: 0, transition: { duration: 0.12 } },
};

export default function SessionRow({
  session,
  mode,
  selected,
  onSelect,
  onCopy,
  onDelete,
}: SessionRowProps) {
  const [hovered, setHovered] = useState(false);

  // Delayed unmount: when `selected` flips false, the grid's
  // `grid-template-rows: 1fr → 0fr` animation needs the child
  // content to REMAIN mounted for the full 240 ms or the detail
  // panel vanishes while the row is still shrinking — that's the
  // "harsh close" the user saw when clicking another row. We unmount
  // on a 260 ms timer instead, so the audio player / transcript
  // fade out smoothly with the row's height.
  const [detailMounted, setDetailMounted] = useState(selected);
  useEffect(() => {
    if (selected) {
      setDetailMounted(true);
      return;
    }
    const t = setTimeout(() => setDetailMounted(false), 260);
    return () => clearTimeout(t);
  }, [selected]);

  // Has-audio signal drives the Play action on the hover-row. Actual
  // playback lives in SessionDetail (single <audio> element, proper
  // scrubber + time display) which mounts when the row is selected.
  const hasAudio = Boolean(
    session.audioDownloadUrl || session.audioStoragePath,
  );

  const transcript = session.formattedTranscript ?? session.rawTranscript;
  const appName = session.appName ?? "Unknown app";
  // Prefer the deduped store (one icon per app, shared across sessions
  // + hydrated from Firestore on sign-in). Fall back to the session's
  // own icon for in-memory in-session rendering before sync catches up,
  // or for sessions created before the dedup feature shipped.
  const storeIcon = useAppIconsStore((s) => s.iconsByName[appName]);
  const appIcon = storeIcon ?? session.appIcon;

  // Snippet label resolution — look up current snippet by id to use
  // the user's current `label` (or fall back to `trigger`). If the
  // snippet has been deleted since this session recorded, fall back
  // to the expansion's own `trigger` so the chip still reads usefully.
  // Dedupe by snippetId so multi-fires of the same snippet count once.
  const snippets = useSnippetsStore((s) => s.snippets);
  const snippetById = useMemo(() => {
    const m = new Map<string, (typeof snippets)[number]>();
    for (const s of snippets) m.set(s.id, s);
    return m;
  }, [snippets]);
  const uniqueSnippetNames = useMemo(() => {
    if (!session.expandedSnippets) return [] as string[];
    const seen = new Set<string>();
    const names: string[] = [];
    for (const e of session.expandedSnippets) {
      if (seen.has(e.snippetId)) continue;
      seen.add(e.snippetId);
      const snip = snippetById.get(e.snippetId);
      names.push(snip?.label || snip?.trigger || e.trigger);
    }
    return names;
  }, [session.expandedSnippets, snippetById]);

  return (
    <motion.div
      variants={itemVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      data-selected={selected || undefined}
      style={{
        position: "relative",
        background: selected
          ? "var(--bg-high)"
          : hovered
            ? "var(--bg-surface)"
            : "transparent",
        borderBottom: "1px solid var(--border-faint)",
        // Match the 240ms detail-expand so the bg fade lands with the
        // content rather than flashing ahead of it.
        transition: "background-color 240ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      {/* Active-state left edge indicator (2px, brief-exception to impeccable §12.3) */}
      {selected && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            width: 2,
            background: "var(--text-primary)",
          }}
        />
      )}

      {/* Header (clickable) — the "short view" that toggles the detail panel */}
      <div
        onClick={onSelect}
        style={{
          minHeight: 72,
          padding: "var(--sp-4) var(--sp-2)",
          paddingRight: "var(--sp-4)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--sp-4)",
          cursor: "pointer",
        }}
      >
        {/* Left column: transcript + metadata (transcript always on top,
            metadata below — matches the collapsed row's reading order). */}
        <div
          style={{
            flex: 1,
            minWidth: 0, // allow truncation
            display: "flex",
            flexDirection: "column",
            gap: selected ? "var(--sp-3)" : 4,
          }}
        >
          {selected ? (
            // Expanded: full transcript, no clamp, selectable. No
            // stopPropagation — we want a click on the text to close
            // the row (drag-select still works because drag fires
            // mousedown/mousemove/mouseup, not a click). Snippet
            // expansions get subtle highlights + hover tooltips via
            // HighlightedTranscript.
            <HighlightedTranscript
              text={transcript}
              expansions={session.expandedSnippets ?? []}
              variant="interactive"
              style={{
                fontFamily: "var(--font-pixel-line)",
                fontSize: "var(--text-base)",
                lineHeight: 1.55,
                color: "var(--text-primary)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                userSelect: "text",
              }}
            />
          ) : (
            // Collapsed: 2-line clamp + fade. Snippet expansions
            // render as quiet highlights; no tooltip (would be
            // clipped by the fade mask anyway).
            <HighlightedTranscript
              text={transcript}
              expansions={session.expandedSnippets ?? []}
              variant="inline"
              style={{
                fontFamily: "var(--font-pixel-line)",
                fontSize: "var(--text-base)",
                lineHeight: 1.4,
                color: "var(--text-primary)",
                display: "-webkit-box",
                WebkitBoxOrient: "vertical" as const,
                WebkitLineClamp: 2,
                overflow: "hidden",
                maskImage:
                  "linear-gradient(to right, black 85%, transparent 100%)",
                WebkitMaskImage:
                  "linear-gradient(to right, black 85%, transparent 100%)",
              }}
            />
          )}

          {/* Metadata row — always directly below the transcript */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-2)",
              flexWrap: "wrap",
              fontFamily: "var(--font-pixel-grid)",
              fontSize: "var(--text-xs)",
              color: "var(--text-secondary)",
            }}
          >
            <AppChip name={appName} iconBase64={appIcon} />
            {mode && <Chip>{mode.name}</Chip>}
            {uniqueSnippetNames.length > 0 && (
              <span
                title={`Used: ${uniqueSnippetNames.join(", ")}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "0 8px 0 6px",
                  height: 20,
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-badge)",
                  fontFamily: "var(--font-pixel-grid)",
                  fontSize: "var(--text-xs)",
                  color: "var(--text-secondary)",
                  maxWidth: 220,
                  overflow: "hidden",
                  flexShrink: 0,
                }}
              >
                <Paperclip
                  size={10}
                  weight="regular"
                  style={{ flexShrink: 0 }}
                />
                <span
                  style={{
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {uniqueSnippetNames.slice(0, 2).join(", ")}
                  {uniqueSnippetNames.length > 2 &&
                    ` +${uniqueSnippetNames.length - 2}`}
                </span>
              </span>
            )}
            <span style={{ color: "var(--text-ghost)" }}>·</span>
            <span>{relativeTime(session.createdAt)}</span>
            <span style={{ color: "var(--text-ghost)" }}>·</span>
            <span>{formatDuration(session.durationMs)}</span>
            <span style={{ color: "var(--text-ghost)" }}>·</span>
            <span>{formatWordCount(session.wordCount)}</span>
          </div>
        </div>

        {/* Right column: hover-revealed actions. Hidden while the
            detail panel is open — those actions live inside the
            detail view to avoid redundant controls. */}
        {!selected && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-1)",
              opacity: hovered ? 1 : 0,
              transition: "opacity 120ms ease",
              pointerEvents: hovered ? "auto" : "none",
              flexShrink: 0,
            }}
          >
            <RowAction
              icon={Copy}
              label="Copy transcript"
              onClick={(e) => {
                e.stopPropagation();
                onCopy();
              }}
            />
            <RowAction
              icon={Play}
              label={
                hasAudio
                  ? "Open to play recording"
                  : "No audio — enable Store audio in Settings"
              }
              disabled={!hasAudio}
              onClick={(e) => {
                e.stopPropagation();
                // Playing is available in the detail view. Opening
                // that is the same gesture as clicking the row, so
                // just toggle selection on.
                if (hasAudio) onSelect();
              }}
            />
            <RowAction
              icon={Trash}
              label="Delete session"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              tone="destructive"
            />
          </div>
        )}
      </div>

      {/* Expanded detail panel — full transcript + audio player.
          Height animates via the CSS grid 0fr↔1fr trick. WebView2
          (Chromium 117+) supports this natively, which gives a
          single browser-layer animation — no Framer layout pass,
          no double-animation feel. The inner wrapper keeps
          overflow:hidden so the detail clips cleanly while the
          grid row collapses. */}
      <div
        style={{
          display: "grid",
          gridTemplateRows: selected ? "1fr" : "0fr",
          transition: "grid-template-rows 240ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        <div style={{ overflow: "hidden", minHeight: 0 }}>
          {detailMounted && (
            <SessionDetail
              session={session}
              onCopy={onCopy}
              onDelete={onDelete}
            />
          )}
        </div>
      </div>
    </motion.div>
  );
}

interface RowActionProps {
  icon: typeof Copy;
  label: string;
  onClick?: (e: React.MouseEvent) => void;
  disabled?: boolean;
  tone?: "default" | "destructive";
}

function RowAction({
  icon: Icon,
  label,
  onClick,
  disabled,
  tone = "default",
}: RowActionProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={(e) => onClick?.(e)}
      style={{
        width: 28,
        height: 28,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        background: "transparent",
        border: "none",
        borderRadius: "var(--radius-micro)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.35 : 1,
      }}
    >
      <Icon
        size={14}
        weight="regular"
        color={
          hovered && !disabled
            ? tone === "destructive"
              ? "var(--accent-error)"
              : "var(--text-primary)"
            : "var(--text-secondary)"
        }
        style={{ transition: "color 120ms ease" }}
      />
    </button>
  );
}

// ── App chip ────────────────────────────────────────────────
//
// Tiny pill showing the app's icon (if we have one) + its name.
// Replaces the old locale-code chip (which read like a dev label).
// When the icon is missing we still render the label; the chip's left
// padding tightens so the text doesn't float awkwardly.

function AppChip({ name, iconBase64 }: { name: string; iconBase64?: string }) {
  const hasIcon = Boolean(iconBase64);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: hasIcon ? "0 8px 0 3px" : "0 8px",
        height: 20,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-badge)",
        fontFamily: "var(--font-pixel-grid)",
        fontSize: "var(--text-xs)",
        color: "var(--text-primary)",
        maxWidth: 180,
        overflow: "hidden",
      }}
      title={name}
    >
      {hasIcon && (
        <img
          src={`data:image/png;base64,${iconBase64}`}
          alt=""
          width={14}
          height={14}
          style={{
            borderRadius: 3,
            objectFit: "contain",
            flexShrink: 0,
          }}
        />
      )}
      <span
        style={{
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {name}
      </span>
    </span>
  );
}
