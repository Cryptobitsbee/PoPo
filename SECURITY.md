# Security policy

## Supported versions

PoPo is pre-1.0. Security fixes are applied to the latest release and the `main` branch. Older installers may not receive backports; upgrade to the newest signed release before reporting a problem that may already be fixed.

| Version | Supported |
| --- | --- |
| Latest 0.1.x release | Yes |
| Older builds | No guaranteed backports |

## Report a vulnerability privately

Do **not** open a public issue, discussion, or pull request for a vulnerability.

Use GitHub's private vulnerability reporting for this repository:

<https://github.com/Ganesh540-crypto/PoPo/security/advisories/new>

If private reporting is unavailable, contact the repository owner through the contact method published on the owner's GitHub profile. Do not send API keys, service-account JSON, access tokens, private audio, or real transcripts. Use synthetic examples and redact usernames and local paths.

Include, when available:

- the affected PoPo version and Windows version;
- impact and realistic attack prerequisites;
- minimal reproduction steps or a proof of concept using test data;
- whether the issue affects the official signed installer, source builds, or both;
- suggested remediation.

You should receive an acknowledgement within 7 days. Investigation and release timing depend on severity and maintainer availability; this is a coordination target, not a service-level guarantee. Please allow time for a fix and signed release before public disclosure.

## In scope

Examples include:

- OAuth state/PKCE or loopback-callback bypasses;
- Firebase Security Rules authorization failures;
- Tauri IPC, capability, CSP, path traversal, or arbitrary file access;
- disclosure or plaintext persistence of Gemini keys, OAuth tokens, service-account private keys, transcripts, or audio;
- installer/update/signing-chain compromise;
- dependency vulnerabilities with a reachable PoPo exploit path.

## Usually not a vulnerability

- Firebase web configuration values and desktop OAuth client IDs: these are public client identifiers, not secrets;
- warnings caused only by an unsigned locally built executable;
- attacks requiring a user to replace their own installed binary or source tree;
- denial of service against only the reporter's own account with no cross-user or production-cost impact;
- issues that apply only to React Server Components/server actions—PoPo is a static Vite/Tauri client and does not run either.

## Safe research

Use your own Firebase/GCP projects and synthetic data. Do not access another person's account, incur costs against PoPo's production project, degrade service, upload malware, or publish private data. The project currently offers no bug bounty.

## Security design notes

See [Open-source configuration](docs/OPEN_SOURCE_CONFIGURATION.md) and the [release security checklist](docs/RELEASE_SECURITY_CHECKLIST.md). Security Rules and client checks are defense in depth; production quotas, API restrictions, signed releases, and private repository-owner credentials remain operator responsibilities.
