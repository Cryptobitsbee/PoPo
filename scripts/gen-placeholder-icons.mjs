#!/usr/bin/env node
/**
 * gen-placeholder-icons.mjs
 *
 * Generates minimal placeholder icon files for Tauri so that
 * `cargo check` / `pnpm tauri dev` compile without the "icon not found"
 * error. Phase 2/3 use only — real icons come from `pnpm tauri icon
 * <source.png>` once the logo mark is ready.
 *
 * What this emits (into apps/desktop/src-tauri/icons/):
 *   - 32x32.png           (tiny dark square)
 *   - 128x128.png         (tiny dark square)
 *   - 128x128@2x.png      (tiny dark square)
 *   - icon.png            (tray icon — tiny dark square)
 *   - icon.ico            (16×16 single-frame .ico, dark)
 *
 * We intentionally skip icon.icns (macOS). tauri.conf.json has been
 * adjusted to not require it since popo v0.1 is Windows-only.
 *
 * All PNGs are a single dark pixel (brief --bg-void #080808 with 100%
 * alpha) — Windows will upscale them for the installer / tray. This is
 * a placeholder, visually ugly by design.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONS = resolve(__dirname, "../apps/desktop/src-tauri/icons");
mkdirSync(ICONS, { recursive: true });

// ---------- PNG writer (minimal, 1×1 RGBA) -----------------------------
//
// We emit a 1×1 RGBA PNG with the byte value of brief's --bg-void:
// (0x08, 0x08, 0x08, 0xFF).

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = (table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8)) >>> 0;
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function makeTinyPng() {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);    // width
  ihdr.writeUInt32BE(1, 4);    // height
  ihdr[8] = 8;                  // bit depth
  ihdr[9] = 6;                  // color type RGBA
  ihdr[10] = 0;                 // compression
  ihdr[11] = 0;                 // filter
  ihdr[12] = 0;                 // interlace
  // Row: filter byte 0, then pixel RGBA = 08 08 08 FF
  const raw = Buffer.from([0x00, 0x08, 0x08, 0x08, 0xFF]);
  const idat = deflateSync(raw);
  const iend = Buffer.alloc(0);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", iend),
  ]);
}

const png = makeTinyPng();
for (const name of ["32x32.png", "128x128.png", "128x128@2x.png", "icon.png"]) {
  writeFileSync(resolve(ICONS, name), png);
}

// ---------- ICO writer (16×16, 32-bit BGRA + AND mask) ------------------

function makeTinyIco() {
  const W = 16, H = 16;
  const xor = Buffer.alloc(W * H * 4);
  for (let i = 0; i < xor.length; i += 4) {
    xor[i + 0] = 0x08; // B
    xor[i + 1] = 0x08; // G
    xor[i + 2] = 0x08; // R
    xor[i + 3] = 0xFF; // A
  }
  const and = Buffer.alloc((W * H) / 8); // all zeros = fully visible

  const bih = Buffer.alloc(40);
  bih.writeUInt32LE(40, 0);                 // header size
  bih.writeInt32LE(W, 4);                   // width
  bih.writeInt32LE(H * 2, 8);               // height (stacked XOR+AND)
  bih.writeUInt16LE(1, 12);                 // planes
  bih.writeUInt16LE(32, 14);                // bpp
  bih.writeUInt32LE(0, 16);                 // compression
  bih.writeUInt32LE(0, 20);                 // image size
  bih.writeInt32LE(0, 24);                  // xres
  bih.writeInt32LE(0, 28);                  // yres
  bih.writeUInt32LE(0, 32);                 // colors
  bih.writeUInt32LE(0, 36);                 // important

  const image = Buffer.concat([bih, xor, and]);

  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);    // reserved
  dir.writeUInt16LE(1, 2);    // type 1 = ICO
  dir.writeUInt16LE(1, 4);    // image count

  const entry = Buffer.alloc(16);
  entry[0] = W === 256 ? 0 : W;
  entry[1] = H === 256 ? 0 : H;
  entry[2] = 0;               // colors
  entry[3] = 0;               // reserved
  entry.writeUInt16LE(1, 4);  // planes
  entry.writeUInt16LE(32, 6); // bpp
  entry.writeUInt32LE(image.length, 8);    // bytes in resource
  entry.writeUInt32LE(6 + 16, 12);         // offset

  return Buffer.concat([dir, entry, image]);
}

writeFileSync(resolve(ICONS, "icon.ico"), makeTinyIco());

console.log("Wrote placeholder icons to", ICONS);
