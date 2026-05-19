import { forwardRef, type InputHTMLAttributes } from "react";

/**
 * Input — single-line text input primitive.
 *
 * Per DESIGN_SYSTEM §9:
 *   Default: bg --bg-elevated · border --border-subtle · radius --radius-button
 *   Font:    GeistPixelLine (body reading surface)  OR  GeistPixelGrid
 *            (technical / monospaced data) when `monospace` is set.
 *   Placeholder: --text-ghost (styled via the inline <style> below,
 *                React inline styles can't target ::placeholder).
 *
 * Used in ModeEditor (name), GCPSetup (path, project id), Test page
 * (manual transcript input — Phase 4 [14]).
 */

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Use the monospaced GeistPixelGrid face for paths, IDs, numbers. */
  monospace?: boolean;
}

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { monospace, style, ...rest },
  ref,
) {
  return (
    <>
      <input
        ref={ref}
        {...rest}
        data-popo-input
        style={{
          width: "100%",
          height: 32,
          padding: "0 12px",
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-button)",
          fontFamily: monospace
            ? "var(--font-pixel-grid)"
            : "var(--font-pixel-line)",
          fontSize: "var(--text-sm)",
          lineHeight: 1.4,
          color: "var(--text-primary)",
          outline: "none",
          caretColor: "var(--text-primary)",
          transition: "border-color 120ms ease",
          ...style,
        }}
      />
      {/* Global-ish placeholder styling scoped via [data-popo-input]. */}
      <style>{`
        [data-popo-input]::placeholder {
          color: var(--text-ghost);
        }
        [data-popo-input]:focus {
          border-color: var(--border-default);
        }
      `}</style>
    </>
  );
});

export default Input;
