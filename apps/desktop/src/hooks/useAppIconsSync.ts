import { useEffect } from "react";
import { useAuthStore } from "../store/authStore";
import { useAppIconsStore } from "../store/appIconsStore";
import { subscribeToAppIcons } from "../lib/firestore";

/**
 * useAppIconsSync — subscribe to Firestore's `users/{uid}/appIcons`
 * collection and hydrate `appIconsStore`.
 *
 * This is the read-side counterpart to the write in `useSessionSave`:
 *   - On sign-in, subscribes; receives the user's full icon library
 *     as one snapshot and calls `setAll()`.
 *   - Subsequent upserts from any device (including this one) arrive
 *     in real time.
 *   - On sign-out, clears the local map so the next user starts fresh.
 *
 * Mount once inside AppShell alongside the other sync hooks. Noops
 * when Firebase isn't configured or the user isn't signed in.
 */
export function useAppIconsSync() {
  const user = useAuthStore((s) => s.user);
  const setAll = useAppIconsStore((s) => s.setAll);
  const clear = useAppIconsStore((s) => s.clear);

  useEffect(() => {
    if (!user?.uid) {
      // Signed out — reset the local map so stale icons from a
      // previous session don't leak into the unauthenticated
      // in-memory history view.
      clear();
      return;
    }
    const unsub = subscribeToAppIcons(user.uid, (map) => {
      setAll(map);
    });
    return () => {
      unsub();
    };
  }, [user?.uid, setAll, clear]);
}
