import { create } from "zustand";
import {
  DEFAULT_SETTINGS,
  DEFAULT_GCP_SETTINGS,
  type Settings,
  type GCPSettings,
} from "@popo/shared-types";
import { saveSettings } from "../lib/firestore";
import { useAuthStore } from "./authStore";
import { isFirebaseConfigured } from "../lib/firebase";
import { trackSync } from "./syncLogStore";
import {
  emitCrossWebview,
  SETTINGS_CHANGED_EVENT,
} from "../lib/cross-webview-sync";

/**
 * settingsStore — user preferences + GCP credentials surface.
 *
 * Persistence strategy (Phase 4 [12] + Phase C, Session 18):
 *   - On first access, hydrate from localStorage (POPO_SETTINGS_KEY,
 *     POPO_GCP_KEY).
 *   - On every `update` / `updateGcp`, write to localStorage
 *     synchronously.
 *   - If a Firebase user is signed in, `update` ALSO pushes the patch
 *     to Firestore (best-effort). GCP settings are NOT synced —
 *     service-account JSON path is machine-specific, and connection
 *     test results are per-device.
 *   - `hydrateFromRemote(settings)` replaces local settings WITHOUT a
 *     Firestore write — used by `useSettingsSync` after loading the
 *     remote doc. This avoids a load→write loop.
 *
 * When Phase 2 [6] Rust core fully lands:
 *   - Replace the localStorage read with `invoke("cmd_get_settings")`.
 *   - Replace the localStorage write with `invoke("cmd_update_settings",
 *     { patch })`. Rust owns SQLite + Firestore mirror.
 *   - The public hook shape (settings / gcp / update / updateGcp) does
 *     NOT change — consumers stay unchanged.
 *
 * Intentionally no zustand persist middleware. Per .clinerules
 * "Zustand stores are thin — no middleware". Hand-rolled persistence
 * keeps the swap to Rust trivial.
 */

const POPO_SETTINGS_KEY = "popo:settings";
const POPO_GCP_KEY = "popo:gcp";

function hydrate<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const merged = { ...fallback, ...JSON.parse(raw) } as T;

    // One-shot migration (Session 50): the Session 49 build of
    // popo shipped with `pillSleepOpacity` defaulting to 0.18
    // which made the sleep pill barely visible. The intended
    // value (matching the previous hardcoded behaviour) is 0.78.
    // Anyone whose stored value is EXACTLY 0.18 almost certainly
    // got it from the broken default rather than deliberately
    // landing there with the 0.01-step slider, so we fix it up.
    //
    // After they next adjust the slider this becomes a no-op (the
    // value won't equal 0.18 anymore). Also persists the fix so
    // we don't keep re-applying.
    if (key === POPO_SETTINGS_KEY) {
      const settings = merged as unknown as Settings;
      if (settings.pillSleepOpacity === 0.18) {
        settings.pillSleepOpacity = 0.78;
        persist(POPO_SETTINGS_KEY, settings);
      }
    }

    // Gemini 3.5 Flash-Lite is served only from global, us, and eu.
    // Older popo builds offered single regions such as us-central1;
    // normalize those persisted values so the next test/dictation does
    // not keep hitting a guaranteed Vertex 404.
    if (key === POPO_GCP_KEY) {
      const gcp = merged as unknown as GCPSettings;
      const supported = new Set(["global", "us", "eu"]);
      if (!supported.has((gcp.vertexLocation ?? "").trim().toLowerCase())) {
        gcp.vertexLocation = "global";
      }
      // Always rewrite the legacy record through persist(), which strips
      // geminiApiKey. A pre-hardening plaintext key remains in this
      // in-memory `merged` value long enough for the Rust DPAPI migration.
      persist(POPO_GCP_KEY, gcp);
    }

    return merged;
  } catch {
    return fallback;
  }
}

function persist(key: string, value: unknown): void {
  try {
    const diskValue =
      key === POPO_GCP_KEY && value && typeof value === "object"
        ? { ...(value as Record<string, unknown>), geminiApiKey: undefined }
        : value;
    localStorage.setItem(key, JSON.stringify(diskValue));
  } catch {
    // Quota / private mode — settings survive only for the session.
  }
}

/** Resolve the current signed-in uid, or null if not available. */
function currentUid(): string | null {
  if (!isFirebaseConfigured) return null;
  return useAuthStore.getState().user?.uid ?? null;
}

/** Fire-and-forget Firestore patch for Settings fields only (not GCP). */
function syncSettings(patch: Partial<Settings>): void {
  const uid = currentUid();
  if (!uid) return;
  trackSync("write", `users/${uid}/settings/doc`, () =>
    saveSettings(uid, patch),
  ).catch(() => {
    // trackSync already logged to console.error + syncLogStore.
  });
}

interface SettingsStore {
  settings: Settings;
  gcp: GCPSettings;
  /** Partial update to Settings. Syncs to Firestore if signed in. */
  update: (patch: Partial<Settings>) => void;
  /**
   * Partial update to GCPSettings. Local-only — intentionally never
   * synced to Firestore (service-account path is machine-specific).
   */
  updateGcp: (patch: Partial<GCPSettings>) => void;
  /**
   * Replace Settings from a remote Firestore doc WITHOUT writing back.
   * Intended for `useSettingsSync` only. Merges over DEFAULT_SETTINGS
   * to tolerate schema additions.
   */
  hydrateFromRemote: (remote: Partial<Settings>) => void;
  /** Reset local state without any Firestore write (account erasure path). */
  resetLocal: () => void;
  reset: () => void;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  settings: hydrate<Settings>(POPO_SETTINGS_KEY, DEFAULT_SETTINGS),
  gcp: hydrate<GCPSettings>(POPO_GCP_KEY, DEFAULT_GCP_SETTINGS),

  update: (patch) =>
    set((state) => {
      const next = { ...state.settings, ...patch };
      persist(POPO_SETTINGS_KEY, next);
      // Sync only the patch — Firestore merge:true applies it atop the
      // existing doc. Reduces payload and avoids needless field churn.
      syncSettings(patch);
      // Tell every other webview (pill, switcher) that settings
      // changed. They re-hydrate from localStorage on receipt. See
      // `lib/cross-webview-sync.ts` for the mechanism.
      void emitCrossWebview(SETTINGS_CHANGED_EVENT);
      return { settings: next };
    }),

  updateGcp: (patch) =>
    set((state) => {
      const next = { ...state.gcp, ...patch };
      persist(POPO_GCP_KEY, next);
      // Intentionally NO Firestore sync — GCP is machine-local.
      return { gcp: next };
    }),

  hydrateFromRemote: (remote) =>
    set((state) => {
      // Merge remote fields over DEFAULT_SETTINGS so new fields added
      // after the remote doc was last written still get their defaults,
      // then over the current local state so any in-flight local edits
      // made BEFORE sync completes aren't silently dropped. Remote
      // still wins per the sync contract.
      const next: Settings = {
        ...DEFAULT_SETTINGS,
        ...state.settings,
        ...remote,
      };
      persist(POPO_SETTINGS_KEY, next);
      // No syncSettings() call — we just loaded from remote.
      // DO emit cross-webview though: the switcher / pill should
      // see the freshly-loaded remote values without waiting for a
      // visibility change.
      void emitCrossWebview(SETTINGS_CHANGED_EVENT);
      return { settings: next };
    }),

  resetLocal: () =>
    set(() => {
      persist(POPO_SETTINGS_KEY, DEFAULT_SETTINGS);
      persist(POPO_GCP_KEY, DEFAULT_GCP_SETTINGS);
      void emitCrossWebview(SETTINGS_CHANGED_EVENT);
      return { settings: DEFAULT_SETTINGS, gcp: DEFAULT_GCP_SETTINGS };
    }),

  reset: () =>
    set(() => {
      persist(POPO_SETTINGS_KEY, DEFAULT_SETTINGS);
      persist(POPO_GCP_KEY, DEFAULT_GCP_SETTINGS);
      // Also push the default settings to Firestore so other devices
      // observe the reset. GCP remains local.
      syncSettings(DEFAULT_SETTINGS);
      void emitCrossWebview(SETTINGS_CHANGED_EVENT);
      return { settings: DEFAULT_SETTINGS, gcp: DEFAULT_GCP_SETTINGS };
    }),
}));
