import { motion } from "framer-motion";

/**
 * AppIconBubble — a 32×32 circle that emerges from the left edge of the
 * pill when recording starts, showing the icon of the target app where
 * text will be pasted.
 *
 * Lifecycle:
 *   - Mounts when pill:app-icon event fires AND state is not "sleep".
 *   - Stays visible during ready / active / processing.
 *   - Unmounts (exit animation) on success / error / sleep.
 *
 * The parent wraps this in <AnimatePresence> and conditionally renders
 * based on `appIcon && state !== "sleep"`.
 *
 * Spring matches the pill morph (stiffness: 380, damping: 28) — they
 * move in concert so the bubble feels like part of the pill.
 */

interface AppIconBubbleProps {
  iconBase64: string;
}

export default function AppIconBubble({ iconBase64 }: AppIconBubbleProps) {
  return (
    <motion.div
      // OUTER wrapper: animates WIDTH only, to collapse flex space on exit.
      // This ensures the pill stays centered without the bubble itself
      // distorting (since the inner circle has fixed 40x40 dimensions).
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 40, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 28 }}
      style={{
        height: 40,
        flexShrink: 0,
        pointerEvents: "none",
        overflow: "visible",
      }}
    >
      <motion.div
        // INNER circle: fixed 40x40 — never stretched. Scales for enter/exit.
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        exit={{ scale: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 28 }}
        style={{
          width: 40,
          height: 40,
          borderRadius: "50%",
          border: "1px solid var(--pill-border)",
          background: "var(--pill-bg)",
          backdropFilter: "blur(var(--pill-blur))",
          WebkitBackdropFilter: "blur(var(--pill-blur))",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 8,
          boxSizing: "border-box",
        }}
      >
        <img
          src={`data:image/png;base64,${iconBase64}`}
          alt=""
          draggable={false}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            filter: "brightness(0.95)",
          }}
        />
      </motion.div>
    </motion.div>
  );
}
