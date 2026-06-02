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
            // Session 53: bumped from --font-pixel-grid →
            // --font-pixel-square so group labels (RECORDING /
            // TRANSCRIPTION / etc.) actually render legibly. Grid
            // is a graph-paper variant that, like Line, drops detail
            // at small sizes. Square is the readable workhorse.
            //
            // Also bumped --text-xs → --text-sm and --text-ghost →
            // --text-secondary so these section dividers carry the
            // visual weight users need to scan a long Settings page.
            // Letter-spacing 0.12em + uppercase keeps them clearly
            // identifiable as section headers (vs. the row labels
            // below them which are mixed-case).
            fontFamily: "var(--font-pixel-square)",
            fontSize: "var(--text-sm)",
            lineHeight: 1.2,
            color: "var(--text-secondary)",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
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
