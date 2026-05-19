import DotMatrix from "./DotMatrix";

/**
 * ProcessingContent — pill inner surface when the transcript is in-flight
 * to GCP. Centered DotMatrix loader.
 *
 * Per brief §2: pill width morphs to 180×44 during this state; the loader
 * sits centered. No text, no timer, no spinner.
 */
export default function ProcessingContent() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
      }}
    >
      <DotMatrix size={14} tone="primary" />
    </div>
  );
}
