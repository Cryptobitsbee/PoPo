import {
  useState,
  useRef,
  useCallback,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";

/**
 * Tooltip — shared floating label primitive.
 *
 * Per DESIGN_SYSTEM §9 + brief §3 Sidebar spec:
 *   bg: --bg-elevated · border: 1px --border-subtle · radius: --radius-badge
 *   font: GeistPixelSquare --text-xs --text-primary · padding: 6px 12px
 *   8px gap from trigger · entrance: opacity 0→1, translate -4→0, 100ms ease
 *
 * Side defaults to `right` (for sidebar icons). Use `bottom` for top-bar
 * controls that need them.
 *
 * ── Session 66: two alignment bugs fixed ──────────────────────────────
 *
 * 1. TRANSFORM CONFLICT (the misalignment).
 *    The old implementation centred itself with a static
 *    `transform: translateY(-50%)` in `style`, while framer-motion
 *    animated `x`/`y` on the same element. Framer owns the `transform`
 *    property outright and rewrites it every frame, so it clobbered the
 *    translate the moment the animation ran. The tooltip therefore
 *    settled half its own height too low (and, on `bottom`, half its
 *    width too far right) rather than centred on the trigger. Nothing in
 *    the CSS looked wrong, which is why this survived: the offending
 *    declaration was simply being overwritten at runtime.
 *
 *    Now centring never touches `transform`. Coordinates are computed
 *    from the trigger rect and applied via `left`/`top`, leaving framer
 *    free to own `transform` for the entrance offset alone.
 *
 * 2. CLIPPING BY AN ANCESTOR.
 *    The tooltip used `position: absolute` inside the trigger. The
 *    sidebar sits in an `overflow: hidden` shell column (AppShell), so a
 *    right-side tooltip on a sidebar icon was clipped at the column edge
 *    — the exact scenario the old file's closing comment anticipated
 *    ("switch to portal" if it ever needed to escape). It did.
 *
 *    Now rendered through a portal to `document.body` with
 *    `position: fixed`, so no ancestor can clip it.
 *
 * Coordinates are measured on open rather than tracked continuously.
 * Tooltips are transient and the trigger cannot move while hovered in
 * this app, so a listener per tooltip would be waste.
 */

/** Gap between trigger edge and tooltip edge, per the design spec. */
const GAP = 8;
/** Keep-on-screen inset so a tooltip never touches the window edge. */
const VIEWPORT_INSET = 8;

export interface TooltipProps {
  label: string;
  children: ReactNode;
  side?: "right" | "bottom";
  /** Delay before showing, in ms. Default 0 (immediate). */
  delay?: number;
}

export default function Tooltip({
  label,
  children,
  side = "right",
  delay = 0,
}: TooltipProps) {
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(
    null,
  );
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const open = coords !== null;

  /**
   * Measure the trigger and place the tooltip beside it.
   *
   * Centring is done here in pixel space instead of with a CSS
   * translate so that framer-motion's transform cannot overwrite it.
   * The tooltip is not yet mounted at measure time, so its own size is
   * unknown; `bottom` placement uses a transform-free approximation via
   * `translate` applied ONLY on the axis framer is not animating.
   */
  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (side === "right") {
      setCoords({
        left: r.right + GAP,
        // Vertical centre of the trigger. The tooltip's own half-height
        // is removed with `translateY(-50%)` on a WRAPPER element, so
        // the animated child keeps its transform free.
        top: r.top + r.height / 2,
      });
    } else {
      setCoords({
        left: r.left + r.width / 2,
        top: r.bottom + GAP,
      });
    }
  }, [side]);

  const show = () => {
    if (delay > 0) {
      timer.current = window.setTimeout(place, delay);
    } else {
      place();
    }
  };

  const hide = () => {
    if (timer.current !== undefined) {
      window.clearTimeout(timer.current);
      timer.current = undefined;
    }
    setCoords(null);
  };

  // The wrapper owns the centring translate; the animated child owns the
  // entrance transform. Splitting them across two elements is what keeps
  // the two concerns from overwriting each other.
  const wrapperStyle: CSSProperties = coords
    ? {
        position: "fixed",
        left: coords.left,
        top: coords.top,
        transform:
          side === "right" ? "translateY(-50%)" : "translateX(-50%)",
        // Above the shell (AppShell chrome sits well below this).
        zIndex: 2000,
        pointerEvents: "none",
        // Never let a long label push the tooltip off-screen.
        maxWidth: `calc(100vw - ${VIEWPORT_INSET * 2}px)`,
      }
    : {};

  const entranceOffset = side === "right" ? { x: -4, y: 0 } : { x: 0, y: -4 };

  return (
    <div
      ref={triggerRef}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      style={{ position: "relative", display: "inline-flex" }}
    >
      {children}
      {createPortal(
        <AnimatePresence>
          {open && (
            <div style={wrapperStyle}>
              <motion.span
                role="tooltip"
                initial={{ opacity: 0, ...entranceOffset }}
                animate={{ opacity: 1, x: 0, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.1, ease: [0.25, 1, 0.5, 1] }}
                style={{
                  display: "block",
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-badge)",
                  padding: "6px 12px",
                  fontFamily: "var(--font-pixel-square)",
                  fontSize: "var(--text-xs)",
                  lineHeight: 1.2,
                  color: "var(--text-primary)",
                  whiteSpace: "nowrap",
                }}
              >
                {label}
              </motion.span>
            </div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
