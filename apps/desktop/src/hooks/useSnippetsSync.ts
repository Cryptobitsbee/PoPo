import { useEffect } from "react";
import { useAuthStore } from "../store/authStore";
import { useSnippetsStore } from "../store/snippetsStore";
import { subscribeToSnippets } from "../lib/firestore";

/**
 * useSnippetsSync — subscribe to `users/{uid}/snippets` and hydrate
 * `snippetsStore`. Follows the same pattern as `useAppIconsSync`.
 *
 * On sign-out the store keeps its last hydrated state in-memory +
 * localStorage so the user isn't left with a blank Snippets list if
 * they sign back in to the same account. If they sign in to a
 * DIFFERENT account the next subscribe overwrites it via `setAll`.
 */
export function useSnippetsSync() {
  const user = useAuthStore((s) => s.user);
  const setAll = useSnippetsStore((s) => s.setAll);

  useEffect(() => {
    if (!user?.uid) return;
    const unsub = subscribeToSnippets(user.uid, (items) => {
      setAll(items);
    });
    return () => {
      unsub();
    };
  }, [user?.uid, setAll]);
}
