// audio/capture.rs — cpal input stream + shared sample ring buffer.
//
// Session 45: SIMPLIFIED.  Previous versions had two compounding bugs
// that silently destroyed signal level on Windows laptop mics:
//
//   1. **Multi-channel averaging dilutes mic arrays.** WASAPI's
//      `IAudioClient::GetMixFormat` (which cpal's
//      `default_input_config` calls) can report 4–8 channels for a
//      mic-array device even when only one channel carries voice
//      (the other channels are reference signals used by Windows
//      AEC, beam-forming, etc.). Our old code averaged ALL channels
//      and divided by N, so a peak-0.1 voice on channel 0 of a
//      4-channel array became 0.025; on an 8-channel array it
//      became 0.0125. v2 stopped averaging and picked channel 0.
//      Session 52 improves that further: laptop mic arrays do not
//      always put the useful voice signal on channel 0, so each audio
//      callback now picks the strongest channel for that buffer.
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
//      └─ sample callback picks ONE strongest channel and converts
//         it to f32 in [-1, 1] using the standard scale for the
//         device's reported sample format (handles every cpal
//         SampleFormat — i8/i16/i24/i32/i64/u8/u16/u24/u32/u64/f32/f64).
//          └─ applies fixed input boost and pushes into VecDeque<f32>
//             behind a Mutex.
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
    /// diagnostics only — all callers see mono samples (we pick the
    /// strongest channel per callback).
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
/// so the old `on_release` log-line code keeps compiling.
/// `peak_pre_agc_bits` is the raw selected-channel peak, while
/// `peak_post_agc_bits` is the same signal after fixed input boost.
/// There is still no adaptive AGC.
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
    /// Highest |sample| observed after fixed input boost. Kept under
    /// the old field name to preserve the existing diagnostic API.
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

    /// Read the current post-input-boost peak as f32.
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
/// Channel handling: if the device reports multi-channel, each input
/// callback chooses the strongest channel and captures only that one.
/// This avoids both failure modes seen on Windows laptop mic arrays:
/// averaging voice with silent/reference channels, and assuming voice
/// always arrives on channel 0.
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

    let default_sample_format = supported.sample_format();
    let sample_rate = supported.sample_rate().0;
    let channels = supported.channels();
    let stream_config: cpal::StreamConfig = supported.into();

    tracing::info!(
        "cpal input: device={device_name} sr={sample_rate}Hz channels={channels} default_format={default_sample_format:?} buffer={:?}",
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
    let fallback_to_native = || {
        Ok(match default_sample_format {
            // ── Floating-point formats (already in [-1, 1] range) ────
            cpal::SampleFormat::F32 => {
                build_input_f32(&device, &stream_config, &samples, &diag, ch)?
            }
            cpal::SampleFormat::F64 => {
                build_input_f64(&device, &stream_config, &samples, &diag, ch)?
            }

            // ── Signed integer formats (zero-centred) ─────────────────
            cpal::SampleFormat::I8 => build_input_i8(&device, &stream_config, &samples, &diag, ch)?,
            cpal::SampleFormat::I16 => {
                build_input_i16(&device, &stream_config, &samples, &diag, ch)?
            }
            cpal::SampleFormat::I32 => {
                build_input_i32(&device, &stream_config, &samples, &diag, ch)?
            }
            cpal::SampleFormat::I64 => {
                build_input_i64(&device, &stream_config, &samples, &diag, ch)?
            }

            // ── Unsigned integer formats (origin = midpoint) ──────────
            cpal::SampleFormat::U8 => build_input_u8(&device, &stream_config, &samples, &diag, ch)?,
            cpal::SampleFormat::U16 => {
                build_input_u16(&device, &stream_config, &samples, &diag, ch)?
            }
            cpal::SampleFormat::U32 => {
                build_input_u32(&device, &stream_config, &samples, &diag, ch)?
            }
            cpal::SampleFormat::U64 => {
                build_input_u64(&device, &stream_config, &samples, &diag, ch)?
            }

            other => {
                return Err(anyhow!(
                "unsupported cpal sample format: {other:?} (this should not happen on Windows WASAPI)"
            ));
            }
        })
    };

    // Prefer a float stream on WASAPI when available. Browser
    // getUserMedia/WebRTC and most voice stacks operate on normalized
    // float audio; asking Windows for f32 avoids ambiguity around
    // integer container formats on laptop mic arrays. If Windows
    // rejects the f32 format for this endpoint, fall back to CPAL's
    // native default format.
    let stream = if default_sample_format == cpal::SampleFormat::F32 {
        fallback_to_native()?
    } else {
        match build_input_f32(&device, &stream_config, &samples, &diag, ch) {
            Ok(stream) => {
                tracing::info!(
                    "cpal input: using f32 shared-mode capture (native default was {default_sample_format:?})"
                );
                stream
            }
            Err(e) => {
                tracing::warn!(
                    "cpal input: f32 shared-mode capture unsupported ({e:#}); falling back to {default_sample_format:?}"
                );
                fallback_to_native()?
            }
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
// picks the strongest channel for the current callback, converts to
// f32 in [-1, 1], applies fixed input boost, updates diagnostics, and
// pushes into the ring buffer. No AGC, no compression, no averaging
// across channels.

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

                    // Laptop mic arrays can expose several channels where
                    // the useful beamformed voice signal is not channel 0.
                    // Pick the strongest channel for this callback instead
                    // of averaging channels or hard-coding channel 0.
                    const MAX_SCAN_CHANNELS: usize = 32;
                    let scan_channels = ch_for_callback.min(MAX_SCAN_CHANNELS);
                    let mut channel_sum_abs = [0.0f32; MAX_SCAN_CHANNELS];
                    let mut channel_peak = [0.0f32; MAX_SCAN_CHANNELS];
                    let mut frames_seen: u64 = 0;

                    let mut scan_i = 0;
                    while scan_i + ch_for_callback <= data.len() {
                        for c in 0..scan_channels {
                            let raw: f32 = $to_f32(data[scan_i + c]);
                            let abs = raw.abs();
                            channel_sum_abs[c] += abs;
                            if abs > channel_peak[c] {
                                channel_peak[c] = abs;
                            }
                        }
                        frames_seen += 1;
                        scan_i += ch_for_callback;
                    }

                    if frames_seen == 0 {
                        return;
                    }

                    let mut selected_channel = 0usize;
                    let mut best_sum_abs = channel_sum_abs[0];
                    for c in 1..scan_channels {
                        if channel_sum_abs[c] > best_sum_abs {
                            best_sum_abs = channel_sum_abs[c];
                            selected_channel = c;
                        }
                    }

                    let raw_peak = channel_peak[selected_channel];
                    let mut boosted_peak: f32 = 0.0;
                    let mut boosted_sum_abs: f32 = 0.0;

                    let Ok(mut ring) = buf.lock() else { return };

                    // Walk frame-by-frame. Each frame is `ch_for_callback`
                    // interleaved samples; we keep ONLY the strongest
                    // selected channel.
                    let mut i = 0;
                    while i + ch_for_callback <= data.len() {
                        // Pick the selected channel from the interleaved frame,
                        // convert to f32 in roughly [-1, 1].
                        let raw: f32 = $to_f32(data[i + selected_channel]);
                        // Apply fixed input boost (see INPUT_BOOST_GAIN
                        // doc above) and clamp to legal range. This
                        // is the SAME operation every voice app does
                        // internally; it is NOT AGC.
                        let mono: f32 = (raw * INPUT_BOOST_GAIN).clamp(-1.0, 1.0);
                        let abs = mono.abs();
                        if abs > boosted_peak {
                            boosted_peak = abs;
                        }
                        boosted_sum_abs += abs;
                        push_cap(&mut ring, mono);
                        i += ch_for_callback;
                    }

                    fetch_max_f32(&diag_cb.peak_pre_agc_bits, raw_peak);
                    fetch_max_f32(&diag_cb.peak_post_agc_bits, boosted_peak);
                    diag_cb
                        .samples_written
                        .fetch_add(frames_seen, Ordering::Relaxed);

                    // Verbose log on the first three callbacks. This
                    // is the canonical "is the device actually
                    // delivering data" check.
                    if cb_idx < 3 {
                        let mean = if frames_seen > 0 {
                            boosted_sum_abs / frames_seen as f32
                        } else {
                            0.0
                        };
                        tracing::info!(
                            "cpal callback #{cb_idx}: frames={frames_seen} channel={selected_channel}/{ch_for_callback} raw_peak={raw_peak:.4} boosted_peak={boosted_peak:.4} mean_abs={mean:.5}"
                        );
                    } else if cb_idx % 250 == 0 {
                        tracing::debug!(
                            "cpal callback #{cb_idx}: raw_peak={:.4} boosted_peak={:.4}",
                            diag_cb.peak_pre_agc(),
                            diag_cb.peak_post_agc()
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
