import { useEffect } from "react";
import { loadSettings, saveSettings } from "../lib/firestore";
import { useSettingsStore } from "../store/settingsStore";
import { useAuthStore } from "../store/authStore";
import { isFirebaseConfigured } from "../lib/firebase";
import type { Settings } from "@popo/shared-types";
import { trackSync } from "../store/syncLogStore";

/**
 * useSettingsSync — on sign-in, reconcile local settings with the
 * user's Firestore settings document.
 *
 * Rules (Phase C, Session 18):
 *   1. If Firestore has no settings doc yet, push the current local
 *      settings as the seed. This preserves anything the user
 *      configured before signing in.
 *   2. If Firestore has a settings doc, merge remote over local
 *      defaults (remote wins for any field it defines, defaults fill
 *      in the rest). This protects against schema additions where the
 *      remote doc predates a new field.
 *   3. GCP credentials are NOT synced — the service-account JSON path
 *      is machine-specific, and `lastConnectionTest`/`lastConnectionOk`
 *      reflect the local machine's state. Each machine configures its
 *      own GCP setup; only the `Settings` (non-GCP) half crosses
 *      devices. Revisit if users ask for project-id cross-device
 *      continuity.
 *
 * Mount once in AppShell. Fires on every user/status change.
 */
export function useSettingsSync() {
  const hydrateFromRemote = useSettingsStore((s) => s.hydrateFromRemote);
  const user = useAuthStore((s) => s.user);
  const status = useAuthStore((s) => s.status);

  useEffect(() => {
    if (!isFirebaseConfigured || status !== "signed-in" || !user?.uid) return;

    const uid = user.uid;
    let cancelled = false;

    (async () => {
      try {
        const remote = await trackSync(
          "load",
          `users/${uid}/settings/doc`,
          () => loadSettings(uid),
        );
        if (cancelled) return;

        if (!remote) {
          // First-time sign-in: push the user's current local settings
          // up so they survive across devices.
          const local = useSettingsStore.getState().settings;
          await trackSync("write", `users/${uid}/settings/doc`, () =>
            saveSettings(uid, local),
          );
        } else {
          // Remote wins. Strip any `gcp` field from the remote doc —
          // GCP stays local-only per the Phase C rule.
          const { gcp: _gcp, ...settingsFields } = remote;
          void _gcp;
          hydrateFromRemote(settingsFields as Partial<Settings>);
        }
      } catch (e) {
        // trackSync already logged to console.error + syncLogStore.
        void e;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, status, hydrateFromRemote]);
}
