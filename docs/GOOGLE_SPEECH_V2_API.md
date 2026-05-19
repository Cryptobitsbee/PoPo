# Google Cloud Speech v2 API reference

> Saved Session 29. Condensed from the official `google.cloud.speech.v2`
> package reference. This file is the companion to CHIRP_3_TRANSCRIPTION.md
> and documents the RPC surface + every message type popo touches.
>
> Full reference: https://cloud.google.com/speech-to-text/docs/reference/rpc/google.cloud.speech.v2

## RPC methods (Speech service)

Popo uses three of the Speech service RPCs:

| Method | How popo uses it |
|---|---|
| `StreamingRecognize` | **Primary path.** Bidirectional gRPC stream. `on_press` opens the stream; chunk-forwarder sends audio every 100 ms while recording; `on_release` half-closes + collects the final transcript. |
| `Recognize` | **Fallback path.** If streaming fails to open OR user releases before streaming is ready, we fall through to synchronous `Recognize` with the buffered audio. Also used by the Test-page command `cmd_test_dictate_stop`. |
| `BatchRecognize` | Not used by popo (long-running jobs / GCS input only). |

Other RPCs (`CreateRecognizer`, `CreateCustomClass`, `CreatePhraseSet`, etc.) are for managing persistent resources. Popo uses the `_` implicit recognizer so none of those management RPCs are exercised.

## Request / response types popo actually builds or parses

### `RecognitionConfig`

Used inside every request shape (both `RecognizeRequest.config` and `StreamingRecognitionConfig.config`).

| Field | Type | popo's value | Notes |
|---|---|---|---|
| `model` | `string` | `"chirp_3"` | Chirp 3 model id |
| `language_codes[]` | `[string]` | `["auto"]` / `["en-US"]` / `["hi-IN","en-US"]` | Multi-value enables code-switching |
| `features` | `RecognitionFeatures?` | `None` (Session 28) | See table below; Chirp 3 accepts very few fields |
| `adaptation` | `SpeechAdaptation?` | `None` | Optional — could be used for biasing in the future |
| `transcript_normalization` | `TranscriptNormalization?` | `None` | Search/replace entries, future polish |
| `translation_config` | `TranslationConfig?` | `None` | Not used |
| `denoiser_config` | `DenoiserConfig?` | (to be re-added) | `{denoise_audio: true, snr_threshold: 0.0}` per Chirp 3 docs |
| `decoding_config` (oneof) | `AutoDetectDecodingConfig` OR `ExplicitDecodingConfig` | `ExplicitDecodingConfig { LINEAR16, 16000 Hz, 1 channel }` | We always send headerless LINEAR16 PCM |

### `RecognitionFeatures`

Proto has these bool fields (**but Chirp 3 only accepts a subset**):

| Field | Chirp 3 support | popo usage |
|---|---|---|
| `profanity_filter` | ❌ Not supported | Hidden from UI |
| `enable_word_time_offsets` | ❌ Not supported on Chirp 3 | Not used |
| `enable_word_confidence` | ❌ "API returns a value, but it isn't truly a confidence score" | Not used |
| `enable_automatic_punctuation` | ✅ Supported (on by default) | Optional — could set explicitly |
| `enable_spoken_punctuation` | ❌ Not in Chirp 3's feature table | Hidden from UI |
| `enable_spoken_emojis` | ❌ Not in Chirp 3's feature table | Hidden from UI |
| `multi_channel_mode` | (not relevant — mono input) | Not used |
| `diarization_config` | ✅ (batch only, not streaming) | Not used (v0.1 = single-user dictation) |
| `max_alternatives` | Standard proto field | Not set |
| `custom_prompt_config` | ✅ **PREVIEW** on Chirp 3 | **Candidate to replace Gemini post-processing** |

### `DenoiserConfig`

```proto
message DenoiserConfig {
  bool  denoise_audio = 1;
  float snr_threshold = 2;  // deprecated on Chirp 3, set to 0.0
}
```

Per the Chirp 3 docs:
- Setting `denoise_audio: true` reduces background music / street traffic / rain.
- It **can't** remove background human voices.
- On Chirp 3, `snr_threshold` is deprecated; set to `0.0` for compatibility.

Popo: always send `{ denoise_audio: true, snr_threshold: 0.0 }` on Chirp 3.

### `ExplicitDecodingConfig`

```proto
message ExplicitDecodingConfig {
  AudioEncoding encoding = 1;          // LINEAR16 for popo
  int32 sample_rate_hertz = 2;         // 16000 for popo
  int32 audio_channel_count = 3;       // 1 for popo (mono)
}
```

Popo always uses LINEAR16 @ 16 kHz mono (cpal default of 48 kHz is downsampled by our box-average `resample_to_16k` before send).

`AudioEncoding` enum values: `LINEAR16`, `MULAW`, `ALAW`, `AMR`, `AMR_WB`, `FLAC`, `MP3`, `OGG_OPUS`, `WEBM_OPUS`, `MP4_AAC`, `M4A_AAC`, `MOV_AAC`.

### `StreamingRecognitionConfig`

```proto
message StreamingRecognitionConfig {
  RecognitionConfig config = 1;                            // required; popo fills
  FieldMask config_mask = 2;                               // not used
  StreamingRecognitionFeatures streaming_features = 3;     // NOT YET set — opportunity
}
```

### `StreamingRecognitionFeatures` (⚠️ popo doesn't use this yet)

| Field | Type | Default | What it does |
|---|---|---|---|
| `interim_results` | `bool` | `false` | If true, streams partial transcripts as Chirp processes. Useful for live display. |
| `enable_voice_activity_events` | `bool` | `false` | If true, server sends `SPEECH_ACTIVITY_BEGIN` / `SPEECH_ACTIVITY_END` events. Could replace local silence detection. |
| `voice_activity_timeout` | `VoiceActivityTimeout?` | `None` | Auto-close stream after N seconds of silence (`speech_start_timeout` / `speech_end_timeout`). Requires `enable_voice_activity_events=true`. |
| `endpointing_sensitivity` | `EndpointingSensitivity` | `STANDARD` | `STANDARD` (default, balanced) · `SHORT` (single-sentence optimized) · `SUPERSHORT` (single-word optimized). |

**Recommendation for popo**:
- `interim_results: true` — observable proof of real-time streaming in logs; future pill live-text display.
- `endpointing_sensitivity: STANDARD` — explicit default for clarity.
- `enable_voice_activity_events: false` — keep our local silence auto-stop for now; revisit when Silero VAD lands.

### `StreamingRecognizeRequest` (client → server)

```proto
message StreamingRecognizeRequest {
  string recognizer = 1;
  oneof streaming_request {
    StreamingRecognitionConfig streaming_config = 6;   // FIRST message
    bytes                      audio = 5;              // SUBSEQUENT messages
  }
}
```

**Ordering is strict**: first message has `streaming_config` + `recognizer`; every subsequent message has `audio` only. Max audio bytes per message: **15 KB**.

### `StreamingRecognizeResponse` (server → client)

```proto
message StreamingRecognizeResponse {
  repeated StreamingRecognitionResult results = 6;
  SpeechEventType speech_event_type = 4;
  Duration speech_event_offset = 7;
  RecognitionResponseMetadata metadata = 5;
}
```

**Exactly one of** `error`, `speech_event_type`, or `results` is populated per message.

### `StreamingRecognitionResult`

```proto
message StreamingRecognitionResult {
  repeated SpeechRecognitionAlternative alternatives = 1;
  bool is_final = 2;         // true = committed segment; false = interim
  float stability = 3;       // 0.0..1.0, interim only
  Duration result_end_offset = 4;
  int32 channel_tag = 5;
  string language_code = 6;  // e.g. "en-US" (auto-detected)
}
```

Popo iterates `response.results`. We collect `alt.transcript` on `is_final=true` results and log interim results for observability.

### `SpeechRecognitionAlternative`

```proto
message SpeechRecognitionAlternative {
  string transcript = 1;
  float confidence = 2;      // 0.0..1.0; only set on is_final
  repeated WordInfo words = 3;
}
```

We read `alt.transcript` and `alt.confidence`.

### `SpeechEventType` (enum, sent when `enable_voice_activity_events=true`)

| Enum | Meaning |
|---|---|
| `SPEECH_EVENT_TYPE_UNSPECIFIED` | no event |
| `END_OF_SINGLE_UTTERANCE` | `latest_short` only; not relevant for Chirp 3 |
| `SPEECH_ACTIVITY_BEGIN` | server detected speech start in the stream |
| `SPEECH_ACTIVITY_END` | server detected speech end in the stream |

Can fire multiple times per stream if the user starts and stops speaking.

### `RecognizeRequest` (sync, popo's fallback path)

```proto
message RecognizeRequest {
  string recognizer = 1;
  RecognitionConfig config = 2;       // popo fills
  FieldMask config_mask = 3;           // not used
  oneof audio_source {
    bytes content = 5;                 // popo uses this
    string uri = 6;                    // GCS URI; not used
  }
}
```

15 KB isn't a limit for sync `Recognize` (unlike streaming), but the audio must be under ~1 minute per the Chirp 3 docs.

### `RecognizeResponse`

```proto
message RecognizeResponse {
  repeated SpeechRecognitionResult results = 1;
  RecognitionResponseMetadata metadata = 5;
}
```

Popo joins `results[i].alternatives[0].transcript` for all results.

## Response ordering guarantees (StreamingRecognize)

From the official docs, example of a typical streaming response sequence:

1. `results { alternatives { transcript: "tube" } stability: 0.01 }` — interim, unstable
2. `results { alternatives { transcript: "to be a" } stability: 0.01 }` — interim
3. `results { alternatives { transcript: "to be" } stability: 0.9 } results { alternatives { transcript: " or not to be" } stability: 0.01 }` — two interims in one message
4. `results { alternatives { transcript: "to be or not to be" confidence: 0.92 } is_final: true }` — **first final segment**
5. `results { alternatives { transcript: " that's" } stability: 0.01 }` — new interim for next phrase
6. `results { alternatives { transcript: " that is" } stability: 0.9 } results { alternatives { transcript: " the question" } stability: 0.01 }`
7. `results { alternatives { transcript: " that is the question" confidence: 0.98 } is_final: true }` — **second final segment**

Full transcript = concatenation of all `is_final=true` segments = "to be or not to be that is the question".

**popo's collector** (`gcp::streaming::collect_final_results`) pushes every `is_final=true` alternative's transcript onto a `Vec<String>`, then `.join(" ")` at end-of-stream. This matches the documented intent.

## Authentication (popo's setup)

- **OAuth 2.0** via `gcp_auth` crate.
- Scope required: `https://www.googleapis.com/auth/cloud-platform`.
- Token delivery: `Authorization: Bearer <access_token>` header on every call.
- popo mints fresh tokens per call via `Authenticator::access_token().await`. The `gcp_auth` crate caches internally.

## Regional endpoints

| Region | Endpoint | Chirp 3 support |
|---|---|---|
| `us` multi-region | `us-speech.googleapis.com` | ✅ GA (popo uses this) |
| `eu` multi-region | `eu-speech.googleapis.com` | ✅ GA |
| Other regions | `<region>-speech.googleapis.com` | Varies; check locations API |

The recognizer resource path must match the region: `projects/{project}/locations/us/recognizers/_` for the US multi-region endpoint.

## Quotas / limits popo is likely to encounter

| Limit | Value |
|---|---|
| Max audio per `Recognize` request | ~1 minute |
| Max audio per `BatchRecognize` job | 1 hour (480 min w/ word-timestamps) |
| Max audio bytes per `StreamingRecognizeRequest.audio` message | 15 KB |
| Max stream duration | Limited by voice_activity_timeout + server defaults |
| Phrase set max size | 1,000 phrases (Chirp 3 adaptation) |

## Status code mapping popo should handle

| gRPC code | Meaning | Handling |
|---|---|---|
| `OK` (0) | success | happy path |
| `INVALID_ARGUMENT` (3) | config rejected (wrong model, unsupported feature, bad language code) | Session 28 root cause — surface error to user + log request shape |
| `UNAUTHENTICATED` (16) | token expired / service account invalid | Refresh token + retry once; if still fails, surface to Settings → GCP Setup |
| `PERMISSION_DENIED` (7) | service account lacks `roles/speech.client` | Surface to Settings → GCP Setup |
| `RESOURCE_EXHAUSTED` (8) | quota hit | Surface to user (unlikely for individual dictation use) |
| `UNAVAILABLE` (14) | GCP down / network flaky | Retry with backoff; after N failures surface error |

Current popo behavior: any gRPC error from streaming triggers batch fallback; if batch also fails, we surface the error to the pill's error tooltip with the full context chain.
