// gcp/client.rs — tonic Channel to the GA `eu-speech.googleapis.com` endpoint.
//
// Endpoint + region choice (Session 59 reliability correction):
//   - Google's Chirp 3 model page (updated 2026-07-22) lists only the
//     `us` and `eu` multi-regions as GA.
//   - popo previously used the preview `asia-south1` endpoint for lower
//     latency from India. Google now rejects Chirp 3's `auto` locale in
//     that region with PERMISSION_DENIED / "It is no longer generally
//     available", even though language-agnostic transcription remains
//     GA in the `us` and `eu` multi-regions.
//   - `eu` is the closer of the two documented GA choices for India and
//     preserves Chirp's real `language_codes=["auto"]` behavior.
//
// Resilience:
//   - The Channel is cached for the process lifetime via a
//     tokio::sync::Mutex<Option<Channel>> so every dictation after the
//     first reuses the same HTTP/2 connection.
//   - build_channel uses exponential-backoff retry (3 attempts) for
//     transient TLS/network failures.
//   - The channel is pre-warmed at app startup.
//
// Auth: tokens are minted per call and attached as Bearer metadata.

use std::time::Duration;

use anyhow::{Context, Result};
use once_cell::sync::Lazy;
use tokio::sync::Mutex;
use tonic::transport::{Channel, ClientTlsConfig};

/// GA multi-region Speech v2 endpoint. `eu` preserves Chirp 3's
/// language-agnostic `auto` locale while remaining the lower-latency
/// documented GA choice for users in India.
pub const SPEECH_ENDPOINT: &str = "https://eu-speech.googleapis.com";

/// Region embedded in the recognizer resource path. Must match the
/// endpoint host's region prefix.
pub const SPEECH_REGION: &str = "eu";

/// Process-lifetime channel cache. `None` on startup; populated on
/// first successful build. Mutex allows us to clear + rebuild on
/// persistent transport failures (if we ever add that logic).
static CHANNEL: Lazy<Mutex<Option<Channel>>> = Lazy::new(|| Mutex::new(None));

/// Return a channel to the Speech endpoint, initializing on first use
/// and reusing across all subsequent calls. The underlying Channel is
/// an Arc internally, so clone is O(1).
pub async fn get_channel() -> Result<Channel> {
    let mut guard = CHANNEL.lock().await;
    if let Some(ch) = guard.as_ref() {
        return Ok(ch.clone());
    }
    let channel = build_channel_with_retry().await?;
    *guard = Some(channel.clone());
    Ok(channel)
}

/// Force a fresh build on the next `get_channel()` call. Use this if
/// the cached channel is producing repeated transport errors.
#[allow(dead_code)]
pub async fn reset_channel() {
    let mut guard = CHANNEL.lock().await;
    *guard = None;
}

/// Build with up to 3 attempts, exponential backoff 500ms → 1500ms →
/// 3500ms. Total worst-case ~20s before surfacing failure.
async fn build_channel_with_retry() -> Result<Channel> {
    let mut last_err = None;
    for attempt in 0..3u32 {
        match build_channel_once().await {
            Ok(ch) => {
                if attempt > 0 {
                    tracing::info!("GCP channel connected on attempt {}", attempt + 1);
                }
                return Ok(ch);
            }
            Err(e) => {
                let delay_ms = 500u64 * (1 << attempt); // 500, 1000, 2000
                tracing::warn!(
                    "GCP channel connect attempt {} failed: {e:?}; retrying in {delay_ms}ms",
                    attempt + 1
                );
                last_err = Some(e);
                if attempt < 2 {
                    tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                }
            }
        }
    }
    Err(last_err.unwrap_or_else(|| anyhow::anyhow!("build_channel: no attempts made")))
}

async fn build_channel_once() -> Result<Channel> {
    let tls = ClientTlsConfig::new().with_native_roots();

    let endpoint = Channel::from_static(SPEECH_ENDPOINT)
        .tls_config(tls)
        .context("failed to configure TLS for speech endpoint")?
        .keep_alive_while_idle(true)
        .http2_keep_alive_interval(Duration::from_secs(30))
        .tcp_keepalive(Some(Duration::from_secs(60)))
        // 20s per attempt — covers slow TLS handshakes on long-haul
        // links (India → EU) without hanging on dead routes.
        .connect_timeout(Duration::from_secs(20));

    endpoint
        .connect()
        .await
        .with_context(|| format!("failed to connect to {SPEECH_ENDPOINT} (check network + TLS)"))
}

/// Fire off a channel build in the background at app startup so the
/// first user dictation doesn't pay the handshake cost. Safe to call
/// before GCP credentials are set — worst case the channel sits idle
/// waiting for its first request.
pub async fn prewarm() {
    match get_channel().await {
        Ok(_) => tracing::info!("GCP channel prewarmed ({SPEECH_ENDPOINT})"),
        Err(e) => tracing::warn!(
            "GCP channel prewarm failed (will retry lazily on first dictation): {e:?}"
        ),
    }
}

/// Prewarm the Chirp 3 StreamingRecognize endpoint by opening a brief
/// dummy session. This forces Google to allocate a streaming model
/// instance for this project/region. Without this, the first real
/// dictation pays a ~12 second cold-start penalty (Session 29
/// diagnosis: `streaming_recognize()` takes 11.5s on cold start).
///
/// Flow:
///   1. Open a StreamingRecognize stream (config + 0.5s of silence)
///   2. Half-close immediately
///   3. Discard any response (we don't care about the transcript)
///
/// Cost: ~$0.0004 per app launch (one 15-second billing increment).
/// This is negligible vs. the UX improvement of instant streaming.
///
/// Call this AFTER `prewarm()` (channel must exist) and AFTER GCP
/// config is confirmed available. Best called from the same spawn
/// block in lib.rs that does `restore_gcp_config_on_boot`.
pub async fn prewarm_streaming(auth: &crate::gcp::auth::Authenticator, project_id: &str) {
    use crate::gcp::chirp::TARGET_SR;

    tracing::info!("streaming prewarm: opening dummy StreamingRecognize to warm Chirp 3 server...");
    let t0 = std::time::Instant::now();

    // Reuse the same streaming::start path but with minimal config.
    // We import RecognitionFeatures just for the signature.
    let features = googleapis_tonic_google_cloud_speech_v2::google::cloud::speech::v2::RecognitionFeatures::default();

    match crate::gcp::streaming::start(
        auth,
        project_id,
        &["auto".to_string()],
        TARGET_SR as i32,
        features,
        "",
        &[], // no adaptation — prewarm is silence anyway
    )
    .await
    {
        Ok(handle) => {
            let open_ms = t0.elapsed().as_millis();
            tracing::info!(
                "streaming prewarm: stream opened in {open_ms}ms — sending silence + closing"
            );

            // Send 0.5s of silence (16kHz PCM16 = 16000 bytes).
            let silence = vec![0u8; 16_000];
            let _ = handle.send_audio(silence).await;

            // Half-close — don't wait for transcript.
            // Drop the handle which drops tx (triggers half-close).
            // The response task will see stream end and terminate on its own.
            drop(handle);

            tracing::info!(
                "streaming prewarm: completed in {}ms total — Chirp 3 server is warm",
                t0.elapsed().as_millis()
            );
        }
        Err(e) => {
            tracing::warn!(
                "streaming prewarm: failed in {}ms (non-fatal, first dictation will be slow): {e:?}",
                t0.elapsed().as_millis()
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn production_chirp_endpoint_uses_ga_eu_multi_region() {
        assert_eq!(SPEECH_REGION, "eu");
        assert_eq!(SPEECH_ENDPOINT, "https://eu-speech.googleapis.com");
        assert!(!SPEECH_ENDPOINT.contains("asia-south1"));
    }
}
