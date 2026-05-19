import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { SnippetExpansion } from "@popo/shared-types";

/**
 * HighlightedTranscript — renders a transcript string with subtle
 * visual highlights at each snippet-expansion range.
 *
 * Two variants:
 *   - "inline": used in collapsed rows where the container applies its
 *     own 2-line clamp + fade mask. No tooltips (would be clipped by
 *     the mask anyway, and the row is not the place for interaction).
 *   - "interactive": used in the expanded view where hovering a
 *     highlight surfaces a tiny tooltip with the original trigger
 *     → expanded value. Tooltip is rendered in a React Portal into
 *     document.body and positioned via getBoundingClientRect so it
 *     escapes any scroll container / overflow-hidden ancestor. Flips
 *     below the span when there isn't enough room above. Closes on
 *     scroll (any ancestor, capture-phase) because position:fixed
 *     would otherwise stay pinned to the viewport while the trigger
 *     moves.
 *
 * The highlight itself is deliberately quiet: a subtle elevated
 * background + 1px underline accent. Never a colour change — snippet
 * expansions are a detail, not a callout.
 *
 * Char indexing uses Array.from so surrogate-pair Unicode (emoji,
 * some CJK) is treated as one character — matches the Rust backend
 * which also emits char (not byte, not UTF-16) offsets.
 */

export interface HighlightedTranscriptProps {
  text: string;
  expansions: SnippetExpansion[];
  /**
   * "inline" for collapsed rows (no tooltip, visual only),
   * "interactive" for expanded views (hover shows trigger → value).
   */
  variant: "inline" | "interactive";
  /**
   * Pass-through styles to the container. Consumers own font, colour,
   * line-clamp, whiteSpace, etc. This component only owns the
   * highlight visual + optional tooltip.
   */
  style?: CSSProperties;
  className?: string;
}

type Segment =
  | { kind: "plain"; start: number; end: number }
  | { kind: "hit"; start: number; end: number; exp: SnippetExpansion };

// Warn-once so a malformed session doesn't spam the console on every
// render. Module-level (shared across all instances) is intentional.
let warned = false;

export default function HighlightedTranscript({
  text,
  expansions,
  variant,
  style,
  className,
}: HighlightedTranscriptProps) {
  // Fast path: no expansions → skip the segment machinery entirely.
  if (!expansions || expansions.length === 0) {
    return (
      <div style={style} className={className}>
        {text}
      </div>
    );
  }

  const chars = Array.from(text);
  const sorted = [...expansions].sort((a, b) => a.startChar - b.startChar);

  const segments: Segment[] = [];
  let cursor = 0;
  let anyInvalid = false;

  for (const e of sorted) {
    const inBounds =
      e.startChar >= 0 && e.endChar > e.startChar && e.endChar <= chars.length;
    const nonOverlapping = e.startChar >= cursor;
    if (!inBounds || !nonOverlapping) {
      anyInvalid = true;
      continue;
    }
    if (e.startChar > cursor) {
      segments.push({ kind: "plain", start: cursor, end: e.startChar });
    }
    segments.push({ kind: "hit", start: e.startChar, end: e.endChar, exp: e });
    cursor = e.endChar;
  }
  if (cursor < chars.length) {
    segments.push({ kind: "plain", start: cursor, end: chars.length });
  }

  if (anyInvalid && !warned) {
    warned = true;
    // eslint-disable-next-line no-console
    console.warn(
      "[HighlightedTranscript] one or more snippet expansions had out-of-bounds or overlapping char offsets; affected expansions skipped.",
    );
  }

  // If every expansion was invalid, segments still covers the whole
  // string as a single plain segment — we render it fine without
  // crashing, which matches the spec.
  return (
    <div style={style} className={className}>
      {segments.map((s, i) => {
        const content = chars.slice(s.start, s.end).join("");
        if (s.kind === "plain") {
          return <span key={i}>{content}</span>;
        }
        if (variant === "inline") {
          return <InlineHighlight key={i} text={content} />;
        }
        return (
          <InteractiveHighlight key={i} text={content} expansion={s.exp} />
        );
      })}
    </div>
  );
}

// ── Highlight span (no tooltip) ─────────────────────────────
// Shared visual vocabulary between inline + interactive variants so
// a collapsed row and its expanded counterpart look identical at rest.

const highlightBaseStyle: CSSProperties = {
  background: "var(--bg-elevated)",
  borderBottom: "1px solid var(--text-secondary)",
  padding: "0 2px",
  borderRadius: 2,
};

function InlineHighlight({ text }: { text: string }) {
  return <span style={highlightBaseStyle}>{text}</span>;
}

// ── Interactive highlight (with tooltip) ─────────────────────

interface InteractiveHighlightProps {
  text: string;
  expansion: SnippetExpansion;
}

// Approximate tooltip box dimensions used for overflow-aware placement.
// These are intentional estimates — the real tooltip is max-width
// 320 + 2 lines of text at ~14px + 16px padding ≈ 56px tall. Slightly
// conservative so we flip to bottom a beat earlier than strictly
// necessary rather than clipping.
const TOOLTIP_EST_HEIGHT = 56;
const TOOLTIP_MAX_WIDTH = 320;
const VIEWPORT_PAD = 8;

function InteractiveHighlight({ text, expansion }: InteractiveHighlightProps) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    placement: "top" | "bottom";
  } | null>(null);
  const spanRef = useRef<HTMLSpanElement>(null);
  const hoverTimerRef = useRef<number | null>(null);

  const valueDisplay =
    expansion.value.length > 200
      ? expansion.value.slice(0, 200) + "…"
      : expansion.value;

  const calcPos = () => {
    const el = spanRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const roomAbove = rect.top;
    const placement: "top" | "bottom" =
      roomAbove < TOOLTIP_EST_HEIGHT + 12 ? "bottom" : "top";
    const top =
      placement === "top" ? rect.top - TOOLTIP_EST_HEIGHT - 4 : rect.bottom + 4;
    // Anchor left-aligned to the span, then clamp within the viewport
    // so long expansions near the right edge don't overflow offscreen.
    const maxLeft = window.innerWidth - TOOLTIP_MAX_WIDTH - VIEWPORT_PAD;
    const left = Math.max(VIEWPORT_PAD, Math.min(rect.left, maxLeft));
    setPos({ top, left, placement });
  };

  const handleEnter = () => {
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(() => {
      calcPos();
      setShow(true);
    }, 80);
  };
  const handleLeave = () => {
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setShow(false);
  };

  // Close on scroll (capture-phase so any ancestor scroll counts).
  // position:fixed tooltips otherwise stay pinned to the viewport
  // while the trigger span moves with the scroll — visually wrong.
  useEffect(() => {
    if (!show) return;
    const onScroll = () => setShow(false);
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [show]);

  // Clean up the hover timer on unmount so a pending setShow(true)
  // doesn't fire after the component is gone.
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
    };
  }, []);

  return (
    <>
      <span
        ref={spanRef}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        style={{
          ...highlightBaseStyle,
          cursor: "help",
        }}
      >
        {text}
      </span>
      {show &&
        pos &&
        createPortal(
          <div
            role="tooltip"
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              maxWidth: TOOLTIP_MAX_WIDTH,
              minWidth: 180,
              padding: "8px 10px",
              background: "var(--bg-surface)",
              border: "1px solid var(--border-default)",
              borderRadius: "var(--radius-button)",
              zIndex: 9999,
              pointerEvents: "none",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-pixel-circle)",
                fontSize: "var(--text-xs)",
                color: "var(--text-secondary)",
              }}
            >
              {expansion.trigger}
            </span>
            <span
              style={{
                fontFamily: "var(--font-pixel-line)",
                fontSize: "var(--text-sm)",
                color: "var(--text-primary)",
                lineHeight: 1.4,
                whiteSpace: "normal",
                wordBreak: "break-word",
              }}
            >
              {valueDisplay}
            </span>
          </div>,
          document.body,
        )}
    </>
  );
}
