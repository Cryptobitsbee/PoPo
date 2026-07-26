import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Warning, Info } from "@phosphor-icons/react";
import { usePillStore } from "../../store/pillStore";

/**
 * ErrorTooltip — in-pill-webview error / info banner.
 *
 * Why this exists: Tauri v2's `sendNotification` is unreliable on
 * Windows dev builds (the app isn't registered with Windows'
 * notification service, Focus Assist can suppress it, permission may
 * be denied silently). This component delivers the error surface
 * inside the pill webview so it works regardless of OS notification
 * state.
 *
 * Behavior:
 *   - Appears at the top of the pill window when `pillStore.error`
 *     becomes non-null.
 *   - TRANSIENT variants (`persistent !== true`) fade out after 10
 *     seconds. Used for paste / transcribe / network errors.
 *   - PERSISTENT variants (`persistent === true`) stay visible until
 *     the user activates/dismisses the tooltip. Used for blocking status
 *     notices and actionable microphone-permission failures.
 *   - A reviewed `action` turns the compact tooltip into a keyboard-operable
 *     control. Rust sends a closed action kind, never a URL/command string.
 *   - Clicking a tooltip without an action dismisses it early.
 *   - Subsequent errors swap the content and reset any timer/action state.
 */

const DISMISS_MS = 10_000;

export default function ErrorTooltip() {
  const error = usePillStore((s) => s.error);
  const clearError = usePillStore((s) => s.clearError);
  const [visible, setVisible] = useState(false);
  const [frozen, setFrozen] = useState<typeof error>(undefined);
  const [actionPending, setActionPending] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);

  const dismiss = () => {
    setVisible(false);
    window.setTimeout(() => clearError(), 300);
  };

  const activate = async () => {
    if (!frozen?.action) {
      dismiss();
      return;
    }
    if (actionPending) return;

    setActionPending(true);
    setActionFailed(false);
    try {
      if (frozen.action.kind === "openMicSettings") {
        await invoke("cmd_open_mic_settings");
      }
      dismiss();
    } catch {
      setActionPending(false);
      setActionFailed(true);
    }
  };

  // Each new error resets visibility. Transient variants start a
  // 10-second auto-dismiss timer; persistent variants stay until the
  // user clicks. We snapshot the error into `frozen` so the content
  // doesn't vanish mid-fadeout if the upstream store clears it early.
  useEffect(() => {
    if (!error) return;
    setFrozen(error);
    setVisible(true);
    setActionPending(false);
    setActionFailed(false);
    if (error.persistent) {
      // No auto-dismiss. User clicks tooltip or Rust re-emits to
      // replace / clear.
      return;
    }
    const handle = window.setTimeout(() => {
      setVisible(false);
      // Clear the store's error after the fade completes so the next
      // error can retrigger cleanly.
      window.setTimeout(() => clearError(), 300);
    }, DISMISS_MS);
    return () => window.clearTimeout(handle);
  }, [error, clearError]);

  // Info-severity tooltips swap the red error border for a neutral
  // surface tone + hide the Warning icon. Visually similar weight so
  // the user still notices, but without scaring them.
  const isInfo = frozen?.severity === "info";

  return (
    <AnimatePresence>
      {visible && frozen ? (
        <motion.div
          key="error-tooltip"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.25, ease: [0.25, 1, 0.5, 1] }}
          onClick={() => void activate()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              void activate();
            }
          }}
          role={frozen.action ? "button" : isInfo ? "status" : "alert"}
          tabIndex={frozen.action ? 0 : undefined}
          aria-live={isInfo ? "polite" : "assertive"}
          aria-label={
            frozen.action
              ? `${frozen.message} ${frozen.action.label}`
              : undefined
          }
          aria-busy={actionPending || undefined}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            maxWidth: 264,
            minHeight: 34,
            padding: "8px 12px",
            // Match the pill's own overlay surface so the tooltip reads
            // as an extension of the pill rather than a separate panel.
            // `--pill-bg` + `--pill-blur` are the two overlay tokens.
            background: "var(--pill-bg)",
            borderRadius: "var(--radius-button)",
            // Info = neutral border; error = solid --accent-error.
            // No box-shadow: DESIGN_SYSTEM §10 bans decorative shadows,
            // the backdrop-filter + border contrast does the floating job.
            border: isInfo
              ? "1px solid var(--border-default)"
              : "1px solid var(--accent-error)",
            backdropFilter: "blur(var(--pill-blur))",
            WebkitBackdropFilter: "blur(var(--pill-blur))",
            cursor: "pointer",
            pointerEvents: "auto",
          }}
          title={frozen.message || frozen.code || "Unknown error"}
        >
          {isInfo ? (
            <Info
              size={13}
              weight="regular"
              color="var(--text-secondary)"
              style={{ flexShrink: 0, marginTop: 2 }}
            />
          ) : (
            <Warning
              size={14}
              weight="regular"
              color="var(--accent-error)"
              style={{ flexShrink: 0, marginTop: 1 }}
            />
          )}
          <span
            style={{
              fontFamily: "var(--font-pixel-line)",
              fontSize: "var(--text-xs)",
              lineHeight: 1.45,
              color: "var(--text-primary)",
              wordBreak: "break-word",
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 5,
              overflow: "hidden",
            }}
          >
            {frozen.message || frozen.code || "Unknown error"}
            {frozen.action ? (
              <span
                style={{
                  color: actionFailed
                    ? "var(--accent-error)"
                    : "var(--text-secondary)",
                  whiteSpace: "nowrap",
                }}
              >
                {" · "}
                {actionFailed
                  ? "Could not open settings. Try again"
                  : actionPending
                    ? "Opening settings"
                    : frozen.action.label}
              </span>
            ) : null}
          </span>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
