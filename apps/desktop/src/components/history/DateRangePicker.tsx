import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarBlank, CaretLeft, CaretRight, X } from "@phosphor-icons/react";

/**
 * DateRangePicker — popover calendar for selecting a [start, end] date range.
 *
 * Design notes (per impeccable + taste-skill review):
 *   - No external date library. Native Date + a tiny month renderer.
 *   - Theme-pure: all colors from CSS vars; no browser defaults.
 *   - Range selection: first click anchors `start`, second click sets
 *     `end`. Clicking a third time restarts from the new anchor.
 *   - Preview-on-hover: while a start is selected, hovering another day
 *     paints the prospective range. Gives the selection a "what am I
 *     about to pick" affordance without cluttering the grid.
 *   - Uses day-level granularity (00:00:00 to 23:59:59 inclusive).
 *
 * Public contract:
 *   - `value`: current selection (null when nothing is picked).
 *   - `onChange(range | null)`: fires on commit (second click) and on clear.
 */

export interface DateRange {
  /** Inclusive start of day (00:00:00 local). */
  from: number;
  /** Inclusive end of day (23:59:59.999 local). */
  to: number;
}

export interface DateRangePickerProps {
  value: DateRange | null;
  onChange: (range: DateRange | null) => void;
  /** Latest selectable date. Defaults to today. */
  maxDate?: Date;
  /**
   * Label shown on the trigger when no `value` is set.
   * History page uses this as a scroll-position indicator
   * ("Today" / "Yesterday" / "Older" / a specific date).
   * Defaults to "Today" when omitted.
   */
  defaultLabel?: string;
}

// ── Utilities ────────────────────────────────────────────────────────

const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function startOfDay(d: Date): number {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c.getTime();
}
function endOfDay(d: Date): number {
  const c = new Date(d);
  c.setHours(23, 59, 59, 999);
  return c.getTime();
}
function isSameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}
function formatShort(ts: number): string {
  const d = new Date(ts);
  const m = d.toLocaleString("en-US", { month: "short" });
  return `${m} ${d.getDate()}`;
}

// ── Main component ───────────────────────────────────────────────────

export default function DateRangePicker({
  value,
  onChange,
  maxDate,
  defaultLabel,
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState<Date>(() => {
    const anchor = value ? new Date(value.to) : new Date();
    return new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  });
  // Local in-progress selection. `anchor` is set on the first click.
  // Committed selection lives in the `value` prop.
  const [anchor, setAnchor] = useState<number | null>(null);
  const [hoverDay, setHoverDay] = useState<number | null>(null);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(t) &&
        triggerRef.current &&
        !triggerRef.current.contains(t)
      ) {
        setOpen(false);
        setAnchor(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setAnchor(null);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const todayTs = startOfDay(new Date());
  const maxTs = maxDate ? startOfDay(maxDate) : todayTs;

  const handleDayClick = (ts: number) => {
    if (ts > maxTs) return;
    if (anchor === null) {
      setAnchor(ts);
      return;
    }
    // Commit — normalize so `from` <= `to`.
    const from = Math.min(anchor, ts);
    const to = Math.max(anchor, ts);
    onChange({ from: startOfDay(new Date(from)), to: endOfDay(new Date(to)) });
    setAnchor(null);
    setOpen(false);
  };

  const clear = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    onChange(null);
    setAnchor(null);
  };

  const preview = (() => {
    if (anchor === null || hoverDay === null) return null;
    const from = Math.min(anchor, hoverDay);
    const to = Math.max(anchor, hoverDay);
    return { from, to };
  })();

  const rangeToPaint: { from: number; to: number } | null = preview ?? value;

  // Label text on the trigger button.
  const triggerLabel = value
    ? isSameDay(value.from, value.to)
      ? formatShort(value.from)
      : `${formatShort(value.from)} – ${formatShort(value.to)}`
    : (defaultLabel ?? "Today");

  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Filter by date"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          height: 32,
          padding: value ? "0 6px 0 12px" : "0 12px",
          background: value ? "var(--bg-elevated)" : "transparent",
          border: `1px solid ${value ? "var(--border-default)" : "var(--border-subtle)"}`,
          borderRadius: "var(--radius-pill)",
          fontFamily: "var(--font-pixel-line)",
          fontSize: "var(--text-sm)",
          color: value ? "var(--text-primary)" : "var(--text-secondary)",
          cursor: "pointer",
          transition: "border-color 120ms ease, color 120ms ease",
        }}
      >
        <CalendarBlank size={14} weight="regular" />
        <span>{triggerLabel}</span>
        {value && (
          <span
            role="button"
            aria-label="Clear date filter"
            tabIndex={0}
            onClick={clear}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") clear();
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 18,
              height: 18,
              marginLeft: 2,
              borderRadius: "var(--radius-pill)",
              color: "var(--text-ghost)",
              cursor: "pointer",
            }}
          >
            <X size={12} weight="regular" />
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={popoverRef}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{
              duration: 0.16,
              ease: [0.22, 1, 0.36, 1] as const,
            }}
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              right: 0,
              zIndex: 40,
              minWidth: 280,
              padding: "var(--sp-4)",
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-default)",
              borderRadius: "var(--radius-card)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--sp-3)",
            }}
          >
            <MonthNavigator
              view={viewMonth}
              onPrev={() =>
                setViewMonth(
                  new Date(
                    viewMonth.getFullYear(),
                    viewMonth.getMonth() - 1,
                    1,
                  ),
                )
              }
              onNext={() => {
                const next = new Date(
                  viewMonth.getFullYear(),
                  viewMonth.getMonth() + 1,
                  1,
                );
                // Don't allow navigating past the month of maxDate.
                if (
                  next.getFullYear() > new Date(maxTs).getFullYear() ||
                  (next.getFullYear() === new Date(maxTs).getFullYear() &&
                    next.getMonth() > new Date(maxTs).getMonth())
                ) {
                  return;
                }
                setViewMonth(next);
              }}
            />
            <MonthGrid
              viewMonth={viewMonth}
              rangeToPaint={rangeToPaint}
              anchor={anchor}
              todayTs={todayTs}
              maxTs={maxTs}
              onDayClick={handleDayClick}
              onDayHover={setHoverDay}
              onDayLeave={() => setHoverDay(null)}
            />
            <Presets
              todayTs={todayTs}
              onPick={(from, to) => {
                onChange({
                  from: startOfDay(new Date(from)),
                  to: endOfDay(new Date(to)),
                });
                setAnchor(null);
                setOpen(false);
              }}
              onClear={() => {
                clear();
                setOpen(false);
              }}
              hasValue={Boolean(value)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Month header ─────────────────────────────────────────────────────

interface MonthNavigatorProps {
  view: Date;
  onPrev: () => void;
  onNext: () => void;
}

function MonthNavigator({ view, onPrev, onNext }: MonthNavigatorProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--sp-2)",
      }}
    >
      <IconButton label="Previous month" onClick={onPrev}>
        <CaretLeft size={13} weight="regular" />
      </IconButton>
      <div
        style={{
          fontFamily: "var(--font-pixel-square)",
          fontSize: "var(--text-sm)",
          color: "var(--text-primary)",
          textAlign: "center",
          flex: 1,
        }}
      >
        {MONTH_NAMES[view.getMonth()]} {view.getFullYear()}
      </div>
      <IconButton label="Next month" onClick={onNext}>
        <CaretRight size={13} weight="regular" />
      </IconButton>
    </div>
  );
}

function IconButton({
  children,
  onClick,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 26,
        height: 26,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        background: hovered ? "var(--bg-high)" : "transparent",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-micro)",
        color: hovered ? "var(--text-primary)" : "var(--text-secondary)",
        cursor: "pointer",
        transition: "color 120ms ease, background-color 120ms ease",
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

// ── Day grid ─────────────────────────────────────────────────────────

interface MonthGridProps {
  viewMonth: Date;
  rangeToPaint: { from: number; to: number } | null;
  anchor: number | null;
  todayTs: number;
  maxTs: number;
  onDayClick: (ts: number) => void;
  onDayHover: (ts: number) => void;
  onDayLeave: () => void;
}

function MonthGrid({
  viewMonth,
  rangeToPaint,
  anchor,
  todayTs,
  maxTs,
  onDayClick,
  onDayHover,
  onDayLeave,
}: MonthGridProps) {
  // Build a 6-week grid: 42 cells. Leading offset days from the
  // previous month are muted; trailing overflow days from the next
  // month are muted; current month is interactive.
  const firstOfMonth = new Date(
    viewMonth.getFullYear(),
    viewMonth.getMonth(),
    1,
  );
  const startDow = firstOfMonth.getDay(); // 0=Sunday
  const daysInMonth = new Date(
    viewMonth.getFullYear(),
    viewMonth.getMonth() + 1,
    0,
  ).getDate();

  // Cell day-timestamps (day-start).
  const cells: { ts: number; inMonth: boolean }[] = [];
  // Previous month leading cells
  for (let i = startDow - 1; i >= 0; i--) {
    const d = new Date(firstOfMonth);
    d.setDate(firstOfMonth.getDate() - (i + 1));
    cells.push({ ts: startOfDay(d), inMonth: false });
  }
  // Current month
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), day);
    cells.push({ ts: startOfDay(d), inMonth: true });
  }
  // Trailing cells to fill 42 grid slots
  while (cells.length < 42) {
    const last = cells[cells.length - 1].ts;
    const d = new Date(last);
    d.setDate(d.getDate() + 1);
    cells.push({ ts: startOfDay(d), inMonth: false });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {/* Weekday header */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 2,
        }}
      >
        {DAY_LABELS.map((label) => (
          <div
            key={label}
            style={{
              textAlign: "center",
              fontFamily: "var(--font-pixel-grid)",
              fontSize: "var(--text-xs)",
              color: "var(--text-ghost)",
              letterSpacing: "0.04em",
              padding: "4px 0",
            }}
          >
            {label}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 2,
        }}
      >
        {cells.map((cell, idx) => {
          const disabled = !cell.inMonth || cell.ts > maxTs;
          const inRange =
            rangeToPaint !== null &&
            cell.ts >= rangeToPaint.from &&
            cell.ts <= rangeToPaint.to;
          const isStart =
            rangeToPaint !== null && cell.ts === rangeToPaint.from;
          const isEnd = rangeToPaint !== null && cell.ts === rangeToPaint.to;
          const isAnchor = anchor !== null && cell.ts === anchor;
          const isToday = cell.ts === todayTs;

          return (
            <DayCell
              key={idx}
              ts={cell.ts}
              inMonth={cell.inMonth}
              disabled={disabled}
              inRange={inRange}
              isStart={isStart}
              isEnd={isEnd}
              isAnchor={isAnchor}
              isToday={isToday}
              onClick={() => onDayClick(cell.ts)}
              onMouseEnter={() => onDayHover(cell.ts)}
              onMouseLeave={onDayLeave}
            />
          );
        })}
      </div>
    </div>
  );
}

interface DayCellProps {
  ts: number;
  inMonth: boolean;
  disabled: boolean;
  inRange: boolean;
  isStart: boolean;
  isEnd: boolean;
  isAnchor: boolean;
  isToday: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

function DayCell({
  ts,
  inMonth,
  disabled,
  inRange,
  isStart,
  isEnd,
  isAnchor,
  isToday,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: DayCellProps) {
  const [hovered, setHovered] = useState(false);
  const day = new Date(ts).getDate();

  const isEndpoint = isStart || isEnd || isAnchor;
  const baseBg = isEndpoint
    ? "var(--text-primary)"
    : inRange
      ? "var(--bg-high)"
      : hovered && !disabled
        ? "var(--bg-surface)"
        : "transparent";

  const baseColor = isEndpoint
    ? "var(--bg-base)" // inverted on the accent endpoint
    : disabled
      ? "var(--text-ghost)"
      : inMonth
        ? "var(--text-primary)"
        : "var(--text-secondary)";

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => {
        setHovered(true);
        onMouseEnter();
      }}
      onMouseLeave={() => {
        setHovered(false);
        onMouseLeave();
      }}
      style={{
        height: 30,
        width: "100%",
        padding: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: baseBg,
        border:
          isToday && !isEndpoint
            ? "1px solid var(--border-default)"
            : "1px solid transparent",
        borderRadius: "var(--radius-micro)",
        fontFamily: "var(--font-pixel-grid)",
        fontSize: "var(--text-xs)",
        color: baseColor,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        transition: "background-color 120ms ease, color 120ms ease",
      }}
    >
      {day}
    </button>
  );
}

// ── Presets row ──────────────────────────────────────────────────────

interface PresetsProps {
  todayTs: number;
  onPick: (from: number, to: number) => void;
  onClear: () => void;
  hasValue: boolean;
}

function Presets({ todayTs, onPick, onClear, hasValue }: PresetsProps) {
  const DAY = 86_400_000;
  const presets: { label: string; from: number; to: number }[] = [
    { label: "Today", from: todayTs, to: todayTs },
    { label: "Yesterday", from: todayTs - DAY, to: todayTs - DAY },
    { label: "Last 7 days", from: todayTs - 6 * DAY, to: todayTs },
    { label: "Last 30 days", from: todayTs - 29 * DAY, to: todayTs },
  ];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--sp-2)",
        paddingTop: "var(--sp-2)",
        borderTop: "1px solid var(--border-subtle)",
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {presets.map((p) => (
          <PresetChip key={p.label} onClick={() => onPick(p.from, p.to)}>
            {p.label}
          </PresetChip>
        ))}
      </div>
      {hasValue && (
        <PresetChip onClick={onClear} tone="ghost">
          Clear
        </PresetChip>
      )}
    </div>
  );
}

function PresetChip({
  children,
  onClick,
  tone = "default",
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: "default" | "ghost";
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: "4px 10px",
        background: hovered ? "var(--bg-high)" : "transparent",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-pill)",
        fontFamily: "var(--font-pixel-grid)",
        fontSize: "var(--text-xs)",
        color:
          tone === "ghost"
            ? "var(--text-ghost)"
            : hovered
              ? "var(--text-primary)"
              : "var(--text-secondary)",
        cursor: "pointer",
        transition: "color 120ms ease, background-color 120ms ease",
      }}
    >
      {children}
    </button>
  );
}
