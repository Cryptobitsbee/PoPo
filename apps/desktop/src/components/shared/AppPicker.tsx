import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowsClockwise,
  CaretDown,
  Check,
  MagnifyingGlass,
  Plus,
  Square,
  X,
} from "@phosphor-icons/react";
import type { RunningApp } from "@popo/shared-types";
import Input from "./Input";

/**
 * AppPicker — chip-style multi-select of Windows apps.
 *
 * Used by:
 *   - Settings → Paste → App-specific paste shortcuts (picks ONE app
 *     per override; opens via `single={true}` prop where we reuse the
 *     same visual grammar but clamp to max 1 selection).
 *   - Modes → ModeEditor → "Apply in these apps" field (picks many).
 *
 * Data source: `invoke("cmd_list_running_apps")` on Tauri, stubbed
 * with `[]` when running in a plain Vite preview so the UI still
 * renders during dev. The list is fetched once on first open + cached
 * until the user clicks the refresh button (top-right of popover).
 *
 * Visual grammar mirrors Select + MultiSelect: same trigger, popover,
 * option row. The trigger renders either a placeholder or a row of
 * chips (one per selected app name). Chips are removable inline.
 *
 * Manual-entry escape hatch: the popover has a "+ Add by name" input
 * at the bottom so users can enter an app that isn't currently
 * running (e.g. a launcher-style game they only open occasionally).
 */

export interface AppPickerProps {
  /** Currently-selected app display names. */
  values: string[];
  /** Fires with the new array whenever the selection changes. */
  onChange: (values: string[]) => void;
  /**
   * Fires ONLY when an app is newly added to `values` (not on
   * removal). Receives the full `RunningApp` metadata for
   * running/installed picks, or a synthetic `{ name, exePath: "",
   * isRunning: false }` for manual-entry additions.
   *
   * Consumers that persist the icon per-selection (e.g. the paste-
   * overrides editor) use this to snapshot `iconBase64` at pick
   * time so chips render correctly even after the app is closed.
   * Mode bindings don't need this — they look up icons from
   * `appIconsStore` which is already deduped + synced.
   */
  onSelect?: (app: RunningApp) => void;
  /** Visible when nothing's selected. */
  placeholder?: string;
  /** Force min-width of the trigger. Defaults to 260px. */
  minWidth?: number;
  /** When true, selection is capped at 1 app (for per-app paste overrides). */
  single?: boolean;
  /** aria label on the trigger. */
  "aria-label"?: string;
  /** Disable the whole control. */
  disabled?: boolean;
  /**
   * Optional per-value icon lookup. When AppPicker's internal
   * running-apps list doesn't have an entry for a selected value
   * (e.g. the user saved the override months ago + the app isn't
   * currently running), consumers can provide an icon map so the
   * chip still renders with the right logo. Key = app name
   * (case-insensitive lookup), value = base64 PNG.
   */
  iconHints?: Record<string, string | undefined>;
}

export default function AppPicker({
  values,
  onChange,
  onSelect,
  placeholder = "Select apps…",
  minWidth = 260,
  single = false,
  "aria-label": ariaLabel,
  disabled,
  iconHints,
}: AppPickerProps) {
  const [open, setOpen] = useState(false);
  const [apps, setApps] = useState<RunningApp[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [manualValue, setManualValue] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Fetch once on first open (or on explicit refresh click).
  useEffect(() => {
    if (!open || apps !== null || loading) return;
    void refresh(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const refresh = async (force: boolean) => {
    setLoading(true);
    setError(null);
    try {
      if (isTauri()) {
        const list = await invoke<RunningApp[]>("cmd_list_running_apps", {
          refresh: force,
        });
        setApps(list);
      } else {
        // Vite preview: no Rust available; show empty state.
        setApps([]);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setApps([]);
    } finally {
      setLoading(false);
    }
  };

  // Close on click-outside + Esc.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      setOpen(false);
      setSearch("");
      setManualValue("");
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setSearch("");
        setManualValue("");
      }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  /** Case-insensitive membership check, trimmed. */
  const isSelected = (name: string) =>
    values.some((v) => v.trim().toLowerCase() === name.trim().toLowerCase());

  const toggle = (name: string) => {
    if (isSelected(name)) {
      onChange(
        values.filter(
          (v) => v.trim().toLowerCase() !== name.trim().toLowerCase(),
        ),
      );
    } else {
      // Notify the consumer about the picked app's full metadata so
      // icon-persisting use-cases (paste overrides) can snapshot it.
      const app = apps?.find(
        (a) => a.name.toLowerCase() === name.toLowerCase(),
      );
      if (onSelect) {
        onSelect(
          app ?? {
            name,
            exePath: "",
            isRunning: false,
          },
        );
      }
      if (single) {
        onChange([name]);
        setOpen(false);
      } else {
        onChange([...values, name]);
      }
    }
  };

  const removeChip = (name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(
      values.filter(
        (v) => v.trim().toLowerCase() !== name.trim().toLowerCase(),
      ),
    );
  };

  const addManual = () => {
    const v = manualValue.trim();
    if (!v) return;
    if (isSelected(v)) {
      setManualValue("");
      return;
    }
    if (onSelect) {
      onSelect({ name: v, exePath: "", isRunning: false });
    }
    if (single) {
      onChange([v]);
      setOpen(false);
    } else {
      onChange([...values, v]);
    }
    setManualValue("");
  };

  // Filter the app list by search (always visible — even short lists
  // benefit from a quick filter once a user has 50+ windows open).
  const filtered = (apps ?? []).filter((app) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      app.name.toLowerCase().includes(s) ||
      (app.title ?? "").toLowerCase().includes(s)
    );
  });

  // Build an "already-selected names not visible in the list" set so
  // the chip strip in the trigger shows even manual-entry apps that
  // aren't currently running.
  const visibleRows = filtered;

  return (
    <div style={{ position: "relative", minWidth }}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexWrap: "wrap",
          width: "100%",
          minHeight: 32,
          padding: values.length > 0 ? "4px 10px 4px 6px" : "0 12px",
          background: "var(--bg-elevated)",
          border: `1px solid ${
            open ? "var(--border-default)" : "var(--border-subtle)"
          }`,
          borderRadius: "var(--radius-button)",
          fontFamily: "var(--font-pixel-square)",
          fontSize: "var(--text-sm)",
          lineHeight: 1.2,
          color:
            values.length > 0 ? "var(--text-primary)" : "var(--text-ghost)",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
          transition: "border-color 120ms ease",
          textAlign: "left",
        }}
      >
        {values.length === 0 ? (
          <span style={{ flex: 1 }}>{placeholder}</span>
        ) : (
          <span
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 4,
              flex: 1,
              alignItems: "center",
            }}
          >
            {values.map((name) => {
              const appMeta = apps?.find(
                (a) => a.name.toLowerCase() === name.toLowerCase(),
              );
              // Fallback icon chain: running-apps list → iconHints
              // (consumer-provided, e.g. pasteOverride.iconBase64).
              const hint = iconHints?.[name] ?? iconHints?.[name.toLowerCase()];
              const iconBase64 = appMeta?.iconBase64 ?? hint;
              return (
                <SelectedChip
                  key={name}
                  name={name}
                  iconBase64={iconBase64}
                  onRemove={(e) => removeChip(name, e)}
                />
              );
            })}
          </span>
        )}
        <CaretDown
          size={12}
          weight="regular"
          color="var(--text-secondary)"
          style={{
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 150ms ease",
            flexShrink: 0,
            marginLeft: "auto",
          }}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={popoverRef}
            role="listbox"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12, ease: [0.25, 1, 0.5, 1] }}
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              left: 0,
              right: 0,
              minWidth,
              maxHeight: 360,
              display: "flex",
              flexDirection: "column",
              background: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-button)",
              padding: 4,
              zIndex: 40,
              overflow: "hidden",
            }}
          >
            {/* Search + refresh row */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 8px",
                borderBottom: "1px solid var(--border-subtle)",
                flexShrink: 0,
              }}
            >
              <MagnifyingGlass
                size={12}
                weight="regular"
                color="var(--text-secondary)"
                style={{ flexShrink: 0 }}
              />
              <input
                type="text"
                placeholder="Search running apps…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
                style={{
                  flex: 1,
                  border: "none",
                  background: "transparent",
                  fontFamily: "var(--font-pixel-square)",
                  fontSize: "var(--text-sm)",
                  color: "var(--text-primary)",
                  outline: "none",
                  minWidth: 0,
                }}
              />
              <button
                type="button"
                onClick={() => void refresh(true)}
                aria-label="Refresh apps list"
                title="Refresh (rescan installed apps)"
                disabled={loading}
                style={{
                  width: 22,
                  height: 22,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 0,
                  background: "transparent",
                  border: "none",
                  borderRadius: "var(--radius-micro)",
                  cursor: loading ? "wait" : "pointer",
                  color: "var(--text-secondary)",
                  flexShrink: 0,
                }}
              >
                <ArrowsClockwise
                  size={12}
                  weight="regular"
                  style={{
                    animation: loading
                      ? "popo-spin 800ms linear infinite"
                      : "none",
                  }}
                />
              </button>
            </div>

            {/* Scrollable option area */}
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                minHeight: 60,
              }}
            >
              <style>{`
                @keyframes popo-spin {
                  from { transform: rotate(0deg); }
                  to   { transform: rotate(360deg); }
                }
              `}</style>
              {loading && apps === null && (
                <EmptyLine>Looking at running apps…</EmptyLine>
              )}
              {!loading && error && (
                <EmptyLine tone="error">
                  Couldn&rsquo;t list apps: {error}
                </EmptyLine>
              )}
              {!loading && !error && visibleRows.length === 0 && (
                <EmptyLine>
                  {search
                    ? "No apps match that search."
                    : "No running apps detected. Try refreshing or add one by name below."}
                </EmptyLine>
              )}
              {visibleRows.map((app) => (
                <AppRow
                  key={app.name}
                  app={app}
                  active={isSelected(app.name)}
                  onPick={() => toggle(app.name)}
                />
              ))}
            </div>

            {/* Manual entry row */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 8px",
                borderTop: "1px solid var(--border-subtle)",
                flexShrink: 0,
              }}
            >
              <Input
                value={manualValue}
                onChange={(e) => setManualValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addManual();
                  }
                }}
                placeholder="Or type an app name…"
                style={{ flex: 1 }}
              />
              <button
                type="button"
                onClick={addManual}
                disabled={!manualValue.trim()}
                aria-label="Add app"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  height: 28,
                  padding: "0 10px",
                  background: manualValue.trim()
                    ? "var(--bg-elevated)"
                    : "transparent",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-button)",
                  fontFamily: "var(--font-pixel-square)",
                  fontSize: "var(--text-xs)",
                  color: manualValue.trim()
                    ? "var(--text-primary)"
                    : "var(--text-ghost)",
                  cursor: manualValue.trim() ? "pointer" : "not-allowed",
                  flexShrink: 0,
                }}
              >
                <Plus size={10} weight="regular" />
                Add
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Subcomponents ─────────────────────────────────────────────

function SelectedChip({
  name,
  iconBase64,
  onRemove,
}: {
  name: string;
  iconBase64?: string;
  onRemove: (e: React.MouseEvent) => void;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: iconBase64 ? "2px 4px 2px 3px" : "2px 4px 2px 8px",
        background: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-badge)",
        fontFamily: "var(--font-pixel-circle)",
        fontSize: "var(--text-xs)",
        color: "var(--text-primary)",
        maxWidth: 160,
      }}
      title={name}
    >
      {iconBase64 ? (
        <img
          src={`data:image/png;base64,${iconBase64}`}
          alt=""
          width={14}
          height={14}
          style={{
            borderRadius: 3,
            objectFit: "contain",
            flexShrink: 0,
          }}
        />
      ) : (
        <Square
          size={10}
          weight="regular"
          color="var(--text-ghost)"
          style={{ flexShrink: 0 }}
        />
      )}
      <span
        style={{
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {name}
      </span>
      <span
        role="button"
        aria-label={`Remove ${name}`}
        onClick={onRemove}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 14,
          height: 14,
          borderRadius: "var(--radius-micro)",
          cursor: "pointer",
          color: "var(--text-ghost)",
          flexShrink: 0,
        }}
      >
        <X size={10} weight="regular" />
      </span>
    </span>
  );
}

function AppRow({
  app,
  active,
  onPick,
}: {
  app: RunningApp;
  active: boolean;
  onPick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onPick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={app.title ?? app.exePath}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        padding: "6px 10px",
        background: hovered ? "var(--bg-elevated)" : "transparent",
        border: "none",
        borderRadius: "var(--radius-micro)",
        fontFamily: "var(--font-pixel-square)",
        fontSize: "var(--text-sm)",
        lineHeight: 1.2,
        color: active ? "var(--text-primary)" : "var(--text-secondary)",
        textAlign: "left",
        cursor: "pointer",
        transition: "background-color 120ms ease, color 120ms ease",
      }}
    >
      {app.iconBase64 ? (
        <img
          src={`data:image/png;base64,${app.iconBase64}`}
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
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 18,
            height: 18,
            borderRadius: 4,
            background: "var(--bg-elevated)",
            color: "var(--text-ghost)",
            flexShrink: 0,
          }}
        >
          <Square size={10} weight="regular" />
        </span>
      )}
      <span
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 2,
          overflow: "hidden",
        }}
      >
        <span
          style={{
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {app.name}
        </span>
        {app.title && app.title !== app.name && (
          <span
            style={{
              fontFamily: "var(--font-pixel-line)",
              fontSize: "var(--text-xs)",
              color: "var(--text-ghost)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {app.title}
          </span>
        )}
      </span>
      {active && (
        <Check
          size={12}
          weight="regular"
          color="var(--text-primary)"
          style={{ flexShrink: 0 }}
        />
      )}
    </button>
  );
}

function EmptyLine({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "error";
}) {
  return (
    <div
      style={{
        padding: "10px 12px",
        fontFamily: "var(--font-pixel-line)",
        fontSize: "var(--text-xs)",
        lineHeight: 1.4,
        color: tone === "error" ? "var(--accent-error)" : "var(--text-ghost)",
      }}
    >
      {children}
    </div>
  );
}

function isTauri(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "__TAURI_INTERNALS__" in window ||
    "__TAURI__" in window ||
    navigator.userAgent.includes("Tauri")
  );
}
