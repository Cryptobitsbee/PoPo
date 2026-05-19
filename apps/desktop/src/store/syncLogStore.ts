import { create } from "zustand";

/**
 * syncLogStore — a ring buffer of recent Firestore operations.
 *
 * Why this exists:
 *   Firestore writes in popo are fire-and-forget (`.catch(console.warn)`)
 *   so the UI never blocks on sync failures. That's the right UX pattern
 *   but it hides bugs: when writes silently fail (wrong database id,
 *   permission denied, WebChannel blocked, auth missing, etc.), the user
 *   sees "nothing happens" with no feedback.
 *
 *   This store captures every write/read attempt as a log entry with:
 *     - kind (write | delete | load | subscribe)
 *     - path (e.g. "users/abc/modes/mode-auto")
 *     - status (pending | ok | error)
 *     - error message if failed
 *     - duration ms
 *     - timestamp
 *
 *   Rendered in the AccountPage "Sync log" section so the user can see
 *   at a glance whether Firestore is actually working.
 *
 * Keeps at most MAX_ENTRIES entries. Oldest rolls off.
 */

export type SyncKind = "write" | "delete" | "load" | "subscribe";
export type SyncStatus = "pending" | "ok" | "error";

export interface SyncLogEntry {
  id: number; // monotonic counter
  kind: SyncKind;
  path: string; // e.g. "users/abc/modes/mode-auto"
  status: SyncStatus;
  error?: string;
  durationMs?: number;
  startedAt: number; // epoch ms
}

const MAX_ENTRIES = 50;

interface SyncLogStore {
  entries: SyncLogEntry[];
  /** Start a new operation. Returns the entry id so the caller can finish it later. */
  start: (kind: SyncKind, path: string) => number;
  /** Mark an in-flight entry as completed successfully. */
  finishOk: (id: number) => void;
  /** Mark an in-flight entry as failed. */
  finishError: (id: number, error: string) => void;
  clear: () => void;
}

let nextId = 1;

export const useSyncLogStore = create<SyncLogStore>((set) => ({
  entries: [],

  start: (kind, path) => {
    const id = nextId++;
    const entry: SyncLogEntry = {
      id,
      kind,
      path,
      status: "pending",
      startedAt: Date.now(),
    };
    set((state) => {
      const next = [entry, ...state.entries].slice(0, MAX_ENTRIES);
      return { entries: next };
    });
    return id;
  },

  finishOk: (id) =>
    set((state) => ({
      entries: state.entries.map((e) =>
        e.id === id
          ? {
              ...e,
              status: "ok",
              durationMs: Date.now() - e.startedAt,
            }
          : e,
      ),
    })),

  finishError: (id, error) =>
    set((state) => ({
      entries: state.entries.map((e) =>
        e.id === id
          ? {
              ...e,
              status: "error",
              error,
              durationMs: Date.now() - e.startedAt,
            }
          : e,
      ),
    })),

  clear: () => set({ entries: [] }),
}));

// ─── Convenience wrapper: tracks a Promise automatically ───────────

/**
 * Wrap any Firestore Promise so it gets logged automatically. Returns
 * the same promise (rejections still propagate).
 *
 * @example
 *   await trackSync("write", `users/${uid}/modes/${mode.id}`,
 *     () => saveMode(uid, mode));
 */
export async function trackSync<T>(
  kind: SyncKind,
  path: string,
  fn: () => Promise<T>,
): Promise<T> {
  const { start, finishOk, finishError } = useSyncLogStore.getState();
  const id = start(kind, path);
  try {
    const result = await fn();
    finishOk(id);
    return result;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    finishError(id, message);
    // Surface to DevTools too, with full error object for stack inspection.
    // eslint-disable-next-line no-console
    console.error(`[popo sync] ${kind} ${path} FAILED:`, e);
    throw e;
  }
}
