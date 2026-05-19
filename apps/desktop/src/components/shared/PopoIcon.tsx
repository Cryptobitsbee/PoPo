/**
 * PopoIcon — the canonical app icon.
 *
 * This renders the exact same glyph as `src-tauri/icons/icon.ico`:
 * a warm-white rounded-square background with three dark waveform
 * bars inside. Use it anywhere the user should see "popo the app"
 * (splash screen, sidebar top-left, system uninstaller branding).
 *
 * The proportions mirror `scripts/gen-icons-from-svg.mjs` exactly —
 * both the SVG here and the PNG/ICO rasterizer share the same
 * CANVAS/BAR_W/GAP/height constants, so what the user sees inside
 * the app is pixel-identical to what they see in the taskbar.
 *
 * Default size is 64 px. For subtler use (sidebar top-left), pass
 * a smaller size like 24. For the hero reveal in FirstRunOverlay,
 * 96+ works great.
 */

export interface PopoIconProps {
  /** Edge length in px of the rendered SVG. Default 64. */
  size?: number;
  /** Override background fill. Defaults to --text-primary (#EDEBE6). */
  bg?: string;
  /** Override bar fill. Defaults to --bg-base (#0D0D0D). */
  bar?: string;
  /**
   * When true, render bars-only on a transparent background.
   * Useful for the sidebar where a full warm-white square would be
   * too loud. The bars take the `bar` color (or --text-primary by
   * default in mono mode).
   */
  mono?: boolean;
}

// Proportions from the icon generator — 512px master canvas, 96px
// corner radius (18.75%), three dark rounded-cap bars with centered
// short/tall/medium heights. We scale by setting the svg viewBox to
// 0 0 512 512 so any `size` just resamples proportionally.
const CANVAS = 512;
const BG_RADIUS = 96;
const BAR_W = 80;
const BAR_RX = BAR_W / 2;
const GAP = 28;
const TOTAL_W = BAR_W * 3 + GAP * 2;
const PAD_X = (CANVAS - TOTAL_W) / 2;
const LEFT_X = PAD_X;
const MID_X = LEFT_X + BAR_W + GAP;
const RIGHT_X = MID_X + BAR_W + GAP;
const SHORT_H = 144;
const TALL_H = 336;
const MEDIUM_H = 208;
const SHORT_Y = (CANVAS - SHORT_H) / 2;
const TALL_Y = (CANVAS - TALL_H) / 2;
const MEDIUM_Y = (CANVAS - MEDIUM_H) / 2;

export default function PopoIcon({
  size = 64,
  bg,
  bar,
  mono = false,
}: PopoIconProps) {
  const bgFill = bg ?? "var(--text-primary)";
  const barFill = mono ? (bar ?? "var(--text-primary)") : (bar ?? "var(--bg-base)");

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${CANVAS} ${CANVAS}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="popo"
      role="img"
    >
      {!mono && (
        <rect
          x="0"
          y="0"
          width={CANVAS}
          height={CANVAS}
          rx={BG_RADIUS}
          ry={BG_RADIUS}
          fill={bgFill}
        />
      )}
      <rect
        x={LEFT_X}
        y={SHORT_Y}
        width={BAR_W}
        height={SHORT_H}
        rx={BAR_RX}
        ry={BAR_RX}
        fill={barFill}
      />
      <rect
        x={MID_X}
        y={TALL_Y}
        width={BAR_W}
        height={TALL_H}
        rx={BAR_RX}
        ry={BAR_RX}
        fill={barFill}
      />
      <rect
        x={RIGHT_X}
        y={MEDIUM_Y}
        width={BAR_W}
        height={MEDIUM_H}
        rx={BAR_RX}
        ry={BAR_RX}
        fill={barFill}
      />
    </svg>
  );
}
