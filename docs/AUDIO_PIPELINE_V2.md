# AUDIO_PIPELINE_V2.md — Enhanced audio + Chirp 3 features spec

> Phase 6 implementation plan. Covers: local noise reduction (RNNoise),
> intelligent voice activity detection (Silero VAD), new Chirp 3 STT
> features (spoken punctuation, spoken emojis, profanity filter,
> multi-language switching, built-in cloud denoiser), and the Gemini
> Flash post-processing step.

## 1. Architecture overview

```
  cpal mic (48 kHz f32)
       │
       ▼
  ┌──────────────┐
  │  RNNoise     │  ← nnnoiseless crate, 480-sample frames at 48 kHz
  │  (denoise)   │    returns cleaned f32 + speech_probability (0-1)
  └──────┬───────┘
         │ clean 48 kHz f32
         ▼
  ┌──────────────┐
  │  Silero VAD  │  ← silero-vad-rs crate, 512-sample frames at 16 kHz
  │  (detect     │    (requires resample 48k→16k for VAD input only)
  │   speech)    │    outputs: is_speech (bool), probability (0-1)
  └──────┬───────┘
         │ speech segments (gated)
         ▼
  ┌──────────────┐
  │  Resample    │  ← box-average 48k→16k (existing logic)
  │  48k → 16k   │    applied to RNNoise-cleaned audio
  └──────┬───────┘
         │ 16 kHz PCM mono (clean)
         ▼
  ┌──────────────────────────────────┐
  │  GCP Chirp 3 StreamingRecognize  │
  │                                  │
  │  Config:                         │
  │    model: "chirp_3"              │
  │    language_codes: [user prefs]  │  ← multi-language switching
  │    features:                     │
  │      enable_automatic_punctuation│  ← always on (existing)
  │      enable_spoken_punctuation   │  ← Settings toggle (NEW)
  │      enable_spoken_emojis        │  ← Settings toggle (NEW)
  │      profanity_filter            │  ← Settings toggle (NEW)
  │    denoiser_config:              │
  │      denoise_audio: true         │  ← ALWAYS ON (compulsory)
  │      snr_threshold: 100          │
  └──────────────┬───────────────────┘
                 │ transcript (string)
                 ▼
  ┌──────────────────────────────────┐
  │  Gemini Flash post-processing    │  ← if autoFormat enabled
  │  (mode.systemPrompt applied)     │    400ms timeout, fail-open
  └──────────────┬───────────────────┘
                 │ polished transcript
                 ▼
            paste at cursor
```

## 2. Component details

### 2.1 RNNoise via `nnnoiseless` (local, compulsory)

**What it is:** Pure-Rust port of Xiph's RNNoise — a recurrent neural
network trained to separate speech from background noise in real-time.
Runs on CPU, <1ms per frame.

**Crate:** `nnnoiseless = "0.5"`

**Constraints:**
- Input MUST be 48 kHz mono f32 (our cpal capture is already 48 kHz ✓)
- Frame size MUST be exactly 480 samples (10 ms at 48 kHz)
- Input values must be in **16-bit PCM range** (-32768 to +32767) NOT
  normalized -1 to +1. Scale: `sample * 32768.0`
- Returns cleaned frame + `speech_probability` (0.0 to 1.0)

**Integration point:** Insert IMMEDIATELY after cpal audio callback,
before the ring buffer. Every 480 samples from cpal → denoise → push
cleaned samples to ring buffer. This means ALL downstream consumers
(waveform bars, GCP stream, WAV storage) get clean audio.

**Code sketch:**
```rust
use nnnoiseless::DenoiseState;

let mut denoiser = DenoiseState::new();
let mut input_frame = [0.0f32; 480];
let mut output_frame = [0.0f32; 480];

// In audio callback, accumulate 480 samples then:
// Scale from -1..1 to -32768..32767
for s in &mut input_frame {
    *s *= 32768.0;
}
let _speech_prob = denoiser.process_frame(&mut output_frame, &input_frame);
// Scale back to -1..1
for s in &mut output_frame {
    *s /= 32768.0;
}
// Push output_frame to ring buffer
```

### 2.2 Silero VAD via `silero-vad-rs` (local, compulsory)

**What it is:** Pre-trained ONNX neural network (~2.2 MB) that detects
whether a given audio chunk contains speech. Used for:
1. Smarter silence auto-stop (replace our naive RMS threshold)
2. Gate the GCP stream — only send audio chunks that contain speech
   (saves bandwidth + reduces GCP cost)
3. More accurate waveform visualization (bars only pump during speech)

**Crate:** `silero-vad-rs = "0.1"` (uses `ort` crate for ONNX Runtime)

**Constraints:**
- Input MUST be 16 kHz mono f32 normalized (-1 to +1)
- Chunk size: 512 samples (32 ms at 16 kHz)
- Model file: `silero_vad_v5.onnx` (~2.2 MB, bundled with the app)
- Maintains internal state between chunks (stateful model)
- Returns probability 0.0–1.0 per chunk

**Threshold best practices:**
- Speech threshold: **0.5** (balanced default)
- Min silence duration: **100 ms** (avoids cutting during natural pauses)
- Speech padding: **30 ms** before and after detected speech segments

**Integration point:** Runs on the 16 kHz resampled audio (same
stream we send to GCP). Acts as a gate: only forward chunks to GCP
when `probability > threshold`. Also used for the silence-auto-stop
timer (replace current naive approach).

**Code sketch:**
```rust
use silero_vad_rs::SileroVad;

let mut vad = SileroVad::new("path/to/silero_vad_v5.onnx", 16000)?;
// For each 512-sample chunk at 16kHz:
let probability = vad.process(&audio_chunk_512)?;
let is_speech = probability > 0.5;
```

### 2.3 Chirp 3 new RecognitionConfig features

**Proto fields to add** (in `gcp/chirp.rs` RecognitionConfig):

```proto
message RecognitionFeatures {
  bool profanity_filter = 1;            // NEW: Settings toggle
  bool enable_automatic_punctuation = 2; // existing, always true
  bool enable_spoken_punctuation = 14;   // NEW: Settings toggle
  bool enable_spoken_emojis = 15;        // NEW: Settings toggle
}

message RecognitionConfig {
  repeated string language_codes = 1;   // EXPAND: multi-language array
  string model = 9;                     // "chirp_3"
  RecognitionFeatures features = 2;
  DenoiserConfig denoiser_config = ?;   // NEW: always enabled
}

message DenoiserConfig {
  bool denoise_audio = 1;               // ALWAYS true
  float snr_threshold = 2;             // 100.0 default
}
```

### 2.4 Multi-language switching

Instead of sending a single `language_code`, Chirp 3 accepts an
**array** of language codes. When multiple are provided, it detects
and switches between them mid-sentence (code-switching).

**Use case:** Indian users speaking Hinglish (Hindi + English mixed),
Tenglish (Telugu + English), etc.

**Settings UI:** Change the Language dropdown from single-select to
multi-select. User can pick e.g. `["hi-IN", "en-US"]` to enable
automatic Hindi↔English switching.

**When "auto" is selected:** Send an empty `language_codes` array —
Chirp 3 detects from 125+ languages automatically.

### 2.5 Google Cloud built-in denoiser (compulsory, cloud-side)

On TOP of our local RNNoise denoising, we ALSO enable GCP's
server-side denoiser. Double-denoising doesn't hurt — the cloud
denoiser handles any residual noise that survived RNNoise (e.g.
very low-frequency hum that RNNoise doesn't target).

**Config:** `denoiser_config.denoise_audio = true` always. No
Settings toggle needed.

### 2.6 Gemini Flash post-processing (after transcription)

**Endpoint:** `generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`

**Flow:**
1. Chirp 3 returns raw transcript
2. If `settings.autoFormat == true` AND a mode is selected:
   - Call Gemini with: system_instruction = mode.systemPrompt,
     user content = raw transcript
   - 400 ms timeout via `tokio::time::timeout`
   - On timeout/error: fall through to paste raw transcript (fail-open)
3. Paste the result (polished or raw) at the cursor

**Auth:** Uses the same GCP service account credentials. Gemini API
is part of Google Cloud's AI Platform — same project, same key.

## 3. New Settings fields

Add to `shared-types/Settings` interface:

```typescript
interface Settings {
  // ... existing fields ...

  // NEW — Chirp 3 features
  spokenPunctuation: boolean;    // default: false
  spokenEmojis: boolean;         // default: false
  profanityFilter: boolean;      // default: false
  multiLanguageCodes: string[];  // default: [] (means "auto")

  // autoFormat already exists (default: false)
  // defaultModeId already exists
}
```

Settings page additions (in TRANSCRIPTION group):
- **Spoken punctuation** — Toggle. "Say 'comma' or 'period' and it becomes , or ."
- **Spoken emojis** — Toggle. "Say 'smiling emoji' and it becomes 😊"
- **Profanity filter** — Toggle. "Mask profanity with asterisks"
- **Languages** — Change from single Select to MultiSelect. "Pick
  languages you speak. Chirp switches between them automatically."

## 4. New Cargo dependencies

```toml
# Local audio processing (compulsory, always-on)
nnnoiseless = "0.5"       # RNNoise pure-Rust port, 48kHz noise reduction
silero-vad-rs = "0.1"     # Silero VAD v5 via ONNX Runtime
ort = "2"                 # ONNX Runtime for silero-vad-rs

# Gemini post-processing (optional, only when autoFormat=true)
reqwest = { version = "0.12", features = ["json", "rustls-tls"] }
```

**Bundled assets (ship with the app):**
- `assets/models/silero_vad_v5.onnx` — 2.2 MB VAD model
- ONNX Runtime DLL — shipped automatically by the `ort` crate

## 5. Implementation order (step-by-step)

### Phase A: RNNoise integration (local denoising)
1. Add `nnnoiseless = "0.5"` to Cargo.toml
2. Create `src-tauri/src/audio/denoise.rs`
3. Insert denoise step in cpal audio callback (after receive, before
   ring buffer push). Process every 480 samples.
4. Verify: waveform bars should look cleaner, background hum removed.

### Phase B: Silero VAD integration
1. Add `silero-vad-rs = "0.1"` + `ort = "2"` to Cargo.toml
2. Download `silero_vad_v5.onnx` to `src-tauri/assets/models/`
3. Bundle via tauri.conf.json resources
4. Create `src-tauri/src/audio/vad.rs`
5. Replace the naive RMS-based silence detection with Silero VAD
6. Gate GCP streaming: only send chunks where VAD says speech=true
7. Improve silence auto-stop: use VAD probability instead of RMS

### Phase C: Chirp 3 feature flags
1. Add new Settings fields to shared-types + settingsStore + localStorage
2. Add Settings UI rows (toggles for spoken punctuation/emojis/profanity)
3. Change Language from single-select to multi-select
4. Update `gcp/chirp.rs` RecognitionConfig to pass the new flags
5. Add `DenoiserConfig { denoise_audio: true }` (always-on)
6. Wire multi-language codes from Settings into the config

### Phase D: Gemini Flash post-processing
1. Add `reqwest` to Cargo.toml
2. Create `src-tauri/src/gemini/mod.rs` with `polish(transcript, mode) -> Result<String>`
3. Wire into `hotkey/mod.rs on_release` between transcript-ready and paste
4. Branch on `settings.autoFormat`: if true, call Gemini with 400ms timeout
5. On timeout/error: paste raw transcript (fail-open, never block)
6. Update Settings UI: the existing "Auto-format with AI" toggle now
   actually does something. Maybe add a "Test format" button.

### Phase E: UI polish for new features
1. MultiSelect component for language picker
2. "Spoken punctuation" tooltip explaining what you can say
3. Test page should reflect new features (show whether VAD is detecting speech)

## 6. Performance budget

| Component | Latency per frame | CPU | Memory |
|-----------|-------------------|-----|--------|
| RNNoise (nnnoiseless) | <1 ms / 10ms frame | ~1% | ~5 MB |
| Silero VAD | <1 ms / 32ms frame | ~1% | ~20 MB (ONNX Runtime) |
| GCP Chirp 3 stream | 500-1200 ms total | 0% (network) | — |
| GCP denoiser | included in Chirp latency | 0% (server) | — |
| Gemini Flash | 200-400 ms | 0% (network) | — |

Total local CPU overhead: ~2% sustained during recording. Well within
the brief's 150 MB recording memory budget (current ~45 MB + 20 MB
ONNX = ~65 MB).

## 7. What NOT to do now (deferred)

- **Speech adaptation / custom vocabulary** — needs a phrase-set
  management UI. Future v1.0 feature.
- **Interim results display** — needs a new floating overlay component.
  Future v0.3 feature.
- **Speaker diarization** — single-user dictation doesn't need it.
  Future meeting-transcription mode (v1.0).
- **Word-level confidence highlighting** — nice polish, not essential.
  Future v0.3.

## 8. Risk notes

- `ort` (ONNX Runtime) adds ~15 MB to the installer due to the native
  DLL. Still well under our 50 MB target (currently at ~4 MB).
- `nnnoiseless` requires 48 kHz input — which is what cpal gives us by
  default on Windows WASAPI. If a user has a weird mic that only does
  44.1 kHz, we'd need to resample UP (rare edge case, handle later).
- Multi-language switching accuracy depends on how distinct the
  languages are. Hindi+English is great (very different phonemes).
  Spanish+Portuguese is harder (similar phonemes). Document this in
  Settings tooltip.
