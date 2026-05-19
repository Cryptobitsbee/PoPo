import type { ReactNode } from "react";

/**
 * SettingsGroup — uppercase label + group of SettingRows.
 *
 * Per brief §3 Settings:
 *   Group label: GeistPixelGrid --text-xs --text-ghost
 *                UPPERCASE letter-spacing 0.1em
 *   mt --sp-10 between groups
 *
 * Label sits above the group's rows with --sp-4 gap. First group on the
 * page doesn't need the --sp-10 top-margin (the page has its own
 * spacing from the title); set `first` on it.
 */

export interface SettingsGroupProps {
  label: string;
  children: ReactNode;
  first?: boolean;
  /** Optional action slot rendered to the right of the label (e.g. a test button). */
  headerAction?: ReactNode;
}

export default function SettingsGroup({
  label,
  children,
  first,
  headerAction,
}: SettingsGroupProps) {
  return (
    <section
      style={{
        marginTop: first ? "var(--sp-8)" : "var(--sp-10)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--sp-4)",
          marginBottom: "var(--sp-4)",
        }}
      >
        <h2
          style={{
            fontFamily: "var(--font-pixel-grid)",
            fontSize: "var(--text-xs)",
            lineHeight: 1.2,
            color: "var(--text-ghost)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            fontWeight: 500,
            margin: 0,
          }}
        >
          {label}
        </h2>
        {headerAction ? (
          <div style={{ flexShrink: 0 }}>{headerAction}</div>
        ) : null}
      </div>
      <div>{children}</div>
    </section>
  );
}
