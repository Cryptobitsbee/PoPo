import { Warning } from "@phosphor-icons/react";
import { useEffect } from "react";
import { usePillStore } from "../../store/pillStore";

/**
 * ErrorContent — pill inner surface when any pipeline step fails.
 *
 * Per brief §2: single Phosphor `Warning` icon 12px, pill border override
 * --accent-error (applied at the PillOverlay level, not here). Held 2s.
 *
 * Error surfacing strategy (Session 16 refinement per user feedback):
 *   1. Pill itself: minimal — just the Warning icon in a red-outlined
 *      pill. Quiet, on-brand. The pill is not meant to carry long text.
 *   2. Native Windows toast notification: fired in usePillEvents when
 *      the error event arrives. Shows the full error message, persists
 *      in the Windows notification center for ~10s and remains
 *      readable even after the pill returns to sleep state.
 *   3. Browser devtools console: `console.error(...)` per-error for
 *      developers debugging dev builds.
 *   4. `title` attribute on the pill: hover tooltip during the 2s error
 *      hold as a third fallback for curious users.
 */
export default function ErrorContent() {
  const error = usePillStore((s) => s.error);

  useEffect(() => {
    if (!error) return;
    // eslint-disable-next-line no-console
    console.error(
      `[popo pill:error] code=${error.code} message=${error.message}`,
    );
  }, [error]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
      }}
      title={error ? `${error.code}: ${error.message}` : undefined}
    >
      <Warning
        size={12}
        weight="regular"
        color="var(--accent-error)"
        aria-label="popo encountered an error"
      />
    </div>
  );
}
