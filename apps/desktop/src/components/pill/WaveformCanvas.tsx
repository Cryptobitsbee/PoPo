import { motion, useReducedMotion } from "framer-motion";
import { useMemo } from "react";

/**
 * WaveformCanvas — the 16-bar live waveform. Reusable.
 *
 * Per POPO_BRIEF §2:
 *   16 bars total · bar width 3px · gap 2px · total width 78px centered
 *   max bar height 24px (peak voice) · min 3px (silence)
 *   bar-radius 2px top, 0 bottom
 *   active color: --wave-primary · flat color: --wave-flat
 *   flat-state idle motion: gentle ±1px organic noise for life
 *
 * Used in:
 *   - PillOverlay (ready + active states) via WaveformContent
 *   - Test page "Hold to Dictate" button (Phase 4 item [14])
 *
 * Reduced-motion: when the user prefers reduced motion, the idle-flat
 * noise is disabled and bars snap to their driven heights without easing.
 */

export interface WaveformCanvasProps {
  /** 16 amplitude values in 0..1. Falls back to silence if length mismatch. */
  bars: number[];
  /** Drives color + subtle opacity. */
  tone: "flat" | "active";
  /**
   * Absolute size. Defaults match brief spec. Test page may override.
   */
  barCount?: number;
  barWidth?: number;
  barGap?: number;
  barMinHeight?: number;
  barMaxHeight?: number;
}

const DEFAULTS = {
  barCount: 16,
  barWidth: 4,
  barGap: 4,
  barMinHeight: 3,
  barMaxHeight: 24,
} as const;

export default function WaveformCanvas({
  bars,
  tone,
  barCount = DEFAULTS.barCount,
  barWidth = DEFAULTS.barWidth,
  barGap = DEFAULTS.barGap,
  barMinHeight = DEFAULTS.barMinHeight,
  barMaxHeight = DEFAULTS.barMaxHeight,
}: WaveformCanvasProps) {
  const prefersReducedMotion = useReducedMotion();

  // Normalize bars to exact length. Silence pads on either side.
  const normalized = useMemo<number[]>(() => {
    if (bars.length === barCount) return bars;
    const out = new Array<number>(barCount).fill(0);
    for (let i = 0; i < Math.min(bars.length, barCount); i++) {
      out[i] = bars[i];
    }
    return out;
  }, [bars, barCount]);

  const color = tone === "active" ? "var(--wave-primary)" : "var(--wave-flat)";

  return (
    <div
      role="img"
      aria-label={tone === "active" ? "Recording voice" : "Ready, no voice"}
      style={{
        display: "flex",
        alignItems: "flex-end", // bars grow from the bottom
        justifyContent: "center",
        gap: `${barGap}px`,
        height: `${barMaxHeight}px`,
        width: `${barCount * barWidth + (barCount - 1) * barGap}px`,
        // Fade at both edges for a polished, spread-out look.
        // Bars at the center stay fully opaque; bars at the edges fade to 0.
        maskImage:
          "linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%)",
        WebkitMaskImage:
          "linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%)",
      }}
    >
      {normalized.map((amp, i) => {
        // Amplitude in 0..1 → height between min and max.
        const driven =
          barMinHeight +
          Math.max(0, Math.min(1, amp)) * (barMaxHeight - barMinHeight);

        // Flat state gets gentle ±1px organic noise for life (brief §2).
        // Active state uses the driven height directly (Rust pushes 40ms updates).
        const isFlat = tone === "flat";
        const idleHeight =
          isFlat && !prefersReducedMotion
            ? [
                barMinHeight + noise(i, 0),
                barMinHeight + noise(i, 1),
                barMinHeight + noise(i, 2),
                barMinHeight + noise(i, 3),
              ]
            : driven;

        return (
          <motion.span
            key={i}
            style={{
              width: `${barWidth}px`,
              background: color,
              // 2px top radius, 0 bottom per brief.
              borderTopLeftRadius: 2,
              borderTopRightRadius: 2,
              borderBottomLeftRadius: 0,
              borderBottomRightRadius: 0,
              display: "block",
              flexShrink: 0,
            }}
            animate={{ height: idleHeight }}
            transition={
              isFlat
                ? {
                    duration: 2 + (i % 4) * 0.5,
                    ease: [0.25, 1, 0.5, 1],
                    repeat: Infinity,
                    repeatType: "mirror",
                  }
                : {
                    // Active voice: 80ms ease-out per brief §2 "active → ready" spec.
                    duration: 0.08,
                    ease: [0.16, 1, 0.3, 1],
                  }
            }
            // Hardware acceleration hint: only while animating.
            // (impeccable motion-design.md: don't set will-change preemptively.)
          />
        );
      })}
    </div>
  );
}

/**
 * Deterministic-per-bar noise offset in the range [-1, +1].
 * We do NOT use Math.random() so the idle animation doesn't shimmer across
 * every re-render. The (i, step) tuple seeds a stable offset per-bar.
 */
function noise(barIndex: number, step: number): number {
  const seed = (barIndex * 9301 + step * 49297) % 233280;
  const v = seed / 233280; // 0..1
  return (v - 0.5) * 2; // -1..+1
}
