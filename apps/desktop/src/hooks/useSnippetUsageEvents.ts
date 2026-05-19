import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useSnippetsStore } from "../store/snippetsStore";

/**
 * useSnippetUsageEvents — bumps `usageCount` on each snippet that
 * expands during a dictation.
 *
 * Rust emits `snippets:expanded` with a `string[]` payload of matched
 * snippet ids AFTER a successful expansion pass in `on_release`. This
 * hook subscribes and calls `incrementUsage` for each id. Use-count
 * drives the ordering on SnippetsPage (most-used first).
 *
 * Mount once in AppShell alongside the other Tauri listeners.
 */
export function useSnippetUsageEvents() {
  const increment = useSnippetsStore((s) => s.incrementUsage);

  useEffect(() => {
    // Same race guard as useSessionSave / useAudioUpload — the
    // async listen() can resolve AFTER the effect's cleanup if auth
    // state flips rapidly, leaving a dangling listener.
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    listen<string[]>("snippets:expanded", (event) => {
      if (cancelled) return;
      const ids = event.payload;
      if (!Array.isArray(ids)) return;
      for (const id of ids) increment(id);
    })
      .then((fn) => {
        if (cancelled) {
          fn();
          return;
        }
        unlisten = fn;
      })
      .catch(() => {
        /* Outside Tauri — silently degrade. */
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [increment]);
}
