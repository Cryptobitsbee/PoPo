import { AnimatePresence, motion } from "framer-motion";
import type { Mode } from "@popo/shared-types";
import ModeCard from "./ModeCard";
import NewModeCard from "./NewModeCard";

/**
 * ModeGrid — 2-column CSS-grid container for the Modes page.
 *
 * Per brief §3 Modes:
 *   2 columns · gap --sp-4 · mt --sp-6
 *
 * The last tile is always the `NewModeCard` (dashed +). Existing modes
 * stagger on mount like the History list (DESIGN_SYSTEM §6 stagger).
 */

const containerVariants = {
  animate: {
    transition: {
      staggerChildren: 0.04,
    },
  },
};

const itemVariants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.15 } },
  exit: { opacity: 0, transition: { duration: 0.12 } },
};

export interface ModeGridProps {
  modes: Mode[];
  onEdit: (mode: Mode) => void;
  onDuplicate: (mode: Mode) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
}

export default function ModeGrid({
  modes,
  onEdit,
  onDuplicate,
  onDelete,
  onNew,
}: ModeGridProps) {
  return (
    <motion.div
      variants={containerVariants}
      initial="initial"
      animate="animate"
      style={{
        marginTop: "var(--sp-6)",
        display: "grid",
        gridTemplateColumns: "repeat(2, 1fr)",
        gap: "var(--sp-4)",
      }}
    >
      <AnimatePresence initial={false}>
        {modes.map((mode) => (
          <motion.div
            key={mode.id}
            variants={itemVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            layout
            style={{ display: "flex" }}
          >
            <div style={{ flex: 1, display: "flex" }}>
              <div style={{ flex: 1 }}>
                <ModeCard
                  mode={mode}
                  onEdit={() => onEdit(mode)}
                  onDuplicate={() => onDuplicate(mode)}
                  onDelete={() => onDelete(mode.id)}
                />
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>

      {/* NewModeCard is always present, no motion wrapper so it stays put */}
      <NewModeCard onClick={onNew} />
    </motion.div>
  );
}
