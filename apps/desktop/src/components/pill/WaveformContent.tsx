import WaveformCanvas from "./WaveformCanvas";
import type { PillState } from "@popo/shared-types";

/**
 * WaveformContent — the pill's `ready` and `active` inner surface.
 *
 * Thin wrapper around WaveformCanvas that picks the tone from the pill
 * state. Kept as a separate file per DESIGN_SYSTEM §9 component inventory
 * so Phase 4 Test page can import WaveformCanvas without pulling in the
 * pill-specific tone mapping.
 */

export interface WaveformContentProps {
  bars: number[];
  state: Extract<PillState, "ready" | "active">;
}

export default function WaveformContent({ bars, state }: WaveformContentProps) {
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
      <WaveformCanvas bars={bars} tone={state === "active" ? "active" : "flat"} />
    </div>
  );
}
