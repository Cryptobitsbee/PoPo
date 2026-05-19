import { useEffect } from "react";
import { useAuthStore } from "../store/authStore";
import { useDictionaryStore } from "../store/dictionaryStore";
import { subscribeToDictionary } from "../lib/firestore";

/**
 * useDictionarySync — subscribe to `users/{uid}/dictionary` and
 * hydrate `dictionaryStore`. Mounted in AppShell.
 */
export function useDictionarySync() {
  const user = useAuthStore((s) => s.user);
  const setAll = useDictionaryStore((s) => s.setAll);

  useEffect(() => {
    if (!user?.uid) return;
    const unsub = subscribeToDictionary(user.uid, (items) => {
      setAll(items);
    });
    return () => {
      unsub();
    };
  }, [user?.uid, setAll]);
}
