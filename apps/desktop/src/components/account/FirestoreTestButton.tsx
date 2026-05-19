import { useState } from "react";
import { Lightning } from "@phosphor-icons/react";
import { doc, setDoc, deleteDoc } from "firebase/firestore";
import { db, isFirebaseConfigured } from "../../lib/firebase";
import { useAuthStore } from "../../store/authStore";
import { trackSync } from "../../store/syncLogStore";
import Button from "../shared/Button";

/**
 * FirestoreTestButton — fires a round-trip Firestore write + delete to
 * `users/{uid}/_diagnostics/ping`. Results are visible in the
 * SyncLogViewer immediately above it.
 *
 * Useful for isolating sync issues:
 *   - If this FAILS but local state is fine, Firestore is the problem.
 *     The error shown in the sync log tells us why (permission-denied,
 *     not-found, unavailable, unauthenticated).
 *   - If this SUCCEEDS, writes are working, and any missing data is a
 *     different bug (sign-in flow, store wiring, etc.).
 *
 * The doc is deleted immediately after the write so it doesn't pollute
 * the user's real data. Both operations are tracked in the sync log.
 */
export default function FirestoreTestButton() {
  const user = useAuthStore((s) => s.user);
  const [busy, setBusy] = useState(false);

  const canRun = isFirebaseConfigured && user?.uid && !!db;

  const handleClick = async () => {
    if (!canRun) return;
    setBusy(true);

    const uid = user.uid;
    const path = `users/${uid}/_diagnostics/ping`;

    try {
      // Write
      await trackSync("write", path, async () => {
        await setDoc(doc(db!, "users", uid, "_diagnostics", "ping"), {
          ts: Date.now(),
          note: "popo diagnostic ping",
        });
      });

      // Immediate cleanup
      await trackSync("delete", path, async () => {
        await deleteDoc(doc(db!, "users", uid, "_diagnostics", "ping"));
      });
    } catch {
      // trackSync already logged it visibly. Nothing more to do.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant="subtle"
      iconLeft={<Lightning size={14} weight="regular" />}
      disabled={!canRun || busy}
      onClick={handleClick}
    >
      {busy ? "Testing…" : "Test Firestore"}
    </Button>
  );
}
