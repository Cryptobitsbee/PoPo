/**
 * time-format.ts — tiny formatters for session metadata.
 *
 * No external deps (no date-fns, no luxon). Everything popo shows fits
 * in a handful of cases: "just now", "5 minutes ago", "2 hours ago",
 * "Yesterday 14:32", "Oct 23", "Jan 4, 2025". Durations are mm:ss.
 *
 * Locale: en-US for now. Phase 5 harden introduces Intl-based locales
 * that follow the Settings → Language selection.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Short relative label for a past timestamp (epoch ms). */
export function relativeTime(ts: number, now: number = Date.now()): string {
  const diff = now - ts;
  if (diff < 0) return "just now"; // clock skew fallback
  if (diff < 30 * SECOND) return "just now";
  if (diff < MINUTE) return `${Math.floor(diff / SECOND)}s ago`;
  if (diff < HOUR) {
    const m = Math.floor(diff / MINUTE);
    return `${m} ${m === 1 ? "minute" : "minutes"} ago`;
  }
  if (diff < DAY) {
    const h = Math.floor(diff / HOUR);
    return `${h} ${h === 1 ? "hour" : "hours"} ago`;
  }
  if (diff < 2 * DAY) return "yesterday";
  if (diff < 7 * DAY) {
    const d = Math.floor(diff / DAY);
    return `${d} days ago`;
  }
  // Older: calendar format. Same-year: "Oct 23". Else: "Jan 4, 2024".
  const d = new Date(ts);
  const nowD = new Date(now);
  const month = d.toLocaleString("en-US", { month: "short" });
  const day = d.getDate();
  if (d.getFullYear() === nowD.getFullYear()) {
    return `${month} ${day}`;
  }
  return `${month} ${day}, ${d.getFullYear()}`;
}

/** Format a duration in milliseconds as mm:ss or h:mm:ss. */
export function formatDuration(ms: number): string {
  if (ms < 0) return "0:00";
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const ss = String(s).padStart(2, "0");
  if (h > 0) {
    const mm = String(m).padStart(2, "0");
    return `${h}:${mm}:${ss}`;
  }
  return `${m}:${ss}`;
}

/** Compact word-count label. */
export function formatWordCount(n: number): string {
  return `${n} ${n === 1 ? "word" : "words"}`;
}
