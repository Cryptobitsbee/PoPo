import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { AnimatePresence, motion } from "framer-motion";
import PillOverlay from "../components/pill/PillOverlay";
import AppIconBubble from "../components/pill/AppIconBubble";
import ErrorTooltip from "../components/pill/ErrorTooltip";
import FirstRunHint from "../components/pill/FirstRunHint";
import { usePillEvents } from "../hooks/usePillEvents";
import { usePillDemo } from "../hooks/usePillDemo";
import { usePillSound } from "../hooks/usePillSound";
import { usePillStore } from "../store/pillStore";
import {
  rehydrateSettings,
  subscribeCrossWebview,
  SETTINGS_CHANGED_EVENT,
} from "../lib/cross-webview-sync";

/**
 * PillPage — route target for the transparent pill webview (`/pill`).
 *
 * Responsibilities:
 *   1. Render the single morphing <PillOverlay />.
 *   2. Render <ErrorTooltip /> above the pill; it's a 10-second in-app
 *      error banner that persists past the pill's 2s error flash.
 *   3. Subscribe to Tauri events from Rust via usePillEvents().
 *   4. Subscribe to `pill:sound` events and play Web Audio tones
 *      (Settings → Sound → Sound effects). The pill window is the
 *      only window that's always alive, so it's the natural home
 *      for the audio player.
 *   5. Run the dev-only state cycler via usePillDemo().
 *   6. Toggle window click-through based on two signals:
 *        a. Pill state: READY / ACTIVE → intercept events (recording).
 *        b. Cursor proximity (`pill:cursor:near` from Rust): intercept
 *           events when the cursor hovers the pill window, enabling
 *           drag-to-reposition in sleep / idle states WITHOUT making
 *           the transparent window permanently block clicks.
 *
 *      Combined rule:
 *        intercept = (state === "ready" || state === "active") || cursorNear
 *
 *      Rust emits `pill:cursor:near: bool` every time the cursor
 *      crosses the pill window boundary (polled at 40ms via
 *      GetCursorPos + GetWindowRect in lib.rs).
 *
 * Layout:
 *   - Pill webview is 260×110 (tauri.conf.json).
 *   - Flex column, children stacked vertically, anchored to the
 *     BOTTOM of the window. Pill sits at the bottom (same screen
 *     position as before — Rust positions so window bottom is 56px
 *     above taskbar). ErrorTooltip stacks above the pill with a
 *     small gap when an error is active; otherwise the top ~60px
 *     is transparent empty space.
 *
 * See POPO_BRIEF §2 + docs/DESIGN_SYSTEM.md §7.
 */
export default function PillPage() {
  const state = usePillStore((s) => s.state);
  const error = usePillStore((s) => s.error);

  // Base64-encoded PNG of the target app's icon, emitted by Rust on press.
  const [appIcon, setAppIcon] = useState<string>("");

  // True while the cursor is inside (or within MARGIN px of) the pill
  // window. Emitted by the Rust cursor-proximity loop in lib.rs.
  const [cursorNear, setCursorNear] = useState(false);

  // A persistent tooltip (e.g. "Setup needed — open GCP Setup…") is
  // the only reason the pill window should accept clicks outside
  // recording. Without this the window stays fully click-through and
  // the user can never dismiss the hint.
  const hasPersistentTooltip = Boolean(error?.persistent);

  usePillEvents();
  usePillSound();
  usePillDemo();

  // Cross-webview settings sync (Session 49 feature #20). The pill
  // webview's settingsStore is a separate Zustand instance from the
  // main window's; without this listener it would only see the
  // settings values that were in localStorage when the pill webview
  // first loaded — changes made via Settings (e.g. dragging the pill
  // opacity slider) wouldn't propagate live. Mirroring the pattern
  // used by QuickSwitcherPage.
  //
  // We don't need the visibilitychange-based rehydrate that the
  // switcher uses, because the pill is ALWAYS visible (it's the
  // ambient bottom-of-screen surface). The Tauri IPC event is
  // sufficient: any time main-window settings change, this fires
  // and we pull the latest from localStorage.
  useEffect(() => {
    // Rehydrate once on mount so the pill picks up any settings
    // change that happened while the pill webview was loading.
    rehydrateSettings();

    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void (async () => {
      const fn = await subscribeCrossWebview(SETTINGS_CHANGED_EVENT, () => {
        rehydrateSettings();
      });
      if (cancelled) {
        fn();
        return;
      }
      unlisten = fn;
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // App-icon listener: Rust emits the focused app's icon as base64 PNG
  // when the hotkey is pressed.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<string>("pill:app-icon", (event) => {
      // eslint-disable-next-line no-console
      console.log(
        `[pill] received app-icon event: ${event.payload.length} chars base64`,
      );
      setAppIcon(event.payload);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {
        /* Outside Tauri — no-op. */
      });
    return () => {
      unlisten?.();
    };
  }, []);

  // Clear the app icon when pill returns to sleep.
  // Delay by 200ms so the icon exits AFTER the pill has started morphing
  // to sleep size — prevents a brief horizontal shift during transition.
  useEffect(() => {
    if (state === "sleep") {
      const t = window.setTimeout(() => setAppIcon(""), 200);
      return () => window.clearTimeout(t);
    }
  }, [state]);

  // Cursor-proximity listener.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<boolean>("pill:cursor:near", (event) => {
      setCursorNear(event.payload);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {
        /* Outside Tauri — no-op. */
      });
    return () => {
      unlisten?.();
    };
  }, []);

  // Combined click-through toggle.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getCurrentWebviewWindow } =
          await import("@tauri-apps/api/webviewWindow");
        if (cancelled) return;
        // Intercept cursor events when:
        //   • Actively recording (ready / active) — so drag region works
        //     during use and hover effects fire on the pill surface.
        //   • Cursor is hovering the pill (cursorNear) — so the user can
        //     drag-to-reposition even when the pill is sleeping.
        //   • A persistent tooltip is showing — otherwise the click
        //     that's supposed to dismiss it would pass through the
        //     click-through window and land on the app behind the pill.
        //     (Persistent tooltips are rare and self-clearing when the
        //     underlying condition resolves, so the click-blocking
        //     side-effect is scoped to genuinely actionable moments.)
        //
        // In all other states the window passes through OS-level
        // mouse events so nothing is blocked behind it.
        const intercept =
          state === "ready" ||
          state === "active" ||
          cursorNear ||
          hasPersistentTooltip;
        await getCurrentWebviewWindow().setIgnoreCursorEvents(!intercept);
      } catch {
        // Outside Tauri (pure Vite in a browser tab) — no-op.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state, cursorNear, hasPersistentTooltip]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        // Pill anchors to the bottom of the 110px-tall window; the
        // ErrorTooltip floats above it with a small gap when active.
        justifyContent: "flex-end",
        gap: 8,
        paddingBottom: 12,
        background: "transparent",
        // Outer container never catches pointer events; only the pill
        // surface + tooltip opt in via pointer-events: auto.
        pointerEvents: "none",
      }}
    >
      <div style={{ pointerEvents: "auto" }}>
        <FirstRunHint />
      </div>
      <div style={{ pointerEvents: "auto" }}>
        <ErrorTooltip />
      </div>
      <div
        style={{
          pointerEvents: "auto",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
          gap: 6,
        }}
      >
        <AnimatePresence>
          {appIcon && state !== "sleep" && (
            <AppIconBubble iconBase64={appIcon} />
          )}
        </AnimatePresence>
        <PillOverlay />
        {/* Invisible spacer so the pill stays centered when icon is visible */}
        <AnimatePresence>
          {appIcon && state !== "sleep" && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 40, opacity: 0 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 380, damping: 28 }}
              style={{
                height: 40,
                flexShrink: 0,
                pointerEvents: "none",
                visibility: "hidden",
              }}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
