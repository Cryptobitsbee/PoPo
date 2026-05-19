import { motion } from "framer-motion";

/**
 * DotMatrix — 3×3 grid pixel loader used in every popo loading / empty /
 * processing state.
 *
 * PLACEHOLDER. The brief prescribes `@dotmatrix/dotm-square-3` installed via
 * `npx shadcn@latest add @dotmatrix/dotm-square-3`. That install is deferred
 * to Phase 3 polish because:
 *   1. It pulls a shadcn-style component tree that we haven't initialized.
 *   2. The runtime behavior we need right now — pill processing indicator —
 *      is identical to this lightweight in-house version.
 *
 * When the real component lands, replace this file's default export with a
 * re-export from the shadcn path. The public props surface must stay the
 * same: { size?: number; tone?: 'primary' | 'secondary' | 'ghost' }.
 *
 * Lint note (DESIGN_SYSTEM §10): no spinners, no shimmer gradients — this
 * pulse animation is purposeful state feedback per impeccable motion rules.
 */

export interface DotMatrixProps {
  /** Outer pixel size of the 3×3 grid. Default 12px (fits in the 44px pill height). */
  size?: number;
  /** Token family for the dots. */
  tone?: "primary" | "secondary" | "ghost";
}

const TONE_MAP: Record<NonNullable<DotMatrixProps["tone"]>, string> = {
  primary: "var(--text-primary)",
  secondary: "var(--text-secondary)",
  ghost: "var(--text-ghost)",
};

/**
 * Dot pulse pattern (9 dots, 3×3 grid). Reading order left-to-right,
 * top-to-bottom. The sequence below is a diagonal-sweep that reads as
 * "forward progress" without looking like a spinner.
 */
const PULSE_SEQUENCE = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const PULSE_DURATION = 1.2; // seconds for one full sweep

export default function DotMatrix({
  size = 12,
  tone = "primary",
}: DotMatrixProps) {
  const dotSize = Math.max(1, Math.floor(size / 5));
  const gap = Math.max(1, Math.floor(size / 10));
  const color = TONE_MAP[tone];

  return (
    <div
      role="status"
      aria-label="Loading"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(3, ${dotSize}px)`,
        gridAutoRows: `${dotSize}px`,
        gap,
        width: "fit-content",
      }}
    >
      {PULSE_SEQUENCE.map((i) => (
        <motion.span
          key={i}
          style={{
            width: dotSize,
            height: dotSize,
            borderRadius: "var(--radius-micro)",
            background: color,
            display: "block",
          }}
          // ease-out-quart per impeccable motion-design.md
          animate={{ opacity: [0.25, 1, 0.25] }}
          transition={{
            duration: PULSE_DURATION,
            ease: [0.25, 1, 0.5, 1],
            repeat: Infinity,
            delay: (i / PULSE_SEQUENCE.length) * PULSE_DURATION,
          }}
        />
      ))}
    </div>
  );
}
