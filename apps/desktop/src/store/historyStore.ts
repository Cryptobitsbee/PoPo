import { create } from "zustand";
import type { Session } from "@popo/shared-types";

/**
 * historyStore — cache of sessions (dictation records) for the main UI.
 *
 * Session 9 (Phase 4 [13]) extracted `modes` out of this store into
 * `modesStore`. History is a read-only log of past dictations; modes
 * are separate user-editable entities. Consumers that need both
 * datasets compose them in the page (see HistoryPage.tsx).
 *
 * Hydration: `useSessionSave` prepends on every dictation (local,
 * instant). `useHistorySync` subscribes to Firestore and calls
 * `setAll()` whenever the remote changes, providing cross-device
 * sync + cross-session persistence. No synthetic data anymore.
 *
 * Selection state (which row is currently expanded / preview) lives in
 * component-local state (HistoryPage) — it's purely UI and shouldn't
 * bleed into other surfaces.
 *
 * Both `setAll` and `appendSessions` dedupe by `session.id` before
 * committing state. This is a defense-in-depth guarantee: even if
 * upstream ever sends a duplicate (double-fired Tauri listener, a
 * Firestore optimistic-then-server snapshot sequence, or a merge of
 * in-memory + remote that overlaps), the UI can never show the same
 * session twice. Without this, React keyed the duplicate by id and
 * rendered two rows — one interactive, the second inert because
 * React-reconciler reuses the first element's instance.
 */

function dedupById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

interface HistoryStore {
  sessions: Session[];
  /** True once seed data has been loaded (or real data arrives). */
  hydrated: boolean;

  setAll: (sessions: Session[]) => void;
  deleteSession: (id: string) => void;
  appendSessions: (s: Session[]) => void;
  updateSession: (id: string, patch: Partial<Session>) => void;
}

export const useHistoryStore = create<HistoryStore>((set) => ({
  sessions: [],
  hydrated: false,

  setAll: (sessions) => set({ sessions: dedupById(sessions), hydrated: true }),

  deleteSession: (id) =>
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
    })),

  appendSessions: (batch) =>
    set((state) => {
      // Drop any incoming sessions whose id is already in the store.
      // This is what keeps the "listener fires twice" bug from ever
      // producing visible duplicates, even while we hunt the root
      // cause of the upstream re-fire.
      const existing = new Set(state.sessions.map((s) => s.id));
      const newOnes = batch.filter((s) => !existing.has(s.id));
      if (newOnes.length === 0) return state;
      return { sessions: [...newOnes, ...state.sessions] };
    }),

  updateSession: (id, patch) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, ...patch } : s,
      ),
    })),
}));
