import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CaretDown, Check } from "@phosphor-icons/react";

/**
 * Select — custom popover dropdown per brief §3 Settings.
 *
 *   Trigger: bg --bg-elevated, border 1px --border-subtle,
 *            radius --radius-button, GeistPixelSquare --text-sm
 *   Popover: bg --bg-surface, border --border-subtle,
 *            max-height 240px scroll
 *   Option hover: bg --bg-elevated
 *
 * No native <select>. Click outside closes. Esc closes. The trigger
 * shows the selected option's label; the popover lists all options
 * with a Check on the active one.
 */

export interface SelectOption<V extends string = string> {
  value: V;
  label: string;
  description?: string;
}

export interface SelectProps<V extends string = string> {
  value: V;
  options: SelectOption<V>[];
  onChange: (value: V) => void;
  placeholder?: string;
  minWidth?: number;
  disabled?: boolean;
  "aria-label"?: string;
}

export default function Select<V extends string = string>({
  value,
  options,
  onChange,
  placeholder = "Select…",
  minWidth = 180,
  disabled,
  "aria-label": ariaLabel,
}: SelectProps<V>) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const current = options.find((o) => o.value === value);

  const showSearch = options.length > 8;
  const filtered = showSearch
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(search.toLowerCase()) ||
          o.value.toLowerCase().includes(search.toLowerCase()),
      )
    : options;

  // Close on click-outside + Esc
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      setOpen(false);
      setSearch("");
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div style={{ position: "relative", minWidth, maxWidth: "100%" }}>
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
          justifyContent: "space-between",
          gap: 8,
          width: "100%",
          height: 32,
          padding: "0 12px",
          background: "var(--bg-elevated)",
          border: `1px solid ${
            open ? "var(--border-default)" : "var(--border-subtle)"
          }`,
          borderRadius: "var(--radius-button)",
          fontFamily: "var(--font-pixel-square)",
          fontSize: "var(--text-sm)",
          lineHeight: 1.2,
          color: current ? "var(--text-primary)" : "var(--text-ghost)",
          overflow: "hidden",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
          transition: "border-color 120ms ease",
        }}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            textAlign: "left",
            flex: 1,
          }}
        >
          {current?.label ?? placeholder}
        </span>
        <CaretDown
          size={12}
          weight="regular"
          color="var(--text-secondary)"
          style={{
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 150ms ease",
            flexShrink: 0,
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
              maxHeight: 240,
              overflowY: "auto",
              background: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-button)",
              padding: 4,
              zIndex: 40,
            }}
          >
            {showSearch && (
              <input
                type="text"
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  border: "none",
                  borderBottom: "1px solid var(--border-subtle)",
                  background: "transparent",
                  fontFamily: "var(--font-pixel-square)",
                  fontSize: "var(--text-sm)",
                  color: "var(--text-primary)",
                  outline: "none",
                }}
              />
            )}
            {filtered.map((opt) => (
              <SelectOptionRow
                key={opt.value}
                option={opt}
                active={opt.value === value}
                onPick={() => {
                  onChange(opt.value);
                  setOpen(false);
                  setSearch("");
                }}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SelectOptionRow<V extends string>({
  option,
  active,
  onPick,
}: {
  option: SelectOption<V>;
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
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        width: "100%",
        padding: "8px 10px",
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
      <span
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
          overflow: "hidden",
          textOverflow: "ellipsis",
          flex: 1,
        }}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {option.label}
        </span>
        {option.description && (
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
            {option.description}
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
