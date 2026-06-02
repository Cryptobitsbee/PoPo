import { useState, useRef, type ReactNode } from "react";
import { Info } from "@phosphor-icons/react";

/**
 * InfoHint — a small ℹ-in-a-circle icon that shows a tooltip on hover.
 *
 * Used inline next to a label when the full description would be too
 * long to display as inline text. The tooltip appears above the icon
 * after a 200ms hover delay, and disappears immediately on mouse leave.
 *
 * Self-contained — renders its own icon AND tooltip internally.
 * Does NOT reuse the sidebar Tooltip primitive (different pattern).
 */

export interface InfoHintProps {
  /** The full description to show in the tooltip. Accepts ReactNode for flexibility. */
  text: ReactNode;
}

export default function InfoHint({ text }: InfoHintProps) {
  const [visible, setVisible] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const show = () => {
    timer.current = window.setTimeout(() => setVisible(true), 200);
  };

  const hide = () => {
    if (timer.current !== undefined) {
      window.clearTimeout(timer.current);
      timer.current = undefined;
    }
    setVisible(false);
  };

  return (
    <span
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
      {visible && (
        <span
          role="tooltip"
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            left: "50%",
            transform: "translateX(-50%)",
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 6,
            padding: "8px 12px",
            fontFamily: "var(--font-pixel-square)",
            fontSize: "var(--text-xs)",
            lineHeight: 1.45,
            color: "var(--text-secondary)",
            maxWidth: 280,
            width: "max-content",
            whiteSpace: "normal",
            pointerEvents: "none",
            zIndex: 50,
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}
