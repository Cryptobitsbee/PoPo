#!/usr/bin/env node
/**
 * copy-geist-fonts.mjs
 *
 * The `geist` npm package is Next.js-only: its modules import
 * `next/font/local`, which breaks in pure Vite. The .woff2 assets are
 * still in node_modules though — we copy them into the desktop app's
 * public/fonts directory so @font-face can reference them via
 * `/fonts/GeistPixel-*.woff2`.
 *
 * Runs as `pnpm predev` / `pnpm prebuild` hooks (see apps/desktop/package.json).
 * Idempotent — reruns are free.
 *
 * If the geist package is ever upgraded and moves files around, update
 * the SOURCE_GLOB pattern below.
 */

import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DEST = resolve(ROOT, "apps/desktop/public/fonts");

// pnpm hoists geist into .pnpm/geist@<ver>_<peer-hash>/node_modules/geist/
// Walk .pnpm looking for any "geist" directory.
function findGeistFontsDir() {
  // Prefer the workspace dependency symlink. Searching the pnpm virtual store
  // first can select a stale package version left by an earlier install and
  // silently rewrite tracked font assets during predev/prebuild.
  const directCandidates = [
    resolve(ROOT, "apps/desktop/node_modules/geist/dist/fonts/geist-pixel"),
    resolve(ROOT, "node_modules/geist/dist/fonts/geist-pixel"),
  ];
  for (const candidate of directCandidates) {
    if (existsSync(candidate)) return candidate;
  }

  const pnpmRoot = resolve(ROOT, "node_modules/.pnpm");
  if (!existsSync(pnpmRoot)) return null;
  const entries = readdirSync(pnpmRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("geist@"))
    .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
  for (const e of entries) {
    const candidate = join(
      pnpmRoot,
      e.name,
      "node_modules/geist/dist/fonts/geist-pixel",
    );
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const src = findGeistFontsDir();
if (!src) {
  console.error(
    "[copy-geist-fonts] Could not locate geist/dist/fonts/geist-pixel.\n" +
      "  Did you run `pnpm install`? Is the geist package installed?",
  );
  process.exit(0); // don't fail the build — let the user see the font fallback
}

mkdirSync(DEST, { recursive: true });
const files = readdirSync(src).filter((f) => f.endsWith(".woff2"));
for (const f of files) {
  cpSync(join(src, f), join(DEST, f));
}
console.log(`[copy-geist-fonts] Copied ${files.length} woff2 files to ${DEST}`);
