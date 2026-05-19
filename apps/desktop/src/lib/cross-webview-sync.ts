// lib/cross-webview-sync.ts — keep separate Tauri webviews in sync
// without going through Firestore.
//
// The problem (Session 39 + this turn):
//   Tauri runs each webview in its own JS context. The pill, the
//   switcher, and the main window each construct their own Zustand
//   stores from `create()`. A change made in one webview's
//   settingsStore does NOT propagate to another webview's
//   settingsStore. Only `localStorage` is shared across same-origin
//   webviews — but localStorage by itself doesn't notify other
//   webviews when it changes (the `storage` event is unreliable
//   across separate Tauri webviews).
//
// The fix:
//   When any store mutation happens, the originating webview emits a
//   Tauri event over the IPC bus. Every other webview listens and
//   re-hydrates its store from localStorage. The event is the
//   "something changed, pull the latest" notification; localStorage
//   is the actual data channel.
//
// Why not Firestore real-time listeners?
//   Works only when the user is signed in. We need cross-webview
//   sync to work offline too (and immediately, without round-trip
//   latency).
//
// Self-rehydration is a no-op:
//   The source webview also receives its own emit. The rehydrate
//   helpers compare current state to the parsed localStorage value
//   and only call setState if they differ — so the round-trip costs
//   one JSON.parse + one JSON.stringify per emit, no spurious
//   re-renders.

import type { Settings, Mode } from "@popo/shared-types";
import { DEFAULT_SETTINGS } from "@popo/shared-types";
import { emit, listen } from "@tauri-apps/api/event";
import { useSettingsStore } from "../store/settingsStore";
import { useModesStore } from "../store/modesStore";
import { useAppIconsStore } from "../store/appIconsStore";

export const SETTINGS_CHANGED_EVENT = "popo:settings-changed";
export const MODES_CHANGED_EVENT = "popo:modes-changed";
export const APP_ICONS_CHANGED_EVENT = "popo:app-icons-changed";

const POPO_SETTINGS_KEY = "popo:settings";
const POPO_MODES_KEY = "popo:modes";
const POPO_APP_ICONS_KEY = "popo:app-icons";

/** True when running inside a Tauri webview. */
function isTauriContext(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "__TAURI_INTERNALS__" in window ||
    "__TAURI__" in window ||
    navigator.userAgent.includes("Tauri")
  );
}

/**
 * Fire a cross-webview event. Failures are swallowed — the localStorage
 * write happens unconditionally before this is called, so even if the
 * IPC emit fails the data isn't lost; the next `visibilitychange` on
 * the receiving webview will pick it up.
 */
export async function emitCrossWebview(
  name: string,
  payload?: unknown,
): Promise<void> {
  if (!isTauriContext()) return;
  try {
    await emit(name, payload ?? {});
  } catch {
    // Swallow — see doc comment above.
  }
}

/**
 * Subscribe to a cross-webview event. Returns an `unlisten()` function;
 * call it on cleanup. Resolves to a no-op when not in a Tauri context.
 */
export async function subscribeCrossWebview(
  name: string,
  handler: () => void,
): Promise<() => void> {
  if (!isTauriContext()) return () => {};
  try {
    const unlisten = await listen(name, () => handler());
    return unlisten;
  } catch {
    return () => {};
  }
}

/**
 * Re-hydrate `useSettingsStore` from localStorage. Idempotent — only
 * triggers a `setState` when the parsed value actually differs from
 * the current one (deep equality via JSON.stringify, which is fine
 * for the small settings shape).
 */
export function rehydrateSettings(): void {
  try {
    const raw = localStorage.getItem(POPO_SETTINGS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const current = useSettingsStore.getState().settings;
    const next: Settings = { ...DEFAULT_SETTINGS, ...current, ...parsed };
    if (JSON.stringify(current) !== JSON.stringify(next)) {
      useSettingsStore.setState({ settings: next });
    }
  } catch {
    // Stale state in this tick is fine; next emit retries.
  }
}

/**
 * Re-hydrate `useModesStore` from localStorage. Same idempotence
 * contract as `rehydrateSettings`.
 */
export function rehydrateModes(): void {
  try {
    const raw = localStorage.getItem(POPO_MODES_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    const current = useModesStore.getState().modes;
    if (JSON.stringify(current) !== JSON.stringify(parsed)) {
      useModesStore.setState({ modes: parsed as Mode[] });
    }
  } catch {
    // ignore
  }
}

/**
 * Re-hydrate `useAppIconsStore` from localStorage. Same idempotence
 * contract as `rehydrateSettings` and `rehydrateModes`. Uses the
 * store's `setAllFromCrossWebview` action which skips the emit so
 * we don't bounce the event back.
 */
export function rehydrateAppIcons(): void {
  try {
    const raw = localStorage.getItem(POPO_APP_ICONS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
    // Defensive: filter to string values only.
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string" && v.length > 0) next[k] = v;
    }
    const current = useAppIconsStore.getState().iconsByName;
    if (JSON.stringify(current) !== JSON.stringify(next)) {
      useAppIconsStore.getState().setAllFromCrossWebview(next);
    }
  } catch {
    // ignore
  }
}
