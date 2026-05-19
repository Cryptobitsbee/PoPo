import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, type ReactNode } from "react";

/**
 * Modal — shared modal primitive.
 *
 * Per brief §3 Modes "Mode Editor Modal":
 *   Backdrop: bg rgba(8,8,8,0.82), blur(6px)
 *   Panel: bg --bg-surface, border 1px --border-subtle, radius --radius-card
 *   Width default 520px · max-height 90vh · padding --sp-8
 *   Entrance: scale 0.96→1 + opacity 0→1, 180ms ease-out
 *
 * Rendered via React Portal into document.body so it escapes any
 * overflow:hidden ancestor (AppShell has overflow:hidden on main).
 *
 * Closes on:
 *   - Escape key (always)
 *   - Backdrop click (configurable; default on)
 *
 * Note: ModeEditor is a brief-authored exception to impeccable's
 * "no modal-first" rule (logged in DESIGN_SYSTEM §12.3). Use Modal
 * sparingly — most surfaces should prefer inline progressive UI.
 */

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  closeOnBackdrop?: boolean;
  /** aria-label for the panel itself (for screen readers). */
  label?: string;
}

export default function Modal({
  open,
  onClose,
  children,
  width = 520,
  closeOnBackdrop = true,
  label,
}: ModalProps) {
  // Escape closes (always, regardless of closeOnBackdrop).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.25, 1, 0.5, 1] }}
          onClick={closeOnBackdrop ? onClose : undefined}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(8, 8, 8, 0.82)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            zIndex: 100,
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={label}
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            style={{
              width,
              maxWidth: "100%",
              maxHeight: "90vh",
              padding: "var(--sp-8)",
              background: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-card)",
              display: "flex",
              flexDirection: "column",
              overflow: "auto",
            }}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
