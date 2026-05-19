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
import { getAnalytics, type Analytics } from "firebase/analytics";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
}

function readEnv(): FirebaseConfig | null {
  const cfg: FirebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "",
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "",
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? "",
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "",
    appId: import.meta.env.VITE_FIREBASE_APP_ID ?? "",
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID ?? undefined,
  };
  if (!cfg.apiKey || !cfg.projectId) return null;
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
const FIRESTORE_DB_ID = "popo-flow";

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

export const analytics: Analytics | null =
  firebaseApp && config?.measurementId ? getAnalytics(firebaseApp) : null;

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

function generatePkceVerifier(): string {
  const arr = new Uint8Array(64);
  crypto.getRandomValues(arr);
  return base64url(arr);
}

async function generatePkceChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return base64url(new Uint8Array(hash));
}

async function signInWithSystemBrowser(): Promise<User> {
  if (!auth) throw new Error("Firebase not configured");

  const clientId = import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_ID;
  const clientSecret = import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_SECRET;
  if (!clientId) {
    throw new Error(
      "Desktop OAuth client ID missing. Add VITE_GOOGLE_DESKTOP_CLIENT_ID " +
        "to apps/desktop/.env.local (create one at console.cloud.google.com " +
        "→ APIs & Services → Credentials → Create OAuth client → Desktop app).",
    );
  }
  if (!clientSecret) {
    throw new Error(
      "Desktop OAuth client secret missing. Add " +
        "VITE_GOOGLE_DESKTOP_CLIENT_SECRET to apps/desktop/.env.local. " +
        "It's shown next to the client ID in Google Cloud Console.",
    );
  }

  // 1. Start the loopback listener in Rust.
  const port = await invoke<number>("cmd_start_oauth_listener");
  const redirectUri = `http://127.0.0.1:${port}`;

  // 2. Generate PKCE verifier + challenge.
  const verifier = generatePkceVerifier();
  const challenge = await generatePkceChallenge(verifier);

  // 3. Start listening for the callback event BEFORE opening the
  //    browser — avoids a race where the callback arrives first.
  const callbackPromise = new Promise<string>((resolve, reject) => {
    let unlistenFn: (() => void) | null = null;
    const timer = window.setTimeout(() => {
      unlistenFn?.();
      reject(new Error("Sign-in timed out after 3 minutes."));
    }, 180_000);

    listen<string>("oauth:callback", (event) => {
      window.clearTimeout(timer);
      unlistenFn?.();
      const params = new URLSearchParams(event.payload);
      const error = params.get("error");
      const code = params.get("code");
      if (error) {
        reject(new Error(`Google OAuth error: ${error}`));
      } else if (code) {
        resolve(code);
      } else {
        reject(new Error("No authorization code received."));
      }
    })
      .then((fn) => {
        unlistenFn = fn;
      })
      .catch((e) => {
        window.clearTimeout(timer);
        reject(e);
      });
  });

  // 4. Build the Google OAuth URL.
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("prompt", "select_account");
  authUrl.searchParams.set("access_type", "online");

  // 5. Open the system browser via a Rust command (OpenerExt). This
  //    bypasses the JS-layer `opener:allow-open-url` capability scope
  //    that was blocking Google's OAuth URL with the error
  //    "Not allowed to open url". Rust-side opener calls are
  //    trusted code and don't go through the capability system.
  await invoke("cmd_open_oauth_url", { url: authUrl.toString() });

  // 6. Wait for the callback.
  const code = await callbackPromise;

  // 7. Exchange code for tokens at Google's token endpoint.
  //    As of Sep 2022, Google requires client_secret for Desktop
  //    OAuth clients even when using PKCE. This "secret" is embedded
  //    in desktop apps by design — PKCE is the real proof of identity.
  //    See https://developers.google.com/identity/protocols/oauth2/native-app
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenResponse.ok) {
    const errBody = await tokenResponse.text();
    throw new Error(
      `Token exchange failed (${tokenResponse.status}): ${errBody}`,
    );
  }

  const tokens: {
    access_token?: string;
    id_token?: string;
    error?: string;
    error_description?: string;
  } = await tokenResponse.json();

  if (tokens.error) {
    throw new Error(tokens.error_description ?? tokens.error);
  }
  if (!tokens.id_token) {
    throw new Error("Token response had no id_token");
  }

  // 8. Sign in to Firebase with the Google ID token. Firebase verifies
  //    it against Google's public keys and matches the email to an
  //    existing user (or creates one).
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
