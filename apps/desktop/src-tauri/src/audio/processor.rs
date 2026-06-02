// audio/processor.rs — extract 16-bar RMS amplitudes for the pill's
// WaveformCanvas.
//
// Called at ~25 Hz (every 40 ms) from the hotkey module's waveform
// task while recording is active. Each call computes ONE RMS value
// for the latest 40 ms chunk and appends it to a rolling history.
// The 16-bar array returned to the pill represents the last 640 ms
// of audio amplitude (16 bars × 40 ms each).
//
// This produces a "scrolling waveform" where:
//   - Bar[0]  = amplitude from ~640 ms ago
//   - Bar[15] = amplitude from the most recent 40 ms
//
// Visually, loud syllables create peaks and pauses between words
// create valleys — much more dynamic than the old approach (which
// split a single 40 ms window into 16 adjacent chunks that all had
// nearly identical RMS because 2.5 ms of speech looks the same as
// the adjacent 2.5 ms).
//
// This matches how Discord, Zoom, Wispr Flow, and most voice-level
// indicators render their waveforms: a time-history of amplitude,
// not a frequency spectrum.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

/// Number of bars per waveform event.
pub const BARS: usize = 16;

/// Rolling history of per-tick RMS values. The caller (hotkey module's
/// waveform task) keeps this alive across ticks and passes it in.
/// Each tick we compute one new RMS, shift left, and append.
pub struct BarHistory {
    history: [f32; BARS],
}

impl BarHistory {
    pub fn new() -> Self {
        Self {
            history: [0.0; BARS],
        }
    }

    /// Compute the RMS of the latest ~40 ms of audio, shift the
    /// history left by one slot, and append the new value. Returns
    /// the full 16-bar array for the pill to render.
    pub fn tick(
        &mut self,
        samples: &Arc<Mutex<VecDeque<f32>>>,
        sample_rate_hz: u32,
    ) -> [f32; BARS] {
        let rms = compute_latest_rms(samples, sample_rate_hz);

        // Shift history left (oldest drops off) and append new value.
        self.history.rotate_left(1);
        self.history[BARS - 1] = rms;

        self.history
    }
}

/// Compute a single RMS value from the most recent ~40 ms of audio
/// in the ring buffer, then map it through the dBFS scale to get a
/// 0.0–1.0 bar magnitude.
fn compute_latest_rms(samples: &Arc<Mutex<VecDeque<f32>>>, sample_rate_hz: u32) -> f32 {
    let Ok(buf) = samples.lock() else {
        return 0.0;
    };

    // 40 ms worth of samples. At 48 kHz = 1920 samples.
    let window = (sample_rate_hz as usize / 25).max(256);
    let n = buf.len().min(window);
    if n == 0 {
        return 0.0;
    }

    let start = buf.len() - n;
    let mut sum_sq = 0.0f32;
    for i in 0..n {
        let s = buf[start + i];
        sum_sq += s * s;
    }
    let rms = (sum_sq / n as f32).sqrt();

    // Logarithmic (dBFS) scaling.
    // Floor -65 dBFS → 0.0, Ceiling -5 dBFS → 1.0.
    // With the 8× input boost:
    //   raw rms 0.001  → boosted 0.008  (-42 dBFS) → bar ~0.38
    //   raw rms 0.005  → boosted 0.04   (-28 dBFS) → bar ~0.62
    //   raw rms 0.05   → boosted 0.4    (-8 dBFS)  → bar ~0.95
    const FLOOR_DBFS: f32 = -65.0;
    const CEIL_DBFS: f32 = -5.0;
    const RANGE_DB: f32 = CEIL_DBFS - FLOOR_DBFS;
    let db = if rms > 1e-9 {
        20.0 * rms.log10()
    } else {
        FLOOR_DBFS - 1.0
    };
    ((db - FLOOR_DBFS) / RANGE_DB).clamp(0.0, 1.0)
}

// Keep the old function signature available for backward compatibility
// in case any code still calls it directly. It delegates to the new
// approach by creating a temporary history and running one tick.
pub fn compute_bars(samples: &Arc<Mutex<VecDeque<f32>>>, sample_rate_hz: u32) -> [f32; BARS] {
    let rms = compute_latest_rms(samples, sample_rate_hz);
    let mut out = [0.0f32; BARS];
    out[BARS - 1] = rms;
    out
}
