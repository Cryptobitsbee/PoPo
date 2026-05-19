// audio — cpal capture + resample + waveform extraction.
//
// Pipeline: cpal (48kHz) → mono downmix → ring buffer → processor/GCP/storage.
// Noise reduction is handled SERVER-SIDE by Chirp 3's built-in DenoiserConfig.
// Local RNNoise was tested (Session 26) and removed — it introduced artifacts
// that degraded both playback quality and STT accuracy.

pub mod capture;
pub mod processor;
pub mod storage;
