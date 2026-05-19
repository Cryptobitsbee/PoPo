# Real-time streaming analysis (Session 29)

> Is popo doing real-time speech recognition, or buffering + batch uploading?
> This doc answers that definitively, documents the log signal to watch for,
> and flags the code paths where we fall back to batch.

## TL;DR

**popo does real-time streaming transcription via Chirp 3's `StreamingRecognize`
when the hotkey is held long enough for the gRPC stream to open (~200-500 ms),
and falls back to synchronous `Recognize` (batch) for very short presses.**

As of Session 29:
- Audio is forwarded to GCP every 100 ms *while* the user is speaking.
- GCP sends interim transcripts back continuously (`interim_results: true`).
- Denoiser is enabled on both streaming + batch paths.
- Final transcript typically arrives 150–400 ms after hotkey release.

## The full data flow (what happens when you hold Ctrl+Shift+Space)

```
  USER                cpal                Ring             Forwarder          GCP              Pill
  press                                   buffer           task              (Chirp 3)        overlay

  ├── t=0 ─────► PHASE 1 (synchronous, <30 ms)
  │                                                                                             morph sleep→ready
  │              mic opens ──► samples begin writing ──► session slot claimed in PopoState
  │              waveform task spawned (25 Hz → pill:waveform events)
  │
  │              PHASE 2 (background spawn)
  │              tokio::async_runtime::spawn ──► gcp::streaming::start().await
  │                                                                            ├ TLS handshake
  │                                                                            ├ HTTP/2 setup
  │                                                                            └ send config message
  ├── t=~200–500 ms ────────────────────────────────────────────────────────── stream OPEN
  │              patcher installs streaming_handle + forwarder into session
  │              forwarder task begins ticking every 100 ms:
  │                 read ring buffer → resample 48k→16k → PCM16 → mpsc.send()
  │                                                         ──── gRPC audio[] ────►
  │
  ├── user speaks "hello world"
  │              every 20 ms: cpal fills ring buffer
  │              every 40 ms: pill waveform emits (RMS bars)
  │              every 100 ms: forwarder sends ~3200 bytes of PCM16 to GCP
  │                                                         ──── gRPC audio[] ────►
  │                                                                            ├ Chirp 3 processing...
  │                                                                            └ ◄── interim #1 "hello"
  │                                                                                "streaming: interim #1 at +340ms"
  │                                                         ──── gRPC audio[] ────►
  │                                                                            ├ more processing...
  │                                                                            └ ◄── interim #2 "hello wor"
  │
  ├── t=~1800 ms ─────── USER RELEASES
  │              on_release fires:
  │              - session.running = false (stops forwarder + waveform task)
  │              - wait up to 150 ms for forwarder to drain
  │              - send any remaining samples via handle.send_audio()
  │              - handle.finish() → drop mpsc sender → half-close gRPC send
  │                                                                            ├ server sees EOF on send
  │                                                                            ├ processes trailing samples
  │                                                                            └ ◄── FINAL "hello world" (is_final=true)
  │                                                                            └ ◄── stream END
  │              collect_final_results returns
  ├── t=~2000 ms ─────── transcript ready ──► (Gemini step currently disabled)
  │              paste sequence:
  │                 arboard.set_text(transcript)
  │                 SetForegroundWindow(target_hwnd)
  │                 50 ms dwell
  │                 enigo Ctrl+V
  │                 100 ms dwell
  │                 arboard.set_text(prev_clipboard)  (restore)
  ├── t=~2200 ms ─────── TEXT APPEARS AT USER'S CURSOR
  │                                                                                             morph success (300 ms) → sleep
```

## The four logs that visibly prove real-time streaming

Watch `%TEMP%\popo.log` (or wherever `tracing-appender` writes) for this sequence
on every dictation:

```
1. on_press: session claimed in 4ms (sync phase complete)
2. streaming: opening StreamingRecognize (languages=["auto"], model=chirp_3, denoiser=on, interim_results=on, endpointing=STANDARD)
3. streaming: opened StreamingRecognize session in 287ms
4. streaming: patched handle + forwarder into live session
5. streaming: first chunk sent at +142ms (3200 bytes)
6. streaming: interim #1 at +483ms (stability 0.45): "hello"     ← ★ proof of real-time
7. streaming: interim #5 at +812ms (stability 0.87): "hello world"
8. streaming: forwarder joined in 12ms (ok=true)
9. streaming: FINAL segment at +1847ms: "hello world" (confidence: 0.94)
10. streaming: collected 1 final + 8 interim + 0 events over 1930ms, total 11 chars
11. streaming: finish() returned transcript in 127ms total
12. paste succeeded via enigo
```

**The critical line is #6** — an interim result logged WHILE the user is still
holding the hotkey. That's only possible if Chirp 3 is processing audio in
real time. If you never see a line with `interim #N`, we're effectively doing
batch.

## What falls back to batch (synchronous `Recognize`)

popo degrades gracefully to batch in three cases. Watch for these logs to
identify which path was used:

### Case A: Streaming never opened before release

```
on_press: session claimed in 4ms (sync phase complete)
streaming: opening StreamingRecognize ...
  ← user releases the hotkey HERE, before stream opened ~350ms later
streaming: session identity changed / session already ended — dropping handle
transcribe: samples=12800 duration=0.80s input_sr=16000Hz max_amp=0.34 model=chirp_3 languages=["auto"]
```

This is normal for very short presses (<~300 ms hold). Batch handles them.

### Case B: Streaming failed to open

```
streaming: failed to open session, on_release will fall back to batch: ...
transcribe: samples=... (batch ran instead)
```

Happens on network hiccup or TLS handshake failure. Rare.

### Case C: Streaming opened but finish() errored

```
streaming: finish() returned transcript in ...
  OR
streaming finish failed: ...
streaming: falling back to batch transcribe
```

Very rare — usually only if the stream gets killed by server-side timeout
(we don't set voice_activity_timeout so this shouldn't happen).

## Feature audit (Session 29) — are my Settings toggles actually doing anything?

| Setting (UI label) | Stored in Rust | Sent to Chirp 3 | Actually works? |
|---|---|---|---|
| Mixed languages (multi-select) | ✅ `multi_language_codes` mutex | ✅ via `language_codes[]` | **YES** — code-switching confirmed per docs |
| Auto-format with AI | ✅ `auto_format_enabled` | ❌ Gemini call commented out | **NO** — toggle shown disabled |
| ~~Spoken punctuation~~ | ✅ `spoken_punctuation` mutex | ❌ Chirp 3 rejects this flag | **NO** — UI hidden |
| ~~Spoken emojis~~ | ✅ `spoken_emojis` mutex | ❌ Chirp 3 rejects this flag | **NO** — UI hidden |
| ~~Profanity filter~~ | ✅ `profanity_filter` mutex | ❌ Chirp 3 rejects this flag | **NO** — UI hidden |
| Language (single) | ✅ via `GcpConfig.language_code` | ✅ (when multi is empty) | **YES** |
| Denoiser | hardcoded always-on | ✅ `denoiser_config { denoise_audio: true, snr_threshold: 0.0 }` | **YES** (Session 29 re-add) |
| Interim results (internal) | hardcoded always-on | ✅ `streaming_features.interim_results: true` | **YES** (Session 29 add) |
| Endpointing sensitivity | hardcoded STANDARD | ✅ `endpointing_sensitivity: STANDARD` | **YES** (Session 29 add) |

## What we *could* enable next

From `StreamingRecognitionFeatures`:

- **`enable_voice_activity_events: true`** — Chirp 3 sends SPEECH_ACTIVITY_BEGIN/END
  events from the server. Could drive our pill's "active" state with cloud-side
  VAD, removing the need for local Silero.

- **`voice_activity_timeout.speech_end_timeout`** — auto-close the stream after
  N seconds of silence. This would replace our manual silence auto-stop for
  Toggle mode (currently handled in `spawn_waveform_task` via RMS).

- **`endpointing_sensitivity: SHORT`** — could expose in Settings as a "Quick
  response" toggle for users who do short phrases / voice commands.

From `RecognitionFeatures`:

- **`custom_prompt_config.custom_prompt`** — PREVIEW on Chirp 3. Could replace
  the disabled Gemini round-trip entirely — pass the user's mode systemPrompt
  directly to Chirp 3's native formatting. Faster, simpler, same auth.

- **`adaptation.phrase_sets`** — hint the model on domain-specific vocabulary
  (proper names, technical jargon). Good polish item for users who dictate
  names / acronyms often.

## Implementation references

- `src-tauri/src/gcp/streaming.rs` — `StreamingRecognize` client + response collector
- `src-tauri/src/gcp/chirp.rs` — synchronous `Recognize` fallback
- `src-tauri/src/hotkey/mod.rs` — `on_press` (Phase 1 sync / Phase 2 async) + `on_release`
- `docs/CHIRP_3_TRANSCRIPTION.md` — official Chirp 3 docs (feature support matrix)
- `docs/GOOGLE_SPEECH_V2_API.md` — Speech v2 RPC + message reference
