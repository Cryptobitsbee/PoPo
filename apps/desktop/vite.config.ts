import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Tauri dev host for mobile (unused on Windows desktop; kept for parity)
const host = process.env.TAURI_DEV_HOST;

// @see https://vitejs.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@popo/shared-types": path.resolve(
        __dirname,
        "../../packages/shared-types/src/index.ts",
      ),
    },
  },
  // Tauri-friendly defaults
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: {
      // tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    // Tauri supports es2021+ targets; bump to es2022 to match tsconfig.
    target: "es2022",
    // Emit source maps when TAURI_ENV_DEBUG is set (tauri dev in debug).
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    // minify defaults to "esbuild" — leave Vite's default.
  },
}));
