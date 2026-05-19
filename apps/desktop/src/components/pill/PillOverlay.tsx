import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { usePillStore } from "../../store/pillStore";
import { useSettingsStore } from "../../store/settingsStore";
import WaveformContent from "./WaveformContent";
import ProcessingContent from "./ProcessingContent";
import SuccessContent from "./SuccessContent";
import ErrorContent from "./ErrorContent";
import type { PillState } from "@popo/shared-types";

/**
 * PillOverlay — the single morphing motion.div.
 *
 * This component is the entire product UI in the pill webview. One
 * `motion.div`, layout-animated with a spring. Never swaps with sibling
 * components; inner content crossfades via AnimatePresence mode="wait".
 *
 * Reads state from pillStore (Zustand). Never writes. The store is driven
 * by:
 *   - Rust events via hooks/usePillEvents (production)
 *   - hooks/usePillDemo (dev cycle when VITE_PILL_DEMO=1 or ?demo=1)
 *
 * See:
 *   - POPO_BRIEF §2
 *   - docs/DESIGN_SYSTEM.md §7 (state→size table, transitions, waveform spec)
 *   - docs/DESIGN_SYSTEM.md §12 (skill reconciliation; pill is brief-blessed
 *     rounded-full exception; backdrop-filter is only purposeful glassmorphism)
 *   - impeccable reference/motion-design.md (reduced-motion mandate)
 */

interface PillStyleSpec {
  width: number;
  height: number;
}

// Sizes are still hard-coded per brief §2 / DESIGN_SYSTEM §7 — they
// are part of the pill's visual language, not user-configurable.
// Only OPACITY is user-tunable (Session 49 feature #20):
//   - sleep state → settings.pillSleepOpacity (default 0.18)
//   - all non-sleep states → settings.pillActiveOpacity (default 1.0)
// The non-sleep multiplier is also slightly attenuated for `ready`
// (0.85) so it appears just-arrived vs. fully-engaged — a brief-
// specified perceptual cue, not a setting.
const PILL_STYLES: Record<PillState, PillStyleSpec> = {
  // Sleep is intentionally quiet. Session 50: 30% smaller (80×14
  // → 56×10) per user request — the previous 80px width felt
  // chunky for a passive ambient indicator. The cursor proximity
  // zone in src-tauri/src/lib.rs was shrunk to match (pill_half_w
  // 40 → 28) so the user's grab area still tracks the visible bar.
  sleep: { width: 56, height: 10 },
  // Active/ready: minimal 176×40 (down from 220×44 — 20% narrower, 10% shorter)
  ready: { width: 176, height: 40 },
  active: { width: 176, height: 40 },
  processing: { width: 144, height: 40 },
  success: { width: 96, height: 40 },
  error: { width: 144, height: 40 },
};

// Spring tuned per brief §2: "stiffness:380, damping:28". Critically damped,
// no bounce — complies with impeccable "no bounce/elastic" motion ban.
const DEFAULT_TRANSITION = {
  type: "spring" as const,
  stiffness: 380,
  damping: 28,
};

// Reduced-motion fallback: linear 150ms, no spring overshoot. Matches the
// impeccable "reduced-motion is mandatory" rule.
const REDUCED_TRANSITION = {
  type: "tween" as const,
  duration: 0.15,
  ease: "linear" as const,
};

export default function PillOverlay() {
  const state = usePillStore((s) => s.state);
  const bars = usePillStore((s) => s.bars);
  const prefersReducedMotion = useReducedMotion();

  // Session 49 feature #20: pill opacity is user-tunable. The pill
  // webview subscribes to cross-webview settings updates in
  // PillPage so this re-renders live when the user drags the
  // Settings sliders.
  const sleepOpacity = useSettingsStore((s) => s.settings.pillSleepOpacity);
  const activeOpacity = useSettingsStore((s) => s.settings.pillActiveOpacity);

  const sizing = PILL_STYLES[state];
  // Resolve final opacity per state. Sleep gets the user's sleep
  // opacity; ready gets a slight attenuation of active (0.85×) for
  // the "just arrived" feel; everything else gets full active.
  const opacity =
    state === "sleep"
      ? sleepOpacity
      : state === "ready"
        ? activeOpacity * 0.85
        : activeOpacity;

  const transition = prefersReducedMotion
    ? REDUCED_TRANSITION
    : DEFAULT_TRANSITION;

  const background =
    state === "sleep" ? "var(--pill-sleep-bg)" : "var(--pill-bg)";
  const borderColor =
    state === "error"
      ? "var(--accent-error)"
      : state === "sleep"
        ? "var(--pill-sleep-border)"
        : "var(--pill-border)";

  // Drag behavior: Tauri's declarative `data-tauri-drag-region` attribute
  // lives on the pill surface ONLY during sleep state. Tauri's webview
  // intercepts pointerdown on this element SYNCHRONOUSLY (no JS await
  // chain) and initiates a window drag via the native Win32 message
  // mechanism — which is why the async startDragging() approach we tried
  // in Session 14 failed (Windows classified the input as a click by the
  // time the dynamic import completed).
  //
  // In non-sleep states the attribute is omitted so an accidental click
  // mid-dictation doesn't tug the pill. (Also, PillPage sets
  // setIgnoreCursorEvents(true) for non-sleep states anyway, so clicks
  // never reach the webview to begin with.)
  const dragRegionProp =
    state === "sleep" ? { "data-tauri-drag-region": true } : {};

  return (
    <motion.div
      data-pill-surface
      data-pill-state={state}
      {...dragRegionProp}
      layout
      animate={{
        width: sizing.width,
        height: sizing.height,
        opacity,
        background,
        borderColor,
      }}
      transition={transition}
      style={{
        borderRadius: "var(--radius-pill)",
        borderWidth: 1,
        borderStyle: "solid",
        // Blur is popo's single purposeful glassmorphism use
        // (DESIGN_SYSTEM §12.3).
        backdropFilter: `blur(var(--pill-blur))`,
        WebkitBackdropFilter: `blur(var(--pill-blur))`,
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        // Sleep pill gets a grab cursor as a drag affordance; other
        // states use default since they don't accept clicks.
        cursor: state === "sleep" ? "grab" : "default",
      }}
    >
      <AnimatePresence mode="wait">
        {(state === "ready" || state === "active") && (
          <motion.div
            key="wave"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            // Exit ≈ 75% of enter per motion-design.md "perceived-performance".
            transition={{ duration: 0.12, ease: [0.25, 1, 0.5, 1] }}
            style={pillInnerStyle}
          >
            <WaveformContent bars={bars} state={state} />
          </motion.div>
        )}

        {state === "processing" && (
          <motion.div
            key="proc"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12, ease: [0.25, 1, 0.5, 1] }}
            style={pillInnerStyle}
          >
            <ProcessingContent />
          </motion.div>
        )}

        {state === "success" && (
          <motion.div
            key="ok"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            style={pillInnerStyle}
          >
            <SuccessContent />
          </motion.div>
        )}

        {state === "error" && (
          <motion.div
            key="err"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            style={pillInnerStyle}
          >
            <ErrorContent />
          </motion.div>
        )}

        {/* sleep: no inner content — the pill shape IS the UI. */}
      </AnimatePresence>
    </motion.div>
  );
}

const pillInnerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "100%",
  height: "100%",
};
