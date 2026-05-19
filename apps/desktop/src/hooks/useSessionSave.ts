import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import type { Session } from "@popo/shared-types";
import { useHistoryStore } from "../store/historyStore";
import { useAuthStore } from "../store/authStore";
import { useSettingsStore } from "../store/settingsStore";
import { useAppIconsStore } from "../store/appIconsStore";
import { saveSession, saveAppIcon } from "../lib/firestore";
import { trackSync } from "../store/syncLogStore";

/**
 * useSessionSave — listen for `session:created` events from Rust and
 * persist every successful dictation.
 *
 * Persistence strategy:
 *   1. Always prepend to historyStore (in-memory, visible immediately
 *      in the History page even if the user is not signed in).
 *   2. If a Firebase user is signed in, also write to Firestore at
 *      `users/{uid}/sessions/{sessionId}`. This is fire-and-forget:
 *      failures are logged but never shown to the user as blocking UI
 *      because the dictation itself already succeeded.
 *
 * The Rust side emits the payload with camelCase keys (serde
 * rename_all = "camelCase"), matching the shared-types Session shape.
 *
 * Mount this once in AppShell alongside useAuth.
 */
export function useSessionSave() {
  const appendSessions = useHistoryStore((s) => s.appendSessions);
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    // Race guard: `listen()` is async. If the effect re-runs (e.g.
    // user sign-in flips auth state) before the Promise resolves,
    // the cleanup runs while `unlisten` is still null, leaving a
    // live listener from the PREVIOUS render plus a new one being
    // registered — both fire on every dictation. That was the
    // "saving twice" symptom. Fix: carry a `cancelled` flag so the
    // late-arriving listener immediately unsubscribes itself.
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    listen<Session>("session:created", (event) => {
      if (cancelled) return; // render was torn down before this fired
      const session = event.payload;

      // 1. In-memory prepend — instant History page update.
      appendSessions([session]);

      // 1b. Dedup the app icon into appIconsStore (local, synchronous)
      //     so every row that knows an appName gets its icon on the
      //     next render, even before Firestore roundtrips complete.
      if (session.appName && session.appIcon) {
        useAppIconsStore.getState().upsert(session.appName, session.appIcon);
      }

      // 2. Firestore — only if signed in AND privacy mode is off.
      //    Privacy mode (Settings → Privacy) keeps sessions completely
      //    local. Per the brief it only affects sessions; modes and
      //    settings still sync.
      const privacyMode = useSettingsStore.getState().settings.privacyMode;
      if (user?.uid && !privacyMode) {
        trackSync("write", `users/${user.uid}/sessions/${session.id}`, () =>
          saveSession(user.uid, session),
        ).catch(() => {
          // trackSync already surfaced the error to syncLogStore + console.
        });

        // 2b. Upsert the app icon into the deduped `appIcons`
        //     collection. Fire-and-forget — if this write fails we
        //     still have the in-memory store copy; next session for
        //     the same app will retry. This is what prevents the
        //     session doc from carrying a redundant 5 KB PNG per row.
        if (session.appName && session.appIcon) {
          trackSync(
            "write",
            `users/${user.uid}/appIcons/${session.appName}`,
            () => saveAppIcon(user.uid, session.appName!, session.appIcon!),
          ).catch(() => {
            /* see above */
          });
        }
      }
    })
      .then((fn) => {
        if (cancelled) {
          // Effect was cleaned up before `listen()` resolved.
          // Immediately unsubscribe the pending listener so it
          // never receives events.
          fn();
          return;
        }
        unlisten = fn;
      })
      .catch((e) => {
        // Outside Tauri (pure Vite in browser) — silently degrade.
        // eslint-disable-next-line no-console
        console.warn("[popo] useSessionSave: could not register listener:", e);
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
    // Re-run when user changes so we always write to the current uid.
  }, [appendSessions, user]);
}
