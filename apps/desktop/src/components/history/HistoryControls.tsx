import { MagnifyingGlass } from "@phosphor-icons/react";
import DateRangePicker, { type DateRange } from "./DateRangePicker";
import AppFilter, { type AppOption } from "./AppFilter";

/**
 * HistoryControls — count + search + date-range filter row above the separator.
 *
 * Per brief §3 History + Session 30 polish:
 *   Left: "N sessions"  GeistPixelGrid --text-xs --text-secondary
 *   Right: search input (bg --bg-elevated, borderless, rounded-full) +
 *          themed date-range picker (calendar popover).
 */

export interface HistoryControlsProps {
  totalCount: number;
  filteredCount: number;
  query: string;
  onQueryChange: (q: string) => void;
  dateRange: DateRange | null;
  onDateRangeChange: (r: DateRange | null) => void;
  /** Label for the date pill when no filter is active. */
  currentSection?: string;
  /** Available apps derived from the current session set. */
  appOptions: AppOption[];
  appFilter: string | null;
  onAppFilterChange: (name: string | null) => void;
}

export default function HistoryControls({
  totalCount,
  filteredCount,
  query,
  onQueryChange,
  dateRange,
  onDateRangeChange,
  currentSection,
  appOptions,
  appFilter,
  onAppFilterChange,
}: HistoryControlsProps) {
  const filterActive =
    query.trim().length > 0 || dateRange !== null || appFilter !== null;
  const showingFiltered = filterActive && filteredCount !== totalCount;

  return (
    <div
      style={{
        marginTop: "var(--sp-3)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--sp-3)",
      }}
    >
      {/* Left: session count */}
      <span
        style={{
          fontFamily: "var(--font-pixel-grid)",
          fontSize: "var(--text-xs)",
          color: "var(--text-secondary)",
          lineHeight: 1.2,
          flexShrink: 0,
        }}
      >
        {showingFiltered
          ? `${filteredCount} of ${totalCount} sessions`
          : `${totalCount} ${totalCount === 1 ? "session" : "sessions"}`}
      </span>

      {/* Right: search + date filter */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-2)",
          flex: 1,
          justifyContent: "flex-end",
        }}
      >
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--sp-2)",
            height: 32,
            padding: "0 12px",
            background: "var(--bg-elevated)",
            borderRadius: "var(--radius-pill)",
            border: "1px solid transparent",
            transition: "border-color 120ms ease",
            // Compact — the row already reads as a search by virtue
            // of the magnifier icon; a wide bar is empty canvas.
            width: 220,
            flexShrink: 0,
          }}
        >
          <MagnifyingGlass
            size={14}
            weight="regular"
            color="var(--text-ghost)"
            style={{ flexShrink: 0 }}
          />
          <input
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search transcripts…"
            spellCheck={false}
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              outline: "none",
              background: "transparent",
              color: "var(--text-primary)",
              fontFamily: "var(--font-pixel-line)",
              fontSize: "var(--text-sm)",
              lineHeight: 1.4,
              caretColor: "var(--text-primary)",
            }}
          />
        </label>

        <DateRangePicker
          value={dateRange}
          onChange={onDateRangeChange}
          defaultLabel={currentSection}
        />

        <AppFilter
          options={appOptions}
          value={appFilter}
          onChange={onAppFilterChange}
        />
      </div>

      {/* Placeholder styling (inline <style> because React inline styles
         can't target ::placeholder pseudo-element). */}
      <style>{`
        input[type="search"]::placeholder {
          color: var(--text-ghost);
        }
        input[type="search"]::-webkit-search-decoration,
        input[type="search"]::-webkit-search-cancel-button {
          -webkit-appearance: none;
          display: none;
        }
      `}</style>
    </div>
  );
}
