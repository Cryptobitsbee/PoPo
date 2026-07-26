import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Warning, Trash } from "@phosphor-icons/react";
import { deleteUser } from "firebase/auth";
import { useAuthStore } from "../../store/authStore";
import { useHistoryStore } from "../../store/historyStore";
import { useModesStore } from "../../store/modesStore";
import { useSnippetsStore } from "../../store/snippetsStore";
import { useDictionaryStore } from "../../store/dictionaryStore";
import { useAppIconsStore } from "../../store/appIconsStore";
import { useSettingsStore } from "../../store/settingsStore";
import { deleteAllCloudUserData } from "../../lib/cloudDeletion";
import { useSyncLogStore, trackSync } from "../../store/syncLogStore";
import Button from "../shared/Button";
import ConfirmDialog from "../shared/ConfirmDialog";

/**
 * AccountDangerZone — full account + data deletion.
 *
 * Rendered unwrapped (not inside a SettingRow) below the AccountRow
 * in the Settings → Account group. Same layout grammar as GCPSetup
 * and PasteOverridesEditor.
 *
 * Only visible when the user is signed in. The button fires a
 * destructive ConfirmDialog; on confirm, we:
 *   1. Delete every Firestore doc across all user sub-collections.
 *   2. Clear local Rust state (WAVs + runtime caches).
 *   3. Reset all Zustand stores to initial state.
 *   4. Delete the Firebase Auth user (irreversible).
 *
 * Errors surface inline; the sequence aborts on first failure so
 * the user can retry. Whatever partial deletes did succeed stay
 * applied — Firestore delete is idempotent.
 */
export default function AccountDangerZone() {
  const user = useAuthStore((s) => s.user);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null; // only signed-in users can delete

  const handleConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const uid = user.uid;

      // 1. Delete every currently-known remote document and recursively
      //    remove audio/{uid}/**. This queries Firestore directly rather
      //    than trusting the UI's 200-session cache.
      await trackSync("delete", `users/${uid}/**`, () =>
        deleteAllCloudUserData(uid),
      );

      // 2. Wipe local Rust-owned data while authentication still exists.
      //    This removes WAVs, gcp.json, the DPAPI-protected Gemini key,
      //    first-run state, and runtime caches. It does not delete the
      //    user's external service-account JSON source file.
      await invoke("cmd_clear_local_user_data");

      // 3. Delete Auth. This is intentionally after cloud deletion because
      //    Firestore and Storage rules require the current UID.
      await deleteUser(user);

      // 4. Clear browser-owned state with reset methods that NEVER write to
      //    Firestore. The previous reset() calls could recreate modes and
      //    settings immediately after they had been deleted.
      useHistoryStore.setState({ sessions: [], hydrated: true });
      useModesStore.getState().resetLocal();
      useSnippetsStore.getState().reset();
      useDictionaryStore.getState().reset();
      useAppIconsStore.getState().clear();
      useSettingsStore.getState().resetLocal();
      useSyncLogStore.getState().clear();

      // The Tauri app has a dedicated origin. Clearing it removes one-off
      // onboarding counters and any legacy PoPo keys not represented by a
      // current store, while the in-memory stores above remain reset.
      window.localStorage.clear();

      setConfirmOpen(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div
        style={{
          marginTop: "var(--sp-4)",
          padding: "var(--sp-4) var(--sp-5)",
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-subtle)",
          borderLeft: "2px solid var(--accent-error)",
          borderRadius: "var(--radius-card)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-3)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-2)",
          }}
        >
          <Warning size={14} weight="regular" color="var(--accent-error)" />
          <span
            style={{
              fontFamily: "var(--font-pixel-square)",
              fontSize: "var(--text-sm)",
              color: "var(--text-primary)",
            }}
          >
            Danger zone
          </span>
        </div>
        <p
          style={{
            margin: 0,
            fontFamily: "var(--font-pixel-line)",
            fontSize: "var(--text-xs)",
            lineHeight: 1.5,
            color: "var(--text-secondary)",
          }}
        >
          Permanently delete every popo record tied to your account: all
          session transcripts + audio, your modes, snippets, dictionary
          entries, app icons, and your popo account itself. This cannot be
          undone.
        </p>
        {error && (
          <p
            style={{
              margin: 0,
              fontFamily: "var(--font-pixel-line)",
              fontSize: "var(--text-xs)",
              lineHeight: 1.5,
              color: "var(--accent-error)",
            }}
          >
            {error}
          </p>
        )}
        <div>
          <Button
            variant="subtle"
            iconLeft={<Trash size={14} weight="regular" />}
            onClick={() => setConfirmOpen(true)}
            disabled={busy}
            style={{
              color: "var(--accent-error)",
              borderColor: "var(--accent-error)",
            }}
          >
            Delete all my data
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        onConfirm={handleConfirm}
        onCancel={() => setConfirmOpen(false)}
        title="Delete your popo account + all data?"
        description={
          <>
            This permanently removes:
            <ul style={{ margin: "8px 0", paddingLeft: 20 }}>
              <li>
                {useHistoryStore.getState().sessions.length} session(s)
              </li>
              <li>{useModesStore.getState().modes.length} mode(s)</li>
              <li>
                {useSnippetsStore.getState().snippets.length} snippet(s)
              </li>
              <li>
                {useDictionaryStore.getState().entries.length} dictionary
                entries
              </li>
              <li>All locally-stored audio files</li>
              <li>Your popo Google account link (you'll be signed out)</li>
            </ul>
            You can always sign in again later and start fresh. This cannot
            be undone.
          </>
        }
        confirmLabel="Delete everything"
        busy={busy}
      />
    </>
  );
}
