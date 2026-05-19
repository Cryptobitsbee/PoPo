import { create } from "zustand";
import type { DictionaryEntry } from "@popo/shared-types";
import {
  saveDictionaryEntry as firestoreSaveEntry,
  deleteDictionaryEntry as firestoreDeleteEntry,
} from "../lib/firestore";
import { useAuthStore } from "./authStore";
import { trackSync } from "./syncLogStore";

/**
 * dictionaryStore — phrase hints passed to Chirp 3's speech-adaptation
 * layer (`RecognitionConfig.adaptation.phrase_sets`).
 *
 * Use cases:
 *   - Proper nouns (your name, colleagues' names, Indian place names)
 *   - Technical jargon (framework names, API names, acronyms)
 *   - Brand names the model mis-transcribes
 *
 * Up to 1000 entries per request (Google's Chirp 3 limit). The frontend
 * pushes the current list to Rust via `cmd_set_dictionary` whenever it
 * changes; Rust attaches them as inline phrase_sets on every
 * StreamingRecognize / Recognize call.
 */

const STORAGE_KEY = "popo:dictionary";

interface DictionaryState {
  entries: DictionaryEntry[];
  hydrated: boolean;

  upsert: (entry: DictionaryEntry) => void;
  remove: (id: string) => void;
  setAll: (entries: DictionaryEntry[]) => void;
  reset: () => void;
}

function loadFromStorage(): DictionaryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as DictionaryEntry[];
  } catch {
    return [];
  }
}

function persistToStorage(entries: DictionaryEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* quota / private mode — ignore */
  }
}

function syncSave(entry: DictionaryEntry) {
  const uid = useAuthStore.getState().user?.uid;
  if (!uid) return;
  trackSync("write", `users/${uid}/dictionary/${entry.id}`, () =>
    firestoreSaveEntry(uid, entry),
  ).catch(() => {});
}

function syncDelete(id: string) {
  const uid = useAuthStore.getState().user?.uid;
  if (!uid) return;
  trackSync("delete", `users/${uid}/dictionary/${id}`, () =>
    firestoreDeleteEntry(uid, id),
  ).catch(() => {});
}

export const useDictionaryStore = create<DictionaryState>((set, get) => ({
  entries: loadFromStorage(),
  hydrated: true,

  upsert: (entry) => {
    const existing = get().entries.findIndex((e) => e.id === entry.id);
    const next =
      existing >= 0
        ? get().entries.map((e) => (e.id === entry.id ? entry : e))
        : [...get().entries, entry];
    set({ entries: next });
    persistToStorage(next);
    syncSave(entry);
  },

  remove: (id) => {
    const next = get().entries.filter((e) => e.id !== id);
    set({ entries: next });
    persistToStorage(next);
    syncDelete(id);
  },

  setAll: (entries) => {
    const seen = new Set<string>();
    const deduped = entries.filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
    set({ entries: deduped });
    persistToStorage(deduped);
  },

  reset: () => {
    set({ entries: [] });
    persistToStorage([]);
  },
}));
