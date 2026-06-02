/**
 * PopoIcon — the canonical app icon (in-app render).
 *
 * Session 56 redesign. Renders the SAME visual treatment as the
 * baked taskbar/installer icons (see `scripts/gen-icons-from-png.mjs`):
 *
 *   - Black rounded square (#0a0a0a → #161616 top-down gradient)
 *   - 18.75% corner radius (iOS / macOS / modern Windows tile convention)
 *   - Subtle 1-px rim highlight at rgba(255,255,255,0.08)
 *   - Stronger top-half rim at rgba(255,255,255,0.16) for the
 *     dome-light effect
 *   - User's white mark from `/popo-mark.png` composited at 70%
 *     of canvas size, centered (matches Apple HIG icon padding)
 *
 * Use anywhere the user should see "popo the app" (FirstRunOverlay
 * welcome step, TrayIllustration step, marketing surfaces).
 *
 * Why this isn't an SVG embed of the new mark:
 *   The mark is a high-resolution raster (the user-provided PNG),
 *   not a clean SVG geometry. Composing the rim-light treatment in
 *   pure SVG + an <img> overlay is the most faithful in-DOM render
 *   without re-encoding the mark every page load.
 *
 * The previous `mono` / `bg` / `bar` props are removed — the new
 * treatment is monochrome by design (white logo on black tile).
 * If you need a flat in-app glyph (no rounded tile), use
 * `PopoMark` instead.
 */

export interface PopoIconProps {
  /** Edge length in px of the rendered tile. Default 64. */
  size?: number;
}

const RADIUS_RATIO = 0.1875; // 18.75% — matches the icon script.
const LOGO_RATIO = 1.0; // Logo fills full tile (user designed it at correct padding).

export default function PopoIcon({ size = 64 }: PopoIconProps) {
  const radius = Math.round(size * RADIUS_RATIO);
  const logoSize = Math.round(size * LOGO_RATIO);

  return (
    <div
      role="img"
      aria-label="popo"
      style={{
        position: "relative",
        width: size,
        height: size,
        borderRadius: radius,
        // Top-down gradient matching the baked icon's #161616 → #0a0a0a.
        background: "linear-gradient(180deg, #161616 0%, #0a0a0a 100%)",
        // Rim light: a faint 1-px inset shadow gives the rounded edge
        // a subtle highlight without the busy-ness of a stroke.
        // Stacked: subtle full-perimeter rim + stronger top-half dome.
        boxShadow:
          "inset 0 0 0 1px rgba(255, 255, 255, 0.08), " +
          "inset 0 1px 0 rgba(255, 255, 255, 0.16)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        // Hint that this is a single visual unit so child <img> drag
        // doesn't accidentally offer to drag-pickup the mark.
        userSelect: "none",
        flexShrink: 0,
      }}
    >
      <img
        src="/popo-mark.png"
        width={logoSize}
        height={logoSize}
        alt=""
        aria-hidden="true"
        draggable={false}
        style={{
          display: "block",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
