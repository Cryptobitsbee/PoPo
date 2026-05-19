import { forwardRef, type TextareaHTMLAttributes } from "react";

/**
 * Textarea — multi-line input primitive.
 *
 * Per brief §3 Modes Mode Editor Modal:
 *   System prompt (textarea, 6 rows, font GeistPixelLine)
 *
 * Tokenized like Input but taller. Resize allowed vertically so users
 * can expand for long system prompts.
 */

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ style, rows = 4, ...rest }, ref) {
    return (
      <>
        <textarea
          ref={ref}
          rows={rows}
          {...rest}
          data-popo-textarea
          style={{
            width: "100%",
            padding: "10px 12px",
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-button)",
            fontFamily: "var(--font-pixel-line)",
            fontSize: "var(--text-sm)",
            lineHeight: 1.5,
            color: "var(--text-primary)",
            outline: "none",
            caretColor: "var(--text-primary)",
            resize: "vertical",
            transition: "border-color 120ms ease",
            ...style,
          }}
        />
        <style>{`
          [data-popo-textarea]::placeholder {
            color: var(--text-ghost);
          }
          [data-popo-textarea]:focus {
            border-color: var(--border-default);
          }
        `}</style>
      </>
    );
  },
);

export default Textarea;
