// commands/gcp.rs — Tauri commands for GCP config sync + test.
//
// Flow:
//   1. User enters service-account path + project ID in the GCP Setup
//      wizard (frontend).
//   2. Frontend invokes `cmd_set_gcp_config` with { path, projectId,
//      languageCode }.
//   3. Rust validates the path parses as a valid service-account JSON,
//      builds an Authenticator, and caches it inside PopoState.
//   4. Rust writes the config to %APPDATA%\popo\gcp.json so next boot
//      can restore it without another wizard run.
//   5. On subsequent dictations, hotkey::on_release reads
//      PopoState.gcp_auth and calls gcp::transcribe instead of
//      gcp::fake_transcribe.
//
// On boot, lib.rs attempts to restore from disk — if the file exists
// and parses, PopoState is pre-populated.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::gcp::{authenticator_from_config, GcpConfig};
use crate::hotkey::PopoState;

// ─── Request / Response shapes ────────────────────────────────

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SetGcpConfigArgs {
    pub service_account_path: String,
    pub project_id: String,
    #[serde(default)]
    pub language_code: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GetGcpConfigResult {
    pub configured: bool,
    pub service_account_path: String,
    pub project_id: String,
    pub language_code: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GcpTestResult {
    pub ok: bool,
    pub message: String,
}

// ─── Commands ─────────────────────────────────────────────────

/// Persist the GCP config in PopoState + on disk, and refresh the
/// Authenticator cache. Returns an error string if the service-account
/// JSON is missing/malformed.
#[tauri::command]
pub async fn cmd_set_gcp_config(
    app: AppHandle,
    state: State<'_, PopoState>,
    args: SetGcpConfigArgs,
) -> Result<(), String> {
    let config = GcpConfig {
        service_account_path: args.service_account_path.trim().to_string(),
        project_id: args.project_id.trim().to_string(),
        language_code: args.language_code.trim().to_string(),
    };

    if !config.is_configured() {
        return Err("service account path and project ID are both required".into());
    }

    // Validate now so errors surface immediately instead of on first
    // dictation. This also pre-warms the Authenticator.
    let auth = authenticator_from_config(&config)
        .await
        .map_err(|e| format!("invalid service-account JSON: {e}"))?;

    // Store in PopoState.
    {
        let mut slot = state.gcp.lock().map_err(|e| format!("state lock: {e}"))?;
        *slot = Some((config.clone(), auth));
    }

    // Persist to disk (best effort — a write failure here doesn't break
    // the current session, just means the user has to re-enter at next
    // boot).
    if let Err(e) = persist_gcp_config(&app, &config) {
        tracing::warn!("could not persist GCP config: {e}");
    }

    tracing::info!(
        "GCP config saved: project_id={} path={}",
        config.project_id,
        config.service_account_path
    );

    Ok(())
}

/// Read the currently-cached GCP config (for pre-filling the Settings
/// page on mount).
#[tauri::command]
pub fn cmd_get_gcp_config(state: State<'_, PopoState>) -> Result<GetGcpConfigResult, String> {
    let slot = state.gcp.lock().map_err(|e| format!("state lock: {e}"))?;
    if let Some((cfg, _)) = slot.as_ref() {
        Ok(GetGcpConfigResult {
            configured: true,
            service_account_path: cfg.service_account_path.clone(),
            project_id: cfg.project_id.clone(),
            language_code: cfg.language_code.clone(),
        })
    } else {
        Ok(GetGcpConfigResult {
            configured: false,
            service_account_path: String::new(),
            project_id: String::new(),
            language_code: String::new(),
        })
    }
}

/// Update ONLY the language_code in the cached GCP config. Called from
/// the Settings page Transcription → Language dropdown. This keeps the
/// GCP credentials separate from the transription language setting while
/// still routing both through Rust.
///
/// If no GCP config is set yet, this is a no-op (language will be picked
/// up from the config when the user finishes setup).
#[tauri::command]
pub async fn cmd_update_language(
    app: AppHandle,
    state: State<'_, PopoState>,
    language_code: String,
) -> Result<(), String> {
    let mut slot = state.gcp.lock().map_err(|e| format!("state lock: {e}"))?;
    if let Some((config, _)) = slot.as_mut() {
        config.language_code = language_code.trim().to_string();
        // Persist the updated config so language survives app restart.
        let updated = config.clone();
        drop(slot);
        if let Err(e) = persist_gcp_config(&app, &updated) {
            tracing::warn!("could not persist updated language: {e}");
        }
        tracing::info!("language updated to: {}", updated.language_code);
    }
    Ok(())
}

/// Smoke-test the GCP credentials: mint a token (no actual transcribe
/// call). If this succeeds the service account is valid and Speech API
/// is reachable.
#[tauri::command]
pub async fn cmd_gcp_test_connection(state: State<'_, PopoState>) -> Result<GcpTestResult, String> {
    let auth = {
        let slot = state.gcp.lock().map_err(|e| format!("state lock: {e}"))?;
        match slot.as_ref() {
            Some((_, a)) => a.clone(),
            None => {
                return Ok(GcpTestResult {
                    ok: false,
                    message: "No GCP config set. Run the setup wizard first.".into(),
                });
            }
        }
    };

    match auth.access_token().await {
        Ok(_) => Ok(GcpTestResult {
            ok: true,
            message: "Service account valid. Access token obtained.".into(),
        }),
        Err(e) => Ok(GcpTestResult {
            ok: false,
            message: format!("{e}"),
        }),
    }
}

/// Smoke-test the currently-selected Gemini provider (Settings →
/// Transcription → Test Gemini connection). Mirrors
/// `cmd_gcp_test_connection` for Chirp, but routes to whichever Gemini
/// backend the user picked:
///   - "aistudio": uses `GCPSettings.geminiApiKey` (pushed via
///     `cmd_set_gemini_api_key`).
///   - "vertex":   reuses the GCP service-account OAuth token + project
///     id (same credential as Chirp), region from `vertex_location`.
///
/// Sends a 1-token `generateContent` request and reports the result so
/// the user knows the provider works before relying on it mid-paste.
#[tauri::command]
pub async fn cmd_gemini_test_connection(
    state: State<'_, PopoState>,
) -> Result<GcpTestResult, String> {
    // Snapshot everything out of the mutexes before any await.
    let provider = {
        let slot = state
            .gemini_provider
            .lock()
            .map_err(|e| format!("state lock: {e}"))?;
        slot.clone()
    };

    if provider == "vertex" {
        let gcp_snap = {
            let slot = state.gcp.lock().map_err(|e| format!("state lock: {e}"))?;
            slot.clone()
        };
        let location = {
            let slot = state
                .vertex_location
                .lock()
                .map_err(|e| format!("state lock: {e}"))?;
            slot.clone()
        };
        let (config, auth) = match gcp_snap {
            Some((c, a)) if c.is_configured() => (c, a),
            _ => {
                return Ok(GcpTestResult {
                    ok: false,
                    message: "Vertex needs a GCP service account. Run GCP Setup first.".into(),
                });
            }
        };
        let token = match auth.access_token().await {
            Ok(t) => t,
            Err(e) => {
                return Ok(GcpTestResult {
                    ok: false,
                    message: format!("Could not mint OAuth token: {e}"),
                });
            }
        };
        let backend = crate::gcp::gemini::GeminiBackend::Vertex {
            access_token: &token,
            project_id: &config.project_id,
            location: &location,
        };
        return Ok(match crate::gcp::gemini::test_connection(backend).await {
            Ok(()) => GcpTestResult {
                ok: true,
                message: format!("Vertex AI reachable ({location})."),
            },
            Err(e) => GcpTestResult {
                ok: false,
                message: format!("{e:#}"),
            },
        });
    }

    // AI Studio path.
    let api_key = {
        let slot = state
            .gemini_api_key
            .lock()
            .map_err(|e| format!("state lock: {e}"))?;
        slot.clone().unwrap_or_default()
    };
    if api_key.trim().is_empty() {
        return Ok(GcpTestResult {
            ok: false,
            message: "No AI Studio API key set. Add one above.".into(),
        });
    }
    let backend = crate::gcp::gemini::GeminiBackend::AiStudio {
        api_key: &api_key,
    };
    Ok(match crate::gcp::gemini::test_connection(backend).await {
        Ok(()) => GcpTestResult {
            ok: true,
            message: "AI Studio reachable.".into(),
        },
        Err(e) => GcpTestResult {
            ok: false,
            message: format!("{e:#}"),
        },
    })
}

// ─── Disk persistence ─────────────────────────────────────────

#[derive(Serialize, Deserialize)]
struct DiskConfig {
    service_account_path: String,
    project_id: String,
    #[serde(default)]
    language_code: String,
}

fn config_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    // app_data_dir on Windows = %APPDATA%\<identifier>\
    let mut p = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    std::fs::create_dir_all(&p).map_err(|e| format!("mkdir: {e}"))?;
    p.push("gcp.json");
    Ok(p)
}

fn persist_gcp_config(app: &AppHandle, cfg: &GcpConfig) -> Result<(), String> {
    let path = config_file_path(app)?;
    let disk = DiskConfig {
        service_account_path: cfg.service_account_path.clone(),
        project_id: cfg.project_id.clone(),
        language_code: cfg.language_code.clone(),
    };
    let json = serde_json::to_string_pretty(&disk).map_err(|e| format!("serialize: {e}"))?;
    std::fs::write(&path, json).map_err(|e| format!("write {}: {e}", path.display()))?;
    Ok(())
}

/// Called from lib.rs setup to rehydrate the GCP state from disk at
/// boot. Non-fatal: logs + returns None on any error.
pub async fn restore_gcp_config_on_boot(app: &AppHandle, state: &PopoState) {
    let path = match config_file_path(app) {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!("could not compute GCP config path: {e}");
            return;
        }
    };

    if !path.exists() {
        tracing::info!("no existing GCP config at {}", path.display());
        return;
    }

    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(e) => {
            tracing::warn!("could not read {}: {e}", path.display());
            return;
        }
    };

    let disk: DiskConfig = match serde_json::from_slice(&bytes) {
        Ok(d) => d,
        Err(e) => {
            tracing::warn!("could not parse {}: {e}", path.display());
            return;
        }
    };

    let config = GcpConfig {
        service_account_path: disk.service_account_path,
        project_id: disk.project_id,
        language_code: disk.language_code,
    };

    if !config.is_configured() {
        return;
    }

    match authenticator_from_config(&config).await {
        Ok(auth) => {
            if let Ok(mut slot) = state.gcp.lock() {
                *slot = Some((config.clone(), auth));
                tracing::info!(
                    "GCP config restored from disk: project_id={}",
                    config.project_id
                );
            }
        }
        Err(e) => {
            tracing::warn!(
                "service account at {} no longer valid: {e}",
                config.service_account_path
            );
        }
    }
}
