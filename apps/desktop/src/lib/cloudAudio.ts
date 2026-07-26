import { getDownloadURL, ref } from "firebase/storage";
import type { Session } from "@popo/shared-types";
import { storage } from "./firebase";

/**
 * Resolve cloud audio only when playback is requested.
 *
 * New sessions persist an object path, not a long-lived bearer URL. The
 * Firebase SDK checks the signed-in user's Storage rules before issuing the
 * temporary in-memory download URL. Existing sessions keep working through
 * the legacy URL fallback until they are deleted.
 */
export async function resolveCloudAudioUrl(
  session: Session,
): Promise<string | null> {
  if (session.audioCloudPath) {
    if (!storage) return null;
    return getDownloadURL(ref(storage, session.audioCloudPath));
  }
  return session.audioDownloadUrl ?? null;
}
