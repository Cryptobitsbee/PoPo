import { useId, useRef, useState, type CSSProperties } from "react";

/**
 * Slider — minimalist horizontal slider for numeric Settings values.
 *
 * Visual register matches Toggle.tsx (the other small Settings primitive):
 *   - Track: 120×4 px, --bg-elevated, radius 9999
 *   - Filled portion: --text-primary, same radius
 *   - Knob: 14×14 px circle, --text-primary fill, no border
 *   - On hover: knob scales 1.0 → 1.15
 *   - On drag: same; track filled portion follows the value
 *
 * Built on a native `<input type="range">` for accessibility +
 * keyboard support (← / → / Home / End / PgUp / PgDn). The visual
 * layer is a pure-CSS treatment over the hidden input.
 *
 * Use case: pill opacity sliders (feature #20 in docs/ROADMAP.md);
 * future use cases for any 0–1 / 0–100 numeric Setting.
 */

export interface SliderProps {
  value: number;
  /** Inclusive lower bound. Default 0. */
  min?: number;
  /** Inclusive upper bound. Default 1. */
  max?: number;
  /** Step granularity. Default 0.01. */
  step?: number;
  onChange: (value: number) => void;
  /** Accessible label, mirrors the SettingRow label. */
  label?: string;
  /** Width of the track in px. Default 140. */
  width?: number;
  /** Disable the slider entirely (knob un-draggable, value frozen). */
  disabled?: boolean;
  /**
   * Function to format the displayed value for the inline readout
   * shown next to the track (e.g. `0.18` → `"18%"`). Default formats
   * 0–1 numbers as percentages.
   */
  formatValue?: (v: number) => string;
}

const TRACK_HEIGHT = 4;
const KNOB_SIZE = 14;
const READOUT_WIDTH = 40;

export default function Slider({
  value,
  min = 0,
  max = 1,
  step = 0.01,
  onChange,
  label,
  width = 140,
  disabled = false,
  formatValue,
}: SliderProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Default formatter: if range is the canonical 0..1, show as
  // percentage; otherwise show the raw number with reasonable
  // precision.
  const fmt = (v: number): string => {
    if (formatValue) return formatValue(v);
    if (min === 0 && max === 1) return `${Math.round(v * 100)}%`;
    if (Number.isInteger(step) && Number.isInteger(v)) return String(v);
    return v.toFixed(2);
  };

  const pct = ((value - min) / (max - min)) * 100;
  const clampedPct = Math.max(0, Math.min(100, pct));

  // Scale the knob slightly when active for tactile feedback.
  const knobScale = dragging ? 1.2 : hovered ? 1.15 : 1.0;

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        opacity: disabled ? 0.5 : 1,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        style={{
          position: "relative",
          width,
          height: KNOB_SIZE,
          flexShrink: 0,
        }}
      >
        {/* Native range input — provides keyboard a11y AND captures
            mouse drags. We fully hide it visually but keep it on top
            so it intercepts pointer events for the underlying knob. */}
        <input
          ref={inputRef}
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-label={label}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          onMouseDown={() => setDragging(true)}
          onMouseUp={() => setDragging(false)}
          onTouchStart={() => setDragging(true)}
          onTouchEnd={() => setDragging(false)}
          onBlur={() => setDragging(false)}
          style={hiddenInputStyle}
        />

        {/* Visual track (full width) */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: (KNOB_SIZE - TRACK_HEIGHT) / 2,
            left: 0,
            width,
            height: TRACK_HEIGHT,
            background: "var(--bg-elevated)",
            borderRadius: 9999,
          }}
        />

        {/* Visual track (filled portion) */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: (KNOB_SIZE - TRACK_HEIGHT) / 2,
            left: 0,
            width: `${clampedPct}%`,
            maxWidth: width,
            height: TRACK_HEIGHT,
            background: "var(--text-primary)",
            borderRadius: 9999,
            transition: dragging
              ? "none"
              : "width 120ms cubic-bezier(0.25, 1, 0.5, 1)",
          }}
        />

        {/* Visual knob */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: 0,
            left: `calc(${clampedPct}% - ${KNOB_SIZE / 2}px)`,
            width: KNOB_SIZE,
            height: KNOB_SIZE,
            borderRadius: "50%",
            background: "var(--text-primary)",
            transform: `scale(${knobScale})`,
            transformOrigin: "center",
            transition: dragging
              ? "none"
              : "transform 120ms cubic-bezier(0.25, 1, 0.5, 1), left 120ms cubic-bezier(0.25, 1, 0.5, 1)",
            pointerEvents: "none",
          }}
        />
      </div>

      {/* Inline value readout */}
      <span
        aria-hidden
        style={{
          width: READOUT_WIDTH,
          flexShrink: 0,
          fontFamily: "var(--font-pixel-grid)",
          fontSize: "var(--text-xs)",
          color: "var(--text-secondary)",
          fontVariantNumeric: "tabular-nums",
          textAlign: "right",
        }}
      >
        {fmt(value)}
      </span>
    </div>
  );
}

const hiddenInputStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  opacity: 0,
  cursor: "pointer",
  margin: 0,
  padding: 0,
  // Important: keep above the visual layer so drags work.
  zIndex: 2,
};
