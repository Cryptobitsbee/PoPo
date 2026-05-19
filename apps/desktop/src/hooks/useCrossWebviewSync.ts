import { useEffect } from "react";
import {
  subscribeCrossWebview,
  rehydrateSettings,
  rehydrateModes,
  rehydrateAppIcons,
  SETTINGS_CHANGED_EVENT,
  MODES_CHANGED_EVENT,
  APP_ICONS_CHANGED_EVENT,
} from "../lib/cross-webview-sync";

/**
 * useCrossWebviewSync — listen for store-mutation events emitted by
 * other Tauri webviews and re-hydrate the local stores.
 *
 * Mounted once in AppShell so the main window stays in sync when the
 * Quick switcher (Ctrl+Shift+M) picks a different default mode. Also
 * usable in any other standalone webview (the switcher subscribes
 * directly inside QuickSwitcherPage for the same reason).
 *
 * Events:
 *   - `popo:settings-changed`  → rehydrateSettings()
 *   - `popo:modes-changed`     → rehydrateModes()
 *   - `popo:app-icons-changed` → rehydrateAppIcons()
 *
 * All three rehydrate helpers are idempotent: if the stored value
 * matches the current store state, no setState fires. So even though
 * the source webview also receives its own emit, there's no flicker.
 *
 * Failure mode: if `@tauri-apps/api/event` import fails (e.g. running
 * under plain Vite preview without the Tauri runtime), the
 * subscription is a silent no-op. The cleanup handles still wire up
 * properly. See `lib/cross-webview-sync.ts` for the guards.
 */
export function useCrossWebviewSync(): void {
  useEffect(() => {
    let unlistenSettings: (() => void) | null = null;
    let unlistenModes: (() => void) | null = null;
    let unlistenAppIcons: (() => void) | null = null;
    let cancelled = false;

    void (async () => {
      const a = await subscribeCrossWebview(SETTINGS_CHANGED_EVENT, () => {
        rehydrateSettings();
      });
      const b = await subscribeCrossWebview(MODES_CHANGED_EVENT, () => {
        rehydrateModes();
      });
      const c = await subscribeCrossWebview(APP_ICONS_CHANGED_EVENT, () => {
        rehydrateAppIcons();
      });
      if (cancelled) {
        // Effect cleanup ran before listen() resolved; tear down now.
        a();
        b();
        c();
        return;
      }
      unlistenSettings = a;
      unlistenModes = b;
      unlistenAppIcons = c;
    })();

    return () => {
      cancelled = true;
      unlistenSettings?.();
      unlistenModes?.();
      unlistenAppIcons?.();
    };
  }, []);
}
