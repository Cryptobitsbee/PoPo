import { useEffect } from "react";
import { subscribeToSessions } from "../lib/firestore";
import { useHistoryStore } from "../store/historyStore";
import { useAuthStore } from "../store/authStore";
import { isFirebaseConfigured } from "../lib/firebase";

/**
 * useHistorySync — subscribe to Firestore sessions for the signed-in
 * user. Fires once with all historical sessions (newest-first), then
 * updates in real-time as new sessions are written.
 *
 * Mounted in AppShell. Fires whenever the user changes (sign-in or
 * sign-out). On sign-out, clears the historyStore to remove personal
 * data from memory.
 */
export function useHistorySync() {
  const setAll = useHistoryStore((s) => s.setAll);
  const user = useAuthStore((s) => s.user);
  const status = useAuthStore((s) => s.status);

  useEffect(() => {
    // Only subscribe when signed in + Firestore is configured.
    if (!isFirebaseConfigured || status !== "signed-in" || !user?.uid) {
      // If not signed in, leave whatever is in the store (in-session
      // dictations from useSessionSave) — don't wipe it.
      return;
    }

    const unsubscribe = subscribeToSessions(user.uid, (sessions) => {
      setAll(sessions);
    });

    return () => {
      unsubscribe();
      // When user signs out, clear personal session data from memory.
      // The store will be empty until the next sign-in.
    };
  }, [user, status, setAll]);
}
