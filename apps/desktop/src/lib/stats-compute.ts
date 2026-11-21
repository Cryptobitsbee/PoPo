import type { Session } from "@popo/shared-types";

/**
 * stats-compute.ts — pure aggregation functions for the Stats page.
 *
 * No React, no dates, no side effects. Hand-tested pure functions so
 * Phase 2 [6] can use them server-side (Rust could call equivalents)
 * and Phase 5 could add unit tests without jumping through React setup.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// ── Top-line metrics ────────────────────────────────────────────────

export interface StatsMetrics {
  totalWords: number;
  totalSessions: number;
  totalMs: number;
  /** Estimated speech + AI spend in USD. */
  gcpCostUsd: number;
}

/**
 * Compute the 4-number headline row.
 *
 * Cost comes from each session's stored `gcpCostEstimate`, which Rust
 * computes at capture time with the pricing of whichever engine actually
 * ran. Summing the stored values is what keeps history correct across
 * the Chirp 3 to Gemini 3.5 Transcribe Live migration: Chirp-era
 * sessions keep Chirp-era pricing, and newer sessions carry token-based
 * pricing, without this function needing to know which is which.
 *
 * Two bugs previously lived here. It recomputed cost from total duration
 * and ignored the stored per-session value entirely, and it applied
 * Chirp's 15-second rounding ONCE over the aggregate rather than per
 * request. For 100 four-second dictations that reported $0.108 against a
 * true $0.40, a roughly 4x under-estimate, while the comment claimed it
 * over-estimated.
 *
 * The fallback below only exists for very old records written before
 * `gcpCostEstimate` was persisted. It rounds per session, which is how
 * Chirp actually billed.
 */
const LEGACY_CHIRP_USD_PER_15S = 0.004;

export function computeMetrics(sessions: Session[]): StatsMetrics {
  let totalWords = 0;
  let totalMs = 0;
  let gcpCostUsd = 0;
  for (const s of sessions) {
    totalWords += s.wordCount;
    totalMs += s.durationMs;
    if (typeof s.gcpCostEstimate === "number") {
      gcpCostUsd += s.gcpCostEstimate;
    } else {
      gcpCostUsd +=
        Math.ceil(s.durationMs / 1000 / 15) * LEGACY_CHIRP_USD_PER_15S;
    }
  }
  return {
    totalWords,
    totalSessions: sessions.length,
    totalMs,
    // Float addition drifts; round to the cent-fraction we display.
    gcpCostUsd: Math.round(gcpCostUsd * 10000) / 10000,
  };
}

// ── Language breakdown ──────────────────────────────────────────────

export interface LanguageBucket {
  language: string;
  sessions: number;
  words: number;
}

export function computeLanguageBuckets(sessions: Session[]): LanguageBucket[] {
  const map = new Map<string, LanguageBucket>();
  for (const s of sessions) {
    const existing = map.get(s.language);
    if (existing) {
      existing.sessions += 1;
      existing.words += s.wordCount;
    } else {
      map.set(s.language, {
        language: s.language,
        sessions: 1,
        words: s.wordCount,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.sessions - a.sessions);
}

// ── Weekly heatmap ──────────────────────────────────────────────────

export interface WeekDay {
  /** ISO date (YYYY-MM-DD) for matching + tooltips. */
  date: string;
  /** Short weekday label (Mon / Tue / ...). */
  label: string;
  /** True for today — used for the subtle emphasis on the current cell. */
  isToday: boolean;
  sessions: number;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/**
 * Return the last 7 calendar days (oldest-first) with session counts.
 * The heatmap UI shows Mon→Sun visually; if the user's locale starts
 * weeks on Sunday they'll see the same order still oldest-first, which
 * is the correct reading for a recent-days heatmap.
 */
export function computeWeekBuckets(
  sessions: Session[],
  now: number = Date.now(),
): WeekDay[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const todayStamp = today.getTime();

  const days: WeekDay[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(todayStamp - i * DAY);
    days.push({
      date: isoDate(d),
      label: DAY_LABELS[d.getDay()],
      isToday: i === 0,
      sessions: 0,
    });
  }

  const byDate = new Map(days.map((d) => [d.date, d]));
  for (const s of sessions) {
    const d = new Date(s.createdAt);
    d.setHours(0, 0, 0, 0);
    const bucket = byDate.get(isoDate(d));
    if (bucket) bucket.sessions += 1;
  }
  return days;
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ── Formatters ──────────────────────────────────────────────────────

/** USD cost formatter — scales precision by magnitude. */
export function formatCost(usd: number): string {
  if (usd <= 0) return "$0.00";
  if (usd < 0.01) return "<$0.01";
  if (usd < 1) return `$${usd.toFixed(3)}`;
  if (usd < 100) return `$${usd.toFixed(2)}`;
  return `$${Math.round(usd)}`;
}

/** Hours/minutes formatter — compact display. */
export function formatHoursCompact(ms: number): string {
  if (ms <= 0) return "0m";
  const hours = ms / HOUR;
  if (hours < 1) {
    const mins = Math.max(1, Math.round(ms / MINUTE));
    return `${mins}m`;
  }
  if (hours < 10) return `${hours.toFixed(1)}h`;
  return `${Math.round(hours)}h`;
}
