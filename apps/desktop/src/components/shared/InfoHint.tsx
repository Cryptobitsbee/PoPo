import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Info } from "@phosphor-icons/react";

/**
 * InfoHint — a small ℹ-in-a-circle icon that shows a tooltip on hover.
 *
 * Used inline next to a label when the full description would be too
 * long to display as inline text. The tooltip appears above the icon
 * after a 200ms hover delay, and disappears immediately on mouse leave.
 *
 * Renders its own icon. The popover is PORTALLED to document.body.
 *
 * ── Session 66: clipping fix ──────────────────────────────────────────
 *
 * The popover used `position: absolute` inside the hint's own <span>, so
 * every ancestor with `overflow: hidden` or a scroll container could cut
 * it off. On Settings rows the text was sliced down its left edge and the
 * top line was lost entirely, because the row and the page scroll body
 * both clip.
 *
 * That is the same defect the sidebar Tooltip had. Both are fixed the
 * same way: measure the trigger, then render at `position: fixed` through
 * a portal so no ancestor can clip it.
 *
 * It also now flips below the icon when there is not enough room above,
 * and is clamped horizontally to the viewport — a 280px popover on a
 * right-aligned Settings control would otherwise overflow the window.
 *
 * Still deliberately separate from the sidebar `Tooltip` primitive: this
 * one wraps multi-line prose, has a hover delay, and points up rather
 * than sideways.
 */

/** Gap between the icon and the popover. */
const GAP = 6;
/** Minimum inset from the window edge. */
const INSET = 8;
/** Matches maxWidth below; used for horizontal clamping before measure. */
const MAX_W = 280;

export interface InfoHintProps {
  /** The full description to show in the tooltip. Accepts ReactNode for flexibility. */
  text: ReactNode;
}

export default function InfoHint({ text }: InfoHintProps) {
  const [pos, setPos] = useState<{
    left: number;
    top: number;
    below: boolean;
  } | null>(null);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const visible = pos !== null;

  const place = () => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();

    // Clamp the horizontal centre so a wide popover cannot leave the
    // window. Half the max width is the worst case, which is the right
    // bound to use since the real width is unknown until after mount.
    const half = MAX_W / 2;
    const centre = Math.min(
      Math.max(r.left + r.width / 2, INSET + half),
      window.innerWidth - INSET - half,
    );

    // Prefer above (the established direction). Flip below only when
    // there genuinely is not room, which is what was happening to rows
    // near the top of the Settings page.
    const roomAbove = r.top;
    const below = roomAbove < 72;

    setPos({
      left: centre,
      top: below ? r.bottom + GAP : r.top - GAP,
      below,
    });
  };

  const show = () => {
    timer.current = window.setTimeout(place, 200);
  };

  const hide = () => {
    if (timer.current !== undefined) {
      window.clearTimeout(timer.current);
      timer.current = undefined;
    }
    setPos(null);
  };

  return (
    <span
      ref={anchorRef}
      onMouseEnter={show}
      onMouseLeave={hide}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        cursor: "default",
      }}
    >
      <Info
        size={13}
        weight="regular"
        style={{
          color: visible ? "var(--text-secondary)" : "var(--text-ghost)",
          transition: "color 150ms ease",
        }}
      />
      {pos &&
        createPortal(
          <span
            role="tooltip"
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top,
              // Horizontal centring plus, when pointing up, lifting the
              // box clear of the icon by its own height.
              transform: pos.below
                ? "translateX(-50%)"
                : "translate(-50%, -100%)",
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 6,
              padding: "8px 12px",
              fontFamily: "var(--font-pixel-square)",
              fontSize: "var(--text-xs)",
              lineHeight: 1.45,
              color: "var(--text-secondary)",
              maxWidth: MAX_W,
              width: "max-content",
              whiteSpace: "normal",
              pointerEvents: "none",
              zIndex: 2000,
              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            }}
          >
            {text}
          </span>,
          document.body,
        )}
    </span>
  );
}
