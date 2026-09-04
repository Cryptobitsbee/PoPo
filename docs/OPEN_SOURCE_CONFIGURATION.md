# Open-source configuration

PoPo can run completely signed out. Firebase is required only for Google sign-in and cloud sync. Speech-to-Text/Gemini use credentials selected by each user at runtime and are separate from the build-time Firebase client configuration.

## Non-negotiable environment separation

- **Official signed releases:** use only the PoPo production Firebase project and publisher-owned desktop OAuth client.
- **Forks, local builds, CI previews, and pull requests:** use a builder-owned development Firebase/GCP project or leave Firebase variables blank.
- Never copy production `.env.local`, service-account JSON, Gemini keys, signing certificates, certificate passwords, or store credentials into a fork, issue, build artifact, or CI log.
- Do not publish source builds that point at PoPo production. Public Firebase configuration is not a secret, but unauthorized builds would consume production quotas and complicate incident response.

The app initializes Firebase only when **all** required `VITE_FIREBASE_*` values are present. With blank values, sign-in/sync are disabled and local dictation still works after runtime GCP setup.

## What is public and what is secret

Safe to embed as public/extractable client metadata:

- Firebase web `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, and `appId`;
- the Google OAuth **Desktop app** client ID;
- the Google-issued Desktop client `secret` when that registration requires it—the value is extractable from every distributed executable and is never treated as a security boundary;
- Firestore database ID.

Never embed or put in any `VITE_*` variable:

- a confidential Web/server OAuth client secret;
- GCP service-account JSON/private keys;
- Gemini/Google AI Studio API keys;
- Firebase Admin SDK credentials;
- Authenticode/Artifact Signing/Store credentials or PFX/P12 passwords.

Vite substitutes `VITE_*` into client JavaScript. Treat every such value as readable by anyone who has the executable.

## 1. Create an isolated Firebase project

Use a dedicated non-production project. Configure budgets/alerts even for development.

1. Create a Firebase project.
2. Add a **Web app** and copy its public configuration to `apps/desktop/.env.local` (or the environment used by Vite) using `.env.example`.
3. Enable **Authentication → Sign-in method → Google**.
4. Create Firestore. A normal contributor project should use `(default)` and set:
   ```env
   VITE_FIRESTORE_DATABASE_ID=(default)
   ```
5. Create Firebase Storage and copy the exact bucket name.
6. Update `firebase.json` for the builder-owned database/bucket before deploying rules. Do not commit production-resource substitutions from a private environment.
7. Deploy the checked-in rules to the builder-owned project:
   ```powershell
   firebase deploy --project YOUR_DEV_PROJECT --only firestore:rules
   firebase deploy --project YOUR_DEV_PROJECT --only storage
   ```

The production repository configuration currently names database `popo-flow` and bucket `popo-flow.firebasestorage.app`. Those names are not defaults for a fork.

## 2. Create the installed-app OAuth client

In the same Google Cloud/Firebase project:

1. Configure the OAuth consent screen/Google Auth Platform branding and test users as appropriate.
2. Create **OAuth client ID → Desktop app**.
3. Set the client ID and the Google-issued Desktop client credential from that same registration:
   ```env
   VITE_GOOGLE_DESKTOP_CLIENT_ID=123456789-example.apps.googleusercontent.com
   VITE_GOOGLE_DESKTOP_CLIENT_SECRET=desktop-client-credential
   ```
4. Do not confuse this with a confidential Web/server client secret. Vite embeds both Desktop values in the executable, so the Desktop credential is public client metadata; PKCE and state remain mandatory.

PoPo uses the system browser, a random `127.0.0.1` port, OAuth state, and PKCE S256. The loopback redirect is generated at runtime. Production publishing/verification requirements in Google Cloud remain the operator's responsibility.

## 3. Fill the public build configuration

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=YOUR_PROJECT.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=YOUR_PROJECT
VITE_FIREBASE_STORAGE_BUCKET=YOUR_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIRESTORE_DATABASE_ID=(default)
VITE_GOOGLE_DESKTOP_CLIENT_ID=....apps.googleusercontent.com
VITE_GOOGLE_DESKTOP_CLIENT_SECRET=...
```

Then validate:

```powershell
pnpm install --frozen-lockfile
pnpm --filter desktop typecheck
pnpm --filter desktop build
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
```

`.env.local` is ignored. Never commit it or print either Desktop OAuth value in build/test logs. The Google-issued Desktop credential is still extractable from a distributed Vite bundle and must not be relied on for confidentiality or authorization.

## 4. Deploy and test rules before enabling users

The checked-in rules provide UID ownership, schema/size bounds, owner-scoped audio paths, WAV MIME/size checks, and default deny. Rules must be deployed explicitly; changing repository files does not change Firebase.

Whenever a user subcollection is added, update these together:

- `firestore.rules`;
- `apps/desktop/src/lib/cloudDeletion.ts`;
- `PRIVACY.md` and relevant tests.

Firestore clients cannot enumerate arbitrary subcollections, so omission from deletion code causes incomplete account erasure.

Use the Emulator Suite and disposable accounts to test owner allowed/cross-owner denied, invalid schemas, oversized audio, recursive cloud deletion, and recent-login behavior for Auth deletion. Never test destructive flows on a real user's account.

## 5. Restrict abuse and cost

Firebase client configuration does not authorize data access. Security comes from Authentication, Rules, quotas, API restrictions, and monitoring.

For each environment:

- restrict the Firebase web API key to the Firebase APIs actually used, then smoke-test sign-in, token refresh, Firestore, and Storage;
- configure Google Cloud budgets/alerts and practical service quotas;
- monitor Authentication creation rate, Firestore operations/storage, and Storage bandwidth/object growth;
- use separate projects for development/staging/production;
- disable unused APIs and remove stale OAuth clients/API keys;
- enable GitHub secret scanning/private vulnerability reporting and review Dependabot/CodeQL/audit results.

Desktop Firebase App Check is not equivalent to web/mobile built-in attestation. A defensible custom provider requires a backend and meaningful device/app attestation. A static attestation secret embedded in an open-source executable is not a security boundary. PoPo therefore does not pretend that an embedded secret protects production; production must rely on Rules, monitoring, quotas, and distribution trust unless a real attestation backend is added.

## 6. Runtime GCP and Gemini credentials

Speech-to-Text/Vertex setup happens inside Settings:

- PoPo stores only the selected service-account source **path**, project ID, and language in `%APPDATA%\ai.popo.desktop\gcp.json`.
- The external JSON remains authoritative and is never copied or deleted by PoPo.
- Grant the service account only required roles (normally Speech client; add Vertex AI user only when Vertex is used). Avoid Owner/Editor.
- Prefer a dedicated project/service account, budgets, restricted quotas, key rotation, and immediate revocation after suspected exposure.
- The AI Studio key is persisted only in `%APPDATA%\ai.popo.desktop\gemini-api-key.dpapi`, encrypted to the current Windows user through DPAPI. It is never placed in local storage, Firestore, or build variables.

A service-account JSON is a long-lived private key. Keep it outside the repository, restrict file permissions, never attach it to bug reports, and delete/revoke it in Google Cloud when no longer needed.

## Official-release operator checklist

Before producing an official executable:

- build only from a reviewed clean revision in a protected release environment;
- inject public production identifiers from controlled CI configuration, not contributor files;
- deploy and test current Firebase Rules;
- confirm API restrictions, quotas, billing alerts, authorized OAuth consent configuration, and deletion behavior;
- run the checks in `docs/RELEASE_SECURITY_CHECKLIST.md`;
- sign and timestamp every distributed binary/installer under the publisher identity.
