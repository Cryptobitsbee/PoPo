import DotMatrix from "../pill/DotMatrix";

/**
 * EmptyState — shown when the History list has no sessions at all.
 *
 * Per brief §3 History:
 *   Centered vertically: DotMatrix pattern (subtle)
 *   "No sessions yet"         GeistPixelSquare --text-sm --text-ghost
 *   "Hold [Ctrl+Shift+Space]  GeistPixelGrid   --text-xs --text-ghost
 *    anywhere to start"
 *
 * Also used for search-no-match (with a different message passed in).
 * The DotMatrix doubles as "empty pattern" (brief allows — DotMatrix is
 * the only permitted loader/empty visual per DESIGN_SYSTEM §4).
 */

export interface EmptyStateProps {
  /** Main heading line. Default for "no sessions yet". */
  headline?: string;
  /** Secondary instructional line. */
  subline?: React.ReactNode;
}

export default function EmptyState({
  headline = "No sessions yet",
  subline,
}: EmptyStateProps) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--sp-3)",
        padding: "var(--sp-12) var(--sp-6)",
        minHeight: 280,
      }}
    >
      <DotMatrix size={28} tone="ghost" />
      <div
        style={{
          marginTop: "var(--sp-4)",
          fontFamily: "var(--font-pixel-square)",
          fontSize: "var(--text-sm)",
          color: "var(--text-ghost)",
          lineHeight: 1.3,
        }}
      >
        {headline}
      </div>
      {subline && (
        <div
          style={{
            fontFamily: "var(--font-pixel-grid)",
            fontSize: "var(--text-xs)",
            color: "var(--text-ghost)",
            lineHeight: 1.4,
            textAlign: "center",
          }}
        >
          {subline}
        </div>
      )}
    </div>
  );
}

/**
 * Rendering the keystroke in the default "start" subline as <kbd> tags.
 * Use this when the caller wants the stock copy. Kept as a named export
 * so it's easy to import both pieces together.
 */
export function StartHintSubline() {
  return (
    <span>
      Hold <Kbd>Ctrl</Kbd> + <Kbd>Shift</Kbd> + <Kbd>Space</Kbd> anywhere to start
    </span>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "0 6px",
        height: 18,
        marginInline: 2,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-micro)",
        fontFamily: "var(--font-pixel-square)",
        fontSize: "var(--text-2xs)",
        lineHeight: 1.2,
        color: "var(--text-secondary)",
      }}
    >
      {children}
    </kbd>
  );
}
