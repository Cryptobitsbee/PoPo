#!/usr/bin/env node
/**
 * gen-icons-from-svg.mjs
 *
 * Builds popo's real icon set from the canonical PopoMark waveform glyph.
 *
 * Emits into apps/desktop/src-tauri/icons/:
 *   32x32.png · 128x128.png · 128x128@2x.png (256×256) · icon.png (64×64 tray)
 *   icon.ico (multi-res: 16, 24, 32, 48, 64, 256)
 *
 * Design (Session 15 refinement — inverts Session 14 for visibility):
 *   - 512×512 master canvas.
 *   - Rounded square background in **warm white** (--text-primary #EDEBE6)
 *     with corner radius 18.75% (96px). Pops against both dark and light
 *     Windows tray/taskbar themes. Previous dark-on-dark invisibly
 *     blended with the taskbar.
 *   - Three waveform bars in **dark** (--bg-base #0D0D0D), bolder than
 *     Session 14 for better legibility at tiny (16×16) sizes.
 *   - Rounded bar caps (rx = width/2).
 *   - Each output size is rendered with Lanczos3 resampling from a
 *     4×-supersampled raster — sharper than naive bilinear at small
 *     sizes, where the human eye is most sensitive to edge aliasing.
 */

import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICONS = path.resolve(__dirname, "../apps/desktop/src-tauri/icons");
fs.mkdirSync(ICONS, { recursive: true });

// ─── Design constants ─────────────────────────────────────────
const CANVAS = 512;
const BG_RADIUS = 96; // 18.75% — clearly rounded, not squircle.
const BG_FILL = "#edebe6"; // --text-primary (warm white).
const BAR_FILL = "#0d0d0d"; // --bg-base (dark — high contrast).

// Bolder bars than Session 14 for 16×16 clarity.
const BAR_W = 80;
const BAR_RX = BAR_W / 2; // Fully-rounded pill caps.
const GAP = 28;
const TOTAL_W = BAR_W * 3 + GAP * 2; // 296
const PAD_X = (CANVAS - TOTAL_W) / 2; // 108
const LEFT_X = PAD_X; // 108
const MID_X = LEFT_X + BAR_W + GAP; // 216
const RIGHT_X = MID_X + BAR_W + GAP; // 324

// Heights: short / tall / medium, vertically centered on y = CANVAS/2.
const SHORT_H = 144;
const TALL_H = 336;
const MEDIUM_H = 208;
const SHORT_Y = (CANVAS - SHORT_H) / 2;
const TALL_Y = (CANVAS - TALL_H) / 2;
const MEDIUM_Y = (CANVAS - MEDIUM_H) / 2;

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">
  <!-- Warm-white rounded background: visible on any taskbar theme. -->
  <rect x="0" y="0" width="${CANVAS}" height="${CANVAS}" rx="${BG_RADIUS}" ry="${BG_RADIUS}" fill="${BG_FILL}" />

  <!-- Short left bar -->
  <rect x="${LEFT_X}"  y="${SHORT_Y}"  width="${BAR_W}" height="${SHORT_H}"  rx="${BAR_RX}" ry="${BAR_RX}" fill="${BAR_FILL}" />
  <!-- Tall middle bar -->
  <rect x="${MID_X}"   y="${TALL_Y}"   width="${BAR_W}" height="${TALL_H}"   rx="${BAR_RX}" ry="${BAR_RX}" fill="${BAR_FILL}" />
  <!-- Medium right bar -->
  <rect x="${RIGHT_X}" y="${MEDIUM_Y}" width="${BAR_W}" height="${MEDIUM_H}" rx="${BAR_RX}" ry="${BAR_RX}" fill="${BAR_FILL}" />
</svg>`;

/**
 * Rasterize at a specific size with high-quality downsampling.
 *
 * sharp's `density` option renders the SVG at a higher internal DPI
 * BEFORE any resize, so the downsampler has more detail to average.
 * Clamped so we don't waste RAM on a 2000×2000 master for a 32×32 icon.
 */
async function pngAt(size) {
  const density = Math.max(72, Math.min(size * 4, 288));
  return sharp(Buffer.from(SVG), { density })
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: sharp.kernel.lanczos3,
    })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

/**
 * Pack PNG-encoded frames into a single .ico file.
 * ICO supports PNG-encoded entries from Vista on (we're Win10+).
 */
function buildIco(frames) {
  const count = frames.length;
  const dirSize = 6;
  const entrySize = 16;
  let offset = dirSize + entrySize * count;

  const dir = Buffer.alloc(dirSize);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(count, 4);

  const entries = [];
  const blobs = [];
  for (const { size, data } of frames) {
    const entry = Buffer.alloc(entrySize);
    entry[0] = size === 256 ? 0 : size;
    entry[1] = size === 256 ? 0 : size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(entry);
    blobs.push(data);
  }
  return Buffer.concat([dir, ...entries, ...blobs]);
}

// ─── Emit the four PNGs Tauri's bundle config lists ────────────
// Each rendered natively at its target size for maximum clarity.
const [p32, p128, p256, p64] = await Promise.all([
  pngAt(32),
  pngAt(128),
  pngAt(256),
  pngAt(64),
]);

fs.writeFileSync(path.join(ICONS, "32x32.png"), p32);
fs.writeFileSync(path.join(ICONS, "128x128.png"), p128);
fs.writeFileSync(path.join(ICONS, "128x128@2x.png"), p256);
fs.writeFileSync(path.join(ICONS, "icon.png"), p64);

// ─── Multi-resolution .ico with extra small sizes for clean tray ──
// 16 and 24 are what Windows uses for tray + jump lists.
// 48 is start menu large. 256 is high-DPI taskbar.
const icoSizes = [16, 24, 32, 48, 64, 256];
const frames = await Promise.all(
  icoSizes.map(async (size) => ({ size, data: await pngAt(size) })),
);
fs.writeFileSync(path.join(ICONS, "icon.ico"), buildIco(frames));

console.log(
  `[gen-icons] Wrote icons to ${ICONS}\n` +
    `  32x32.png, 128x128.png, 128x128@2x.png, icon.png (tray 64×64),\n` +
    `  icon.ico with frames: ${icoSizes.join(", ")}\n` +
    `  Design: warm-white rounded bg ${BG_FILL} (rx=${BG_RADIUS}) + 3 dark bars ${BAR_FILL}`,
);
