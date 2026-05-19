import { useState, useRef, type ReactNode } from "react";
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
 * controls in Phase 4 pages that need them.
 *
 * Not rendered via portal (keeping Phase 4 [10] simple). If tooltips need
 * to escape an `overflow:hidden` parent in later phases, switch to portal.
 */

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
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const show = () => {
    if (delay > 0) {
      timer.current = window.setTimeout(() => setOpen(true), delay);
    } else {
      setOpen(true);
    }
  };
  const hide = () => {
    if (timer.current !== undefined) {
      window.clearTimeout(timer.current);
      timer.current = undefined;
    }
    setOpen(false);
  };

  const positionStyles: React.CSSProperties =
    side === "right"
      ? {
          left: "calc(100% + 8px)",
          top: "50%",
          transform: "translateY(-50%)",
        }
      : {
          top: "calc(100% + 8px)",
          left: "50%",
          transform: "translateX(-50%)",
        };

  const entranceOffset =
    side === "right" ? { x: -4, y: 0 } : { x: 0, y: -4 };

  return (
    <div
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      style={{ position: "relative", display: "inline-flex" }}
    >
      {children}
      <AnimatePresence>
        {open && (
          <motion.span
            role="tooltip"
            initial={{ opacity: 0, ...entranceOffset }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.1, ease: [0.25, 1, 0.5, 1] }}
            style={{
              position: "absolute",
              ...positionStyles,
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-badge)",
              padding: "6px 12px",
              fontFamily: "var(--font-pixel-square)",
              fontSize: "var(--text-xs)",
              lineHeight: 1.2,
              color: "var(--text-primary)",
              whiteSpace: "nowrap",
              pointerEvents: "none",
              zIndex: 50,
            }}
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}
