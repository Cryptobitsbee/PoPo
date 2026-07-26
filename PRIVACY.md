# PoPo privacy notice

_Last updated: July 26, 2026_

This notice describes the current PoPo desktop application's technical behavior. It is intended to provide a clear global privacy baseline; it is not legal advice and does not claim that PoPo or a distributor complies with every law in every jurisdiction.

**Release requirement:** before distributing an official production build, the publisher must add its legal identity, country, and a dedicated private privacy-contact email here. Do not direct people to submit access or deletion requests in public GitHub issues.

A person or organization that builds PoPo from source with its own Firebase/GCP configuration is the operator of that build and must publish its own accurate notice.

## At a glance

- PoPo has no advertising SDK, product analytics, third-party crash reporter, or PoPo-operated transcription proxy.
- The microphone is used for an active dictation or test recording, not while idle.
- Speech audio goes directly from the app to the Google Cloud project configured by the user.
- Firebase sign-in and cloud sync are optional. Source builds should use the builder's own Firebase project.
- Raw WAV retention is off by default. If enabled, audio is stored locally and, while signed in, uploaded to the configured Firebase Storage bucket.
- Google AI Studio or Vertex AI receives transcript text and the selected formatting prompt only when AI formatting is enabled and configured.
- PoPo does not sell personal information or use it for targeted advertising.

## Data stored on the device

PoPo may keep:

- WebView local storage: preferences, modes and their prompts, snippets, dictionary phrases, app-icon images, GCP project/path metadata, and onboarding counters. The Gemini API key is expressly excluded from local storage.
- `%APPDATA%\ai.popo.desktop\gcp.json`: the selected service-account JSON **path**, GCP project ID, and language. PoPo does not copy the selected service-account JSON; the original remains where the user placed it.
- `%APPDATA%\ai.popo.desktop\gemini-api-key.dpapi`: the Gemini AI Studio key encrypted for the current Windows user with DPAPI. The key exists in process/WebView memory while needed for settings and requests.
- `%APPDATA%\ai.popo.desktop\audio\`: PCM WAV recordings only when **Store audio** is enabled.
- `%APPDATA%\popo\popo.log` and one rotated predecessor: bounded local operational diagnostics. Logs are designed not to include transcript/prompt text, access tokens, API keys, or service-account contents, but can include timing, error classes, app/mode identifiers, and feature state. Review and redact a log before sharing it.
- Clipboard contents needed to paste dictated text. Optional clipboard restoration can restore the previous clipboard after paste.
- Current session/history state in memory. PoPo currently does not implement the SQLite history store described in older planning documents.

Local app-icon discovery can inspect running/installed application names, window metadata, and executable paths to render pickers. Full executable paths are not written to release logs or synced to Firebase; selected app names and small icon images can be synced as described below.

## Data sent to service providers

### Google Cloud Speech-to-Text

During a dictation/test, PoPo sends audio, language/recognition settings, selected mode prompt where applicable, and dictionary adaptation phrases directly to Google Cloud Speech-to-Text using the service account selected by the user. Google returns transcript text. Billing and provider-side retention are controlled by that user's GCP project and Google's terms/settings.

### Gemini (optional)

When AI formatting is enabled:

- **Google AI Studio** receives the raw transcript and selected system/mode prompt using the DPAPI-protected API key; or
- **Vertex AI** receives the same content using the configured GCP service account and project.

If Gemini is disabled, unconfigured, or fails, PoPo uses the Speech-to-Text result without that Gemini request.

### Firebase Authentication and sync (optional)

Signing in sends normal Google/Firebase authentication data to Google. PoPo's Firestore profile contains the Firebase UID and may contain Google account email, display name, profile-photo URL, and first/last-seen timestamps.

While signed in, the configured Firebase project can store:

- sessions: timestamps, duration, language, word count, raw/formatted transcript, estimated GCP cost, selected mode/app name, snippet-expansion records, and an owner-scoped cloud-audio object path;
- modes and prompts, snippets and their replacement text, dictionary phrases, preferences, and app names/icons;
- a short-lived diagnostic ping when the user explicitly tests Firestore;
- WAV files at `audio/{uid}/{sessionId}.wav` only when **Store audio** is enabled.

PoPo does not put the GCP service-account JSON/path, Gemini API key, or new long-lived Firebase Storage download URLs in Firestore. Privacy mode prevents new session sync; settings and modes can still sync. Data synced before privacy mode was enabled remains until deleted.

Firebase Security Rules restrict these records to the authenticated UID and validate bounded schemas. Rules reduce accidental/cross-user access but are not a substitute for publisher-side quotas, monitoring, API restrictions, or credential security.

## Purposes

Data is processed only to provide dictation, formatting, paste, history/playback, preferences, optional cross-device sync, authentication, security, and user-requested diagnostics. PoPo does not use the data for ads, profiling, model training by PoPo, or sale. Google services process data under the terms and settings applicable to the configured Google/Firebase projects.

## Retention and deletion

- In-memory records last until replaced or the app exits unless synced.
- Local settings and optional WAVs remain until the user resets/deletes them or removes app data during uninstall.
- Local diagnostics rotate at approximately 5 MiB and retain at most the active file plus one predecessor.
- Firebase records remain until individually deleted, **Delete all my data** succeeds, or the relevant Firebase operator removes them.
- Provider-side logs, billing records, backups, and abuse/security records are governed by Google and the project owner's retention configuration; PoPo cannot erase those directly.

**Delete all my data** first removes all known user Firestore collections and the profile, recursively deletes `audio/{uid}/`, clears local WAVs/config metadata/the DPAPI key/browser records, deletes the Firebase Auth user, and schedules local diagnostic logs for guaranteed removal before the next launch. The external service-account JSON selected by the user is not owned by PoPo and is not deleted.

Deletion can be partially complete if the network fails or Firebase requires recent authentication. The operation is idempotent: sign in/re-authenticate if required and retry. Uninstalling alone does not delete Firebase or Google Cloud data.

Users can edit settings, modes, snippets, and dictionary entries in the app, delete sessions individually, export history to a user-approved `.json` or `.txt` path, or delete the account. A publisher that receives a privacy request must verify identity privately and handle any operator-controlled data that the app cannot expose.

## Security

PoPo uses TLS through Google SDKs/APIs; owner-scoped Firebase rules; OAuth authorization-code flow with PKCE, random state, and a loopback callback; Windows current-user DPAPI for the Gemini key; scoped Tauri capabilities/commands; and a restrictive Content Security Policy. No system can be guaranteed perfectly secure. Report vulnerabilities using [SECURITY.md](SECURITY.md), never a public issue.

## International processing and legal rights

Google may process data in multiple countries. The Firestore database ID/location and Google Cloud regions are chosen by the operator/project owner; source builders control their own deployment. Depending on location, people may have rights to access, correct, export, delete, restrict, or object to processing, and to complain to a regulator. The production publisher must provide a private contact and respond under laws that apply to that publisher.

## Children

PoPo is a general productivity tool and is not directed to children. A distributor must assess applicable age/consent requirements before offering it to minors or schools.

## Changes

Material behavior changes must update this notice, the data inventory, Firebase Rules, and deletion code together. The date above indicates the latest notice revision.
