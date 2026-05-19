import { useEffect } from "react";
import { loadModes, saveMode } from "../lib/firestore";
import { useModesStore } from "../store/modesStore";
import { useAuthStore } from "../store/authStore";
import { isFirebaseConfigured } from "../lib/firebase";
import { trackSync } from "../store/syncLogStore";

/**
 * useModesSync — on sign-in, reconcile local modes with the user's
 * Firestore modes collection.
 *
 * Rules (Phase C, Session 18):
 *   1. If Firestore has zero mode docs for this user, push the current
 *      local modes up (first-time sign-in seeds remote with local state
 *      so customizations made while signed-out are preserved).
 *   2. If Firestore already has modes, they win — replace the local
 *      store via `setAll`. Any local-only edits made while signed-out
 *      are discarded. This is the standard "server is the source of
 *      truth" rule for multi-device sync.
 *   3. On sign-out, leave the current store intact. Per-mutation
 *      writes in the store are already gated on `user?.uid`, so the
 *      stale local state won't leak back to the previous user's
 *      Firestore.
 *
 * Mount this once in AppShell alongside useAuth / useSessionSave /
 * useHistorySync. Fires on every user/status change.
 */
export function useModesSync() {
  const setAll = useModesStore((s) => s.setAll);
  const user = useAuthStore((s) => s.user);
  const status = useAuthStore((s) => s.status);

  useEffect(() => {
    if (!isFirebaseConfigured || status !== "signed-in" || !user?.uid) return;

    const uid = user.uid;
    let cancelled = false;

    (async () => {
      try {
        const remote = await trackSync("load", `users/${uid}/modes/*`, () =>
          loadModes(uid),
        );
        if (cancelled) return;

        if (remote.length === 0) {
          // First-time sign-in: push local modes (seeds + any custom)
          // to Firestore as the authoritative list.
          const local = useModesStore.getState().modes;
          await Promise.all(
            local.map((m) =>
              trackSync("write", `users/${uid}/modes/${m.id}`, () =>
                saveMode(uid, m),
              ),
            ),
          );
        } else {
          // Remote wins — replace local without triggering re-writes.
          setAll(remote);
        }
      } catch (e) {
        // trackSync already logged. Nothing else to do — the entry is
        // visible in the AccountPage sync log.
        void e;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, status, setAll]);
}
