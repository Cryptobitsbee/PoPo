import { motion } from "framer-motion";
import type { WeekDay } from "../../lib/stats-compute";

/**
 * WeekHeatmap — 7 columns (one per day of the last week), each a
 * DotMatrix-style cell with opacity scaled by session intensity.
 *
 * Per brief §3 Stats:
 *   7 columns Mon–Sun
 *   Each column: day label (GeistPixelGrid --text-2xs --text-ghost)
 *                + DotMatrix cell (opacity varies 0.1→1.0 by intensity)
 *
 * The cell is a 5×5 grid of `--text-primary` dots with a single shared
 * opacity value = 0.1 + (intensity * 0.9). Zero-session days show the
 * minimum 0.1 opacity (still faintly visible) to convey "we have data
 * for this day, just none in it", versus a missing cell which would
 * imply no data at all.
 */

export interface WeekHeatmapProps {
  days: WeekDay[];
}

export default function WeekHeatmap({ days }: WeekHeatmapProps) {
  if (days.length === 0) return null;

  const maxSessions = Math.max(...days.map((d) => d.sessions), 1);

  return (
    <section style={{ marginTop: "var(--sp-10)" }}>
      <h2
        style={{
          margin: 0,
          marginBottom: "var(--sp-4)",
          fontFamily: "var(--font-pixel-square)",
          fontSize: "var(--text-sm)",
          lineHeight: 1.2,
          fontWeight: 500,
          color: "var(--text-secondary)",
        }}
      >
        Last 7 days
      </h2>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: "var(--sp-2)",
          maxWidth: 520,
        }}
      >
        {days.map((d, i) => {
          const intensity = d.sessions / maxSessions;
          return (
            <div
              key={d.date}
              title={`${d.date} · ${d.sessions} ${d.sessions === 1 ? "session" : "sessions"}`}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
              }}
            >
              <HeatmapCell intensity={intensity} delayMs={i * 40} />
              <span
                style={{
                  fontFamily: "var(--font-pixel-grid)",
                  fontSize: "var(--text-2xs)",
                  color: d.isToday ? "var(--text-secondary)" : "var(--text-ghost)",
                  lineHeight: 1.2,
                }}
              >
                {d.label}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-pixel-grid)",
                  fontSize: "var(--text-2xs)",
                  color: "var(--text-secondary)",
                  lineHeight: 1.2,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {d.sessions}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function HeatmapCell({
  intensity,
  delayMs,
}: {
  intensity: number;
  delayMs: number;
}) {
  // 0.1 floor so zero-session days still show a faint pattern (conveys
  // "we looked at this day"); 1.0 ceiling at max intensity.
  const opacity = 0.1 + Math.min(1, Math.max(0, intensity)) * 0.9;
  const DOTS = 25; // 5×5 grid

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity }}
      transition={{
        duration: 0.35,
        delay: delayMs / 1000,
        ease: [0.25, 1, 0.5, 1],
      }}
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(5, 3px)",
        gridAutoRows: "3px",
        gap: 2,
        padding: 4,
      }}
    >
      {Array.from({ length: DOTS }).map((_, i) => (
        <span
          key={i}
          style={{
            width: 3,
            height: 3,
            borderRadius: 1,
            background: "var(--text-primary)",
            display: "block",
          }}
        />
      ))}
    </motion.div>
  );
}
