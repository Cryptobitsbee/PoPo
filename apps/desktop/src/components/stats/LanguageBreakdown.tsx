import { motion } from "framer-motion";
import type { LanguageBucket } from "../../lib/stats-compute";

/**
 * LanguageBreakdown — horizontal-bar list of session counts per language.
 *
 * Per brief §3 Stats:
 *   Label: "Languages"  GeistPixelSquare --text-sm --text-secondary
 *   Bar rows: language name (left) + bar (center, grows 0→value on mount)
 *     Bar: height 4px, bg --bg-elevated, fill --text-primary, radius 9999
 *     Staggered mount animation 60ms per row
 *   Count right: GeistPixelGrid --text-xs --text-ghost
 *
 * Animation: each row's bar fill transitions width 0 → target with a
 * 60ms-per-row stagger and 500ms ease-out-quart.
 */

export interface LanguageBreakdownProps {
  buckets: LanguageBucket[];
}

export default function LanguageBreakdown({ buckets }: LanguageBreakdownProps) {
  if (buckets.length === 0) return null;

  const maxSessions = Math.max(...buckets.map((b) => b.sessions), 1);

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
        Languages
      </h2>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-3)",
        }}
      >
        {buckets.map((b, i) => (
          <LanguageBar
            key={b.language}
            language={b.language}
            sessions={b.sessions}
            fraction={b.sessions / maxSessions}
            delayMs={i * 60}
          />
        ))}
      </div>
    </section>
  );
}

function LanguageBar({
  language,
  sessions,
  fraction,
  delayMs,
}: {
  language: string;
  sessions: number;
  fraction: number;
  delayMs: number;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "100px 1fr 60px",
        alignItems: "center",
        gap: "var(--sp-3)",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-pixel-grid)",
          fontSize: "var(--text-xs)",
          color: "var(--text-secondary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {language}
      </span>

      <div
        style={{
          height: 4,
          background: "var(--bg-elevated)",
          borderRadius: 9999,
          overflow: "hidden",
        }}
      >
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(2, fraction * 100)}%` }}
          transition={{
            duration: 0.5,
            delay: delayMs / 1000,
            ease: [0.25, 1, 0.5, 1],
          }}
          style={{
            height: "100%",
            background: "var(--text-primary)",
            borderRadius: 9999,
          }}
        />
      </div>

      <span
        style={{
          fontFamily: "var(--font-pixel-grid)",
          fontSize: "var(--text-xs)",
          color: "var(--text-ghost)",
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {sessions}
      </span>
    </div>
  );
}
