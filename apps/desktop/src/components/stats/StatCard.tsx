import { useEffect, useRef, useState } from "react";

/**
 * StatCard — one of the 4 headline metrics on the Stats page.
 *
 * Per brief §3 Stats:
 *   Card: bg --bg-surface, border 1px --border-subtle,
 *         radius --radius-card, padding --sp-6
 *   Value: GeistPixelSquare --text-stat --text-primary
 *   Label: GeistPixelGrid --text-xs --text-secondary, mt --sp-2
 *   Numbers animate count-up on mount (600ms)
 *
 * Uses requestAnimationFrame for the count-up (not Framer Motion's
 * animate() so we don't pull that into the Stats chunk just for 4
 * numbers). Easing is ease-out-quart per impeccable motion-design.md.
 */

export interface StatCardProps {
  value: number;
  label: string;
  /** Formatter for display. Default: integer with locale grouping. */
  format?: (n: number) => string;
  /** Count-up duration in ms. */
  duration?: number;
}

export default function StatCard({
  value,
  label,
  format = (n) => Math.round(n).toLocaleString(),
  duration = 600,
}: StatCardProps) {
  const [displayed, setDisplayed] = useState(0);
  const startRef = useRef<number | null>(null);
  const targetRef = useRef(value);

  useEffect(() => {
    targetRef.current = value;
    startRef.current = null;
    let rafId: number;
    const step = (now: number) => {
      if (startRef.current == null) startRef.current = now;
      const elapsed = now - startRef.current;
      const t = Math.min(elapsed / duration, 1);
      // ease-out-quart
      const eased = 1 - Math.pow(1 - t, 4);
      setDisplayed(targetRef.current * eased);
      if (t < 1) rafId = requestAnimationFrame(step);
      else setDisplayed(targetRef.current);
    };
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [value, duration]);

  return (
    <div
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-card)",
        padding: "var(--sp-6)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-2)",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-pixel-square)",
          fontSize: "var(--text-stat)",
          lineHeight: 1.1,
          color: "var(--text-primary)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {format(displayed)}
      </div>
      <div
        style={{
          fontFamily: "var(--font-pixel-grid)",
          fontSize: "var(--text-xs)",
          lineHeight: 1.2,
          color: "var(--text-secondary)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </div>
    </div>
  );
}
