import type { ReactNode } from "react";
import Modal from "./Modal";
import Button from "./Button";

/**
 * ConfirmDialog — small wrapper around `Modal` for destructive /
 * risky actions. Keeps the "yes / cancel" dance consistent across
 * every place in popo that needs confirmation:
 *
 *   - Delete a mode
 *   - Delete a snippet / dictionary entry
 *   - Delete all my account data (danger zone)
 *   - Reset modes to factory defaults
 *   - ...anywhere else a user might regret a click
 *
 * The Cancel button gets autofocus so keyboard Enter always goes to
 * the safe choice. Esc + backdrop click cancel (inherited from Modal).
 *
 * `tone="destructive"` gives the Confirm button the `--accent-error`
 * color treatment so the UI reads "this one's permanent". For
 * non-destructive confirms ("overwrite these saved settings?") pass
 * `tone="neutral"` and the button uses the primary style.
 */

export interface ConfirmDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  /**
   * Body copy. Can be a string, or any React node for richer content
   * (e.g. a list of what's about to be deleted).
   */
  description?: ReactNode;
  /** Primary action label. Default "Delete". */
  confirmLabel?: string;
  /** Cancel label. Default "Cancel". */
  cancelLabel?: string;
  /** `"destructive"` (red confirm) or `"neutral"` (primary confirm). */
  tone?: "destructive" | "neutral";
  /** When true, disables the confirm button — useful during async work. */
  busy?: boolean;
}

export default function ConfirmDialog({
  open,
  onConfirm,
  onCancel,
  title,
  description,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  tone = "destructive",
  busy = false,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onCancel} width={420} label={title}>
      <h2
        style={{
          margin: 0,
          fontFamily: "var(--font-pixel-square)",
          fontSize: "var(--text-lg)",
          fontWeight: 500,
          lineHeight: 1.2,
          color: "var(--text-primary)",
        }}
      >
        {title}
      </h2>
      {description && (
        <div
          style={{
            marginTop: "var(--sp-4)",
            fontFamily: "var(--font-pixel-line)",
            fontSize: "var(--text-sm)",
            lineHeight: 1.55,
            color: "var(--text-secondary)",
          }}
        >
          {description}
        </div>
      )}
      <div
        style={{
          marginTop: "var(--sp-6)",
          display: "flex",
          justifyContent: "flex-end",
          gap: "var(--sp-3)",
        }}
      >
        <Button variant="ghost" onClick={onCancel} autoFocus disabled={busy}>
          {cancelLabel}
        </Button>
        <Button
          variant="primary"
          onClick={onConfirm}
          disabled={busy}
          style={
            tone === "destructive"
              ? {
                  background: "var(--accent-error)",
                  color: "var(--text-primary)",
                  borderColor: "var(--accent-error)",
                }
              : undefined
          }
        >
          {busy ? "Working…" : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
