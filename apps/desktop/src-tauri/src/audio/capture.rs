// audio/capture.rs — cpal input stream + shared sample ring buffer.
//
// Session 45: SIMPLIFIED.  Previous versions had two compounding bugs
// that silently destroyed signal level on Windows laptop mics:
//
//   1. **Multi-channel averaging dilutes mic arrays.** WASAPI's
//      `IAudioClient::GetMixFormat` (which cpal's
//      `default_input_config` calls) can report 4–8 channels for a
//      mic-array device even when only channel 0 carries voice
//      (the other channels are reference signals used by Windows
//      AEC, beam-forming, etc.). Our old code averaged ALL channels
//      and divided by N, so a peak-0.1 voice on channel 0 of a
//      4-channel array became 0.025; on an 8-channel array it
//      became 0.0125. Other recording apps (Audacity, OBS,
//      Windows Voice Recorder) DON'T do that — they pick channel 0
//      for mono recording. v2 does the same.
//
//   2. **AGC silence threshold rejected real voice as noise.** The
//      `if rms > 0.001` gate held gain at 1.0 forever for any input
//      RMS below 0.001 — which includes a normal-volume built-in
//      laptop mic. Combined with #1, that meant the mic delivered
//      tiny signal AND we never amplified it. v2 removes the AGC
//      entirely (per user request: "no AG, no special settings,
//      restore the mic listing to general way how all other apps
//      does"). Just raw audio in [-1, 1] f32, no processing.
//
// New pipeline:
//
//   cpal input stream (WASAPI shared-mode on Windows)
//      └─ sample callback picks ONE channel (channel 0) and converts
//         it to f32 in [-1, 1] using the standard scale for the
//         device's reported sample format (handles every cpal
//         SampleFormat — i8/i16/i24/i32/i64/u8/u16/u24/u32/u64/f32/f64).
//          └─ pushes into VecDeque<f32> behind a Mutex.
//             size-capped at MAX_BUFFER_SAMPLES (drops oldest).
//
// The VecDeque is read by:
//   - `audio::processor::compute_bars` (40 ms polling → 16-bar RMS events)
//   - `gcp::transcribe` (end of recording — full buffer drained)
//
// Diagnostic counters (callbacks fired, sample count, peak amplitude)
// are still tracked so `on_release` can surface them in error
// tooltips when nothing was captured.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use anyhow::{anyhow, Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

/// Hard cap on the ring buffer. 3 minutes at 48 kHz mono = 8_640_000
/// samples × 4 bytes = ~34 MB per active recording. This covers the
/// vast majority of voice dictation sessions (most are under 60s, but
/// meeting-notes-style dictation can run 2–3 min).
const MAX_BUFFER_SAMPLES: usize = 48_000 * 180; // 3 minutes

/// Fixed input-gain multiplier applied to every captured sample.
///
/// Session 48 (the built-in-laptop-mic loudness fix). Why this isn't
/// AGC even though it changes signal level:
///
///   AGC = Automatic Gain CONTROL = adaptive, with thresholds and
///   ramping. We tried that in Sessions 29–44 and it was fragile.
///   Removed in Session 45.
///
///   This is FIXED gain. A constant multiplier applied uniformly
///   to every sample, with no state, no adaptation, no thresholds.
///   Same operation as turning the input-volume knob up on a mixer
///   board. Every voice-app on Windows does this internally:
///   Zoom, Discord ("Input Sensitivity" slider), OBS ("Gain"
///   filter), browser getUserMedia (WebRTC processing).
///
/// Why 8×:
///   - Built-in laptop mic typical raw peak: 0.001–0.005
///     → boosted peak 0.008–0.04 (audible, visible on waveform).
///   - Bluetooth headset typical raw peak: 0.005–0.05
///     → boosted peak 0.04–0.4 (well-leveled).
///   - External condenser mic raw peak: 0.05–0.3
///     → boosted peak 0.4–1.0+ (peaks soft-clip at 1.0; voice
///     intelligibility preserved — Chirp is robust to mild peak
///     clipping on speech).
///
/// The hard clamp `(sample * GAIN).clamp(-1.0, 1.0)` prevents
/// digital overflow. Voice intelligibility survives soft-clipping
/// at the very loudest peaks (which is rare on speech anyway).
const INPUT_BOOST_GAIN: f32 = 8.0;

/// Active audio capture — caller keeps this alive to keep recording.
/// Dropping the handle stops the stream (cpal docs: `Stream` owns the
/// callback thread).
pub struct CaptureHandle {
    /// The live cpal input stream. Dropping this stops audio capture.
    pub stream: SafeStream,
    /// Shared ring buffer the audio callback writes to. Mono f32 in
    /// roughly [-1, 1] (we don't clamp; very loud mics can exceed
    /// briefly; downstream RMS / waveform code handles either way).
    pub samples: Arc<Mutex<VecDeque<f32>>>,
    /// Sample rate reported by the device (e.g., 48000).
    /// Represents samples-per-second PER CHANNEL (cpal convention).
    /// After channel-pick this is also the effective mono sample rate.
    pub sample_rate: u32,
    /// Number of channels the device is capturing. Kept for
    /// diagnostics only — all callers see mono samples (we pick
    /// channel 0).
    pub channels: u16,
    /// Human-readable device name as cpal reported it. Surfaced into
    /// pill error messages when a recording produces silent audio so
    /// the user can tell at a glance which device popo was capturing
    /// from.
    pub device_name: String,
    /// Live diagnostic counters updated by every audio callback.
    /// Read by `on_release` when a recording is rejected for low
    /// amplitude, so the user gets a specific error ("max signal:
    /// 0.0008 from Microphone Array") instead of a generic "no
    /// speech detected." Also useful for live debugging.
    pub diag: Arc<CaptureDiagnostics>,
}

/// Counters updated by the cpal audio callback every time it fires.
/// All fields are atomic so the callback (audio thread) can write
/// while the main thread reads without locking.
///
/// Backwards-compatible field names (`peak_pre_agc_bits`,
/// `peak_post_agc_bits`) kept even though Session 45 removed AGC,
/// so the old `on_release` log-line code keeps compiling. Both now
/// hold the SAME value (the raw mic peak) — there's no longer a
/// "pre/post AGC" distinction since we don't AGC.
pub struct CaptureDiagnostics {
    /// Number of times the cpal callback has fired since the stream
    /// started. Zero means cpal opened the device but never delivered
    /// any data — a strong signal the device's default config is wrong.
    pub callbacks: AtomicU64,
    /// Total mono samples (post channel-pick) appended to the ring buffer.
    pub samples_written: AtomicU64,
    /// Highest |sample| observed at the device — the raw mic peak.
    /// Encoded as u32 bits via `f32::to_bits` / `f32::from_bits` for
    /// lock-free atomic max via `compare_exchange_weak`.
    pub peak_pre_agc_bits: AtomicU32,
    /// Same as `peak_pre_agc_bits` since Session 45 removed AGC. Kept
    /// to preserve the existing `on_release` diagnostic log format.
    pub peak_post_agc_bits: AtomicU32,
}

impl CaptureDiagnostics {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            callbacks: AtomicU64::new(0),
            samples_written: AtomicU64::new(0),
            peak_pre_agc_bits: AtomicU32::new(0),
            peak_post_agc_bits: AtomicU32::new(0),
        })
    }

    /// Read the current raw-mic peak as f32.
    pub fn peak_pre_agc(&self) -> f32 {
        f32::from_bits(self.peak_pre_agc_bits.load(Ordering::Relaxed))
    }

    /// Same as `peak_pre_agc` since Session 45 removed AGC.
    pub fn peak_post_agc(&self) -> f32 {
        f32::from_bits(self.peak_post_agc_bits.load(Ordering::Relaxed))
    }
}

/// Lock-free f32 max via the atomic-u32 trick. Updates `target` to
/// the bigger of (current, candidate). Used by the audio callback to
/// track peaks without taking a lock.
#[inline]
fn fetch_max_f32(target: &AtomicU32, candidate: f32) {
    if !candidate.is_finite() || candidate < 0.0 {
        return;
    }
    let cand_bits = candidate.to_bits();
    let mut cur = target.load(Ordering::Relaxed);
    loop {
        let cur_val = f32::from_bits(cur);
        if candidate <= cur_val {
            return;
        }
        match target.compare_exchange_weak(cur, cand_bits, Ordering::Relaxed, Ordering::Relaxed) {
            Ok(_) => return,
            Err(actual) => cur = actual,
        }
    }
}

/// Wrapper that asserts `cpal::Stream: Send + Sync` for our use case.
///
/// cpal 0.15 defines `Stream` as `Box<dyn StreamTrait>` without
/// `Send + Sync` bounds. On Windows WASAPI the stream is safe to move
/// between threads.
pub struct SafeStream(#[allow(dead_code)] cpal::Stream);

// SAFETY: cpal::Stream on Windows WASAPI is safe to move between threads.
unsafe impl Send for SafeStream {}
unsafe impl Sync for SafeStream {}

/// Start capturing from an input device. `preferred_name`:
///   - `Some("Realtek Audio")` — open the device whose cpal name
///     matches exactly. If no match is found, log a warning and fall
///     back to the default device instead of failing.
///   - `None` — open the system default input device.
///
/// Channel handling: if the device reports multi-channel, we capture
/// channel 0 only. This matches what every standard recording app
/// does for mono capture (Audacity, OBS, Windows Voice Recorder,
/// Discord's monitoring). It avoids the dilution bug where averaging
/// across reference / silence channels of a Microphone Array
/// destroys signal level.
pub fn start(preferred_name: Option<&str>) -> Result<CaptureHandle> {
    let host = cpal::default_host();

    // Resolve the device: explicit pick first, then default.
    let device = match preferred_name {
        Some(target) if !target.is_empty() => {
            let mut found = None;
            match host.input_devices() {
                Ok(iter) => {
                    for dev in iter {
                        if let Ok(name) = dev.name() {
                            if name == target {
                                tracing::info!("cpal input: using user-selected device {name:?}");
                                found = Some(dev);
                                break;
                            }
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!(
                        "cpal input_devices() failed while searching for {target:?}: {e}"
                    );
                }
            }
            match found {
                Some(d) => d,
                None => {
                    tracing::warn!(
                        "user-selected mic {target:?} not found; falling back to default"
                    );
                    host.default_input_device()
                        .ok_or_else(|| anyhow!("no default input device available"))?
                }
            }
        }
        _ => host
            .default_input_device()
            .ok_or_else(|| anyhow!("no default input device available"))?,
    };

    let device_name = device.name().unwrap_or_else(|_| "<unknown>".into());

    let supported = device
        .default_input_config()
        .context("failed to get default input config")?;

    let sample_format = supported.sample_format();
    let sample_rate = supported.sample_rate().0;
    let channels = supported.channels();
    let stream_config: cpal::StreamConfig = supported.into();

    tracing::info!(
        "cpal input: device={device_name} sr={sample_rate}Hz channels={channels} format={sample_format:?} buffer={:?}",
        stream_config.buffer_size
    );

    let samples: Arc<Mutex<VecDeque<f32>>> = Arc::new(Mutex::new(VecDeque::with_capacity(1 << 16)));
    let diag = CaptureDiagnostics::new();

    let ch = channels as usize;

    // Build the stream with a closure typed to the device's actual
    // sample format. cpal converts the underlying PCM to the requested
    // sample type at the buffer boundary, so for any of these formats
    // the closure receives a [T] of the right size.
    //
    // We support EVERY cpal SampleFormat to avoid silent failures on
    // unusual Windows devices (some 24-bit-in-i32 mic arrays show up
    // as I32, some studio interfaces show up as F64, etc.).
    let stream = match sample_format {
        // ── Floating-point formats (already in [-1, 1] range) ────
        cpal::SampleFormat::F32 => build_input_f32(&device, &stream_config, &samples, &diag, ch)?,
        cpal::SampleFormat::F64 => build_input_f64(&device, &stream_config, &samples, &diag, ch)?,

        // ── Signed integer formats (zero-centred) ─────────────────
        cpal::SampleFormat::I8 => build_input_i8(&device, &stream_config, &samples, &diag, ch)?,
        cpal::SampleFormat::I16 => build_input_i16(&device, &stream_config, &samples, &diag, ch)?,
        cpal::SampleFormat::I32 => build_input_i32(&device, &stream_config, &samples, &diag, ch)?,
        cpal::SampleFormat::I64 => build_input_i64(&device, &stream_config, &samples, &diag, ch)?,

        // ── Unsigned integer formats (origin = midpoint) ──────────
        cpal::SampleFormat::U8 => build_input_u8(&device, &stream_config, &samples, &diag, ch)?,
        cpal::SampleFormat::U16 => build_input_u16(&device, &stream_config, &samples, &diag, ch)?,
        cpal::SampleFormat::U32 => build_input_u32(&device, &stream_config, &samples, &diag, ch)?,
        cpal::SampleFormat::U64 => build_input_u64(&device, &stream_config, &samples, &diag, ch)?,

        other => {
            return Err(anyhow!(
                "unsupported cpal sample format: {other:?} (this should not happen on Windows WASAPI)"
            ));
        }
    };

    stream.play().context("failed to start input stream")?;

    Ok(CaptureHandle {
        stream: SafeStream(stream),
        samples,
        sample_rate,
        channels,
        device_name,
        diag,
    })
}

// ─── Per-format input-stream builders ──────────────────────────────
//
// Each one takes interleaved frames in the device's native format,
// picks channel 0, converts to f32 in [-1, 1], updates diagnostics,
// and pushes into the ring buffer. No AGC, no compression, no
// averaging across channels.

/// Helper macro: same body, different sample type and to-f32
/// conversion. Avoids 10 nearly-identical 25-line functions.
macro_rules! build_input_impl {
    ($fname:ident, $sample_ty:ty, $to_f32:expr) => {
        fn $fname(
            device: &cpal::Device,
            cfg: &cpal::StreamConfig,
            samples: &Arc<Mutex<VecDeque<f32>>>,
            diag: &Arc<CaptureDiagnostics>,
            ch: usize,
        ) -> Result<cpal::Stream> {
            let buf = samples.clone();
            let diag_cb = diag.clone();
            let ch_for_callback = ch.max(1);
            let stream = device.build_input_stream(
                cfg,
                move |data: &[$sample_ty], _| {
                    if data.is_empty() {
                        return;
                    }
                    let cb_idx = diag_cb.callbacks.fetch_add(1, Ordering::Relaxed);

                    // Track raw-mic peak and per-callback diagnostics
                    // BEFORE pushing to the ring buffer.
                    let mut peak: f32 = 0.0;
                    let mut sum_abs: f32 = 0.0;
                    let mut written: u64 = 0;

                    let Ok(mut ring) = buf.lock() else { return };

                    // Walk frame-by-frame. Each frame is `ch_for_callback`
                    // interleaved samples; we keep ONLY channel 0.
                    let mut i = 0;
                    while i + ch_for_callback <= data.len() {
                        // Pick channel 0 from the interleaved frame,
                        // convert to f32 in roughly [-1, 1].
                        let raw: f32 = $to_f32(data[i]);
                        // Apply fixed input boost (see INPUT_BOOST_GAIN
                        // doc above) and clamp to legal range. This
                        // is the SAME operation every voice app does
                        // internally; it is NOT AGC.
                        let mono: f32 = (raw * INPUT_BOOST_GAIN).clamp(-1.0, 1.0);
                        let abs = mono.abs();
                        if abs > peak {
                            peak = abs;
                        }
                        sum_abs += abs;
                        push_cap(&mut ring, mono);
                        written += 1;
                        i += ch_for_callback;
                    }

                    fetch_max_f32(&diag_cb.peak_pre_agc_bits, peak);
                    fetch_max_f32(&diag_cb.peak_post_agc_bits, peak);
                    diag_cb
                        .samples_written
                        .fetch_add(written, Ordering::Relaxed);

                    // Verbose log on the first three callbacks. This
                    // is the canonical "is the device actually
                    // delivering data" check.
                    if cb_idx < 3 {
                        let mean = if written > 0 {
                            sum_abs / written as f32
                        } else {
                            0.0
                        };
                        tracing::info!(
                            "cpal callback #{cb_idx}: frames={written} peak={peak:.4} mean_abs={mean:.5}"
                        );
                    } else if cb_idx % 250 == 0 {
                        tracing::debug!(
                            "cpal callback #{cb_idx}: peak={:.4}",
                            diag_cb.peak_pre_agc()
                        );
                    }
                },
                on_stream_error,
                None,
            )?;
            Ok(stream)
        }
    };
}

// f32 / f64 — already in [-1, 1] range; just pass through (or down-cast f64).
build_input_impl!(build_input_f32, f32, |s: f32| s);
build_input_impl!(build_input_f64, f64, |s: f64| s as f32);

// Signed integers — divide by the type's MAX magnitude to land in [-1, 1].
build_input_impl!(build_input_i8, i8, |s: i8| s as f32 / i8::MAX as f32);
build_input_impl!(build_input_i16, i16, |s: i16| s as f32 / i16::MAX as f32);
build_input_impl!(build_input_i32, i32, |s: i32| s as f32 / i32::MAX as f32);
build_input_impl!(build_input_i64, i64, |s: i64| s as f32 / i64::MAX as f32);

// Unsigned integers — origin is the midpoint, so subtract first.
build_input_impl!(build_input_u8, u8, |s: u8| (s as f32
    - (u8::MAX as f32 / 2.0))
    / (u8::MAX as f32 / 2.0));
build_input_impl!(build_input_u16, u16, |s: u16| (s as f32
    - (u16::MAX as f32 / 2.0))
    / (u16::MAX as f32 / 2.0));
build_input_impl!(build_input_u32, u32, |s: u32| (s as f32
    - (u32::MAX as f32 / 2.0))
    / (u32::MAX as f32 / 2.0));
build_input_impl!(build_input_u64, u64, |s: u64| (s as f32
    - (u64::MAX as f32 / 2.0))
    / (u64::MAX as f32 / 2.0));

#[inline]
fn push_cap(buf: &mut VecDeque<f32>, sample: f32) {
    if buf.len() >= MAX_BUFFER_SAMPLES {
        buf.pop_front();
    }
    buf.push_back(sample);
}

fn on_stream_error(err: cpal::StreamError) {
    tracing::error!("cpal input stream error: {err}");
}
