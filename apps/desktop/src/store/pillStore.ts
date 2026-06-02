import { create } from "zustand";
import type { PillState, PillErrorPayload } from "@popo/shared-types";

/**
 * pillStore — the sole render cache for pill state on the React side.
 *
 * Rust is the state machine authority (see memory-bank/systemPatterns.md).
 * React only listens to `pill:state:*` and `pill:waveform` Tauri events
 * and mirrors them here.
 *
 * Do NOT add transition logic or timers inside this store. The only
 * exception is the 300ms success hold, which is a Framer Motion
 * animation detail that lives inside <PillOverlay />.
 */

interface PillStore {
  state: PillState;
  bars: number[]; // length 16, 0..1
  error?: PillErrorPayload;

  setState: (s: PillState) => void;
  setBars: (bars: number[]) => void;
  setError: (e: PillErrorPayload) => void;
  clearError: () => void;
}

export const usePillStore = create<PillStore>((set) => ({
  state: "sleep",
  bars: new Array(16).fill(0),
  error: undefined,

  setState: (state) => set({ state }),
  setBars: (bars) => set({ bars }),
  /**
   * Show a tooltip above the pill. When `severity === "info"` the
   * pill's own state is preserved (used for soft hints that
   * accompany a normal success/sleep flow — e.g. the "finish GCP
   * setup" nudge after a fake-transcribe paste). Otherwise the pill
   * flips to "error" so the brief §2 red-border + Warning-icon
   * treatment kicks in.
   */
  setError: (error) =>
    set(error.severity === "info" ? { error } : { error, state: "error" }),
  clearError: () =>
    set((current) => ({
      error: undefined,
      state: current.state === "error" ? "sleep" : current.state,
    })),
}));
