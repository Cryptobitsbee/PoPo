import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { usePillStore } from "../store/pillStore";
import type {
  PillState,
  PillErrorPayload,
  PillWaveformPayload,
} from "@popo/shared-types";

/**
 * usePillEvents — subscribes to the Tauri event protocol from Rust and
 * dispatches into pillStore. Mounted once inside PillPage.
 *
 * Event contract (see memory-bank/systemPatterns.md §"Tauri event protocol"):
 *   pill:state:sleep      | {}
 *   pill:state:ready      | {}
 *   pill:state:active     | {}
 *   pill:state:processing | {}
 *   pill:state:success    | {}
 *   pill:state:error      | { code, message, action? }
 *   pill:waveform         | { bars: number[16] }
 *
 * Listeners are registered in parallel on mount and torn down on unmount.
 * Rust doesn't emit any of these yet (that's Phase 3 item [9] end-to-end
 * wiring); this hook is installed ahead of time so there's no UI change
 * when the Rust side comes online.
 */
/**
 * Errors remain visible in the pill's accessible ErrorTooltip. Native toast
 * fallback was removed because it was unreliable on unsigned/dev builds and
 * pulled in a vulnerable Windows XML notification stack.
 */
export function usePillEvents() {
  const setState = usePillStore((s) => s.setState);
  const setBars = usePillStore((s) => s.setBars);
  const setError = usePillStore((s) => s.setError);

  useEffect(() => {
    let disposed = false;
    const unlistens: UnlistenFn[] = [];

    // Register a handler for a simple state-change event.
    const bindState = async (state: PillState) => {
      const fn = await listen(`pill:state:${state}`, () => {
        if (disposed) return;
        setState(state);
      });
      unlistens.push(fn);
    };

    (async () => {
      await Promise.all([
        bindState("sleep"),
        bindState("ready"),
        bindState("active"),
        bindState("processing"),
        bindState("success"),
      ]);

      const errorUnlisten = await listen<PillErrorPayload>(
        "pill:state:error",
        (evt) => {
          if (disposed) return;
          setError(evt.payload);
        },
      );
      unlistens.push(errorUnlisten);

      // `pill:error:clear` is emitted by Rust when a condition that
      // produced a persistent tooltip has been resolved (e.g. the
      // user finished the GCP setup wizard). It wipes the tooltip
      // without waiting for the 10s auto-dismiss — critical for
      // persistent variants which otherwise stay on-screen forever.
      const clearUnlisten = await listen("pill:error:clear", () => {
        if (disposed) return;
        usePillStore.getState().clearError();
      });
      unlistens.push(clearUnlisten);

      const waveformUnlisten = await listen<PillWaveformPayload>(
        "pill:waveform",
        (evt) => {
          if (disposed) return;
          if (Array.isArray(evt.payload?.bars)) setBars(evt.payload.bars);
        },
      );
      unlistens.push(waveformUnlisten);
    })().catch((e) => {
      // listen() can fail if the Tauri IPC isn't available (e.g. running
      // in pure Vite dev outside Tauri). We silently degrade — the demo
      // hook (usePillDemo) still works.
      // eslint-disable-next-line no-console
      console.warn("[usePillEvents] listener registration failed:", e);
    });

    return () => {
      disposed = true;
      for (const fn of unlistens) {
        try {
          fn();
        } catch {
          /* noop */
        }
      }
    };
  }, [setState, setBars, setError]);
}
