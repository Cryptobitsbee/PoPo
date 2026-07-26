// commands/oauth.rs — OAuth via system browser with localhost callback.
//
// Firebase's signInWithPopup and signInWithRedirect both fail in Tauri
// WebView2 because of isolated cookie/storage contexts. The fix is
// the industry-standard desktop-app OAuth pattern: use the user's
// real system browser with a loopback HTTP server as the callback.
// gcloud, GitHub CLI, Spotify, Slack all use this exact pattern.
//
// Flow:
//   1. Frontend calls `cmd_start_oauth_listener` to get a free port.
//   2. Frontend builds the Google OAuth URL (PKCE + redirect_uri=
//      http://127.0.0.1:{port}) and calls `cmd_open_oauth_url(url)`.
//   3. Rust validates the URL and opens it through the Tauri opener plugin.
//   4. User signs in normally in Chrome/Edge/Firefox.
//   5. Google redirects to 127.0.0.1:{port}/?code=...&state=...
//   6. Rust listener accepts one connection, serves a beautiful HTML
//      "you can close this tab" response, emits `oauth:callback`.
//   7. Frontend exchanges code for id_token at Google's token endpoint
//      then calls signInWithCredential(GoogleAuthProvider.credential(
//      id_token, access_token)) to complete Firebase sign-in.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use base64::Engine as _;
use once_cell::sync::Lazy;
use tauri::{AppHandle, Emitter, WebviewWindow};
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

const CALLBACK_HTML_TEMPLATE: &str = concat!(
    "HTTP/1.1 200 OK\r\n",
    "Content-Type: text/html; charset=utf-8\r\n",
    "Cache-Control: no-store\r\n",
    "Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src 'none'; frame-ancestors 'none'\r\n",
    "Referrer-Policy: no-referrer\r\n",
    "X-Content-Type-Options: nosniff\r\n",
    "X-Frame-Options: DENY\r\n",
    "Connection: close\r\n",
    "\r\n",
    r##"<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>popo</title>
  <style>
    @font-face{
      font-family:'Geist Pixel Square';
      src:url(data:font/woff2;base64,__POPO_GEIST_PIXEL_SQUARE__) format('woff2');
      font-weight:500;font-style:normal;font-display:swap
    }
    *{box-sizing:border-box;margin:0;padding:0}
    body{
      background:#080808;color:#edebe6;
      font-family:'Geist Pixel Square',ui-monospace,monospace;
      display:flex;flex-direction:column;
      align-items:center;justify-content:center;
      min-height:100vh;gap:0;padding:40px
    }
    .card{
      background:#0d0d0d;
      border:1px solid #202020;
      border-radius:16px;
      padding:40px 48px;
      text-align:center;
      max-width:400px;width:100%;
      animation:up .45s cubic-bezier(.16,1,.3,1) both
    }
    @keyframes up{
      from{opacity:0;transform:translateY(18px)}
      to{opacity:1;transform:none}
    }
    .mark{
      display:flex;align-items:center;
      justify-content:center;
      margin:0 auto 20px
    }
    .check{
      width:48px;height:48px;
      background:#1a2e22;
      border-radius:50%;
      display:flex;align-items:center;justify-content:center;
      margin:0 auto 24px;
      animation:pop .5s .2s cubic-bezier(.16,1,.3,1) both
    }
    @keyframes pop{
      from{opacity:0;transform:scale(.5)}
      to{opacity:1;transform:scale(1)}
    }
    h1{
      font-family:'Geist Pixel Square',ui-monospace,monospace;
      font-size:19px;font-weight:500;
      letter-spacing:-.01em;
      color:#edebe6;
      margin-bottom:8px
    }
    .sub{
      font-size:13px;color:#7a786f;
      line-height:1.55
    }
    .hint{
      font-family:'Geist Pixel Square',ui-monospace,monospace;
      font-size:11px;color:#6a6862;
      margin-top:20px;
      letter-spacing:.06em;
      text-transform:uppercase
    }
    @media (prefers-reduced-motion:reduce){
      .card,.check{animation:none}
    }
  </style>
</head>
<body>
  <div class="card">
    <!-- popo 3-bar waveform mark -->
    <div class="mark">
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="5"  y="11" width="5" height="10" rx="2.5" fill="#edebe6"/>
        <rect x="13" y="7"  width="5" height="18" rx="2.5" fill="#edebe6"/>
        <rect x="21" y="9"  width="5" height="14" rx="2.5" fill="#edebe6"/>
      </svg>
    </div>
    <!-- success check -->
    <div class="check">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <polyline points="4,10 8.5,14.5 16,6"
          stroke="#2d6a4f" stroke-width="2.2"
          stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
    <h1>Authentication response received</h1>
    <p class="sub">Return to popo to finish sign-in.<br>If anything failed, popo will explain why.</p>
    <p class="hint">You can close this tab</p>
  </div>
</body>
</html>"##
);

static CALLBACK_HTML: Lazy<String> = Lazy::new(|| {
    let font = base64::engine::general_purpose::STANDARD.encode(include_bytes!(
        "../../../public/fonts/GeistPixel-Square.woff2"
    ));
    CALLBACK_HTML_TEMPLATE.replace("__POPO_GEIST_PIXEL_SQUARE__", &font)
});

static OAUTH_LISTENER_ACTIVE: AtomicBool = AtomicBool::new(false);

struct OAuthListenerGuard;

impl Drop for OAuthListenerGuard {
    fn drop(&mut self) {
        OAUTH_LISTENER_ACTIVE.store(false, Ordering::Release);
    }
}

/// Step 1: spawn a state-bound loopback listener on a random port.
#[tauri::command]
pub async fn cmd_start_oauth_listener(
    app: AppHandle,
    window: WebviewWindow,
    expected_state: String,
) -> Result<u16, String> {
    if window.label() != "main" {
        return Err("OAuth can be started only from the main window".into());
    }
    if !(32..=128).contains(&expected_state.len())
        || !expected_state
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("invalid OAuth state nonce".into());
    }
    if OAUTH_LISTENER_ACTIVE
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("an OAuth sign-in is already in progress".into());
    }

    let listener = match TcpListener::bind("127.0.0.1:0").await {
        Ok(listener) => listener,
        Err(error) => {
            OAUTH_LISTENER_ACTIVE.store(false, Ordering::Release);
            return Err(format!("could not bind loopback port: {error}"));
        }
    };

    let port = match listener.local_addr() {
        Ok(address) => address.port(),
        Err(error) => {
            OAUTH_LISTENER_ACTIVE.store(false, Ordering::Release);
            return Err(format!("could not read port: {error}"));
        }
    };

    let app = Arc::new(app);
    tokio::spawn(async move {
        let _guard = OAuthListenerGuard;
        accept_oauth_callback(listener, app, expected_state, Duration::from_secs(180)).await;
    });

    tracing::info!("OAuth listener ready on 127.0.0.1:{port}");
    Ok(port)
}

/// Step 2: validate and open the Google OAuth authorization URL.
///
/// The URL originates in the webview and is therefore untrusted. Keeping the
/// allowlist here prevents a compromised frontend from turning this command
/// into an arbitrary URL/protocol launcher.
fn validate_google_oauth_url(raw: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(raw).map_err(|_| "invalid OAuth URL".to_string())?;
    if parsed.scheme() != "https"
        || parsed.host_str() != Some("accounts.google.com")
        || parsed.path() != "/o/oauth2/v2/auth"
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.port().is_some_and(|port| port != 443)
        || parsed.fragment().is_some()
    {
        return Err("OAuth URL is not the allowed Google authorization endpoint".into());
    }

    let parameter = |name: &str| {
        parsed
            .query_pairs()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.into_owned())
    };

    let client_id = parameter("client_id").unwrap_or_default();
    let scope = parameter("scope").unwrap_or_default();
    if !client_id.ends_with(".apps.googleusercontent.com")
        || !scope.split_whitespace().any(|value| value == "openid")
        || parameter("response_type").as_deref() != Some("code")
        || parameter("code_challenge_method").as_deref() != Some("S256")
        || parameter("code_challenge").map_or(true, |value| value.len() < 43)
        || parameter("state").map_or(true, |value| value.len() < 32)
    {
        return Err("OAuth URL is missing required PKCE/state parameters".into());
    }

    let redirect = parameter("redirect_uri")
        .ok_or_else(|| "OAuth URL is missing redirect_uri".to_string())
        .and_then(|value| {
            reqwest::Url::parse(&value).map_err(|_| "invalid OAuth redirect_uri".to_string())
        })?;
    if redirect.scheme() != "http"
        || redirect.host_str() != Some("127.0.0.1")
        || redirect.port().is_none()
        || redirect.path() != "/"
        || redirect.query().is_some()
        || redirect.fragment().is_some()
    {
        return Err("OAuth redirect_uri must be a random-port IPv4 loopback URL".into());
    }

    Ok(parsed)
}

#[tauri::command]
pub fn cmd_open_oauth_url(
    app: AppHandle,
    window: WebviewWindow,
    url: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("OAuth can be started only from the main window".into());
    }
    let validated = validate_google_oauth_url(&url)?;
    app.opener()
        .open_url(validated.as_str(), None::<&str>)
        .map_err(|e| format!("failed to open system browser: {e}"))
}

// ─── Internal ────────────────────────────────────────────────────────

const INVALID_CALLBACK_RESPONSE: &str = concat!(
    "HTTP/1.1 400 Bad Request\r\n",
    "Content-Type: text/plain; charset=utf-8\r\n",
    "Cache-Control: no-store\r\n",
    "X-Content-Type-Options: nosniff\r\n",
    "Connection: close\r\n",
    "\r\n",
    "Invalid OAuth callback."
);

fn matching_callback_query(request: &str, expected_state: &str) -> Option<String> {
    let mut parts = request.lines().next()?.split_whitespace();
    if parts.next()? != "GET" {
        return None;
    }
    let target = parts.next()?;
    if !target.starts_with("/?") || target.len() > 8192 {
        return None;
    }

    let parsed = reqwest::Url::parse(&format!("http://127.0.0.1{target}")).ok()?;
    if parsed.path() != "/" {
        return None;
    }

    let mut state_matches = false;
    let mut has_result = false;
    for (key, value) in parsed.query_pairs() {
        if key == "state" && value == expected_state {
            state_matches = true;
        }
        if (key == "code" || key == "error") && !value.is_empty() {
            has_result = true;
        }
    }

    (state_matches && has_result).then(|| parsed.query().unwrap_or_default().to_string())
}

async fn accept_oauth_callback(
    listener: TcpListener,
    app: Arc<AppHandle>,
    expected_state: String,
    timeout: Duration,
) {
    let deadline = tokio::time::Instant::now() + timeout;

    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            tracing::warn!("OAuth listener timed out");
            let _ = app.emit_to(
                "main",
                "oauth:callback",
                format!("error=timeout&state={expected_state}"),
            );
            return;
        }

        let (mut stream, _) = match tokio::time::timeout(remaining, listener.accept()).await {
            Ok(Ok(connection)) => connection,
            Ok(Err(error)) => {
                tracing::error!("OAuth accept error: {error}");
                let _ = app.emit_to(
                    "main",
                    "oauth:callback",
                    format!("error=listener_failed&state={expected_state}"),
                );
                return;
            }
            Err(_) => {
                tracing::warn!("OAuth listener timed out");
                let _ = app.emit_to(
                    "main",
                    "oauth:callback",
                    format!("error=timeout&state={expected_state}"),
                );
                return;
            }
        };

        let mut buffer = vec![0u8; 8192];
        let bytes_read =
            match tokio::time::timeout(Duration::from_secs(5), stream.read(&mut buffer)).await {
                Ok(Ok(count)) => count,
                _ => {
                    let _ = stream.write_all(INVALID_CALLBACK_RESPONSE.as_bytes()).await;
                    let _ = stream.shutdown().await;
                    continue;
                }
            };
        let request = String::from_utf8_lossy(&buffer[..bytes_read]);

        let Some(query) = matching_callback_query(&request, &expected_state) else {
            let _ = stream.write_all(INVALID_CALLBACK_RESPONSE.as_bytes()).await;
            let _ = stream.shutdown().await;
            continue;
        };

        // Respond before emitting so the browser receives a clean page even
        // if the frontend immediately tears down its listener.
        let _ = stream.write_all(CALLBACK_HTML.as_bytes()).await;
        let _ = stream.shutdown().await;
        tracing::info!(
            "OAuth callback accepted (code present: {})",
            query.contains("code=")
        );
        let _ = app.emit_to("main", "oauth:callback", query);
        return;
    }
}

#[cfg(test)]
mod tests {
    use super::{matching_callback_query, validate_google_oauth_url};

    fn valid_url() -> String {
        concat!(
            "https://accounts.google.com/o/oauth2/v2/auth?",
            "client_id=123-example.apps.googleusercontent.com&",
            "redirect_uri=http%3A%2F%2F127.0.0.1%3A49152&",
            "response_type=code&scope=openid%20email%20profile&",
            "code_challenge=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ&",
            "code_challenge_method=S256&",
            "state=abcdefghijklmnopqrstuvwxyz012345"
        )
        .to_string()
    }

    #[test]
    fn accepts_google_loopback_pkce_url() {
        assert!(validate_google_oauth_url(&valid_url()).is_ok());
    }

    #[test]
    fn rejects_non_https_or_lookalike_hosts() {
        assert!(validate_google_oauth_url(&valid_url().replacen("https:", "http:", 1)).is_err());
        assert!(validate_google_oauth_url(&valid_url().replacen(
            "accounts.google.com",
            "accounts.google.com.evil.test",
            1
        ))
        .is_err());
    }

    #[test]
    fn rejects_external_redirects_and_missing_state() {
        assert!(validate_google_oauth_url(&valid_url().replace(
            "http%3A%2F%2F127.0.0.1%3A49152",
            "https%3A%2F%2Fevil.test%2Fcallback"
        ))
        .is_err());
        let url = valid_url();
        let without_state = url.split("&state=").next().expect("valid URL prefix");
        assert!(validate_google_oauth_url(without_state).is_err());
    }

    #[test]
    fn rejects_wrong_paths_and_embedded_credentials() {
        assert!(validate_google_oauth_url(&valid_url().replacen(
            "/o/oauth2/v2/auth",
            "/signin",
            1
        ))
        .is_err());
        assert!(validate_google_oauth_url(&valid_url().replacen(
            "https://",
            "https://user:pass@",
            1
        ))
        .is_err());
    }

    #[test]
    fn callback_parser_requires_exact_state_and_result() {
        let state = "abcdefghijklmnopqrstuvwxyz012345";
        let valid = format!("GET /?code=abc&state={state} HTTP/1.1\r\nHost: 127.0.0.1\r\n");
        assert!(matching_callback_query(&valid, state).is_some());

        let wrong = "GET /?code=abc&state=wrong HTTP/1.1\r\n";
        assert!(matching_callback_query(wrong, state).is_none());
        assert!(matching_callback_query("POST /?code=abc HTTP/1.1\r\n", state).is_none());
    }
}
