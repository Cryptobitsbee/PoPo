import { useState } from "react";
import { Plus } from "@phosphor-icons/react";

/**
 * NewModeCard — the dashed-border "+ New Mode" tile that sits at the
 * end of the modes grid.
 *
 * Per brief §3 Modes:
 *   Same size (min-height 120px)
 *   Dashed border (border-style: dashed) --border-subtle
 *   Centered content: Plus 18px + "New Mode" GeistPixelSquare --text-sm --text-secondary
 *   Hover: border --border-default, content --text-primary
 */

export interface NewModeCardProps {
  onClick: () => void;
}

export default function NewModeCard({ onClick }: NewModeCardProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-label="New mode"
      style={{
        minHeight: 120,
        padding: "var(--sp-6)",
        background: "transparent",
        border: `1px dashed ${
          hovered ? "var(--border-default)" : "var(--border-subtle)"
        }`,
        borderRadius: "var(--radius-card)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--sp-2)",
        cursor: "pointer",
        color: hovered ? "var(--text-primary)" : "var(--text-secondary)",
        transition: "border-color 180ms ease, color 180ms ease",
      }}
    >
      <Plus size={18} weight="regular" />
      <span
        style={{
          fontFamily: "var(--font-pixel-square)",
          fontSize: "var(--text-sm)",
          lineHeight: 1.2,
        }}
      >
        New Mode
      </span>
    </button>
  );
}
