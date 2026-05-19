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
//   3. Rust opens the system browser with PowerShell Start-Process.
//   4. User signs in normally in Chrome/Edge/Firefox.
//   5. Google redirects to 127.0.0.1:{port}/?code=...&state=...
//   6. Rust listener accepts one connection, serves a beautiful HTML
//      "you can close this tab" response, emits `oauth:callback`.
//   7. Frontend exchanges code for id_token at Google's token endpoint
//      then calls signInWithCredential(GoogleAuthProvider.credential(
//      id_token, access_token)) to complete Firebase sign-in.

use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

const CALLBACK_HTML: &str = concat!(
    "HTTP/1.1 200 OK\r\n",
    "Content-Type: text/html; charset=utf-8\r\n",
    "Connection: close\r\n",
    "\r\n",
    r##"<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>popo</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500&family=Geist:wght@400;500&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{
      background:#080808;color:#edebe6;
      font-family:'Geist',system-ui,sans-serif;
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
      font-family:'Geist',system-ui,sans-serif;
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
      font-family:'Geist Mono',monospace;
      font-size:11px;color:#3a3836;
      margin-top:20px;
      letter-spacing:.06em;
      text-transform:uppercase
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
    <h1>You are signed in</h1>
    <p class="sub">Return to popo &mdash; your history<br>and settings will sync automatically.</p>
    <p class="hint">You can close this tab</p>
  </div>
</body>
</html>"##
);

/// Step 1: spawn a one-shot loopback listener. Returns the ephemeral
/// port so the frontend can embed it in the OAuth redirect_uri.
#[tauri::command]
pub async fn cmd_start_oauth_listener(app: AppHandle) -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("could not bind loopback port: {e}"))?;

    let port = listener
        .local_addr()
        .map_err(|e| format!("could not read port: {e}"))?
        .port();

    let app = Arc::new(app);
    tokio::spawn(accept_one(listener, app, Duration::from_secs(180)));

    tracing::info!("OAuth listener ready on 127.0.0.1:{port}");
    Ok(port)
}

/// Step 2: open the full OAuth URL in the system browser.
///
/// Uses PowerShell's `Start-Process` — the correct way to open an
/// HTTPS URL in the default browser on Windows without cmd.exe
/// interpreting `&` as a shell operator. `-WindowStyle Hidden`
/// prevents a PowerShell window flash.
#[tauri::command]
pub fn cmd_open_oauth_url(url: String) -> Result<(), String> {
    let safe_url = url.replace('\'', "''");
    let script = format!("Start-Process '{}'", safe_url);

    std::process::Command::new("powershell")
        .args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &script])
        .spawn()
        .map_err(|e| format!("failed to open system browser: {e}"))?;
    Ok(())
}

// ─── Internal ────────────────────────────────────────────────────────

async fn accept_one(listener: TcpListener, app: Arc<AppHandle>, timeout: Duration) {
    let sleep = tokio::time::sleep(timeout);
    tokio::pin!(sleep);

    let (mut stream, _) = match tokio::select! {
        r = listener.accept() => r,
        _ = &mut sleep => {
            tracing::warn!("OAuth listener timed out");
            let _ = app.emit("oauth:callback", "error=timeout");
            return;
        }
    } {
        Ok(p) => p,
        Err(e) => {
            tracing::error!("OAuth accept error: {e}");
            let _ = app.emit("oauth:callback", format!("error={e}"));
            return;
        }
    };

    let mut buf = vec![0u8; 8192];
    let n = stream.read(&mut buf).await.unwrap_or(0);
    let request = String::from_utf8_lossy(&buf[..n]);

    // Parse "GET /?code=abc&state=xyz HTTP/1.1"
    let query = request
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .and_then(|u| u.find('?').map(|i| u[i + 1..].to_string()))
        .unwrap_or_default();

    // Respond BEFORE emitting so the browser doesn't show an error.
    let _ = stream.write_all(CALLBACK_HTML.as_bytes()).await;
    let _ = stream.shutdown().await;

    if query.is_empty() {
        let _ = app.emit("oauth:callback", "error=empty_callback");
        tracing::warn!("OAuth callback received with no query string");
    } else {
        tracing::info!(
            "OAuth callback received (code present: {})",
            query.contains("code=")
        );
        let _ = app.emit("oauth:callback", query);
    }
}
