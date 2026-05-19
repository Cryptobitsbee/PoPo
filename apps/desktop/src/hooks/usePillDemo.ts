import { useEffect } from "react";
import { usePillStore } from "../store/pillStore";
import type { PillState } from "@popo/shared-types";

/**
 * usePillDemo — development-only state cycler for the pill.
 *
 * Enabled when `VITE_PILL_DEMO=1` OR the pill URL includes `?demo=1`.
 * Mirrors the timing Rust will use in production:
 *
 *   sleep → (2s) → ready → (600ms flat) → active → (3s live bars) →
 *   processing → (1.2s) → success → (300ms) → sleep → loop
 *
 * Error branch is triggered once per cycle (every 5th rotation).
 *
 * This hook is a no-op when demo mode is off. Real Rust events from
 * usePillEvents drive the store in production.
 *
 * WARNING: never ship demo mode as the default. It's for visual QA of the
 * pill component before Rust is wired.
 */

const STATE_TIMINGS: Record<PillState, number> = {
  sleep: 2000,
  ready: 600,
  active: 3000,
  processing: 1200,
  success: 300,
  error: 2000,
};

export function usePillDemo() {
  const setState = usePillStore((s) => s.setState);
  const setBars = usePillStore((s) => s.setBars);
  const setError = usePillStore((s) => s.setError);

  useEffect(() => {
    const envFlag = import.meta.env.VITE_PILL_DEMO === "1";
    const urlFlag =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("demo") === "1";
    if (!envFlag && !urlFlag) return;

    let timer: number | undefined;
    let barTimer: number | undefined;
    let cycle = 0;

    const runState = (state: PillState) => {
      if (state === "error") {
        setError({ code: "demo", message: "demo cycle error state" });
      } else {
        setState(state);
      }
    };

    const advance = () => {
      cycle += 1;
      const sequence: PillState[] =
        cycle % 5 === 0
          ? ["sleep", "ready", "active", "error"]
          : ["sleep", "ready", "active", "processing", "success"];

      let stepIdx = 0;
      const step = () => {
        if (stepIdx >= sequence.length) {
          advance();
          return;
        }
        const s = sequence[stepIdx];
        runState(s);

        if (s === "active") {
          // Pump synthetic waveform bars at ~25Hz.
          const start = performance.now();
          barTimer = window.setInterval(() => {
            const t = (performance.now() - start) / 1000;
            const bars = new Array(16).fill(0).map((_, i) => {
              const phase = t * 4 + i * 0.4;
              return Math.max(0, 0.45 + 0.4 * Math.sin(phase) + 0.15 * Math.sin(phase * 2.7));
            });
            setBars(bars);
          }, 40);
        } else if (barTimer !== undefined) {
          window.clearInterval(barTimer);
          barTimer = undefined;
          setBars(new Array(16).fill(0));
        }

        timer = window.setTimeout(step, STATE_TIMINGS[s]);
        stepIdx += 1;
      };

      step();
    };

    advance();

    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      if (barTimer !== undefined) window.clearInterval(barTimer);
    };
  }, [setState, setBars, setError]);
}
