import { useState, type ReactNode } from "react";

/**
 * SegmentedControl — iOS-style 2-or-3 option selector.
 *
 * Used in Settings for:
 *   RECORDING · Mode:          push-to-talk ◎ toggle ◎
 *   PASTE · Paste Method:      clipboard ◎ keystroke ◎
 *
 * Inactive segment: color --text-secondary, no bg
 * Active segment:   bg --bg-high, color --text-primary
 * Container: bg --bg-elevated, border --border-subtle, radius --radius-button
 * Segments animate their bg via CSS transition (120ms ease).
 */

export interface SegmentedControlOption<V extends string = string> {
  value: V;
  label: ReactNode;
}

export interface SegmentedControlProps<V extends string = string> {
  value: V;
  options: SegmentedControlOption<V>[];
  onChange: (value: V) => void;
  "aria-label"?: string;
}

export default function SegmentedControl<V extends string = string>({
  value,
  options,
  onChange,
  "aria-label": ariaLabel,
}: SegmentedControlProps<V>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      style={{
        display: "inline-flex",
        padding: 2,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-button)",
      }}
    >
      {options.map((opt) => (
        <Segment
          key={opt.value}
          option={opt}
          active={opt.value === value}
          onPick={() => onChange(opt.value)}
        />
      ))}
    </div>
  );
}

function Segment<V extends string>({
  option,
  active,
  onPick,
}: {
  option: SegmentedControlOption<V>;
  active: boolean;
  onPick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onPick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: "4px 12px",
        height: 24,
        background: active ? "var(--bg-high)" : "transparent",
        border: "none",
        borderRadius: 6,
        fontFamily: "var(--font-pixel-square)",
        fontSize: "var(--text-xs)",
        lineHeight: 1.2,
        color: active
          ? "var(--text-primary)"
          : hovered
            ? "var(--text-secondary)"
            : "var(--text-ghost)",
        cursor: "pointer",
        transition: "background-color 120ms ease, color 120ms ease",
        whiteSpace: "nowrap",
      }}
    >
      {option.label}
    </button>
  );
}
