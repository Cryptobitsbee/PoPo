// firebase.ts — single source of truth for Firebase client SDK init.
//
// Firebase is ONLY initialized in the main window webview per the
// brief's architecture. The pill webview never touches Firebase.
//
// Auth strategy (Session 17 final form):
//   - In browser: signInWithPopup (works fine in normal browser context).
//   - In Tauri WebView2: signInWithPopup and signInWithRedirect both
//     fail because the webview has a different cookie/storage context
//     than the redirect's target origin. The industry-standard fix for
//     desktop apps is:
//         1. Open system browser to Google OAuth URL with PKCE
//         2. Google redirects to http://127.0.0.1:<port>/?code=...
//         3. Rust loopback listener captures the code
//         4. Frontend exchanges code for ID token at Google's token
//            endpoint
//         5. `signInWithCredential(GoogleAuthProvider.credential(idToken))`
//     See `commands/oauth.rs` on the Rust side for the listener.

import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithCredential,
  signOut as fbSignOut,
  type Auth,
  type User,
} from "firebase/auth";
import { initializeFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

function readEnv(): FirebaseConfig | null {
  const cfg: FirebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "",
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "",
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? "",
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "",
    appId: import.meta.env.VITE_FIREBASE_APP_ID ?? "",
  };
  if (Object.values(cfg).some((value) => !value.trim())) return null;
  return cfg;
}

const config = readEnv();

export const firebaseApp: FirebaseApp | null = config
  ? initializeApp(config)
  : null;

export const auth: Auth | null = firebaseApp ? getAuth(firebaseApp) : null;

// IMPORTANT: the Firestore database in this project is a NAMED database
// ("popo-flow") rather than the default ("(default)"). The Firebase JS SDK
// defaults to (default) when no database id is passed, which would silently
// resolve to a non-existent database and cause every write to fail with
// NOT_FOUND. Always pass the explicit database id.
//
// Located at asia-south1 (Mumbai). Verified via:
//   gcloud firestore databases list --project=popo-flow
//
// If we ever migrate to (default) in a future project, change this back to
// `getFirestore(firebaseApp)`.
const FIRESTORE_DB_ID =
  import.meta.env.VITE_FIRESTORE_DATABASE_ID?.trim() || "popo-flow";

// Transport settings for Tauri WebView2:
//   Firestore's default transport ("WebChannel") uses long-lived Google-proprietary
//   HTTP streaming that frequently misbehaves inside Electron / Tauri webviews and
//   some corporate proxies. Writes get queued locally but never reach the server,
//   and there is NO visible error — they just hang forever.
//
//   `experimentalAutoDetectLongPolling: true` makes the SDK probe the network on
//   startup and fall back to plain HTTP long-polling if WebChannel fails. This is
//   the Firebase team's recommended setting for Electron / webview environments.
//
//   See: https://github.com/firebase/firebase-js-sdk/issues/1674
//        https://firebase.google.com/docs/reference/js/firestore_.firestoresettings
//
// `ignoreUndefinedProperties: true` — ADDED Session 33.
//   Without this, Firebase JS SDK throws synchronously on any field
//   whose value is `undefined` (refusing the whole `setDoc`). Our
//   shared types deliberately use `?: T` + `| undefined` on optional
//   fields (apps, language, iconBase64, etc.) which meant any write
//   with an unset optional field failed silently — the fire-and-forget
//   error handlers caught + logged via `trackSync` but the data never
//   reached the cloud. Symptom: mode.apps + pasteOverrides worked
//   locally but didn't sync across devices.
//
//   `ignoreUndefinedProperties: true` makes the SDK silently skip
//   undefined fields instead of throwing. Missing-field behaviour on
//   the server side is identical: Firestore docs never store the
//   `undefined` sentinel, only omitted fields.
export const db: Firestore | null = firebaseApp
  ? initializeFirestore(
      firebaseApp,
      {
        experimentalAutoDetectLongPolling: true,
        ignoreUndefinedProperties: true,
      },
      FIRESTORE_DB_ID,
    )
  : null;

/** Firebase Storage for cloud audio backup (audio/{uid}/{sessionId}.wav). */
export const storage: FirebaseStorage | null = firebaseApp
  ? getStorage(firebaseApp)
  : null;

/** True if Firebase env vars are present and init succeeded. */
export const isFirebaseConfigured = !!firebaseApp;

/** Detect whether we're running inside a Tauri webview vs a plain browser. */
export function isTauriContext(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "__TAURI_INTERNALS__" in window ||
    "__TAURI__" in window ||
    navigator.userAgent.includes("Tauri")
  );
}

// ─── Browser path: classic popup ────────────────────────────────────

async function signInWithPopupBrowser(): Promise<User> {
  if (!auth) throw new Error("Firebase not configured");
  const provider = new GoogleAuthProvider();
  provider.addScope("profile");
  provider.addScope("email");
  provider.setCustomParameters({ prompt: "select_account" });
  const result = await signInWithPopup(auth, provider);
  return result.user;
}

// ─── Tauri path: OAuth via system browser + loopback callback ──────
//
// Uses the OAuth 2.0 Authorization Code flow with PKCE (RFC 7636).
// The Desktop OAuth client ID comes from .env.local; it must be a
// "Desktop app" OAuth client created in Google Cloud Console.

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomBase64url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

function generatePkceVerifier(): string {
  return randomBase64url(64);
}

async function generatePkceChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return base64url(new Uint8Array(hash));
}

interface GoogleTokenResponse {
  access_token?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

/**
 * Convert Google's token response into stable, actionable UI copy.
 *
 * A `client_secret is missing` response means the configured client ID was
 * created as a Web application. Native desktop apps cannot keep a secret and
 * must instead use a Desktop app OAuth client with PKCE. Never "fix" this by
 * embedding the Web client's secret in Vite or the executable.
 */
export function describeGoogleTokenFailure(
  status: number,
  response: GoogleTokenResponse,
): string {
  const details = `${response.error ?? ""} ${response.error_description ?? ""}`
    .trim()
    .toLowerCase();

  if (details.includes("client_secret") && details.includes("missing")) {
    return (
      "This PoPo build is configured with a Google Web application OAuth " +
      "client. Replace VITE_GOOGLE_DESKTOP_CLIENT_ID with an OAuth client " +
      "created as Desktop app, then rebuild. Do not add a client secret."
    );
  }

  if (response.error === "invalid_grant") {
    return "Google sign-in expired or was already used. Please try again.";
  }

  if (response.error === "invalid_client") {
    return (
      "Google rejected this build's Desktop OAuth client ID. Check the " +
      "publisher OAuth configuration and rebuild PoPo."
    );
  }

  return `Google sign-in could not finish (token exchange ${status}). Please try again.`;
}

async function signInWithSystemBrowser(): Promise<User> {
  if (!auth) throw new Error("Firebase not configured");

  const clientId = import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_ID?.trim();
  if (!clientId) {
    throw new Error(
      "Desktop OAuth client ID missing. Add VITE_GOOGLE_DESKTOP_CLIENT_ID " +
        "to apps/desktop/.env.local (create one at console.cloud.google.com " +
        "→ APIs & Services → Credentials → Create OAuth client → Desktop app).",
    );
  }

  // 1. Generate independent PKCE and OAuth state values. PKCE binds the
  //    authorization code to this process; state prevents login CSRF and
  //    callback substitution. Rust also validates this state before it
  //    accepts a loopback request.
  const verifier = generatePkceVerifier();
  const challenge = await generatePkceChallenge(verifier);
  const expectedState = randomBase64url(32);

  // 2. Start a random-port loopback listener bound to the state nonce.
  const port = await invoke<number>("cmd_start_oauth_listener", {
    expectedState,
  });
  const redirectUri = `http://127.0.0.1:${port}`;

  // 3. Register the callback listener completely before opening the
  //    browser. The earlier implementation started registration but did
  //    not await it, leaving a small callback race.
  let resolveCallback!: (code: string) => void;
  let rejectCallback!: (error: Error) => void;
  const callbackPromise = new Promise<string>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });

  let timeoutId: number | undefined;
  const unlisten = await listen<string>("oauth:callback", (event) => {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    unlisten();

    const params = new URLSearchParams(event.payload);
    const returnedState = params.get("state");
    if (!returnedState || returnedState !== expectedState) {
      rejectCallback(new Error("OAuth state mismatch. Sign-in was cancelled."));
      return;
    }

    const error = params.get("error");
    const errorDescription = params.get("error_description");
    const code = params.get("code");
    if (error) {
      rejectCallback(new Error(errorDescription || `Google OAuth error: ${error}`));
    } else if (code) {
      resolveCallback(code);
    } else {
      rejectCallback(new Error("No authorization code received."));
    }
  });

  timeoutId = window.setTimeout(() => {
    unlisten();
    rejectCallback(new Error("Sign-in timed out after 3 minutes."));
  }, 180_000);

  // 4. Build the Google OAuth URL. Desktop OAuth client IDs are public
  //    identifiers; installed apps cannot keep a client secret. PKCE and
  //    state provide the proof and CSRF protections for this flow.
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", expectedState);
  authUrl.searchParams.set("prompt", "select_account");
  authUrl.searchParams.set("access_type", "online");

  // 5. Open only the validated Google authorization endpoint through
  //    the Rust command. If opening fails, tear down the pending listener.
  try {
    await invoke("cmd_open_oauth_url", { url: authUrl.toString() });
  } catch (error) {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    unlisten();
    throw error;
  }

  // 6. Wait for and validate the loopback callback.
  const code = await callbackPromise;

  // 7. Exchange the code. Google documents client_secret as optional for
  //    installed-app token exchange; embedding one would not make it secret.
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });

  const tokens = (await tokenResponse
    .json()
    .catch(() => ({}))) as GoogleTokenResponse;
  if (!tokenResponse.ok || tokens.error) {
    throw new Error(describeGoogleTokenFailure(tokenResponse.status, tokens));
  }
  if (!tokens.id_token) {
    throw new Error("Token response had no id_token");
  }

  // 8. Sign in to Firebase with the Google ID token. Firebase verifies
  //    it against Google's public keys and maps it to the Firebase user.
  const credential = GoogleAuthProvider.credential(
    tokens.id_token,
    tokens.access_token,
  );
  const userCred = await signInWithCredential(auth, credential);
  return userCred.user;
}

/**
 * Trigger Google Sign-In. Picks the right flow based on runtime:
 *   - Tauri WebView2 → system browser + loopback callback
 *   - Regular browser → signInWithPopup
 */
export async function signInWithGoogle(): Promise<User> {
  if (!auth) {
    throw new Error(
      "Firebase not configured. Add VITE_FIREBASE_* to .env.local and restart.",
    );
  }
  if (isTauriContext()) {
    return signInWithSystemBrowser();
  }
  return signInWithPopupBrowser();
}

/** Sign out the current user. */
export async function signOut(): Promise<void> {
  if (!auth) return;
  await fbSignOut(auth);
}
