import type { ReactNode } from "react";

/**
 * StatGrid — 4-column CSS-grid container for the Stats headline metrics.
 *
 * Per brief §3 Stats:
 *   4-metric grid top, equal columns, gap --sp-4, mt --sp-6
 *
 * The 4-column-equal grid is specifically NOT the banned "3-column
 * feature cards" anti-pattern (DESIGN_SYSTEM §12.4): it's a dashboard
 * metric row idiom. If the window narrows below ~720px, cards collapse
 * to 2-col then 1-col via auto-fit.
 */

export interface StatGridProps {
  children: ReactNode;
}

export default function StatGrid({ children }: StatGridProps) {
  return (
    <div
      style={{
        marginTop: "var(--sp-6)",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: "var(--sp-4)",
      }}
    >
      {children}
    </div>
  );
}
