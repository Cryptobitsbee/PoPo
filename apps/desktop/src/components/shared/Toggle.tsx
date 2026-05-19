import { motion } from "framer-motion";

/**
 * Toggle — 36×20 spring toggle per brief §3 Settings.
 *
 *   36×20 · radius 9999 (pill)
 *   Off: bg --bg-elevated · knob --text-ghost
 *   On:  bg --text-primary · knob --bg-void
 *   Knob spring: { stiffness: 400, damping: 25 }
 *   Track: 150ms ease background
 *
 * Designed for boolean settings (autoFormat, restoreClipboard, storeAudio,
 * privacyMode, soundEffects, startAtLogin). Keyboard: Space toggles when
 * focused.
 */

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}

const TRACK_WIDTH = 36;
const TRACK_HEIGHT = 20;
const KNOB_SIZE = 14;
const KNOB_PADDING = 3;

export default function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: ToggleProps) {
  const offX = KNOB_PADDING;
  const onX = TRACK_WIDTH - KNOB_SIZE - KNOB_PADDING;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      style={{
        position: "relative",
        width: TRACK_WIDTH,
        height: TRACK_HEIGHT,
        padding: 0,
        border: "none",
        borderRadius: 9999,
        background: checked ? "var(--text-primary)" : "var(--bg-elevated)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "background-color 150ms ease",
        flexShrink: 0,
      }}
    >
      <motion.span
        aria-hidden
        animate={{ x: checked ? onX : offX }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
        style={{
          position: "absolute",
          top: (TRACK_HEIGHT - KNOB_SIZE) / 2,
          left: 0,
          width: KNOB_SIZE,
          height: KNOB_SIZE,
          borderRadius: "50%",
          background: checked ? "var(--bg-void)" : "var(--text-ghost)",
          display: "block",
        }}
      />
    </button>
  );
}
