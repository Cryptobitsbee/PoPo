import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";

/**
 * usePillSound — listen for `pill:sound` Tauri events from Rust and
 * play a short tone via the Web Audio API.
 *
 * Rust emits these when the user has Settings → Sound → Sound effects
 * enabled. Since Session 33 the payload carries both the event kind
 * AND the active mode's sound preset so different modes can have
 * their own signature tones:
 *
 *   `{ kind: "start" | "paste", preset: "default"|"soft"|"chime"|"bell"|"none" }`
 *
 * Preset vocabulary (choose one per mode in the Mode editor):
 *   - "default"  — the original ascending ping/chime.
 *   - "soft"     — lower-pitched, longer decay. Calmer. Good for Email.
 *   - "chime"    — two-tone bright bell. Good for Casual / Notes.
 *   - "bell"     — higher-pitched sharper single tone. Good for Code.
 *   - "none"     — silent. Useful during focus / meeting / recording.
 *
 * Backwards-compat: old builds (and the Test page) still emit a
 * plain string `"start"` / `"paste"` payload. We accept both shapes
 * and fall through to the "default" preset when only a string is
 * supplied — so upgrades don't break anything.
 *
 * Why Web Audio and not bundled files:
 *   - Zero assets to ship; tones are synthesised on the fly.
 *   - Precisely tuned volume + attack/decay so nothing jumps out.
 *   - Works without the `audio` element's user-gesture requirement
 *     because the AudioContext is created in response to a Tauri
 *     event; WebView2 treats those as user gestures.
 *
 * The pill window is always alive and never minimised, so it's the
 * natural home for the audio player — the main window can be closed
 * to tray without muting popo.
 */
export function usePillSound() {
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    const ensureCtx = (): AudioContext | null => {
      if (ctxRef.current) return ctxRef.current;
      try {
        const Ctor =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        if (!Ctor) return null;
        ctxRef.current = new Ctor();
        return ctxRef.current;
      } catch {
        return null;
      }
    };

    // Payload may be a plain string (legacy) or an object
    // `{ kind, preset }` (Session 33+). Normalise both into the
    // same internal shape.
    type Payload = string | { kind?: string; preset?: string };

    listen<Payload>("pill:sound", (event) => {
      const raw = event.payload;
      const kind = typeof raw === "string" ? raw : (raw?.kind ?? "start");
      const preset =
        typeof raw === "string"
          ? "default"
          : (raw?.preset ?? "default").toLowerCase();

      if (preset === "none") return;

      const ctx = ensureCtx();
      if (!ctx) return;
      if (ctx.state === "suspended") {
        void ctx.resume();
      }

      // Map (kind, preset) → glide parameters.
      if (kind === "start") {
        playStart(ctx, preset);
      } else if (kind === "paste") {
        playPaste(ctx, preset);
      }
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {
        /* Outside Tauri — no-op. */
      });

    return () => {
      unlisten?.();
      // Don't close the AudioContext on unmount — the hook is meant
      // to live for the entire pill-window lifetime, and closing
      // would prevent subsequent re-mounts from playing anything.
    };
  }, []);
}

// ── Preset glide recipes ────────────────────────────────
//
// Each preset is a (fromHz, toHz, peakVolume, durationSec) tuple
// per event kind. Changing these changes the app's "voice" in a
// subtle but noticeable way — careful balance between distinctness
// and understated-ness.

function playStart(ctx: AudioContext, preset: string) {
  switch (preset) {
    case "soft":
      playGlide(ctx, 420, 560, 0.08, 0.06);
      return;
    case "chime":
      // Two-tone bright: low-root + up a fifth.
      playGlide(ctx, 520, 620, 0.07, 0.04);
      setTimeout(() => playGlide(ctx, 780, 940, 0.07, 0.05), 60);
      return;
    case "bell":
      playGlide(ctx, 880, 1100, 0.07, 0.05);
      return;
    case "default":
    default:
      playGlide(ctx, 620, 840, 0.09, 0.04);
  }
}

function playPaste(ctx: AudioContext, preset: string) {
  switch (preset) {
    case "soft":
      playGlide(ctx, 560, 720, 0.07, 0.06);
      return;
    case "chime":
      playGlide(ctx, 780, 940, 0.07, 0.04);
      setTimeout(() => playGlide(ctx, 1100, 1320, 0.07, 0.05), 60);
      return;
    case "bell":
      playGlide(ctx, 1200, 1480, 0.07, 0.05);
      return;
    case "default":
    default:
      playGlide(ctx, 940, 1240, 0.08, 0.05);
  }
}

/**
 * Play a short sine glide from `fromHz` → `toHz` over `durationMs`,
 * at a modest peak volume (`peak`, 0..1). Envelope: linear attack
 * over 6 ms, exponential decay over the rest — gives a clean ping
 * without the click you'd get from a hard-cut gain.
 */
function playGlide(
  ctx: AudioContext,
  fromHz: number,
  toHz: number,
  peak: number,
  durationSec: number,
) {
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "sine";
  osc.frequency.setValueAtTime(fromHz, now);
  osc.frequency.exponentialRampToValueAtTime(toHz, now + durationSec);

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(peak, now + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + durationSec + 0.02);
}
