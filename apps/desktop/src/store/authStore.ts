import { create } from "zustand";
import type { User } from "firebase/auth";

/**
 * authStore — mirror of Firebase auth state for the main window.
 *
 * Populated by the useAuth hook's onAuthStateChanged listener (installed
 * once at AppShell mount). Every page can read the current user via
 * this store without importing Firebase directly.
 *
 * Initial value: `status: "loading"` until Firebase reports the first
 * state change (either a cached user or null). After that:
 *   - `signed-in`: `user` is populated
 *   - `signed-out`: `user` is null
 *   - `unconfigured`: Firebase env vars are missing; feature is soft-off
 */

export type AuthStatus =
  | "loading"
  | "signed-in"
  | "signed-out"
  | "unconfigured";

interface AuthStore {
  status: AuthStatus;
  user: User | null;
  /** Last error from sign-in / sign-out, shown in the Account page. */
  error: string | null;

  setStatus: (status: AuthStatus) => void;
  setUser: (user: User | null) => void;
  setError: (error: string | null) => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  status: "loading",
  user: null,
  error: null,
  setStatus: (status) => set({ status }),
  setUser: (user) =>
    set({
      user,
      status: user ? "signed-in" : "signed-out",
    }),
  setError: (error) => set({ error }),
}));
