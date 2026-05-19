// audio/processor.rs — extract 16-bar RMS amplitudes from the live
// sample ring buffer, for the pill's WaveformCanvas.
//
// Called at ~25 Hz (every 40 ms) from the hotkey module while
// recording is active. The result is serialized as `PillWaveformPayload`
// and emitted as a `pill:waveform` event — see memory-bank/systemPatterns.md
// Tauri event protocol.
//
// Phase 2 [6] uses simple time-domain RMS (cheap, perceptually fine).
// Phase 2 [6] polish may swap for an FFT-based spectrum if the live
// pill looks too "flat" across the bar range — rustfft is ~20k-cycles
// per 1024-sample FFT which is well within budget.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

/// Number of bars per waveform event. Matches PillWaveformPayload.bars
/// length and the brief's 16-bar pill spec.
pub const BARS: usize = 16;

/// Compute 16 normalized bar amplitudes from the last ~40 ms of audio.
///
/// Returns `[0.0; 16]` when there isn't enough data (startup, silence,
/// poisoned lock). The caller emits even in this case so the pill gets
/// steady 25 Hz updates — the waveform visuals rely on regular events
/// to interpolate smoothly.
pub fn compute_bars(samples: &Arc<Mutex<VecDeque<f32>>>, sample_rate_hz: u32) -> [f32; BARS] {
    let Ok(buf) = samples.lock() else {
        return [0.0; BARS];
    };

    // 40 ms window. Clamped at a minimum of 16 * 16 = 256 samples so
    // low-rate devices (16 kHz) still get a per-bar chunk of useful size.
    let window = (sample_rate_hz as usize / 25).max(BARS * 16);
    let n = buf.len().min(window);

    // Need at least one sample per bar.
    if n < BARS {
        return [0.0; BARS];
    }

    let bar_size = n / BARS;
    let start = buf.len() - n;

    let mut out = [0f32; BARS];
    for b in 0..BARS {
        let chunk_start = start + b * bar_size;
        let mut sum_sq = 0.0f32;
        for i in 0..bar_size {
            let s = buf[chunk_start + i];
            sum_sq += s * s;
        }
        let rms = (sum_sq / bar_size as f32).sqrt();

        // Logarithmic (dBFS) scaling — maps the dynamic range of
        // mic levels into the bar's 0–1 visual range.
        //
        // Session 48 retuned for the 8× fixed input boost in
        // `audio::capture`. Reference points (post-boost):
        //   raw rms 0.0001 → boosted 0.0008  (≋ -62 dBFS) → ~0
        //   raw rms 0.001  → boosted 0.008   (≋ -42 dBFS) → ~0.38
        //   raw rms 0.005  → boosted 0.04    (≋ -28 dBFS) → ~0.62
        //   raw rms 0.05   → boosted 0.4     (≋ -8 dBFS)  → ~0.95
        //
        // The bars now respond visibly even on a quiet built-in
        // laptop mic without going slack on a loud studio mic.
        const FLOOR_DBFS: f32 = -65.0;
        const CEIL_DBFS: f32 = -5.0;
        const RANGE_DB: f32 = CEIL_DBFS - FLOOR_DBFS;
        let db = if rms > 1e-9 {
            20.0 * rms.log10()
        } else {
            FLOOR_DBFS - 1.0
        };
        out[b] = ((db - FLOOR_DBFS) / RANGE_DB).clamp(0.0, 1.0);
    }
    out
}
