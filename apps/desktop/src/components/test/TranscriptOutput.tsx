import { Copy } from "@phosphor-icons/react";
import DotMatrix from "../pill/DotMatrix";
import Button from "../shared/Button";
import type { TestState } from "./HoldToDictateButton";

/**
 * TranscriptOutput — the right column of the Test page.
 *
 * Per brief §3 Test:
 *   Label: "Output"  GeistPixelGrid --text-xs --text-ghost, mb --sp-2
 *   Box:   bg --bg-surface, border --border-subtle, radius --radius-card
 *          padding --sp-4, min-height 200px
 *   Text:  GeistPixelLine --text-base --text-primary
 *   Empty: DotMatrix + "Transcript appears here" centered, --text-ghost
 *   Processing: DotMatrix centered
 *   Footer: word count + Copy button
 *
 * Additional UX: Clear button appears once there's a transcript so the
 * user can reset back to idle without having to hold again.
 */

export interface TranscriptOutputProps {
  state: TestState;
  transcript: string;
  onClear: () => void;
  onCopy: () => void;
}

export default function TranscriptOutput({
  state,
  transcript,
  onClear,
  onCopy,
}: TranscriptOutputProps) {
  const hasTranscript = transcript.length > 0;
  const wordCount = hasTranscript
    ? transcript.trim().split(/\s+/).filter(Boolean).length
    : 0;
  const showProcessing = state === "processing";
  const showEmpty = !hasTranscript && !showProcessing;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <label
        style={{
          fontFamily: "var(--font-pixel-grid)",
          fontSize: "var(--text-xs)",
          color: "var(--text-ghost)",
          marginBottom: "var(--sp-2)",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
        }}
      >
        Output
      </label>

      <div
        style={{
          flex: 1,
          minHeight: 240,
          padding: "var(--sp-4)",
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-card)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Body */}
        <div
          style={{
            flex: 1,
            display: "flex",
            minHeight: 160,
          }}
        >
          {showProcessing ? (
            <ProcessingBody />
          ) : showEmpty ? (
            <EmptyBody />
          ) : (
            <p
              style={{
                margin: 0,
                flex: 1,
                fontFamily: "var(--font-pixel-line)",
                fontSize: "var(--text-base)",
                lineHeight: 1.5,
                color: "var(--text-primary)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {transcript}
            </p>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--sp-3)",
            marginTop: "var(--sp-4)",
            paddingTop: "var(--sp-3)",
            borderTop: "1px solid var(--border-faint)",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-pixel-grid)",
              fontSize: "var(--text-xs)",
              color: "var(--text-secondary)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {wordCount} {wordCount === 1 ? "word" : "words"}
          </span>

          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="ghost" onClick={onClear} disabled={!hasTranscript}>
              Clear
            </Button>
            <Button
              variant="subtle"
              iconLeft={<Copy size={14} weight="regular" />}
              onClick={onCopy}
              disabled={!hasTranscript}
            >
              Copy
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyBody() {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
      }}
    >
      <DotMatrix size={22} tone="ghost" />
      <span
        style={{
          fontFamily: "var(--font-pixel-line)",
          fontSize: "var(--text-sm)",
          color: "var(--text-ghost)",
        }}
      >
        Transcript appears here
      </span>
    </div>
  );
}

function ProcessingBody() {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <DotMatrix size={22} tone="primary" />
    </div>
  );
}
