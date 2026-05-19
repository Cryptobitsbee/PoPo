import { create } from "zustand";
import {
  emitCrossWebview,
  APP_ICONS_CHANGED_EVENT,
} from "../lib/cross-webview-sync";

/**
 * appIconsStore — deduped map of `appName → iconBase64`.
 *
 * Problem this solves:
 *   Every dictation captures the target app's icon (~2–5 KB base64).
 *   If the user dictates 50 times into Chrome, we'd otherwise store 50
 *   copies of the same Chrome icon on Firestore session docs. That
 *   bloats cloud storage and every Session snapshot by ~250 KB for no
 *   user value — the icon for "Chrome" is one thing, not fifty.
 *
 * Persistence (Session 41):
 *   - localStorage at `popo:app-icons`. Hydrated on first store
 *     access. Without this, the Quick switcher webview's
 *     appIconsStore was permanently empty (`useAppIconsSync` only
 *     runs in AppShell / main window) and ModeRow's app-icon row
 *     never rendered. Now every webview reads the same persisted
 *     map at startup and gets live updates via the cross-webview
 *     event channel.
 *   - Cap: roughly 30–80 small PNGs at ~3 KB each → 100–250 KB. Well
 *     under localStorage's 5–10 MB origin quota.
 *
 * Sync (full architecture):
 *   - Rust still emits `session.appIcon` on every dictation.
 *   - `useSessionSave` upserts the icon into this store (which
 *     persists + emits cross-webview), AND into Firestore
 *     `users/{uid}/appIcons/{name}`.
 *   - Before writing the Firestore session doc, the per-session
 *     `appIcon` is stripped (kept in the in-memory history as a
 *     fallback until the icons store catches up from Firestore).
 *   - `useAppIconsSync` subscribes to Firestore and hydrates this
 *     store via `setAll()` so the user's icon library follows them
 *     across devices.
 *   - Other webviews (switcher, pill) read via localStorage
 *     hydration + `popo:app-icons-changed` event listener (see
 *     `useCrossWebviewSync` and `QuickSwitcherPage`).
 *
 * Public API:
 *   - `iconFor(name)` — lookup helper; returns undefined if we have no
 *     icon for this app yet.
 *   - `upsert(name, iconBase64)` — called by useSessionSave and by the
 *     Firestore subscription.
 *   - `setAll(map)` — replace the whole store (used on initial sync).
 *   - `setAllFromCrossWebview(map)` — like `setAll` but skips the
 *     emit (used by the cross-webview rehydrate to avoid loops).
 */

const POPO_APP_ICONS_KEY = "popo:app-icons";

function hydrateFromLocalStorage(): Record<string, string> {
  try {
    const raw = localStorage.getItem(POPO_APP_ICONS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      // Defensive: only keep string values.
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "string" && v.length > 0) out[k] = v;
      }
      return out;
    }
  } catch {
    // ignore — corrupt entry; treat as empty
  }
  return {};
}

function persist(map: Record<string, string>): void {
  try {
    localStorage.setItem(POPO_APP_ICONS_KEY, JSON.stringify(map));
  } catch {
    // Quota or private mode — runtime copy still works for this session.
  }
}

interface AppIconsState {
  iconsByName: Record<string, string>;
  iconFor: (name: string | undefined) => string | undefined;
  upsert: (name: string, iconBase64: string) => void;
  setAll: (map: Record<string, string>) => void;
  /**
   * Replace the whole map WITHOUT emitting a cross-webview event.
   * Used exclusively by the cross-webview rehydrate path to avoid
   * a notify→rehydrate→notify loop. Product code should use
   * `setAll`. Also bypasses persist when source is already
   * localStorage (the rehydrate already read from it).
   */
  setAllFromCrossWebview: (map: Record<string, string>) => void;
  /**
   * Remove a single app's icon from the local map. Called when the
   * LAST session for that app is deleted — see HistoryPage.handleDelete.
   * If sessions for the app still exist, we keep the icon so those
   * rows continue to render correctly.
   */
  remove: (name: string) => void;
  /** Drop every icon (used when the user signs out). */
  clear: () => void;
}

export const useAppIconsStore = create<AppIconsState>((set, get) => ({
  iconsByName: hydrateFromLocalStorage(),
  iconFor: (name) => {
    if (!name) return undefined;
    return get().iconsByName[name];
  },
  upsert: (name, iconBase64) => {
    if (!name || !iconBase64) return;
    const current = get().iconsByName[name];
    if (current === iconBase64) return; // no-op if unchanged
    const next = { ...get().iconsByName, [name]: iconBase64 };
    persist(next);
    set({ iconsByName: next });
    void emitCrossWebview(APP_ICONS_CHANGED_EVENT);
  },
  setAll: (map) => {
    const next = { ...map };
    persist(next);
    set({ iconsByName: next });
    void emitCrossWebview(APP_ICONS_CHANGED_EVENT);
  },
  setAllFromCrossWebview: (map) => {
    // Used by `rehydrateAppIcons` in cross-webview-sync.ts. The
    // rehydrate already read from localStorage, so we don't need to
    // write back. We also skip the emit to avoid an event loop.
    set({ iconsByName: { ...map } });
  },
  remove: (name) => {
    if (!name) return;
    const current = get().iconsByName;
    if (!(name in current)) return;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [name]: _dropped, ...rest } = current;
    persist(rest);
    set({ iconsByName: rest });
    void emitCrossWebview(APP_ICONS_CHANGED_EVENT);
  },
  clear: () => {
    persist({});
    set({ iconsByName: {} });
    void emitCrossWebview(APP_ICONS_CHANGED_EVENT);
  },
}));
