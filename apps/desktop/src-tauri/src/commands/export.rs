//
// Trusted history export boundary.
//
// The frontend supplies export contents, but Rust owns the native save dialog
// and writes only the path the user approves in that same command. This avoids
// exposing a reusable `write arbitrary path` IPC primitive.

use serde::Serialize;
use tauri::{AppHandle, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

const MAX_EXPORT_BYTES: usize = 50 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    bytes_written: u64,
    path: String,
}

fn validate_suggested_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed.len() > 128
        || trimmed.contains(['/', '\\'])
        || !trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        return Err("invalid export file name".into());
    }
    Ok(trimmed.to_string())
}

#[tauri::command]
pub async fn cmd_export_history(
    app: AppHandle,
    window: WebviewWindow,
    json_contents: String,
    text_contents: String,
    suggested_name: String,
) -> Result<Option<ExportResult>, String> {
    if window.label() != "main" {
        return Err("history export is available only from the main window".into());
    }
    if json_contents.len() > MAX_EXPORT_BYTES || text_contents.len() > MAX_EXPORT_BYTES {
        return Err("history export is too large".into());
    }
    let suggested_name = validate_suggested_name(&suggested_name)?;

    let dialog_app = app.clone();
    let selected = tauri::async_runtime::spawn_blocking(move || {
        dialog_app
            .dialog()
            .file()
            .set_title("Export PoPo history")
            .set_file_name(suggested_name)
            .add_filter("JSON", &["json"])
            .add_filter("Text", &["txt"])
            .blocking_save_file()
    })
    .await
    .map_err(|e| format!("save dialog failed: {e}"))?;

    let Some(selected) = selected else {
        return Ok(None);
    };
    let target = selected
        .into_path()
        .map_err(|e| format!("invalid export path: {e}"))?;
    let extension = target
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let contents = match extension.as_str() {
        "json" => json_contents,
        "txt" => text_contents,
        _ => return Err("export path must end in .json or .txt".into()),
    };

    tokio::fs::write(&target, contents.as_bytes())
        .await
        .map_err(|e| format!("couldn't write the selected export: {e}"))?;

    tracing::info!(
        "cmd_export_history: wrote {} bytes to a user-approved path",
        contents.len()
    );
    Ok(Some(ExportResult {
        bytes_written: contents.len() as u64,
        path: target.to_string_lossy().into_owned(),
    }))
}

#[cfg(test)]
mod tests {
    use super::validate_suggested_name;

    #[test]
    fn accepts_safe_export_names() {
        assert!(validate_suggested_name("popo-history-2026-01-01.json").is_ok());
    }

    #[test]
    fn rejects_paths_and_shell_like_names() {
        assert!(validate_suggested_name("../history.json").is_err());
        assert!(validate_suggested_name("folder\\history.json").is_err());
        assert!(validate_suggested_name("history.json;calc.exe").is_err());
    }
}
