import { useEffect } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth, isFirebaseConfigured } from "../lib/firebase";
import { useAuthStore } from "../store/authStore";
import { saveUserProfile, userProfileExists } from "../lib/firestore";
import { trackSync } from "../store/syncLogStore";

/**
 * useAuth — install the Firebase auth state listener once.
 *
 *   1. Flags status=unconfigured if env vars are missing.
 *   2. Subscribes to onAuthStateChanged — fires once at app launch
 *      with the cached user (or null), then on every sign-in /
 *      sign-out. This is the canonical source of auth state.
 *   3. When a user signs in, writes their profile doc at
 *      `users/{uid}` so `users/{uid}` is no longer a ghost parent.
 *      That fixes the Firebase Console's "This collection has no
 *      documents" display when looking at the `users` collection.
 *      First-time sign-ins get a `firstSeenAt` server timestamp;
 *      subsequent sign-ins just bump `lastSeenAt`.
 *
 * No redirect-result handling: the Tauri OAuth flow uses
 * signInWithCredential which immediately propagates to
 * onAuthStateChanged, so there's nothing to "resume" on app load.
 */
export function useAuth() {
  const setStatus = useAuthStore((s) => s.setStatus);
  const setUser = useAuthStore((s) => s.setUser);

  useEffect(() => {
    if (!isFirebaseConfigured || !auth) {
      setStatus("unconfigured");
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);

      if (user?.uid) {
        // Fire-and-forget profile doc upsert.
        void syncProfileOnSignIn({
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
        });
      }
    });

    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * Writes `users/{uid}` profile fields, tracking both the existence
 * check and the write in the sync log so the user can see it happen.
 */
async function syncProfileOnSignIn(input: {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}): Promise<void> {
  const { uid } = input;
  try {
    const exists = await trackSync("load", `users/${uid}`, () =>
      userProfileExists(uid),
    );
    await trackSync("write", `users/${uid}`, () =>
      saveUserProfile(input, !exists),
    );
  } catch {
    // trackSync already logged to syncLogStore + console.error.
  }
}
