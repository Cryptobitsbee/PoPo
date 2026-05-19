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
  /** Estimated GCP Chirp STT cost in USD. */
  gcpCostUsd: number;
}

/**
 * Compute the 4-number headline row.
 *
 * GCP Chirp 2 standard tier (late 2025): $0.004 per 15-second increment
 * ($0.016/min). We simplify the display by ignoring the 60-minutes-per-
 * month free allowance — accurate enough for a quick "how much did I
 * spend" gauge, and errs on the conservative (over-estimate) side.
 */
export function computeMetrics(sessions: Session[]): StatsMetrics {
  let totalWords = 0;
  let totalMs = 0;
  for (const s of sessions) {
    totalWords += s.wordCount;
    totalMs += s.durationMs;
  }
  const billedSeconds = totalMs / 1000;
  const billedIncrements = Math.ceil(billedSeconds / 15);
  const gcpCostUsd = billedIncrements * 0.004;
  return {
    totalWords,
    totalSessions: sessions.length,
    totalMs,
    gcpCostUsd,
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
