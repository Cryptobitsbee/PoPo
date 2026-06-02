import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Session, Mode } from "@popo/shared-types";
import SessionRow from "./SessionRow";

/**
 * HistoryList — grouped, staggered list of SessionRow.
 *
 * Grouping (Session 30 polish):
 *   Sessions are bucketed into Today / Yesterday / Previous 7 days /
 *   Previous 30 days / Older and rendered with sticky-ish section headers.
 *   Groups that have no sessions after filtering are omitted entirely.
 *
 * Stagger:
 *   Children animate in with 40ms offset per DESIGN_SYSTEM §6.
 *   `AnimatePresence` handles delete + filter animations.
 *   `layout` on each row smooths the height change when the detail
 *   panel expands inside.
 */

const containerVariants = {
  animate: {
    transition: {
      staggerChildren: 0.04,
    },
  },
};

export interface HistoryListProps {
  sessions: Session[];
  modesById: Record<string, Mode>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCopy: (session: Session) => void;
  onDelete: (id: string) => void;
  /**
   * Called with the label of the topmost visible bucket ("Today",
   * "Yesterday", …) whenever the user scrolls past a section header.
   * Used by HistoryPage to update the DateRangePicker's default
   * label so the pill tracks what the user is currently looking at.
   */
  onSectionInView?: (label: string) => void;
  /**
   * Scroll container that owns the list. Used as the IntersectionObserver
   * `root`. When omitted the observer falls back to the viewport — fine
   * for preview storybooks but wrong when the page uses nested scroll.
   */
  scrollRoot?: React.RefObject<HTMLElement | null>;
}

interface Bucket {
  key: string;
  label: string;
  sessions: Session[];
}

// Compute bucket boundaries for NOW at module import is wrong because
// the page may stay open across midnight; we recompute on each render.
function bucketize(sessions: Session[]): Bucket[] {
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const DAY = 86_400_000;
  const startOfYesterday = startOfToday - DAY;
  const start7 = startOfToday - 6 * DAY; // inclusive-of-today, 7 days window
  const start30 = startOfToday - 29 * DAY;

  const buckets: Record<string, Bucket> = {
    today: { key: "today", label: "Today", sessions: [] },
    yesterday: { key: "yesterday", label: "Yesterday", sessions: [] },
    week: { key: "week", label: "Previous 7 days", sessions: [] },
    month: { key: "month", label: "Previous 30 days", sessions: [] },
    older: { key: "older", label: "Older", sessions: [] },
  };

  for (const s of sessions) {
    const ts = s.createdAt;
    if (ts >= startOfToday) buckets.today.sessions.push(s);
    else if (ts >= startOfYesterday) buckets.yesterday.sessions.push(s);
    else if (ts >= start7) buckets.week.sessions.push(s);
    else if (ts >= start30) buckets.month.sessions.push(s);
    else buckets.older.sessions.push(s);
  }

  // Preserve input ordering inside each bucket (already newest-first
  // from the store). Return only non-empty buckets.
  return ["today", "yesterday", "week", "month", "older"]
    .map((k) => buckets[k])
    .filter((b) => b.sessions.length > 0);
}

export default function HistoryList({
  sessions,
  modesById,
  selectedId,
  onSelect,
  onCopy,
  onDelete,
  onSectionInView,
  scrollRoot,
}: HistoryListProps) {
  const buckets = bucketize(sessions);

  // Track section visibility so the caller can reflect the current
  // bucket in the DateRangePicker's pill label.
  const headerRefs = useRef<Map<string, HTMLElement>>(new Map());

  useEffect(() => {
    if (!onSectionInView) return;
    const refs = headerRefs.current;
    if (refs.size === 0) return;

    // Order matters: we want the TOPMOST visible bucket. Store the
    // declared order once so we can pick the right header when
    // multiple are intersecting at the same time.
    const order = ["today", "yesterday", "week", "month", "older"];
    const labelByKey: Record<string, string> = {
      today: "Today",
      yesterday: "Yesterday",
      week: "Previous 7 days",
      month: "Previous 30 days",
      older: "Older",
    };

    const visible = new Set<string>();

    const update = () => {
      for (const k of order) {
        if (visible.has(k)) {
          onSectionInView(labelByKey[k]);
          return;
        }
      }
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const key = (entry.target as HTMLElement).dataset.bucketKey;
          if (!key) continue;
          if (entry.isIntersecting) visible.add(key);
          else visible.delete(key);
        }
        update();
      },
      {
        // Use the provided scroll container as the observation root
        // (the history list has its own nested scroll area — see
        // HistoryPage). Falls back to viewport when omitted.
        root: scrollRoot?.current ?? null,
        // Trigger just after a header crosses the top so the pill
        // flips when a new section becomes dominant rather than the
        // instant its header peeks in.
        rootMargin: "-20px 0px -75% 0px",
        threshold: 0,
      },
    );

    refs.forEach((el) => io.observe(el));
    return () => io.disconnect();
    // We want to re-subscribe when the set of buckets changes.
  }, [buckets.map((b) => b.key).join("|"), onSectionInView, scrollRoot]);

  return (
    <motion.div
      variants={containerVariants}
      initial="initial"
      animate="animate"
      style={{
        display: "flex",
        flexDirection: "column",
      }}
    >
      {buckets.map((bucket) => (
        <section key={bucket.key}>
          <SectionHeader
            label={bucket.label}
            count={bucket.sessions.length}
            bucketKey={bucket.key}
            registerRef={(el) => {
              if (el) headerRefs.current.set(bucket.key, el);
              else headerRefs.current.delete(bucket.key);
            }}
          />
          <AnimatePresence initial={false}>
            {bucket.sessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                mode={session.modeId ? modesById[session.modeId] : undefined}
                selected={selectedId === session.id}
                onSelect={() =>
                  onSelect(selectedId === session.id ? null : session.id)
                }
                onCopy={() => onCopy(session)}
                onDelete={() => onDelete(session.id)}
              />
            ))}
          </AnimatePresence>
        </section>
      ))}
    </motion.div>
  );
}

// ── Section header ────────────────────────────────────────

function SectionHeader({
  label,
  count,
  bucketKey,
  registerRef,
}: {
  label: string;
  count: number;
  bucketKey: string;
  registerRef: (el: HTMLElement | null) => void;
}) {
  return (
    <header
      ref={registerRef}
      data-bucket-key={bucketKey}
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        padding: "var(--sp-6) var(--sp-2) var(--sp-2)",
      }}
    >
      <h2
        style={{
          margin: 0,
          // Session 53: matched SettingsGroup heading style —
          // square font + text-sm + secondary + 0.12em uppercase
          // for consistent legible section dividers across pages.
          fontFamily: "var(--font-pixel-square)",
          fontSize: "var(--text-sm)",
          fontWeight: 500,
          color: "var(--text-secondary)",
          textTransform: "uppercase",
          letterSpacing: "0.12em",
        }}
      >
        {label}
      </h2>
      <span
        style={{
          fontFamily: "var(--font-pixel-grid)",
          fontSize: "var(--text-xs)",
          // Session 54: ghost → secondary so the per-section count
          // (e.g. "1", "58") is readable next to the bucket label.
          color: "var(--text-secondary)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {count}
      </span>
    </header>
  );
}
