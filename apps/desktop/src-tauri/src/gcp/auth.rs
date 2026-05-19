// gcp/auth.rs — Google service-account access-token caching.
//
// Strategy:
//   - Read the user-provided service-account JSON once (path comes from
//     the frontend GCP Setup wizard via cmd_set_gcp_config).
//   - Use `gcp_auth::CustomServiceAccount` to parse it + mint OAuth2
//     access tokens against https://www.googleapis.com/auth/cloud-platform.
//   - gcp_auth internally caches and refreshes tokens ~5 min before expiry,
//     so every call to `token()` is effectively O(1) except across refreshes.
//
// Tokens are attached to outgoing gRPC requests via the tonic interceptor
// in gcp/client.rs.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use gcp_auth::{CustomServiceAccount, TokenProvider};

/// Scope required for Speech-to-Text v2.
/// See https://cloud.google.com/speech-to-text/v2/docs/reference/rpc.
pub const SCOPE: &str = "https://www.googleapis.com/auth/cloud-platform";

/// Cached authenticator tied to one service-account key file.
///
/// Cheap to clone (it's just an `Arc`).
#[derive(Clone)]
pub struct Authenticator {
    provider: Arc<CustomServiceAccount>,
    /// Absolute path to the service-account JSON (logged for diagnostics).
    pub source_path: PathBuf,
}

impl Authenticator {
    /// Build an authenticator from a service-account JSON file on disk.
    ///
    /// Fails if the path doesn't exist, isn't readable, or isn't a valid
    /// service-account key file. Does NOT make any network call yet —
    /// that happens on the first `token()`.
    pub async fn from_service_account_file(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        if !path.exists() {
            return Err(anyhow!(
                "GCP service-account JSON not found at {}",
                path.display()
            ));
        }

        let sa = CustomServiceAccount::from_file(path).with_context(|| {
            format!("failed to parse service-account JSON at {}", path.display())
        })?;

        Ok(Self {
            provider: Arc::new(sa),
            source_path: path.to_path_buf(),
        })
    }

    /// Mint (or return cached) OAuth2 access token for Speech-to-Text.
    ///
    /// gcp_auth caches internally — typical call is a cheap hashmap lookup.
    pub async fn access_token(&self) -> Result<String> {
        let token = self
            .provider
            .token(&[SCOPE])
            .await
            .context("failed to obtain GCP access token (service account valid? network?)")?;
        Ok(token.as_str().to_string())
    }

    /// The project_id embedded in the service-account JSON. Used as the
    /// parent resource in StreamingRecognize requests
    /// (`projects/{project_id}/locations/global/recognizers/_`).
    pub fn project_id(&self) -> Option<String> {
        // gcp_auth's CustomServiceAccount::project_id() returns
        // Option<Arc<str>>, not Result. The Arc<str> derefs to str,
        // which implements ToString — avoids the as_ref ambiguity
        // (Arc<T> has both inherent as_ref() and one via Deref's AsRef).
        self.provider
            .project_id()
            .map(|s| (*s).to_string())
    }
}
