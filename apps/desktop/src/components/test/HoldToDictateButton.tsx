import { Microphone } from "@phosphor-icons/react";
import WaveformCanvas from "../pill/WaveformCanvas";
import DotMatrix from "../pill/DotMatrix";

/**
 * HoldToDictateButton — the big 80px "Hold to Dictate" button on Test.
 *
 * Per brief §3 Test:
 *   Height 80px, full width
 *   bg --bg-elevated, border 1px --border-subtle, radius --radius-card
 *   Default: GeistPixelSquare --text-sm --text-secondary centered
 *   On hold: border --border-strong, bg --bg-high
 *   WaveformCanvas (same as pill component) appears inside on hold
 *   Shows flat bars → live bars as voice is detected
 *
 * State-driven:
 *   idle / done → "Hold to dictate" + mic icon
 *   recording   → WaveformCanvas (synthetic bars pumped by the page)
 *   processing  → DotMatrix loader (during fake GCP round trip)
 */

export type TestState = "idle" | "recording" | "processing" | "done";

export interface HoldToDictateButtonProps {
  state: TestState;
  bars: number[];
  onStart: () => void;
  onStop: () => void;
}

export default function HoldToDictateButton({
  state,
  bars,
  onStart,
  onStop,
}: HoldToDictateButtonProps) {
  const isRecording = state === "recording";
  const isProcessing = state === "processing";

  const handlePointerDown = () => {
    if (state === "idle" || state === "done") onStart();
  };
  const handlePointerUpOrLeave = () => {
    if (state === "recording") onStop();
  };

  return (
    <button
      type="button"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUpOrLeave}
      onPointerLeave={handlePointerUpOrLeave}
      onPointerCancel={handlePointerUpOrLeave}
      disabled={isProcessing}
      aria-label="Hold to dictate"
      style={{
        width: "100%",
        height: 80,
        padding: 0,
        background: isRecording ? "var(--bg-high)" : "var(--bg-elevated)",
        border: `1px solid ${
          isRecording ? "var(--border-strong)" : "var(--border-subtle)"
        }`,
        borderRadius: "var(--radius-card)",
        cursor: isProcessing ? "default" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "background-color 120ms ease, border-color 120ms ease",
        userSelect: "none",
      }}
    >
      {isRecording ? (
        <WaveformCanvas bars={bars} tone="active" />
      ) : isProcessing ? (
        <DotMatrix size={18} tone="primary" />
      ) : (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            fontFamily: "var(--font-pixel-square)",
            fontSize: "var(--text-sm)",
            color: "var(--text-secondary)",
          }}
        >
          <Microphone size={14} weight="regular" color="var(--text-secondary)" />
          Hold to dictate
        </span>
      )}
    </button>
  );
}
