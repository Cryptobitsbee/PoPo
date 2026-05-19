import { useMemo } from "react";
import { useHistoryStore } from "../store/historyStore";
import {
  computeMetrics,
  computeLanguageBuckets,
  computeWeekBuckets,
  formatCost,
  formatHoursCompact,
} from "../lib/stats-compute";
import StatGrid from "../components/stats/StatGrid";
import StatCard from "../components/stats/StatCard";
import LanguageBreakdown from "../components/stats/LanguageBreakdown";
import WeekHeatmap from "../components/stats/WeekHeatmap";

/**
 * StatsPage — brief §3 Stats.
 *
 *   Title "Stats"
 *   4-metric grid: Total Words / Sessions / Hours / Est. Cost
 *   Language breakdown bars (staggered mount)
 *   Weekly heatmap (7 DotMatrix cells, opacity by intensity)
 *
 * All data is computed from `historyStore.sessions`, which is populated
 * by either (a) useHistorySync subscribing to Firestore when signed in,
 * or (b) useSessionSave prepending new dictations. Fresh installs with
 * no sessions yet show empty metrics — we no longer seed demo data.
 */

export default function StatsPage() {
  const sessions = useHistoryStore((s) => s.sessions);

  const metrics = useMemo(() => computeMetrics(sessions), [sessions]);
  const languageBuckets = useMemo(
    () => computeLanguageBuckets(sessions),
    [sessions],
  );
  const weekDays = useMemo(() => computeWeekBuckets(sessions), [sessions]);

  return (
    <div
      style={{
        padding: "var(--sp-8) var(--sp-10)",
        maxWidth: 1040,
        margin: "0 auto",
      }}
    >
      <h1
        style={{
          margin: 0,
          fontFamily: "var(--font-pixel-square)",
          fontSize: "var(--text-xl)",
          lineHeight: 1.1,
          fontWeight: 500,
          color: "var(--text-primary)",
        }}
      >
        Stats
      </h1>

      <p
        style={{
          marginTop: "var(--sp-3)",
          marginBottom: 0,
          maxWidth: 520,
          fontFamily: "var(--font-pixel-line)",
          fontSize: "var(--text-xs)",
          color: "var(--text-secondary)",
          lineHeight: 1.5,
        }}
      >
        Usage across all your sessions. Cost is estimated at the Chirp standard
        tier ($0.016 / minute) and ignores the 60-min monthly free allowance.
      </p>

      {/* 4-metric headline */}
      <StatGrid>
        <StatCard value={metrics.totalWords} label="Total words" />
        <StatCard value={metrics.totalSessions} label="Sessions" />
        <StatCard
          value={metrics.totalMs}
          label="Dictated"
          format={formatHoursCompact}
        />
        <StatCard
          value={metrics.gcpCostUsd}
          label="Est. cost"
          format={formatCost}
        />
      </StatGrid>

      {/* Breakdown sections */}
      <LanguageBreakdown buckets={languageBuckets} />
      <WeekHeatmap days={weekDays} />

      {/* Bottom breathing room */}
      <div style={{ height: "var(--sp-12)" }} />
    </div>
  );
}
