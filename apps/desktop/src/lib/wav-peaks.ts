/**
 * wav-peaks.ts — waveform peak extraction from raw WAV bytes.
 *
 * Why this exists in JS rather than only in Rust:
 *
 * `cmd_get_audio_peaks` reads a WAV *from disk by path*, so it can only
 * ever serve sessions that still have a machine-local file. Since
 * Session 61, new session documents deliberately do NOT persist a local
 * path (`audioStoragePath`), and cloud audio is addressed by
 * `audioCloudPath` instead. That left every synced session with working
 * playback but no waveform, because playback can fall back to the cloud
 * object and the peaks path could not.
 *
 * This parses the bytes we have already downloaded or read, so the
 * waveform works identically for local and cloud recordings and costs no
 * extra I/O.
 *
 * Deliberately does NOT use Web Audio's `decodeAudioData`: Session 56
 * found it fails silently in WebView2 for PoPo's WAVs. PoPo writes a
 * known format (16 kHz mono PCM-16, via `audio/storage.rs`), so a direct
 * parse is both simpler and more reliable. Non-PCM input returns null so
 * the caller can show an honest "unavailable" state.
 */

/** Minimal RIFF/WAVE header walk. Returns null if this isn't PCM-16. */
function findPcm16Data(
  view: DataView,
): { offset: number; length: number; channels: number } | null {
  // "RIFF" ....  "WAVE"
  if (view.byteLength < 12) return null;
  const riff = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3),
  );
  const wave = String.fromCharCode(
    view.getUint8(8),
    view.getUint8(9),
    view.getUint8(10),
    view.getUint8(11),
  );
  if (riff !== "RIFF" || wave !== "WAVE") return null;

  let channels = 1;
  let bitsPerSample = 0;
  let formatTag = 0;
  let cursor = 12;

  // Chunks are [4-byte id][4-byte little-endian size][payload], with
  // payloads padded to even length.
  while (cursor + 8 <= view.byteLength) {
    const id = String.fromCharCode(
      view.getUint8(cursor),
      view.getUint8(cursor + 1),
      view.getUint8(cursor + 2),
      view.getUint8(cursor + 3),
    );
    const size = view.getUint32(cursor + 4, true);
    const payload = cursor + 8;

    if (id === "fmt " && payload + 16 <= view.byteLength) {
      formatTag = view.getUint16(payload, true);
      channels = Math.max(1, view.getUint16(payload + 2, true));
      bitsPerSample = view.getUint16(payload + 14, true);
    } else if (id === "data") {
      // formatTag 1 is uncompressed PCM.
      if (formatTag !== 1 || bitsPerSample !== 16) return null;
      const available = Math.min(size, view.byteLength - payload);
      if (available <= 0) return null;
      return { offset: payload, length: available, channels };
    }

    cursor = payload + size + (size % 2);
  }

  return null;
}

/**
 * Compute `barCount` normalised (0..1) peak values from WAV bytes.
 *
 * Mirrors `cmd_get_audio_peaks` exactly: peak-per-bucket on channel 0,
 * then divide through by the global max so quiet recordings still fill
 * the bar height. Returns null when the bytes are not parseable PCM-16.
 */
export function computeWavPeaks(
  buffer: ArrayBuffer,
  barCount: number,
): number[] | null {
  const bars = Math.max(1, Math.min(256, Math.floor(barCount)));
  const view = new DataView(buffer);
  const pcm = findPcm16Data(view);
  if (!pcm) return null;

  const bytesPerFrame = 2 * pcm.channels;
  const frames = Math.floor(pcm.length / bytesPerFrame);
  if (frames <= 0) return null;

  const perBucket = Math.max(1, Math.floor(frames / bars));
  const peaks: number[] = [];
  let globalMax = 0;

  for (let i = 0; i < bars; i += 1) {
    const start = Math.min(i * perBucket, frames);
    const end = Math.min((i + 1) * perBucket, frames);
    let peak = 0;
    for (let f = start; f < end; f += 1) {
      // Channel 0 only, matching the Rust implementation. Averaging
      // channels would dilute a mic-array recording (Session 45).
      const sample = view.getInt16(pcm.offset + f * bytesPerFrame, true);
      const magnitude = Math.abs(sample) / 32767;
      if (magnitude > peak) peak = magnitude;
    }
    if (peak > globalMax) globalMax = peak;
    peaks.push(peak);
  }

  if (globalMax > 0) {
    for (let i = 0; i < peaks.length; i += 1) peaks[i] /= globalMax;
  }

  return peaks;
}
