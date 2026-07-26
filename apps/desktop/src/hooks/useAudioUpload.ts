import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { ref, uploadBytes } from "firebase/storage";
import { doc, updateDoc } from "firebase/firestore";
import type { Session } from "@popo/shared-types";
import { storage, db, isFirebaseConfigured } from "../lib/firebase";
import { useAuthStore } from "../store/authStore";
import { useSettingsStore } from "../store/settingsStore";
import { useHistoryStore } from "../store/historyStore";

/**
 * useAudioUpload — listens for `session:created` events from Rust and,
 * when the session has a local `audioStoragePath`, uploads the WAV to
 * Firebase Storage bucket `popo-flow.firebasestorage.app`.
 *
 * Storage path in Firebase: `audio/{uid}/{sessionId}.wav`
 *
 * Why we use `cmd_read_audio_bytes` (Rust command) instead of
 * `@tauri-apps/plugin-fs`:
 *   In Tauri v2 the fs plugin is path-scoped. Without an explicit scope
 *   entry in tauri.conf.json, `readFile()` fails silently with a
 *   permission error. Rust commands have no such restriction — they run
 *   with the OS user's full filesystem permissions.
 *
 * Fallback chain for audio URL in SessionRow:
 *   1. `audioDownloadUrl` (Firebase Storage) — works on ANY device when
 *      the user is signed in. Written here + stored in Firestore.
 *   2. `audioStoragePath` via `convertFileSrc` — works only on the
 *      recording device. Used when cloud URL is not yet available.
 */
export function useAudioUpload() {
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    // Same race guard as useSessionSave: if the effect re-runs
    // before `listen()` resolves, the pending listener would be
    // orphaned and upload every audio file twice.
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    listen<Session>("session:created", async (event) => {
      if (cancelled) return;
      const session = event.payload;

      // Guard: storeAudio must be on AND user must be signed in.
      const storeAudio = useSettingsStore.getState().settings.storeAudio;
      if (!storeAudio) return;

      const uid = user?.uid;
      if (!uid || !isFirebaseConfigured || !storage || !db) return;
      if (!session.audioStoragePath) return;

      try {
        // Read the WAV file via Rust command (no fs-plugin scope needed).
        const bytes = await invoke<number[]>("cmd_read_audio_bytes", {
          path: session.audioStoragePath,
        });
        if (!bytes || bytes.length === 0) {
          // eslint-disable-next-line no-console
          console.warn(
            "[popo] useAudioUpload: empty bytes from cmd_read_audio_bytes",
          );
          return;
        }

        const uint8 = new Uint8Array(bytes);
        const blob = new Blob([uint8], { type: "audio/wav" });

        // Persist only the object path. Playback resolves an authenticated
        // download URL on demand through the Firebase SDK instead of storing
        // a long-lived bearer URL in Firestore.
        const cloudPath = `audio/${uid}/${session.id}.wav`;
        const audioRef = ref(storage, cloudPath);
        await uploadBytes(audioRef, blob, {
          contentType: "audio/wav",
          customMetadata: {
            sessionId: session.id,
            durationMs: String(session.durationMs),
            language: session.language,
          },
        });

        const sessionRef = doc(db, "users", uid, "sessions", session.id);
        await updateDoc(sessionRef, { audioCloudPath: cloudPath });

        const { sessions, setAll } = useHistoryStore.getState();
        setAll(
          sessions.map((s) =>
            s.id === session.id ? { ...s, audioCloudPath: cloudPath } : s,
          ),
        );

        // eslint-disable-next-line no-console
        console.info(
          `[popo] audio uploaded (${(uint8.length / 1024).toFixed(0)} KB) → ${cloudPath}`,
        );
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[popo] useAudioUpload failed:", e);
        // Non-blocking — local audioStoragePath still works for same-device playback.
      }
    })
      .then((fn) => {
        if (cancelled) {
          fn();
          return;
        }
        unlisten = fn;
      })
      .catch(() => {
        /* Outside Tauri — no-op. */
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [user]);
}
