#!/usr/bin/env node
/**
 * gen-icons-from-png.mjs
 *
 * Builds popo's app-icon set from a user-provided white-on-transparent
 * source PNG (the canonical popo mark).
 *
 * Source : apps/desktop/public/popo-mark.png  (must exist; 512×512 ideal)
 * Outputs (apps/desktop/src-tauri/icons/):
 *   32x32.png · 128x128.png · 128x128@2x.png (256×256) · icon.png (64×64 tray)
 *   icon.ico (multi-res: 16, 24, 32, 48, 64, 256)
 *
 * Design (Session 56):
 *   - Black rounded square (#0a0a0a) with corner radius 18.75% — same
 *     ratio as iOS / macOS / modern Windows tile conventions.
 *   - Subtle "shine" treatment around the rounded edges:
 *       1. A faint linear gradient on the background (top ~#161616
 *          → bottom #0a0a0a) for a soft top-down lift.
 *       2. A 1-px inner stroke just inside the rounded border at
 *          rgba(255,255,255,0.06) — gives the rim a thin highlight
 *          line that catches the eye without feeling glossy.
 *       3. A second 1-px outer stroke at the very top half only
 *          (linear-gradient mask) for a subtle "dome" feel.
 *   - The user's white logo composited at 70 % of canvas size, centered.
 *     This leaves a comfortable padding ring around it (matches
 *     Apple HIG icon padding guidance) and keeps the logo clearly
 *     readable on small tray sizes.
 *   - Each output size is rendered at native resolution (no upscaling
 *     of the small icons). The source PNG is resampled with Lanczos3
 *     for the cleanest small-size detail.
 *
 * To replace the source mark later:
 *   1. Drop a new white-on-transparent square PNG (512×512 recommended)
 *      at apps/desktop/public/popo-mark.png.
 *   2. Re-run `node scripts/gen-icons-from-png.mjs`.
 *   3. Rebuild the app (icons are baked in by Tauri at build time).
 *
 * The older script `gen-icons-from-svg.mjs` (waveform 3-bar mark) is
 * kept around as a fallback for emergencies (e.g. lost source PNG).
 */

import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SOURCE = path.resolve(ROOT, "apps/desktop/public/popo-mark.png");
const ICONS = path.resolve(ROOT, "apps/desktop/src-tauri/icons");

// ─── Sanity check ───────────────────────────────────────
if (!fs.existsSync(SOURCE)) {
  console.error(
    `[gen-icons-from-png] ERROR: source not found at ${SOURCE}\n` +
      `\n` +
      `Save the popo mark (white on transparent, 512×512 recommended) to\n` +
      `that path, then re-run this script.\n`,
  );
  process.exit(1);
}

fs.mkdirSync(ICONS, { recursive: true });

// ─── Tunables ─────────────────────────────────────────
const RADIUS_RATIO = 0.1875; // 18.75 % — iOS-style rounded square.
const LOGO_RATIO = 1.0; // Logo fills the entire canvas (user designed it at correct padding already).
const BG_TOP = "#161616"; // Top of background gradient.
const BG_BOTTOM = "#0a0a0a"; // Bottom of background gradient.
const RIM_ALPHA = 0.08; // 1-px rim highlight alpha (0–1).
const TOP_RIM_ALPHA = 0.16; // Stronger top-edge highlight ("dome").

/**
 * Build the rounded-square background SVG for a given canvas size.
 * Includes the gradient + rim light treatment.
 */
function backgroundSvg(size) {
  const radius = Math.round(size * RADIUS_RATIO);
  // Inner stroke at 0.5 px inside the edge so the line lives ON the
  // rounded border rather than next to it.
  const innerInset = 0.5;
  const innerR = radius - innerInset;
  const rimAlpha = RIM_ALPHA.toFixed(3);
  const topRimAlpha = TOP_RIM_ALPHA.toFixed(3);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${BG_TOP}" />
      <stop offset="100%" stop-color="${BG_BOTTOM}" />
    </linearGradient>
    <linearGradient id="topRimMask" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="white" stop-opacity="1" />
      <stop offset="50%" stop-color="white" stop-opacity="0" />
    </linearGradient>
    <mask id="topHalfMask">
      <rect x="0" y="0" width="${size}" height="${size}" fill="url(#topRimMask)" />
    </mask>
  </defs>
  <!-- Black rounded background with subtle top-down gradient -->
  <rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="url(#bgGrad)" />
  <!-- Full-perimeter rim highlight (faint) -->
  <rect x="${innerInset}" y="${innerInset}" width="${size - innerInset * 2}" height="${size - innerInset * 2}" rx="${innerR}" ry="${innerR}" fill="none" stroke="rgba(255,255,255,${rimAlpha})" stroke-width="1" />
  <!-- Top-edge "dome" highlight (stronger, faded out by mask) -->
  <rect x="${innerInset}" y="${innerInset}" width="${size - innerInset * 2}" height="${size - innerInset * 2}" rx="${innerR}" ry="${innerR}" fill="none" stroke="rgba(255,255,255,${topRimAlpha})" stroke-width="1" mask="url(#topHalfMask)" />
</svg>`;
}

/**
 * Render a single icon at the given size. Pipeline:
 *   1. Rasterize the background SVG at 4× density for crisp edges.
 *   2. Resize the user's source PNG to LOGO_RATIO × size.
 *   3. Composite the logo centered onto the background.
 */
async function buildIcon(size) {
  const bgPng = await sharp(Buffer.from(backgroundSvg(size)), {
    density: Math.max(72, Math.min(size * 4, 288)),
  })
    .resize(size, size, { fit: "contain", kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();

  const logoSize = Math.round(size * LOGO_RATIO);
  const logoPng = await sharp(SOURCE)
    .resize(logoSize, logoSize, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      // lanczos3: high-quality downscaling that averages neighboring
      // pixels. Preserves overall logo shape even at extreme ratios
      // (512→24 for tray icons). Nearest-neighbor was dropping pixels
      // and breaking the logo apart at small sizes.
      kernel: sharp.kernel.lanczos3,
    })
    .png()
    .toBuffer();

  const offset = Math.floor((size - logoSize) / 2);

  return (
    sharp(bgPng)
      .composite([{ input: logoPng, left: offset, top: offset }])
      // compressionLevel 9 is LOSSLESS (like ZIP — just slower encode).
      // No quality loss at all. adaptiveFiltering helps file size
      // without touching pixel values.
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer()
  );
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

// ─── Emit the four PNGs Tauri's bundle config lists ────────
const [p32, p128, p256, p64] = await Promise.all([
  buildIcon(32),
  buildIcon(128),
  buildIcon(256),
  buildIcon(64),
]);

fs.writeFileSync(path.join(ICONS, "32x32.png"), p32);
fs.writeFileSync(path.join(ICONS, "128x128.png"), p128);
fs.writeFileSync(path.join(ICONS, "128x128@2x.png"), p256);
fs.writeFileSync(path.join(ICONS, "icon.png"), p64);

// ─── Multi-resolution .ico ────────────────────────────────
const icoSizes = [16, 24, 32, 48, 64, 256];
const frames = await Promise.all(
  icoSizes.map(async (size) => ({ size, data: await buildIcon(size) })),
);
fs.writeFileSync(path.join(ICONS, "icon.ico"), buildIco(frames));

console.log(
  `[gen-icons-from-png] Wrote icons to ${ICONS}\n` +
    `  Source: ${SOURCE}\n` +
    `  PNGs: 32x32.png, 128x128.png, 128x128@2x.png, icon.png\n` +
    `  ICO frames: ${icoSizes.join(", ")}\n` +
    `  Treatment: black rounded square (rx=${(RADIUS_RATIO * 100).toFixed(2)}%), ` +
    `${BG_TOP}→${BG_BOTTOM} gradient, rim glow + top-half highlight.`,
);
