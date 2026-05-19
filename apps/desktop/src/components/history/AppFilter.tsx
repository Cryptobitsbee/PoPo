import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AppWindow, X, Check } from "@phosphor-icons/react";

/**
 * AppFilter — popover chip for filtering History by the target app
 * (Chrome, VS Code, Slack, …).
 *
 * Design notes:
 *   - Trigger: pill-shaped chip that shows the selected app's icon +
 *     name when active, or "All apps" when idle. Matches the shape of
 *     the DateRangePicker trigger next to it.
 *   - Popover: dark elevated surface with a vertical list of apps
 *     derived from the current session set. Each row shows the app's
 *     icon (resolved from the most recent session that used it), its
 *     name, and a session count. Selecting a row commits the filter.
 *   - "All apps" row at the top clears the filter.
 *
 * Options are computed by HistoryPage so icon dedup happens once per
 * render (and not on every keystroke of unrelated filters). See
 * buildAppOptions() there.
 */

export interface AppOption {
  /** Canonical app name (unique key). */
  name: string;
  /** Latest icon we've seen for this app. Base64 PNG. */
  iconBase64?: string;
  /** How many sessions in the current unfiltered set belong to this app. */
  count: number;
}

export interface AppFilterProps {
  options: AppOption[];
  value: string | null;
  onChange: (name: string | null) => void;
}

export default function AppFilter({
  options,
  value,
  onChange,
}: AppFilterProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  const selectedOption = value
    ? (options.find((o) => o.name === value) ?? null)
    : null;

  // Top-3 most-used apps (already sorted by count desc in HistoryPage).
  // Used for the stacked-avatar trigger when no filter is active — an
  // at-a-glance hint that the chip filters by app.
  const topApps = options.slice(0, 3);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        popRef.current &&
        !popRef.current.contains(t) &&
        triggerRef.current &&
        !triggerRef.current.contains(t)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const clear = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    onChange(null);
  };

  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Filter by app"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          height: 32,
          padding: value
            ? "0 6px 0 8px"
            : topApps.length > 0
              ? "0 12px 0 8px"
              : "0 12px",
          background: value ? "var(--bg-elevated)" : "transparent",
          border: `1px solid ${value ? "var(--border-default)" : "var(--border-subtle)"}`,
          borderRadius: "var(--radius-pill)",
          fontFamily: "var(--font-pixel-line)",
          fontSize: "var(--text-sm)",
          color: value ? "var(--text-primary)" : "var(--text-secondary)",
          cursor: "pointer",
          transition: "border-color 120ms ease, color 120ms ease",
          maxWidth: 200,
        }}
      >
        {value ? (
          // ── Filter active: show the selected app's icon + name ──
          <>
            {selectedOption?.iconBase64 ? (
              <img
                src={`data:image/png;base64,${selectedOption.iconBase64}`}
                alt=""
                width={16}
                height={16}
                style={{
                  borderRadius: 3,
                  objectFit: "contain",
                  flexShrink: 0,
                }}
              />
            ) : (
              <AppWindow size={14} weight="regular" />
            )}
            <span
              style={{
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {selectedOption?.name ?? "App"}
            </span>
            <span
              role="button"
              aria-label="Clear app filter"
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
                flexShrink: 0,
              }}
            >
              <X size={12} weight="regular" />
            </span>
          </>
        ) : topApps.length > 0 ? (
          // ── Idle, we have apps: stacked-avatars + "Apps" label ──
          <>
            <StackedAppAvatars apps={topApps} />
            <span style={{ whiteSpace: "nowrap" }}>Apps</span>
          </>
        ) : (
          // ── Idle, no history yet: generic icon + label ──
          <>
            <AppWindow size={14} weight="regular" />
            <span style={{ whiteSpace: "nowrap" }}>Apps</span>
          </>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={popRef}
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
              minWidth: 240,
              maxHeight: 360,
              overflowY: "auto",
              padding: 4,
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-default)",
              borderRadius: "var(--radius-card)",
            }}
          >
            {/* "All apps" clear row */}
            <Row
              label="All apps"
              active={value === null}
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            />

            {options.length === 0 ? (
              <div
                style={{
                  padding: "8px 12px",
                  fontFamily: "var(--font-pixel-line)",
                  fontSize: "var(--text-xs)",
                  color: "var(--text-ghost)",
                }}
              >
                No apps recorded yet.
              </div>
            ) : (
              options.map((opt) => (
                <Row
                  key={opt.name}
                  label={opt.name}
                  iconBase64={opt.iconBase64}
                  count={opt.count}
                  active={value === opt.name}
                  onClick={() => {
                    onChange(opt.name);
                    setOpen(false);
                  }}
                />
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Stacked avatars ────────────────────────────────────────────
//
// Up to three app icons drawn as overlapping circles with the most-
// used one leading. Each subsequent icon is offset 50% leftward so
// about half its width is visible; a 1 px border ring matching the
// pill's background separates the rings from each other.
//
// Purpose: at a glance the user sees "ah, these are the apps I use",
// which reads immediately as "app filter" without any text label
// beyond the "Apps" suffix next to it.

function StackedAppAvatars({ apps }: { apps: AppOption[] }) {
  // Most-used icon goes on the RIGHT (highest z-index) so its
  // full circle is visible; older ones peek out from under the left
  // edge. Reversing the array achieves this without changing the
  // source ordering.
  const rendered = apps.slice(0, 3);
  const SIZE = 20;
  const OVERLAP = 7; // px of each icon that's hidden under the next one

  return (
    <div
      aria-hidden
      style={{
        display: "inline-flex",
        alignItems: "center",
        // Width is the sum of visible portions + one full icon, plus
        // a couple px of breathing room. Prevents the flex parent
        // from collapsing the negative-margin stack.
        width: SIZE + (rendered.length - 1) * (SIZE - OVERLAP),
        height: SIZE,
      }}
    >
      {rendered.map((app, i) => (
        <div
          key={app.name}
          title={app.name}
          style={{
            width: SIZE,
            height: SIZE,
            marginLeft: i === 0 ? 0 : -OVERLAP,
            borderRadius: "50%",
            background: "var(--bg-base)", // matches the pill surface
            border: "1.5px solid var(--bg-base)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            zIndex: i, // later icons sit on top of earlier ones
            flexShrink: 0,
            boxSizing: "border-box",
          }}
        >
          {app.iconBase64 ? (
            <img
              src={`data:image/png;base64,${app.iconBase64}`}
              alt=""
              width={SIZE - 4}
              height={SIZE - 4}
              style={{
                objectFit: "contain",
                borderRadius: "50%",
                display: "block",
              }}
            />
          ) : (
            <div
              style={{
                width: SIZE - 4,
                height: SIZE - 4,
                borderRadius: "50%",
                background: "var(--bg-elevated)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <AppWindow size={9} color="var(--text-ghost)" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Row ────────────────────────────────────────────────────

function Row({
  label,
  iconBase64,
  count,
  active,
  onClick,
}: {
  label: string;
  iconBase64?: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "6px 8px",
        width: "100%",
        background: hovered ? "var(--bg-high)" : "transparent",
        border: "none",
        borderRadius: "var(--radius-micro)",
        cursor: "pointer",
        transition: "background-color 100ms ease",
        textAlign: "left",
      }}
    >
      {iconBase64 ? (
        <img
          src={`data:image/png;base64,${iconBase64}`}
          alt=""
          width={18}
          height={18}
          style={{
            borderRadius: 4,
            objectFit: "contain",
            flexShrink: 0,
          }}
        />
      ) : (
        <div
          style={{
            width: 18,
            height: 18,
            borderRadius: 4,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--bg-high)",
            border: "1px solid var(--border-subtle)",
            flexShrink: 0,
          }}
        >
          <AppWindow size={10} weight="regular" color="var(--text-ghost)" />
        </div>
      )}

      <span
        style={{
          flex: 1,
          fontFamily: "var(--font-pixel-line)",
          fontSize: "var(--text-sm)",
          color: "var(--text-primary)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </span>

      {typeof count === "number" && (
        <span
          style={{
            fontFamily: "var(--font-pixel-grid)",
            fontSize: "var(--text-xs)",
            color: "var(--text-ghost)",
            fontVariantNumeric: "tabular-nums",
            flexShrink: 0,
          }}
        >
          {count}
        </span>
      )}

      {active && (
        <Check size={12} weight="regular" color="var(--text-primary)" />
      )}
    </button>
  );
}
