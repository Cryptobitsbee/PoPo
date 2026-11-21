// audio/pcm.rs — sample-rate conversion and PCM-16 packing.
//
// These are pure DSP helpers with no cloud dependency. They lived in
// `gcp/chirp.rs` until the Gemini 3.5 Transcribe Live migration, which
// deletes that file; they are transport-agnostic and belong with the
// rest of the audio pipeline.
//
// Every speech backend PoPo has used wants the same thing: 16 kHz mono
// little-endian PCM-16. The Vertex AI Live API is no different, so this
// module is the single conversion point feeding it.

/// Target sample rate for all speech-to-text requests.
///
/// Google's Live API accepts `audio/pcm;rate=16000`, and Chirp wanted
/// LINEAR16 at the same rate. Higher rates cost bandwidth without
/// improving accuracy, because the models are trained at 16 kHz.
pub const TARGET_SR: usize = 16_000;

/// Resample f32 mono audio from `input_sr` to 16 kHz.
///
/// Uses box-average for downsampling (covers the 44.1 kHz and 48 kHz
/// common microphone rates) and linear interpolation for the rare
/// upsample case. Box-average is a rectangular-window low-pass filter
/// whose sinc-shaped frequency response rolls off near the output
/// Nyquist. Good enough for speech, and completely deterministic.
///
/// Session 15 used rubato's `FftFixedInOut`, which failed at runtime
/// with "rubato resample chunk failed" — an FFT chunk-size mismatch
/// that depends on the input/output ratio. This hand-rolled version
/// cannot hit that failure mode. Do not reintroduce rubato.
pub fn resample_to_16k(input: &[f32], input_sr: usize) -> Vec<f32> {
    if input.is_empty() {
        return Vec::new();
    }
    if input_sr == TARGET_SR {
        return input.to_vec();
    }

    let ratio = input_sr as f64 / TARGET_SR as f64;
    let output_len = (input.len() as f64 / ratio) as usize;
    let mut output = Vec::with_capacity(output_len);

    if ratio >= 1.0 {
        // Downsampling (typical: 48 kHz or 44.1 kHz to 16 kHz).
        // For each output sample, average the input samples falling
        // within its time window. Implicit anti-aliasing via the
        // rectangular low-pass response.
        for i in 0..output_len {
            let start = (i as f64 * ratio) as usize;
            let end = ((i + 1) as f64 * ratio).ceil() as usize;
            let end = end.min(input.len());
            if start >= end {
                output.push(0.0);
                continue;
            }
            let mut sum = 0.0f32;
            for j in start..end {
                sum += input[j];
            }
            output.push(sum / (end - start) as f32);
        }
    } else {
        // Upsampling (rare: e.g. 8 kHz mic to 16 kHz). Linear
        // interpolation between neighbouring input samples.
        for i in 0..output_len {
            let src_idx = i as f64 * ratio;
            let src_i = src_idx as usize;
            let frac = (src_idx - src_i as f64) as f32;
            if src_i + 1 < input.len() {
                let a = input[src_i];
                let b = input[src_i + 1];
                output.push(a + (b - a) * frac);
            } else if src_i < input.len() {
                output.push(input[src_i]);
            }
        }
    }

    output
}

/// Convert f32 [-1.0, 1.0] samples to little-endian i16 PCM bytes.
pub fn f32_to_pcm16_bytes(samples: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(samples.len() * 2);
    for &s in samples {
        let clamped = s.clamp(-1.0, 1.0);
        let i = (clamped * i16::MAX as f32) as i16;
        out.extend_from_slice(&i.to_le_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn target_rate_matches_what_the_live_api_expects() {
        assert_eq!(TARGET_SR, 16_000);
    }

    #[test]
    fn empty_input_resamples_to_empty() {
        assert!(resample_to_16k(&[], 48_000).is_empty());
    }

    #[test]
    fn matching_rate_is_a_passthrough() {
        let input = vec![0.1, -0.2, 0.3];
        assert_eq!(resample_to_16k(&input, TARGET_SR), input);
    }

    #[test]
    fn downsampling_thirds_the_length_from_48k() {
        let input = vec![0.5f32; 4_800];
        let out = resample_to_16k(&input, 48_000);
        assert_eq!(out.len(), 1_600);
        // A constant signal must survive box-averaging unchanged.
        assert!(out.iter().all(|&s| (s - 0.5).abs() < 1e-6));
    }

    #[test]
    fn upsampling_doubles_the_length_from_8k() {
        let input = vec![0.25f32; 800];
        let out = resample_to_16k(&input, 8_000);
        assert_eq!(out.len(), 1_600);
    }

    #[test]
    fn pcm16_packs_two_little_endian_bytes_per_sample() {
        let bytes = f32_to_pcm16_bytes(&[0.0, 1.0, -1.0]);
        assert_eq!(bytes.len(), 6);
        assert_eq!(&bytes[0..2], &0i16.to_le_bytes());
        assert_eq!(&bytes[2..4], &i16::MAX.to_le_bytes());
        assert_eq!(&bytes[4..6], &(-i16::MAX).to_le_bytes());
    }

    #[test]
    fn pcm16_clamps_out_of_range_samples() {
        // Session 48's 8x input boost can push peaks past 1.0; packing
        // must clamp rather than wrap around to a loud opposite-sign
        // sample.
        let bytes = f32_to_pcm16_bytes(&[2.5, -2.5]);
        assert_eq!(&bytes[0..2], &i16::MAX.to_le_bytes());
        assert_eq!(&bytes[2..4], &(-i16::MAX).to_le_bytes());
    }
}
