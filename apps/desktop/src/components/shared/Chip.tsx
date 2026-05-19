import type { ReactNode } from "react";

/**
 * Chip — small inline tag primitive.
 *
 * Per DESIGN_SYSTEM §9 + brief §3 History:
 *   font: GeistPixelCircle 9px · px-2 py-0.5 · bg --bg-elevated
 *   radius: --radius-badge · text: --text-secondary
 *
 * Used in SessionRow (language, mode), Modes page (later), anywhere a
 * compact inline metadata label is needed.
 */

export interface ChipProps {
  children: ReactNode;
  tone?: "default" | "muted";
  as?: "span" | "button";
  onClick?: () => void;
}

export default function Chip({
  children,
  tone = "default",
  as = "span",
  onClick,
}: ChipProps) {
  const Component = as;
  const isInteractive = as === "button" || !!onClick;

  return (
    <Component
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 18,
        padding: "0 8px",
        background: tone === "muted" ? "transparent" : "var(--bg-elevated)",
        border:
          tone === "muted" ? "1px solid var(--border-subtle)" : "1px solid transparent",
        borderRadius: "var(--radius-badge)",
        fontFamily: "var(--font-pixel-circle)",
        fontSize: "var(--text-2xs)",
        lineHeight: 1.2,
        color: "var(--text-secondary)",
        whiteSpace: "nowrap",
        cursor: isInteractive ? "pointer" : "default",
        userSelect: "none",
        transition: "border-color 120ms ease, color 120ms ease, background-color 120ms ease",
      }}
    >
      {children}
    </Component>
  );
}
