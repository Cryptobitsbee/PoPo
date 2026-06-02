/**
 * PopoMark — the sidebar's brand glyph.
 *
 * Session 56: switched from an inline-SVG of three pill bars to an
 * <img> tag pointing at the user-provided 512×512 logo PNG at
 * `/popo-mark.png` (i.e. `apps/desktop/public/popo-mark.png`).
 *
 * The image is white-on-transparent so it sits naturally on the
 * dark sidebar canvas (`--bg-void`). We render at 16 px (matches
 * the previous SVG dimensions) so the rest of the sidebar layout
 * stays unchanged. `image-rendering: pixelated` would NOT help here
 * because the source is high-resolution; default smooth scaling is
 * correct.
 *
 * Important: this is INTENTIONALLY DIFFERENT from `PopoIcon`. The
 * latter is the canonical app-icon tile (black rounded square with
 * rim glow + white logo) used for taskbar / splash / installer.
 * Inside the app the warm sidebar canvas already provides the
 * "tile" — adding another would feel busy.
 *
 * To replace the source asset later, just overwrite
 * `apps/desktop/public/popo-mark.png` with a new white-on-
 * transparent square PNG; this component picks it up automatically.
 */

export interface PopoMarkProps {
  size?: number;
  /**
   * Optional CSS filter for tinting. Default: leaves the white logo
   * white. If you ever need the mark in a different tone (e.g. a
   * marketing surface), pass something like `brightness(0.6)`.
   */
  filter?: string;
}

export default function PopoMark({ size = 16, filter }: PopoMarkProps) {
  return (
    <img
      src="/popo-mark.png"
      width={size}
      height={size}
      alt="popo"
      style={{
        display: "block",
        // Slight selectability hint — block-display + no drag-image
        // so this glyph doesn't get accidentally dragged into other
        // apps. Tauri also disables this at the window level for
        // most contexts but belt-and-suspenders is cheap.
        userSelect: "none",
        pointerEvents: "none",
        filter,
      }}
      // No-op draggable=false to prevent the browser's native
      // image-drag affordance.
      draggable={false}
    />
  );
}
