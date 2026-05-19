#!/usr/bin/env node
/**
 * gen-installer-images.mjs
 *
 * Generates NSIS installer brand images for popo.
 *
 * Emits into apps/desktop/src-tauri/assets/installer/:
 *   header.bmp  — 150×57px   — banner shown at the top of every NSIS page
 *   sidebar.bmp — 164×314px  — shown on the left of the Welcome + Finish pages
 *
 *   header.png  — same, kept for debugging / previewing
 *   sidebar.png — same, kept for debugging / previewing
 *
 * NSIS MUI2 (`MUI_WELCOMEFINISHPAGE_BITMAP`) REQUIRES 24-bit uncompressed
 * BMP. PNG files load as blank/white on the Welcome + Finish pages —
 * that's the "blank white left sidebar" bug that was showing up in the
 * custom installer. Tauri's NSIS bundler passes these paths straight
 * through to NSIS without conversion.
 *
 * Design tokens (matches globals.css):
 *   --bg-base:       #0D0D0D
 *   --text-primary:  #EDEBE6
 *   --border-subtle: rgba(237,235,230,0.07)
 */

import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(
  __dirname,
  "../apps/desktop/src-tauri/assets/installer",
);
fs.mkdirSync(OUT_DIR, { recursive: true });

// ─── Shared icon geometry (matches gen-icons-from-svg.mjs + PopoIcon.tsx) ───
//
// We render the EXACT same glyph the user already sees in the taskbar,
// tray, and sidebar — a warm-white rounded square with three dark
// waveform bars inside. Matching pixel-for-pixel proportions here means
// the installer can't feel "off-brand" relative to the running app.

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

/**
 * Render the PopoIcon glyph inline at a specific pixel size, positioned
 * at (x, y). Uses `<g transform="translate(x,y) scale(s)">` on the
 * source 512-unit coordinate system — this works in every SVG renderer
 * (librsvg / sharp / chromium) including ones that don't correctly
 * handle nested `<svg>` within `<g>`.
 */
function popoIconMarkup(x, y, size) {
  const s = size / CANVAS;
  return `<g transform="translate(${x}, ${y}) scale(${s})">
    <rect x="0" y="0" width="${CANVAS}" height="${CANVAS}" rx="${BG_RADIUS}" ry="${BG_RADIUS}" fill="#EDEBE6"/>
    <rect x="${LEFT_X}"  y="${SHORT_Y}"  width="${BAR_W}" height="${SHORT_H}"  rx="${BAR_RX}" ry="${BAR_RX}" fill="#0D0D0D"/>
    <rect x="${MID_X}"   y="${TALL_Y}"   width="${BAR_W}" height="${TALL_H}"   rx="${BAR_RX}" ry="${BAR_RX}" fill="#0D0D0D"/>
    <rect x="${RIGHT_X}" y="${MEDIUM_Y}" width="${BAR_W}" height="${MEDIUM_H}" rx="${BAR_RX}" ry="${BAR_RX}" fill="#0D0D0D"/>
  </g>`;
}

// ─── header SVG — 150×57px ─────────────────────────────────────────────
// PopoIcon flush-left at 40×40, wordmark centred vertically next to it.
const headerSvg = `<svg width="150" height="57" xmlns="http://www.w3.org/2000/svg">
  <rect width="150" height="57" fill="#0D0D0D"/>

  <!-- PopoIcon at 40×40, vertically centred (y = 8 → 48) -->
  ${popoIconMarkup(10, 8, 40)}

  <!-- "popo" wordmark -->
  <text x="60" y="35" font-family="Segoe UI, Arial, sans-serif" font-size="18" font-weight="600" fill="#EDEBE6" letter-spacing="2">popo</text>

  <!-- bottom accent line -->
  <line x1="0" y1="56" x2="150" y2="56" stroke="#1F1F1F" stroke-width="1"/>
</svg>`;

// ─── sidebar SVG — 164×314px ─────────────────────────────────────────
// PopoIcon hero centred in the upper third, wordmark + tagline beneath.
const sidebarSvg = `<svg width="164" height="314" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#121212"/>
      <stop offset="60%"  stop-color="#0D0D0D"/>
      <stop offset="100%" stop-color="#080808"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="30%" r="55%">
      <stop offset="0%" stop-color="#EDEBE6" stop-opacity="0.05"/>
      <stop offset="100%" stop-color="#EDEBE6" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <!-- base + soft glow -->
  <rect width="164" height="314" fill="url(#bg)"/>
  <rect width="164" height="314" fill="url(#glow)"/>

  <!-- PopoIcon hero at 72×72, centred horizontally at x = (164-72)/2 = 46 -->
  ${popoIconMarkup(46, 54, 72)}

  <!-- "popo" wordmark -->
  <text x="82" y="170" font-family="Segoe UI, Arial, sans-serif" font-size="26" font-weight="600" fill="#EDEBE6" text-anchor="middle" letter-spacing="4">popo</text>

  <!-- tagline -->
  <text x="82" y="194" font-family="Segoe UI, Arial, sans-serif" font-size="10" fill="#7A786F" text-anchor="middle" letter-spacing="2">VOICE · TO · CURSOR</text>

  <!-- dot row accent near bottom -->
  <circle cx="70"  cy="262" r="2" fill="#3D3A36"/>
  <circle cx="82"  cy="262" r="2" fill="#7A786F"/>
  <circle cx="94"  cy="262" r="2" fill="#3D3A36"/>

  <!-- right accent line -->
  <line x1="163" y1="0" x2="163" y2="314" stroke="#1F1F1F" stroke-width="1"/>
</svg>`;

// ─── helpers ────────────────────────────────────────────────────

/**
 * Rasterize an SVG via sharp → raw RGB buffer → write a 24-bit BMP
 * (BITMAPFILEHEADER + BITMAPINFOHEADER + bottom-up padded BGR pixel
 * data). This is what NSIS expects.
 */
async function renderBmp(svgString, width, height, outPath) {
  const rgb = await sharp(Buffer.from(svgString))
    .resize(width, height)
    .flatten({ background: { r: 13, g: 13, b: 13 } })
    .removeAlpha()
    .raw()
    .toBuffer(); // row-major, top-down, RGB (width*height*3 bytes)

  const rowSizeRaw = width * 3;
  const pad = (4 - (rowSizeRaw % 4)) % 4;
  const rowSize = rowSizeRaw + pad;
  const pixelArraySize = rowSize * height;
  const fileSize = 14 + 40 + pixelArraySize;

  const header = Buffer.alloc(14 + 40);
  // BITMAPFILEHEADER
  header.write("BM", 0, "ascii");
  header.writeUInt32LE(fileSize, 2);
  header.writeUInt32LE(0, 6); // reserved
  header.writeUInt32LE(14 + 40, 10); // pixel data offset
  // BITMAPINFOHEADER
  header.writeUInt32LE(40, 14); // header size
  header.writeInt32LE(width, 18);
  header.writeInt32LE(height, 22); // positive = bottom-up
  header.writeUInt16LE(1, 26); // planes
  header.writeUInt16LE(24, 28); // bits per pixel
  header.writeUInt32LE(0, 30); // compression BI_RGB
  header.writeUInt32LE(pixelArraySize, 34); // image size
  header.writeInt32LE(2835, 38); // x pixels per meter (≈72 DPI)
  header.writeInt32LE(2835, 42);
  header.writeUInt32LE(0, 46); // colors used
  header.writeUInt32LE(0, 50); // important colors

  const pixels = Buffer.alloc(pixelArraySize);
  const padBuf = Buffer.alloc(pad);
  for (let y = 0; y < height; y++) {
    // BMP stores rows bottom-up, so source row (height-1-y) becomes
    // dest row y.
    const srcRow = (height - 1 - y) * rowSizeRaw;
    const destRow = y * rowSize;
    // Swap RGB → BGR inline.
    for (let x = 0; x < width; x++) {
      const si = srcRow + x * 3;
      const di = destRow + x * 3;
      pixels[di] = rgb[si + 2]; // B
      pixels[di + 1] = rgb[si + 1]; // G
      pixels[di + 2] = rgb[si]; // R
    }
    if (pad > 0) padBuf.copy(pixels, destRow + rowSizeRaw);
  }

  const bmp = Buffer.concat([header, pixels], fileSize);
  fs.writeFileSync(outPath, bmp);
}

/** Also emit a PNG next to each BMP for easy preview. */
async function renderPng(svgString, width, height, outPath) {
  const buf = await sharp(Buffer.from(svgString))
    .resize(width, height)
    .flatten({ background: { r: 13, g: 13, b: 13 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  fs.writeFileSync(outPath, buf);
}

// ─── emit ───────────────────────────────────────────────────────

const headerBmpPath = path.join(OUT_DIR, "header.bmp");
const sidebarBmpPath = path.join(OUT_DIR, "sidebar.bmp");
const headerPngPath = path.join(OUT_DIR, "header.png");
const sidebarPngPath = path.join(OUT_DIR, "sidebar.png");

await renderBmp(headerSvg, 150, 57, headerBmpPath);
await renderBmp(sidebarSvg, 164, 314, sidebarBmpPath);
await renderPng(headerSvg, 150, 57, headerPngPath);
await renderPng(sidebarSvg, 164, 314, sidebarPngPath);

const kb = (p) => (fs.statSync(p).size / 1024).toFixed(1);

console.log(`[gen-installer-images] Wrote to ${OUT_DIR}`);
console.log(
  `  header.bmp   150×57   ${kb(headerBmpPath)} KB  (NSIS uses this)`,
);
console.log(
  `  sidebar.bmp  164×314  ${kb(sidebarBmpPath)} KB  (NSIS uses this)`,
);
console.log(`  header.png   150×57   ${kb(headerPngPath)} KB  (preview)`);
console.log(`  sidebar.png  164×314  ${kb(sidebarPngPath)} KB  (preview)`);
console.log(`  Format: 24-bit uncompressed BMP (BI_RGB), bottom-up row order`);
