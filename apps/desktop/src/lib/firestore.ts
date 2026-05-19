// lib/firestore.ts — typed Firestore collection references.
//
// IMPORTANT — named database, NOT (default):
//   The popo-flow project's Firestore is a NAMED database called
//   "popo-flow" at asia-south1, not the default. `lib/firebase.ts`
//   initializes `db` via `getFirestore(firebaseApp, "popo-flow")`.
//   If that id is ever wrong, every call here silently resolves to
//   a non-existent database and writes fail with NOT_FOUND.
//
// Firestore schema:
//   users/
//     {uid}/
//       sessions/
//         {sessionId} — one per dictation
//       modes/
//         {modeId} — user's custom + default modes
//       settings/
//         doc — single document with Settings shape
//       gcp/
//         doc — GCP config (no service-account JSON, only path + projectId)
//
// Location: asia-south1 (Mumbai) — closest to the user's region (India).
// All writes go through the JS SDK's gRPC channel which auto-routes.
//
// Security rules live at `/firestore.rules` at the project root and are
// deployed via `firebase deploy --project popo-flow --only firestore:rules`.
// The rule-set allows read/write only when request.auth.uid == userId.

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  onSnapshot,
  orderBy,
  query,
  limit,
  serverTimestamp,
  type CollectionReference,
  type DocumentData,
  type Query,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";
import type {
  Session,
  Mode,
  Settings,
  GCPSettings,
  Snippet,
  DictionaryEntry,
} from "@popo/shared-types";

// ─── Collection helpers ──────────────────────────────────────

/** Reference to the sessions sub-collection for a given user. */
function sessionsCol(uid: string): CollectionReference<DocumentData> {
  if (!db) throw new Error("Firestore not initialized");
  return collection(db, "users", uid, "sessions");
}

function modesCol(uid: string): CollectionReference<DocumentData> {
  if (!db) throw new Error("Firestore not initialized");
  return collection(db, "users", uid, "modes");
}

function settingsDoc(uid: string) {
  if (!db) throw new Error("Firestore not initialized");
  return doc(db, "users", uid, "settings", "doc");
}

// ─── Sessions ───────────────────────────────────────────────

/** Persist a single dictation session. Overwrites if id already exists. */
export async function saveSession(
  uid: string,
  session: Session,
): Promise<void> {
  if (!db) return;
  // Strip `appIcon` before writing. Icons are stored once per app in
  // the `users/{uid}/appIcons` collection to avoid duplicating the
  // same ~5 KB PNG on every session doc. `appName` stays on the
  // session so the dedup key survives cross-device sync; the icon
  // itself is resolved at render time from `appIconsStore`.
  const { appIcon: _appIcon, ...sessionWithoutIcon } = session;
  const ref = doc(sessionsCol(uid), session.id);
  await setDoc(ref, {
    ...sessionWithoutIcon,
    // serverTimestamp is a sentinel value that Firestore resolves to
    // the actual server timestamp — avoids client clock drift.
    _serverCreatedAt: serverTimestamp(),
  });
}

/**
 * Load the most recent `n` sessions for a user.
 * Returns them newest-first, matching the History page display order.
 */
export async function loadSessions(uid: string, n = 200): Promise<Session[]> {
  if (!db) return [];
  const q = query(sessionsCol(uid), orderBy("createdAt", "desc"), limit(n));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Session);
}

/**
 * Subscribe to session updates in real-time. Fires immediately with the
 * current list, then on every remote change. Returns an unsubscribe fn.
 */
export function subscribeToSessions(
  uid: string,
  onUpdate: (sessions: Session[]) => void,
): Unsubscribe {
  if (!db) return () => {};
  const q: Query<DocumentData> = query(
    sessionsCol(uid),
    orderBy("createdAt", "desc"),
    limit(200),
  );
  return onSnapshot(q, (snap) => {
    const sessions = snap.docs.map((d) => d.data() as Session);
    onUpdate(sessions);
  });
}

/** Delete a session. Mirrors the local delete in historyStore. */
export async function deleteSession(uid: string, id: string): Promise<void> {
  if (!db) return;
  await deleteDoc(doc(sessionsCol(uid), id));
}

// ─── App icons ──────────────────────────────────────────
//
// One document per unique app the user has dictated into. Keyed by
// the app's display name ("Chrome", "VS Code"), which Rust resolves
// from the foreground window's process image path. Body:
//   { name: string, iconBase64: string, lastSeenAt: server timestamp }
//
// Session docs carry `appName` only; the icon is joined at render
// time via appIconsStore. This dedups ~2–5 KB of PNG data per dictation
// into a one-time cost per app.

function appIconsCol(uid: string): CollectionReference<DocumentData> {
  if (!db) throw new Error("Firestore not initialized");
  return collection(db, "users", uid, "appIcons");
}

/** Upsert the icon for a given app name. Safe to call repeatedly; a
 *  `merge: true` setDoc keeps the `firstSeenAt` field intact if present. */
export async function saveAppIcon(
  uid: string,
  name: string,
  iconBase64: string,
): Promise<void> {
  if (!db) return;
  if (!name || !iconBase64) return;
  // Sanitize the doc id: Firestore rejects `/` and `.` in path
  // segments. App names we generate are already safe but a defensive
  // replace covers edge cases (weird exe names, future localisations).
  const id = name.replace(/[./\[\]#]/g, "_");
  await setDoc(
    doc(appIconsCol(uid), id),
    {
      name,
      iconBase64,
      lastSeenAt: serverTimestamp(),
    },
    { merge: true },
  );
}

/** Subscribe to the full appIcons collection. Fires with the whole
 *  map on every change so the caller can `setAll()` in one go. */
export function subscribeToAppIcons(
  uid: string,
  onUpdate: (iconsByName: Record<string, string>) => void,
): Unsubscribe {
  if (!db) return () => {};
  return onSnapshot(appIconsCol(uid), (snap) => {
    const map: Record<string, string> = {};
    for (const d of snap.docs) {
      const data = d.data() as { name?: string; iconBase64?: string };
      if (data.name && data.iconBase64) {
        map[data.name] = data.iconBase64;
      }
    }
    onUpdate(map);
  });
}

/** Remove the icon doc for a given app. Called when the LAST session
 *  using this app is deleted — prevents orphaned icons from sitting
 *  in Firestore forever. Sessions for the same app that still exist
 *  keep their row rendering because the in-memory fallback on
 *  `session.appIcon` takes over once the store entry is gone. */
export async function deleteAppIcon(uid: string, name: string): Promise<void> {
  if (!db) return;
  if (!name) return;
  const id = name.replace(/[./\[\]#]/g, "_");
  await deleteDoc(doc(appIconsCol(uid), id));
}

// ─── Snippets ────────────────────────────────────────
//
// User-defined text-expansion shortcuts. Post-dictation Rust scans
// the transcript for snippet triggers and substitutes their values
// before paste. See snippetsStore + hotkey::expand_snippets.

function snippetsCol(uid: string): CollectionReference<DocumentData> {
  if (!db) throw new Error("Firestore not initialized");
  return collection(db, "users", uid, "snippets");
}

export async function saveSnippet(
  uid: string,
  snippet: Snippet,
): Promise<void> {
  if (!db) return;
  await setDoc(doc(snippetsCol(uid), snippet.id), snippet);
}

export async function deleteSnippet(uid: string, id: string): Promise<void> {
  if (!db) return;
  await deleteDoc(doc(snippetsCol(uid), id));
}

export function subscribeToSnippets(
  uid: string,
  onUpdate: (snippets: Snippet[]) => void,
): Unsubscribe {
  if (!db) return () => {};
  return onSnapshot(snippetsCol(uid), (snap) => {
    const items = snap.docs.map((d) => d.data() as Snippet);
    onUpdate(items);
  });
}

// ─── Dictionary ───────────────────────────────────────
//
// Phrase hints biased into Chirp 3's speech-adaptation layer. See
// dictionaryStore + gcp::streaming::start (adaptation param).

function dictionaryCol(uid: string): CollectionReference<DocumentData> {
  if (!db) throw new Error("Firestore not initialized");
  return collection(db, "users", uid, "dictionary");
}

export async function saveDictionaryEntry(
  uid: string,
  entry: DictionaryEntry,
): Promise<void> {
  if (!db) return;
  await setDoc(doc(dictionaryCol(uid), entry.id), entry);
}

export async function deleteDictionaryEntry(
  uid: string,
  id: string,
): Promise<void> {
  if (!db) return;
  await deleteDoc(doc(dictionaryCol(uid), id));
}

export function subscribeToDictionary(
  uid: string,
  onUpdate: (entries: DictionaryEntry[]) => void,
): Unsubscribe {
  if (!db) return () => {};
  return onSnapshot(dictionaryCol(uid), (snap) => {
    const items = snap.docs.map((d) => d.data() as DictionaryEntry);
    onUpdate(items);
  });
}

// ─── Modes ──────────────────────────────────────────────────────

/** Upsert a mode document. */
export async function saveMode(uid: string, mode: Mode): Promise<void> {
  if (!db) return;
  await setDoc(doc(modesCol(uid), mode.id), mode);
}

/** Load all modes for a user. */
export async function loadModes(uid: string): Promise<Mode[]> {
  if (!db) return [];
  const snap = await getDocs(modesCol(uid));
  return snap.docs.map((d) => d.data() as Mode);
}

/** Delete a mode. */
export async function deleteMode(uid: string, id: string): Promise<void> {
  if (!db) return;
  await deleteDoc(doc(modesCol(uid), id));
}

// ─── Settings ───────────────────────────────────────────────

/** Persist user settings. Merges with existing doc (partial updates ok). */
export async function saveSettings(
  uid: string,
  settings: Partial<Settings & { gcp: Partial<GCPSettings> }>,
): Promise<void> {
  if (!db) return;
  await setDoc(settingsDoc(uid), settings, { merge: true });
}

/** Load settings doc. Returns null if not yet written. */
export async function loadSettings(
  uid: string,
): Promise<(Settings & { gcp?: GCPSettings }) | null> {
  if (!db) return null;
  const snap = await getDoc(settingsDoc(uid));
  return snap.exists()
    ? (snap.data() as Settings & { gcp?: GCPSettings })
    : null;
}

// ─── User profile ────────────────────────────────

/**
 * Minimal shape of the public User object we care about.
 * Matches firebase/auth's User but decoupled so callers don't need
 * to pass the full User class around.
 */
interface UserProfileInput {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

/**
 * Upsert the user's profile document at `users/{uid}`.
 *
 * Two reasons this exists:
 *   1. Store useful metadata (email / name / photo / timestamps).
 *   2. Promote `users/{uid}` from a ghost/implicit parent doc to a
 *      real doc. Ghost parents are inconsistently rendered by the
 *      Firebase Console Data viewer — it often shows
 *      "This collection has no documents" even when subcollections
 *      are full. Writing real fields here fixes the console display
 *      so you can see your modes/sessions/settings collections
 *      normally instead of having to navigate via direct URL.
 *
 * Uses `merge: true` so subsequent sign-ins update `lastSeenAt` (and
 * refresh email / displayName / photoURL if they changed on Google's
 * side) without clobbering anything else. `firstSeenAt` is only
 * written when the caller sets `isFirstSeen = true`.
 */
export async function saveUserProfile(
  user: UserProfileInput,
  isFirstSeen: boolean,
): Promise<void> {
  if (!db) return;
  const profile: Record<string, unknown> = {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
    lastSeenAt: serverTimestamp(),
  };
  if (isFirstSeen) {
    profile.firstSeenAt = serverTimestamp();
  }
  await setDoc(doc(db, "users", user.uid), profile, { merge: true });
}

/**
 * Check whether the user profile doc already exists at `users/{uid}`.
 * Used to decide whether to set `firstSeenAt` on the next save.
 */
export async function userProfileExists(uid: string): Promise<boolean> {
  if (!db) return false;
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists();
}
