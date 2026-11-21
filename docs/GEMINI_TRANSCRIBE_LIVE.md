# GEMINI_TRANSCRIBE_LIVE.md — STT engine reference + Chirp 3 migration spec

> **Status**: Spec approved, implementation not started.
> **Supersedes**: `docs/CHIRP_3_TRANSCRIPTION.md` and
> `docs/GOOGLE_SPEECH_V2_API.md`. Both remain in the repo as historical
> record until this migration lands, then are marked superseded.
> **Owner decisions recorded**: full Chirp removal with no fallback
> engine; Preview/Experimental launch stage accepted; Tamil loss
> accepted; session resumption stays off.

This document is both the engine reference for PoPo's speech-to-text
layer and the migration playbook that replaces Google Chirp 3
(Speech-to-Text v2 over tonic gRPC) with `gemini-3.5-transcribe-live`
on Vertex AI / Gemini Enterprise Agent Platform.

---

## 1. Why

Google's own comparison of Gemini 3.5 Transcribe against Chirp 3:
roughly 70% faster from voice to final transcribed text, live-speech
word error rate down to 5.5% (2.6% for the batch endpoint). Beyond raw
accuracy, four things matter specifically for PoPo:

- **`mode: "SMART"` performs the cleanup our Auto mode currently pays a
  whole Gemini round trip for.** Disfluency removal, inline
  self-correction resolution, punctuation/casing, and list/number/date
  formatting all happen inside the transcription pass.
- **Manual VAD maps exactly onto push-to-talk.** `activityStart` /
  `activityEnd` with `automaticActivityDetection.disabled: true` is
  documented as the push-to-talk case; it replaces our RMS heuristics
  for turn boundaries.
- **`custom_vocabulary` works alongside auto-detect.** Chirp 3 required
  a concrete language for `PhraseSet` adaptation, which is why
  `build_speech_adaptation` silently drops the entire user Dictionary
  whenever language is `auto` (Session 31). That limitation disappears.
- **The gRPC stack goes away.** `tonic`, `tonic-prost`, `prost`,
  `prost-types`, and `googleapis-tonic-google-cloud-speech-v2` are
  replaced by one WebSocket plus `serde_json`.

Cost drops from Chirp's `$0.016/min` to roughly `$0.009/min` blended,
and the common Auto-mode path loses an entire network hop.

---

## 2. Model, endpoint, and credentials

### 2.1 Vertex model IDs differ from AI Studio

| Surface | Streaming model ID | Batch model ID |
| --- | --- | --- |
| AI Studio | `gemini-3.5-transcribe-live` | `gemini-3.5-transcribe` |
| **Vertex / Agent Platform** | **`gemini-3.5-transcribe-live-preview`** | `gemini-3.5-transcribe-preview` |

PoPo uses Vertex, therefore the `-preview` suffix is **required**.
Using the AI Studio ID against the Vertex endpoint is the same class of
mistake as Session 59's `us-central1` 404.

### 2.2 Location is `global`, and only `global`

The Agent Platform regional-availability table lists exactly one
location for both endpoints, with "single-region and multi-region
support coming soon". There is no `us`, no `eu`, no `asia-south1`.

- Hardcode `global` in a `STT_LOCATION` constant.
- Do **not** add an STT region field to `GCPSettings`.
- Do **not** reuse `gemini.rs`'s `normalize_vertex_location`. That
  function governs Gemini 3.5 Flash-Lite, which genuinely supports
  `global` / `us` / `eu`. Conflating the two is a live footgun.

### 2.3 Endpoint and auth

```
wss://aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent
Authorization: Bearer {oauth_token}
```

Host is `{LOCATION}-aiplatform.googleapis.com` for regional locations;
`global` uses the bare `aiplatform.googleapis.com` host, matching the
convention already implemented in `gemini.rs::GeminiBackend::endpoint`.

Credentials are unchanged: the existing user-selected service-account
JSON, via `gcp::auth::Authenticator`. `SCOPE` is already
`https://www.googleapis.com/auth/cloud-platform`, which covers
`aiplatform.googleapis.com`. The Session 58 invariant holds — every
token use must first verify the configured path is still a regular
file, so deleting the JSON fails closed.

No API key. No new secret. No DPAPI change.

### 2.4 Launch stage

Model is **Preview**. Per-feature stages: language auto-detection
Preview, custom vocabulary Preview, utterance timestamps Preview,
**Smart Dictation & Formatting Experimental**, speaker diarization
Experimental.

Accepted knowingly. Tier 2 (below) rests on an Experimental feature and
may change without a deprecation window. `RELEASE_SECURITY_CHECKLIST.md`
gets a line recording that the core dictation path runs on a Preview
model.

Ignore two stale rows on the Vertex model page: it claims "Gemini Live
API: Not supported" and marks all four consumption options unsupported,
while the same page documents `BidiGenerateContent` streaming and the
Live API overview lists the model explicitly. The how-to sections are
authoritative.

---

## 3. The three-tier routing rule

Auto-format remains the strict master switch (Session 58). The tier is
decided by two bits PoPo already has — no new `Mode` field, no ID
special-casing in Rust.

| `auto_format_enabled` | resolved prompt | Transcribe `mode` | Flash-Lite polish |
| --- | --- | --- | --- |
| off | (returns empty early) | `VERBATIM` | no |
| on | empty | `SMART` | no |
| on | non-empty | `VERBATIM` | yes |

`resolve_effective_prompt` already returns `(String, Option<(id, name)>)`
and already gates on `auto_format_enabled` first, so it needs only a
small extension to report the resolved tier.

**Tier 1** is a literal transcript: filler words, stutters, false
starts, and profanity all preserved. Chirp 3 never had a profanity
filter (Session 28 removed those flags as unsupported), so nothing is
lost.

**Tier 2** is Auto mode. `mode-auto`'s `systemPrompt` becomes `""`, so
it reaches tier 2 structurally rather than by name. This also gives
correct behaviour for two edge cases the old design would have
mishandled: a user who deletes the Auto mode, and a user who creates a
custom mode with a blank prompt. Both land on SMART, which is the
sensible outcome.

**Tier 3** feeds `VERBATIM` — not `SMART` — into Flash-Lite. SEED_MODES
v10 prompts are written against unedited speech; their FORBIDDEN lists
assume raw input. Pre-formatting with SMART would put two formatting
layers in conflict.

### 3.1 What this deletes

The current three-branch Auto-format behaviour collapses. Today:
`autoFormat` ON + Gemini key → Gemini polish; ON + no key → Chirp
`custom_prompt_config` biasing; OFF → raw. That middle branch was
always the weak one, since Chirp *biases* rather than *rewrites* and
cannot collapse self-corrections at all (Session 34). It becomes SMART,
which genuinely does that work. `custom_prompt_config` and the dynamic
three-branch Settings description both go away.

---

## 4. Socket lifecycle

### 4.1 `setup_complete` is a hard gate

> Clients must wait to receive the `setup_complete` message from the
> server before streaming audio data. Sending audio requests before
> `setup_complete` is received can cause the session to cancel
> unexpectedly and may result in empty transcriptions, particularly on
> short audio clips.

PoPo dictations are short. This **inverts** Session 27's architecture,
where we deliberately did not await stream open because Chirp's
`streaming_recognize()` blocked ~12s on response headers. Under the
Live API, a warm pre-opened socket is mandatory, not an optimization.

### 4.2 Setup parameters are immutable, which forces a config fingerprint

The Vertex session guide notes that apart from system instructions, the
model and other setup parameters are immutable once the setup message
is processed. Everything PoPo varies per dictation lives in `setup`:
`mode`, `languageCodes`, and `customVocabulary`.

A single warm socket therefore cannot switch tier mid-life. Design:

- Compute a **config fingerprint** from `(mode, languageCodes,
  customVocabulary hash)`.
- Keep one warm socket open for the fingerprint implied by the *current
  default mode* — for a stock install that is Auto, hence `SMART`.
- On `on_press`, resolve the effective mode and compute the required
  fingerprint. Match → use the warm socket. Mismatch → open a fresh
  socket for this dictation, paying one setup round trip, then
  re-establish the warm socket afterwards.
- Invalidate and reopen the warm socket whenever language, the
  Dictionary, the default mode, or the Auto-format toggle changes. Those
  already flow through `useApplySettingsToRust`, so the invalidation
  hooks onto existing IPC.

Because mode resolution most often lands on the default mode, the warm
path covers the common case, and the mismatch path is still correct —
just one setup round trip slower.

### 4.3 Per-dictation message sequence

Manual VAD, matching push-to-talk exactly:

```
(warm, at boot / after invalidation)
  → {"setup": { ... }}
  ← {"setupComplete": {}}                   // gate; do not send audio before this

(hotkey down)
  → {"realtimeInput": {"activityStart": {}}}
  → {"realtimeInput": {"audio": {"data": "<base64 pcm>",
                                 "mimeType": "audio/pcm;rate=16000"}}}   // repeated, 100ms chunks
  ← {"serverContent": {"interimInputTranscription": {"text": "..."}}}    // optional, for pill preview

(hotkey up)
  → {"realtimeInput": {"activityEnd": {}}}
  ← {"serverContent": {"inputTranscription": {"text": "..."}}}           // authoritative final
```

Toggle mode with silence auto-stop uses the same shape; the silence
detector triggers `activityEnd` instead of the hotkey release.

Audio format is unchanged from what `audio/processor.rs` already
produces: raw 16-bit PCM, 16 kHz, mono, little-endian, 100 ms chunks.
The only new work is base64-encoding each chunk, which costs ~33%
bandwidth over binary gRPC — negligible at ~32 KB/s.

### 4.3.1 Concurrency: a writer task is mandatory, not stylistic

The audio pump runs in its own tokio task (`hotkey::spawn_chunk_forwarder`)
while `on_release` concurrently holds the session to close the turn. A
`send_audio(&mut self)` API therefore cannot work — it would need
`&mut` from two places at once. The Chirp path got this for free because
tonic handed it a cloneable `mpsc::Sender`.

`LiveSession` therefore owns a **writer task** that holds the sink and
drains an `mpsc<Outbound>` queue. Every outbound frame is serialised
through it. `LiveSession::audio_sender()` returns a cloneable
`AudioSender` for the forwarder, which can send audio but deliberately
**cannot** start or end a turn — so a forwarder can never desynchronise
turn boundaries. Queue depth is 256 and full-queue behaviour is
back-pressure, not drop, because dropping audio silently truncates a
transcript.

Two Rust details worth keeping: `close()` takes `&mut self` and swaps in
a dead sender rather than consuming `self`, because moving fields out of
a type implementing `Drop` does not compile. And `Drop` aborts only the
reader (parked on `source.next()`, it would never wake); the writer is
left to observe its channel closing and emit a Close frame on its own.

### 4.4 Connection ceiling, `goAway`, and no resumption

- Connection lifetime is ~10 minutes (a WebSocket constraint).
  Audio-only sessions cap at 15 minutes without context compression.
- A `goAway` message arrives 60 seconds before the connection ends.
  On `goAway`, finish any in-flight dictation, then tear down and
  reopen a fresh warm socket.
- **Session resumption stays disabled.** The doc is explicit: "If you
  need to ensure zero data retention in your application, don't enable
  session resumption" — it works by server-side caching audio and text.
  That is incompatible with PoPo's privacy posture. Reconnect fresh.
- Up to 1,000 concurrent sessions per project. PoPo uses one or two.

---

## 5. Language support

The Vertex list is authoritative and differs from the AI Studio list: it
carries a Supported/Experimental readiness column, includes `en-AU`,
`fr-CA`, and `es-ES` which the AI Studio page omits, and has no
duplicate `en-IN` row.

This maps cleanly onto PoPo's existing two-tier label pattern in
`SettingsPage.tsx`. Relabel **GA → Supported** and **Preview →
Experimental**.

### 5.1 Supported (29)

`ca-ES` `hr-HR` `da-DK` `nl-NL` `en-AU` `en-GB` `en-IN` `en-US` `fi-FI`
`fr-FR` `fr-CA` `de-DE` `el-GR` `hi-IN` `it-IT` `ja-JP` `ko-KR`
`cmn-Hans-CN` `pl-PL` `pt-BR` `pt-PT` `ro-RO` `ru-RU` `es-ES` `es-US`
`sv-SE` `tr-TR` `uk-UA` `vi-VN`

### 5.2 Experimental (57)

`af-ZA` `am-ET` `ar-EG` `hy-AM` `as-IN` `az-AZ` `be-BY` `bn-BD` `bn-IN`
`bs-BA` `bg-BG` `rup-BG` `my-MM` `yue-Hant-HK` `ceb` `km-KH` `cs-CZ`
`et-EE` `fa-IR` `fil-PH` `gl-ES` `ka-GE` `gu-IN` `ha-NG` `he-IL`
`hu-HU` `is-IS` `id-ID` `jv-ID` `kea-CV` `kn-IN` `kk-KZ` `ky-KG`
`lv-LV` `ln-CD` `lt-LT` `mk-MK` `ms-MY` `ml-IN` `mt-MT` `mr-IN`
`mn-MN` `ne-NP` `nb-NO` `or-IN` `pa-IN` `pa-Guru-IN` `sr-RS`
`sd-Arab-IN` `sk-SK` `sl-SI` `es-419` `sw-KE` `tg-TJ` `te-IN` `th-TH`
`uz-UZ`

### 5.3 Regressions to disclose

- **Tamil (`ta-IN`) is absent from the model entirely.** Not Supported,
  not Experimental — not listed. Chirp 3 supported it and `README.md`
  advertises it. Remove Tamil from the README feature bullet and from
  `LANGUAGE_OPTIONS`.
- Among Indian languages only `hi-IN` and `en-IN` are Supported.
  `te-IN`, `bn-IN`, and `mr-IN` drop from Chirp GA to Experimental.
  They stay in the list, labelled honestly.

### 5.4 Multi-language selection is deleted

`Settings.multiLanguageCodes` and its `MultiSelect` row exist only
because Chirp 3 needed an explicit array for code-switching, and could
not combine Preview languages or `custom_prompt` with multi-language
arrays (Session 29). Transcribe Live does mid-utterance code-switching
natively when `languageCodes` is `[]`.

So: delete the field, the `MultiSelect` row, the GA-only
`MULTI_LANGUAGE_OPTIONS` filter, the auto-clear-on-specific-language
logic, and `cmd_set_multi_language_codes`. "Auto-detect" alone now does
what the two controls used to do together, which is a genuine UX
simplification.

`Settings.endpointing` also goes: it was UI-only from Session 33
because the proto crate exposed only `Standard`, and the Live API has
no analogue. Likewise `spokenPunctuation`, `spokenEmojis`, and
`profanityFilter`, which have been dead since Session 28.

---

## 6. Cost accounting

### 6.1 Rates

| | Transcribe Live | Flash-Lite (tier 3 only) |
| --- | --- | --- |
| Input | $3.50 / 1M tokens | $0.30 / 1M tokens |
| Output | $21.00 / 1M tokens | $2.50 / 1M tokens |

Token basis: **25 audio tokens per second** of input; text output billed
as ordinary text tokens (Google's published per-minute figures assume
~175 text tokens/minute). Blended ≈ `$0.009/min` versus Chirp's
`$0.016/min`.

Unverified: a Google pricing page mentions 30-second billing increments
but does not attribute it to the Live API. **Do not encode an
increment** until confirmed against a real bill.

### 6.2 Rust, replacing `hotkey/mod.rs` :2888-2891

```
audio_tokens = ceil(duration_secs) * 25
text_tokens  = estimated from the final transcript, not from duration
stt_cost     = audio_tokens * 3.50e-6 + text_tokens * 21.0e-6
polish_cost  = tier 3 only: prompt+transcript in, result out, at Flash-Lite rates
gcp_cost_estimate = stt_cost + polish_cost
```

Deriving output tokens from the actual transcript is more accurate than
assuming a fixed tokens-per-minute rate, since we already have the
text. Tier 3's `polish_cost` is new: the current code never counted the
Gemini call at all, so every polished dictation has under-reported since
Session 34. The Stats card label changes from "Est. GCP cost" to
something engine-neutral.

**Implemented and tested, awaiting wiring**: `gcp/cost.rs` provides
`audio_tokens()`, `estimate_text_tokens()`, `stt_cost_usd()`,
`polish_cost_usd()`, and `session_cost_usd(duration_ms,
final_transcript, Option<PolishUsage>)`. Twelve tests, including one
asserting the one-minute input cost equals Google's published
`$0.00525/min`, one asserting the blended minute lands in
`$0.008..=$0.010`, one asserting transcribe-live is cheaper than Chirp
was, and one asserting STT is billed on the **raw** transcript rather
than the polished output (polish can shorten text substantially, and
the STT model was still paid for what it emitted).

This must be wired in the **same** change as the transport swap. Wiring
it while Chirp is still the engine would apply Gemini token pricing to
Chirp calls and report a wrong number.

### 6.3 Two pre-existing bugs in `stats-compute.ts`

`computeMetrics()` today:

```ts
const billedIncrements = Math.ceil(totalMs / 1000 / 15);
const gcpCostUsd = billedIncrements * 0.004;
```

1. It **ignores the stored per-session `gcpCostEstimate`** that Rust
   already computes at capture time, and recomputes from scratch.
2. It rounds **once over the aggregate**, but Chirp bills per request.
   Correct is `sum(ceil(sessionSeconds / 15))`. For 100 four-second
   dictations, true cost `$0.40`, reported `$0.108` — a ~4×
   under-estimate. The doc comment claims the opposite, that it "errs on
   the conservative (over-estimate) side".

**Fix**: sum the stored `session.gcpCostEstimate` when present; fall
back to a formula only when absent (pre-Session-20 records), and do
that per session.

This is also what makes historical data correct for free. Rust baked
the engine-appropriate cost into each session at capture time, so
Chirp-era sessions keep Chirp-era pricing and new sessions get
transcribe-live pricing, with **no Session schema change, no
`firestore.rules` edit, and no rules redeploy**.

### 6.4 Why no engine tag field

`firestore.rules` `validSession()` enforces a closed 16-field allowlist
via `data.keys().hasOnly([...])`. Adding any Session field without
simultaneously updating and redeploying the rules would cause **every**
session write to be rejected. Since §6.3 removes the need for an engine
tag, we do not touch that allowlist. If we later want to *display* the
engine per session, that is a separate decision with a known cost.

`validMode()`'s allowlist is unaffected: `mode-auto` keeps
`systemPrompt` as `""` rather than dropping the key.

---

## 7. Files to touch

### 7.1 Rust — delete

- `gcp/chirp.rs` (batch `Recognize`)
- `gcp/streaming.rs` (`StreamingRecognize`, `tokio_stream::ReceiverStream`)
- `gcp/client.rs` (`SPEECH_ENDPOINT = "https://eu-speech.googleapis.com"`,
  the `once_cell` tonic `Channel` cache, `prewarm_streaming`, and the
  test asserting the `eu` endpoint)
- `hotkey/mod.rs`: `resolve_recognition_features`,
  `resolve_endpointing_sensitivity`, `build_speech_adaptation`, the
  `googleapis_tonic_...` import, and `PopoState` fields
  `spoken_punctuation`, `spoken_emojis`, `profanity_filter`,
  `multi_language_codes`, `endpointing_sensitivity` plus their init
- `commands/settings.rs`: `cmd_set_spoken_punctuation`,
  `cmd_set_spoken_emojis`, `cmd_set_profanity_filter`,
  `cmd_set_multi_language_codes`, `cmd_set_endpointing_sensitivity`,
  and their `lib.rs` `invoke_handler` registrations
- `lib.rs`: `prewarm_streaming` call and the Chirp half of the
  4-minute keep-warm task

### 7.2 Rust — add / rewrite

- **New** `gcp/transcribe_live.rs`: WebSocket client, setup builder,
  config fingerprint, warm-socket manager, `goAway` handling, interim
  and final transcript parsing.
- `gcp/mod.rs`: rewrite the `transcribe()` wrapper; drop
  `RecognitionFeatures` from the signature.
- `hotkey/mod.rs`: `resolve_language_codes` simplifies to
  auto-detect-or-single; `build_speech_adaptation` becomes a
  `custom_vocabulary` builder that no longer bails out on auto-detect;
  `on_press`/`on_release` drive `activityStart`/`activityEnd`; new cost
  math. Preserve the Session 27 claim-before-async ordering and the
  `Arc::ptr_eq` session-identity guard.
- `commands/test.rs`, `commands/gcp.rs`: connection test against the new
  endpoint.
- `Cargo.toml`: remove `tonic`, `tonic-prost`, `prost`, `prost-types`,
  `googleapis-tonic-google-cloud-speech-v2`; verify-then-remove
  `hyper`, `hyper-util`, `http`, `tower`, `futures`, `tokio-stream`
  (no direct `use` outside `gcp/`, confirm by compile). Add
  `tokio-tungstenite` with `rustls-tls-native-roots` to stay on the
  single existing rustls stack. `reqwest` already has `rustls-tls` for
  Gemini — reuse it, do not add a second HTTP stack.

### 7.2.1 The batch-fallback branches collapse

`on_release` currently has **five** separate `gcp::transcribe(...)` call
sites (around lines 2388, 2409, 2493, 2521, 2556). They exist because
Chirp had two transports: if `StreamingRecognize` failed to open, or
`finish()` errored, the code retried through the non-streaming
`Recognize` endpoint. One of those retries also strips speech
adaptation, working around an EU-region `NOT_FOUND` on inline phrase
sets.

The Live API has no second transport. Per §8, a socket that cannot be
opened or that dies mid-turn must **fail closed with a specific pill
error**, not silently degrade. So all five batch call sites, the
`used_fake` interaction with them, the `adaptation_phrases_batch`
retry-without-adaptation logic, and the entire three-path A/B/C comment
block are deleted rather than ported.

This is the single largest simplification in the migration and the main
reason `on_release` shrinks substantially. It is also why the rewiring
is one indivisible change: the transcript-acquisition block, the cost
math, and the error paths are all entangled in the same control flow.

### 7.3 Rust — keep unchanged

- `gcp/auth.rs`. Scope and the regular-file check already suffice.
- `gcp/gemini.rs` logic. Only comment wording referring to "raw Chirp
  transcript" and Chirp's `custom_prompt` biasing needs updating.
  **Do not touch `normalize_vertex_location`** — see §2.2.
- The entire `audio/` pipeline. 16 kHz mono PCM-16 is already exactly
  what the Live API wants.

### 7.3.1 Prerequisite completed: the DSP helpers were rescued from `chirp.rs`

`gcp/chirp.rs` did **not** contain only gRPC code. It also defined three
pure-DSP items that the rest of the pipeline depends on:

- `TARGET_SR` (16 000)
- `resample_to_16k()` — box-average downsample, linear upsample. Hand
  rolled because Session 15's `rubato::FftFixedInOut` panicked at
  runtime with a chunk-size mismatch. **Do not reintroduce rubato.**
- `f32_to_pcm16_bytes()`

Call sites were `hotkey/mod.rs` (the chunk forwarder, and the sample-rate
argument) and `gcp/client.rs`. Deleting `chirp.rs` naively would have
destroyed the audio conversion path that feeds the *new* WebSocket
client.

**Done**: these now live in `audio/pcm.rs`, registered in
`audio/mod.rs`, with seven unit tests covering the target rate, empty
input, passthrough at a matching rate, 48 kHz → 16 kHz length and
constant-signal preservation, 8 kHz → 16 kHz upsampling, little-endian
byte packing, and clamping of out-of-range samples — that last one
matters because Session 48's 8× input boost can push peaks past 1.0.
`chirp.rs` now re-exports from `audio::pcm` rather than defining them,
and `hotkey/mod.rs` and `client.rs` import from `audio::pcm` directly,
so deleting `chirp.rs` breaks nothing.

### 7.3.2 Hard ordering constraint

The five `cmd_set_*` Rust commands (§7.1) and the five frontend
`Settings` fields with their `useApplySettingsToRust` pushes (§7.4) must
be removed **in the same change**. Removing the Rust side alone leaves
the frontend invoking commands that no longer exist, which typechecks
cleanly and then fails at runtime the moment a setting changes.

### 7.4 Frontend

- `shared-types/index.ts`: remove `Settings.multiLanguageCodes`,
  `spokenPunctuation`, `spokenEmojis`, `profanityFilter`, `endpointing`.
  `mode-auto` seed `systemPrompt` → `""`. `SEED_MODE_VERSION` 10 → 11.
- `SettingsPage.tsx`: new `LANGUAGE_OPTIONS` from §5 with
  Supported/Experimental labels; delete the multi-language row, the
  `MULTI_LANGUAGE_OPTIONS` filter, the auto-clear logic, and the
  endpointing dropdown; rewrite the "Chirp detects from 125+ languages"
  copy and the three-branch Auto-format description.
- `useApplySettingsToRust.ts`: delete the five dead debounced pushes.
- `stats-compute.ts`: the §6.3 fix.
- `ModeEditor.tsx`: for a factory mode with an empty prompt, replace the
  textarea with a read-only explanation of what SMART does; hide
  `translateTo` and `outputFormat` for it.
- `ModeCard.tsx`: a Chip marking the no-LLM mode, so "why is Auto
  instant" is visible.
- `DictionaryPage.tsx`: the auto-detect banner currently explains that
  adaptation is dropped when language is `auto`. That limitation is
  gone; rewrite the copy.
- Copy-only passes: `TestPage.tsx`, `StatsPage.tsx`, `SessionDetail.tsx`,
  `GCPSetupWizard.tsx`, `VertexSetupWizard.tsx`, `GCPSetup.tsx`,
  `GeminiSetup.tsx`, `AppShell.tsx`, `dictionaryStore.ts`,
  `lib/firestore.ts`.

### 7.5 Infra

No `firestore.rules` change (§6.4). No rules redeploy. Verify by test
rather than assumption.

### 7.6 Docs

`README.md` (feature bullet incl. Tamil, wizard step 3 "Enable
Speech-to-Text v2", two troubleshooting sections about `locale auto` and
Vertex 404), `TECHNICAL_SPEC.md` §5/§6/§10, `AUDIO_PIPELINE_V2.md`,
`REALTIME_ANALYSIS.md`, `COMPETITIVE_ANALYSIS.md`,
`LANDING_PAGE_RESEARCH.md`, `POPO_BRIEF.md` §4/§7, `PRIVACY.md`,
`RELEASE_SECURITY_CHECKLIST.md` (smoke matrix + Preview-model note),
`MICROSOFT_STORE_SUBMISSION_GUIDE.md`, `SECURITY_AUDIT_REPORT.md`,
`.clinerules`, and all six `memory-bank/` files. Mark
`CHIRP_3_TRANSCRIPTION.md` and `GOOGLE_SPEECH_V2_API.md` superseded.

---

## 8. Edge cases

- **`setup_complete` never arrives** (network, auth, bad model ID):
  fail closed with a specific pill error. Never send audio anyway.
- **Warm socket died between dictations** (idle reap, network change):
  detect on `activityStart` write failure, reopen synchronously, retry
  once, then fail with a real message.
- **Fingerprint mismatch at `on_press`**: open a per-dictation socket.
  Correct, one setup round trip slower. Log it at `info` so the
  frequency is measurable.
- **`goAway` mid-dictation**: finish the current turn on the existing
  connection, reopen afterwards. Do not abort a dictation in flight.
- **Empty final transcript**: existing too-quiet / no-speech
  classification in `audio/mic_error.rs` still applies. Do not attribute
  a mic problem to the model or vice versa.
- **Dictation exceeds 10 minutes**: beyond PoPo's realistic envelope,
  but must not corrupt state. Cap and finalize gracefully.
- **User deleted `mode-auto`**: empty prompt resolves → SMART. Correct
  by construction (§3).
- **`translateTo` on a prompt-less mode**: impossible via the UI after
  §7.4, but Rust must treat `translateTo` as forcing tier 3 if both
  somehow arrive.
- **Service-account JSON moved mid-session**: `Authenticator` already
  fails closed per Session 58. The warm socket must also be torn down.

---

## 9. Validation

Automated, all required green before this is considered done:

- Rust unit tests: setup-message JSON shape (including the `-preview`
  model path and `global` host), the §3 three-tier routing table,
  config-fingerprint equality and invalidation, cost math against
  hand-computed values, and `goAway` reconnect.
- `cargo fmt --check`, `cargo test --locked`, `cargo check --locked --release`.
- `pnpm --filter desktop typecheck`, `pnpm --filter desktop build`.
- `git diff --check`.

Manual, against real Vertex credentials — the only thing that proves the
model ID and location actually serve:

1. Tier 1: Auto-format off, dictate with fillers. Expect them preserved.
2. Tier 2: Auto-format on, Auto mode, dictate with "um" and a
   self-correction. Expect a clean result and **no** Gemini call in the
   logs.
3. Tier 3: Professional / Email / Code / a `translateTo` mode. Expect
   `VERBATIM` on the wire and one Flash-Lite call.
4. Auto-detect with code-switching mid-sentence.
5. A Dictionary term with language `auto` — must now bias correctly,
   where Chirp silently ignored it.
6. Warm-socket reuse across consecutive dictations, then an 11-minute
   idle to force `goAway` reconnect.
7. Cost: dictate a known duration, compare the stored
   `gcpCostEstimate` against hand-computed tokens, then against the
   real Vertex bill once it posts.
8. Firestore sync still succeeds (proves §6.4's no-schema-change claim).

---

## 10. Risks

| Risk | Mitigation |
| --- | --- |
| SMART is Experimental; behaviour may shift | Accepted by owner. Tier 2 is isolated; falling back to routing Auto through Flash-Lite is a one-line change to the routing table. |
| Model is Preview; ID may change at GA | Model ID is a single constant. Pin it, log it at startup. |
| 30-second billing increment unconfirmed | Cost is labelled an estimate. Reconcile against a real bill before making any cost claim in the README. |
| No Rust SDK; hand-rolled protocol | Offset by deleting the far larger tonic + generated-proto surface. Setup-message shape is unit-tested. |
| Preview model on the core dictation path in a signed release | Recorded in `RELEASE_SECURITY_CHECKLIST.md`. |
