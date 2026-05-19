import type { ReactNode } from "react";

/**
 * SettingRow — the core row inside a SettingsGroup.
 *
 * Per brief §3 Settings:
 *   Height 56px · flex · align-center
 *   Bottom: 1px solid --border-faint
 *   Left: label GeistPixelSquare --text-sm --text-primary
 *         + optional description (GeistPixelLine --text-xs --text-secondary)
 *   Right: control slot (passed as children)
 *
 * Use with Toggle / Select / SegmentedControl / Button / HotkeyInput /
 * plain text in the control slot. The `last` prop suppresses the bottom
 * border on the final row of a group (for cleaner group separators).
 */

export interface SettingRowProps {
  label: string;
  description?: ReactNode;
  children: ReactNode;
  /** Suppress bottom border (e.g., last row in a group). */
  last?: boolean;
  /** Alignment of the control slot. Default: right. */
  align?: "right" | "left" | "stretch";
}

export default function SettingRow({
  label,
  description,
  children,
  last,
  align = "right",
}: SettingRowProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-4)",
        minHeight: 56,
        padding: "var(--sp-2) 0",
        borderBottom: last ? "none" : "1px solid var(--border-faint)",
      }}
    >
      {/* Left: label + optional description */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 2,
          minWidth: 0,
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-pixel-square)",
            fontSize: "var(--text-sm)",
            lineHeight: 1.3,
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
      </div>

      {/* Right: control */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent:
            align === "left"
              ? "flex-start"
              : align === "stretch"
                ? "stretch"
                : "flex-end",
          flexShrink: 1,
          minWidth: 0,
          maxWidth: 320,
          ...(align === "stretch" ? { flex: 1 } : {}),
        }}
      >
        {children}
      </div>
    </div>
  );
}
