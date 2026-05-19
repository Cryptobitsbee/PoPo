import { create } from "zustand";
import type { Snippet } from "@popo/shared-types";
import {
  saveSnippet as firestoreSaveSnippet,
  deleteSnippet as firestoreDeleteSnippet,
} from "../lib/firestore";
import { useAuthStore } from "./authStore";
import { trackSync } from "./syncLogStore";

/**
 * snippetsStore — user-defined text-expansion shortcuts.
 *
 * Mirrors the modesStore pattern:
 *   - In-memory + localStorage for instant UX across app restarts.
 *   - Firestore mirror (`users/{uid}/snippets/{id}`) via fire-and-forget
 *     writes when the user is signed in.
 *   - `useSnippetsSync` (mounted in AppShell) hydrates from Firestore
 *     on sign-in and provides cross-device real-time updates.
 *
 * Expansion engine lives in Rust (`hotkey::expand_snippets`). Frontend
 * pushes the current snippet list to Rust via `cmd_set_snippets`
 * whenever it changes (see `useApplySettingsToRust`).
 */

const STORAGE_KEY = "popo:snippets";

interface SnippetsState {
  snippets: Snippet[];
  /** True once localStorage has been read once (on first get/mutation). */
  hydrated: boolean;

  upsert: (snippet: Snippet) => void;
  remove: (id: string) => void;
  /**
   * Increment a snippet's usageCount. Called from Rust (via a Tauri
   * event we'll wire in a later polish) OR manually from the UI on
   * successful expansion. Non-blocking; Firestore sync happens in bg.
   */
  incrementUsage: (id: string) => void;
  /**
   * Replace the entire list. BYPASSES Firestore writes by design;
   * used only by `useSnippetsSync` when hydrating from remote.
   */
  setAll: (snippets: Snippet[]) => void;
  reset: () => void;
}

// ── localStorage helpers ────────────────────────────────────────────

function loadFromStorage(): Snippet[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as Snippet[];
  } catch {
    return [];
  }
}

function persistToStorage(snippets: Snippet[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snippets));
  } catch {
    /* quota / private mode — ignore */
  }
}

// ── Firestore fire-and-forget helpers ──────────────────────────────

function syncSave(snippet: Snippet) {
  const uid = useAuthStore.getState().user?.uid;
  if (!uid) return;
  trackSync("write", `users/${uid}/snippets/${snippet.id}`, () =>
    firestoreSaveSnippet(uid, snippet),
  ).catch(() => {
    /* trackSync already surfaces the error */
  });
}

function syncDelete(id: string) {
  const uid = useAuthStore.getState().user?.uid;
  if (!uid) return;
  trackSync("delete", `users/${uid}/snippets/${id}`, () =>
    firestoreDeleteSnippet(uid, id),
  ).catch(() => {});
}

// ── Store ──────────────────────────────────────────────────────────

export const useSnippetsStore = create<SnippetsState>((set, get) => ({
  snippets: loadFromStorage(),
  hydrated: true,

  upsert: (snippet) => {
    const existing = get().snippets.findIndex((s) => s.id === snippet.id);
    const next =
      existing >= 0
        ? get().snippets.map((s) => (s.id === snippet.id ? snippet : s))
        : [...get().snippets, snippet];
    set({ snippets: next });
    persistToStorage(next);
    syncSave(snippet);
  },

  remove: (id) => {
    const next = get().snippets.filter((s) => s.id !== id);
    set({ snippets: next });
    persistToStorage(next);
    syncDelete(id);
  },

  incrementUsage: (id) => {
    const existing = get().snippets.find((s) => s.id === id);
    if (!existing) return;
    const updated: Snippet = {
      ...existing,
      usageCount: (existing.usageCount ?? 0) + 1,
      updatedAt: Date.now(),
    };
    const next = get().snippets.map((s) => (s.id === id ? updated : s));
    set({ snippets: next });
    persistToStorage(next);
    syncSave(updated);
  },

  setAll: (snippets) => {
    // Dedup by id — defense-in-depth for the same reason historyStore
    // dedupes: Firestore emits optimistic-then-server snapshots which
    // can transiently overlap with in-memory state.
    const seen = new Set<string>();
    const deduped = snippets.filter((s) => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
    set({ snippets: deduped });
    persistToStorage(deduped);
  },

  reset: () => {
    set({ snippets: [] });
    persistToStorage([]);
  },
}));
