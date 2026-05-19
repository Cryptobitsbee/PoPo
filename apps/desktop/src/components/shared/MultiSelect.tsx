import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CaretDown, Check, X } from "@phosphor-icons/react";

/**
 * MultiSelect — chip-style multi-value picker.
 *
 * Visual grammar mirrors Select: same trigger, popover, option row.
 * The trigger shows a row of chips (one per selected value) or a
 * placeholder when empty. Clicking a chip's × removes it inline.
 *
 * Used in Settings → Transcription → Languages (Phase C).
 * Could also retrofit History filter chips later.
 */

export interface MultiSelectOption<V extends string = string> {
  value: V;
  label: string;
  description?: string;
}

export interface MultiSelectProps<V extends string = string> {
  values: V[];
  options: MultiSelectOption<V>[];
  onChange: (values: V[]) => void;
  placeholder?: string;
  minWidth?: number;
  disabled?: boolean;
  "aria-label"?: string;
  /** Soft cap on selections. When reached, unselected options disable. */
  maxSelections?: number;
}

export default function MultiSelect<V extends string = string>({
  values,
  options,
  onChange,
  placeholder = "Select…",
  minWidth = 240,
  disabled,
  "aria-label": ariaLabel,
  maxSelections,
}: MultiSelectProps<V>) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const selected = options.filter((o) => values.includes(o.value));
  const atCap = maxSelections != null && values.length >= maxSelections;

  const showSearch = options.length > 8;
  const filtered = showSearch
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(search.toLowerCase()) ||
          o.value.toLowerCase().includes(search.toLowerCase()),
      )
    : options;

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

  const toggle = (v: V) => {
    if (values.includes(v)) {
      onChange(values.filter((x) => x !== v));
    } else if (!atCap) {
      onChange([...values, v]);
    }
  };

  const removeChip = (v: V, e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(values.filter((x) => x !== v));
  };

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
          padding: selected.length > 0 ? "4px 10px 4px 6px" : "0 12px",
          background: "var(--bg-elevated)",
          border: `1px solid ${
            open ? "var(--border-default)" : "var(--border-subtle)"
          }`,
          borderRadius: "var(--radius-button)",
          fontFamily: "var(--font-pixel-square)",
          fontSize: "var(--text-sm)",
          lineHeight: 1.2,
          color:
            selected.length > 0 ? "var(--text-primary)" : "var(--text-ghost)",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
          transition: "border-color 120ms ease",
          textAlign: "left",
        }}
      >
        {selected.length === 0 ? (
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
            {selected.map((opt) => (
              <span
                key={opt.value}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "2px 4px 2px 8px",
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-badge)",
                  fontFamily: "var(--font-pixel-circle)",
                  fontSize: "var(--text-xs)",
                  color: "var(--text-primary)",
                }}
              >
                {opt.label}
                <span
                  role="button"
                  aria-label={`Remove ${opt.label}`}
                  onClick={(e) => removeChip(opt.value, e)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 14,
                    height: 14,
                    borderRadius: "var(--radius-micro)",
                    cursor: "pointer",
                    color: "var(--text-ghost)",
                  }}
                >
                  <X size={10} weight="regular" />
                </span>
              </span>
            ))}
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
              maxHeight: 280,
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
            {filtered.map((opt) => {
              const active = values.includes(opt.value);
              const disable = !active && atCap;
              return (
                <Row
                  key={opt.value}
                  option={opt}
                  active={active}
                  disabled={disable}
                  onPick={() => toggle(opt.value)}
                />
              );
            })}
            {maxSelections != null && (
              <div
                style={{
                  padding: "6px 10px 4px",
                  fontFamily: "var(--font-pixel-line)",
                  fontSize: "var(--text-xs)",
                  color: "var(--text-ghost)",
                }}
              >
                {values.length}/{maxSelections} selected
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Row<V extends string>({
  option,
  active,
  disabled,
  onPick,
}: {
  option: MultiSelectOption<V>;
  active: boolean;
  disabled?: boolean;
  onPick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={disabled ? undefined : onPick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        width: "100%",
        padding: "8px 10px",
        background: hovered && !disabled ? "var(--bg-elevated)" : "transparent",
        border: "none",
        borderRadius: "var(--radius-micro)",
        fontFamily: "var(--font-pixel-square)",
        fontSize: "var(--text-sm)",
        lineHeight: 1.2,
        color: active ? "var(--text-primary)" : "var(--text-secondary)",
        opacity: disabled ? 0.4 : 1,
        textAlign: "left",
        cursor: disabled ? "not-allowed" : "pointer",
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
