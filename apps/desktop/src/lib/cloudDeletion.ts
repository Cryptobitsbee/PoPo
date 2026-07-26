import {
  collection,
  doc,
  getDocs,
  writeBatch,
  type DocumentReference,
} from "firebase/firestore";
import { deleteObject, listAll, ref, type StorageReference } from "firebase/storage";
import { db, storage } from "./firebase";

/**
 * Every Firestore subcollection currently written by PoPo.
 *
 * Firestore's client SDK cannot enumerate arbitrary subcollections, so any
 * future user-owned collection must be added here and to firestore.rules.
 */
const USER_SUBCOLLECTIONS = [
  "sessions",
  "modes",
  "snippets",
  "dictionary",
  "appIcons",
  "settings",
  "_diagnostics",
] as const;

const MAX_BATCH_WRITES = 450;
const SAFE_SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;

async function deleteDocumentRefs(refs: DocumentReference[]): Promise<void> {
  if (!db) throw new Error("Firestore not initialized");

  for (let offset = 0; offset < refs.length; offset += MAX_BATCH_WRITES) {
    const batch = writeBatch(db);
    for (const documentRef of refs.slice(offset, offset + MAX_BATCH_WRITES)) {
      batch.delete(documentRef);
    }
    await batch.commit();
  }
}

async function deleteStorageTree(root: StorageReference): Promise<void> {
  const listing = await listAll(root);
  await Promise.all(listing.items.map((item) => deleteObject(item)));
  for (const prefix of listing.prefixes) {
    await deleteStorageTree(prefix);
  }
}

/** Delete one session's cloud WAV without persisting a bearer download URL. */
export async function deleteCloudAudio(
  uid: string,
  sessionId: string,
): Promise<void> {
  if (!storage) return;
  if (!SAFE_SESSION_ID.test(sessionId)) {
    throw new Error("Refusing to delete audio for an invalid session ID.");
  }

  try {
    await deleteObject(ref(storage, `audio/${uid}/${sessionId}.wav`));
  } catch (error) {
    // Deletion is idempotent: a missing object already satisfies the request.
    const code = (error as { code?: string } | null)?.code;
    if (code !== "storage/object-not-found") throw error;
  }
}

/**
 * Delete every cloud object represented by the current PoPo schema.
 *
 * This must run while the Firebase user is still authenticated. The caller
 * deletes the Firebase Auth account only after this resolves successfully.
 */
export async function deleteAllCloudUserData(uid: string): Promise<void> {
  if (!db) throw new Error("Firestore not initialized");
  if (!storage) throw new Error("Firebase Storage not initialized");

  const documentRefs: DocumentReference[] = [];
  for (const name of USER_SUBCOLLECTIONS) {
    const snapshot = await getDocs(collection(db, "users", uid, name));
    for (const documentSnapshot of snapshot.docs) {
      documentRefs.push(documentSnapshot.ref);
    }
  }

  await Promise.all([
    deleteDocumentRefs(documentRefs),
    deleteStorageTree(ref(storage, `audio/${uid}`)),
  ]);

  // Firestore does not cascade parent-document deletion. Delete the profile
  // only after every known subcollection document has been removed.
  await deleteDocumentRefs([doc(db, "users", uid)]);
}
