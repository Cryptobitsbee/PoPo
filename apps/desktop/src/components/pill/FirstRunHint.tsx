import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePillStore } from "../../store/pillStore";

/**
 * FirstRunHint — small floating tooltip that surfaces hidden popo
 * features during a new user's first three SUCCESSFUL dictations.
 *
 * Why this exists:
 *   popo's two power features (Esc-to-cancel, Ctrl+Shift+M mode
 *   switcher) are completely undiscoverable: there is no menu, no
 *   button, no on-screen affordance for either. Without a one-time
 *   nudge during the user's first interactions, most installs never
 *   discover them. This component is the nudge.
 *
 * Behavior:
 *   1st dictation:  "Press [Esc] to cancel anytime"
 *   2nd dictation:  "Press [Ctrl]+[Shift]+[M] for mode picker"
 *   3rd dictation:  "All set! Tweak more in Settings"
 *   4th onward:     never shown again
 *
 * Lifecycle within ONE dictation:
 *   - Hint fades IN  when pill enters `ready` (200ms, slide up 4px).
 *   - Stays visible  through `active` (waveform / recording).
 *   - Fades OUT      when pill enters `processing` (150ms). Clutter
 *                    while transcription is in flight is bad UX.
 *   - Stays hidden   through `success` / `error` / `sleep`.
 *
 * Counter increment rule:
 *   Only on a CONFIRMED successful dictation, defined as the pill
 *   transitioning from any non-sleep state into `sleep` AFTER having
 *   passed through `success`. Cancellation (`error` from Esc) and
 *   transcription failures DO NOT increment — a user who never saw
 *   their transcript paste hasn't "learned" anything yet, and we'd
 *   rather give them another chance than burn through their three
 *   hint slots on accidents.
 *
 * Storage:
 *   Persisted in localStorage at `popo:first-run-dictation-count`.
 *   If localStorage is unavailable (e.g. private-browsing Vite
 *   preview, sandboxed test contexts), the component silently
 *   no-ops — better to suppress hints than to crash the pill webview.
 *
 * No Zustand store: the counter is single-window (pill webview
 * only owns this surface) and self-contained, so localStorage is
 * the natural authority. No cross-webview-sync wiring required.
 */

const STORAGE_KEY = "popo:first-run-dictation-count";
const TOTAL_HINTS = 3;

type Hint =
  | { kind: "keys"; before: string; keys: string[]; after: string }
  | { kind: "text"; text: string };

const HINTS: readonly Hint[] = [
  // 1st dictation
  { kind: "keys", before: "Press ", keys: ["Esc"], after: " to cancel anytime" },
  // 2nd dictation
  {
    kind: "keys",
    before: "Press ",
    keys: ["Ctrl", "Shift", "M"],
    after: " for mode picker",
  },
  // 3rd dictation
  { kind: "text", text: "All set! Tweak more in Settings" },
];

function readCount(): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw == null) return 0;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(n, TOTAL_HINTS);
  } catch {
    // localStorage unavailable — return sentinel so hints never show.
    return TOTAL_HINTS;
  }
}

function writeCount(n: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(n));
  } catch {
    /* localStorage unavailable; counter lives in memory only this run. */
  }
}

export default function FirstRunHint() {
  const state = usePillStore((s) => s.state);

  const [count, setCount] = useState<number>(() => readCount());

  // Track the previous pill state so we can detect transitions
  // (specifically: the success → sleep edge that means "user saw
  // their transcript paste cleanly").
  const prevStateRef = useRef(state);

  // Latches to true when the pill enters `success`. Cleared on the
  // next sleep (after we increment) or on any `error` (which means
  // the dictation didn't actually complete successfully — Esc cancel
  // or transcription failure).
  const sawSuccessRef = useRef(false);

  useEffect(() => {
    const prev = prevStateRef.current;

    if (state === "success") {
      sawSuccessRef.current = true;
    } else if (state === "error") {
      // A cancelled or failed dictation invalidates any pending
      // success edge — don't burn a hint slot on it.
      sawSuccessRef.current = false;
    } else if (state === "sleep" && prev !== "sleep" && sawSuccessRef.current) {
      sawSuccessRef.current = false;
      setCount((c) => {
        const next = Math.min(c + 1, TOTAL_HINTS);
        if (next !== c) writeCount(next);
        return next;
      });
    }

    prevStateRef.current = state;
  }, [state]);

  // Hints only show during the user-facing dictation states. We
  // explicitly include `ready` + `active` so the hint follows the
  // user from press through speaking, then bows out the moment
  // transcription begins.
  const showSlot = state === "ready" || state === "active";
  const visible = showSlot && count < TOTAL_HINTS;
  const hint = count < TOTAL_HINTS ? HINTS[count] : null;

  return (
    <AnimatePresence>
      {visible && hint ? (
        <motion.div
          // Keying on `count` ensures a clean fade-out / fade-in
          // animation if the counter increments while the hint is
          // somehow still mounted (defensive — in practice the hint
          // is hidden during success → sleep so this shouldn't fire).
          key={count}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4, transition: { duration: 0.15 } }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "8px 14px",
            background: "var(--pill-bg)",
            border: "1px solid var(--pill-border)",
            backdropFilter: "blur(var(--pill-blur))",
            WebkitBackdropFilter: "blur(var(--pill-blur))",
            borderRadius: "var(--radius-pill)",
            fontFamily: "var(--font-pixel-grid)",
            fontSize: "var(--text-xs)",
            color: "var(--text-secondary)",
            lineHeight: 1,
            whiteSpace: "nowrap",
            // The pill webview's outer container manages
            // pointer-events; this surface inherits that policy via
            // the wrapper in PillPage.
          }}
        >
          {hint.kind === "text" ? (
            <span>{hint.text}</span>
          ) : (
            <>
              <span>{hint.before}</span>
              {hint.keys.map((k, i) => (
                <span
                  key={`${k}-${i}`}
                  style={{ display: "inline-flex", alignItems: "center" }}
                >
                  <KeyChip>{k}</KeyChip>
                  {i < hint.keys.length - 1 && (
                    <span
                      style={{
                        margin: "0 3px",
                        color: "var(--text-secondary)",
                      }}
                    >
                      +
                    </span>
                  )}
                </span>
              ))}
              <span>{hint.after}</span>
            </>
          )}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/**
 * Inline keystroke chip. Mirrors the visual grammar of QuickSwitcher's
 * KeyChip but a touch smaller to suit an inline-flow context inside
 * a tooltip rather than a footer legend row.
 */
function KeyChip({ children }: { children: ReactNode }) {
  return (
    <kbd
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2px 4px",
        margin: "0 1px",
        background: "var(--bg-elevated)",
        color: "var(--text-primary)",
        borderRadius: 3,
        fontFamily: "var(--font-pixel-grid)",
        fontSize: "var(--text-xs)",
        lineHeight: 1,
      }}
    >
      {children}
    </kbd>
  );
}
