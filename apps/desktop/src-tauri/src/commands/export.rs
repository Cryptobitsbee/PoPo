// commands/export.rs — export history as JSON (or TXT) to disk.
//
// Called by the Settings → Privacy → "Export history" button.
//
// Accepts a `path` + the user's current sessions as JSON-serialisable
// objects, and writes them to disk. Frontend owns the dialog + the
// data; Rust owns the filesystem write so we don't need a separate
// tauri-plugin-fs scope for arbitrary paths (tauri-plugin-fs is
// scope-locked to specific directories, and users may want to export
// to Desktop / Documents / any path the file picker returns).

use std::path::PathBuf;

use tauri::command;

/// Write `contents` to the absolute `path` the user chose via the
/// frontend's file picker. Returns the number of bytes written.
///
/// No content transformation happens here — whatever the frontend
/// hands over (a JSON string, a plain-text dump, CSV, etc.) goes to
/// disk verbatim. Keeping this generic means Settings can ship
/// multiple export formats later without changing Rust.
#[command]
pub async fn cmd_export_history_to_file(path: String, contents: String) -> Result<u64, String> {
    let target = PathBuf::from(&path);

    // Basic sanity: the parent must exist. We don't try to create it
    // because the user picked this path via a native file dialog and
    // intermediate-dir creation would be surprising.
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            return Err(format!("Parent folder doesn't exist: {}", parent.display()));
        }
    }

    let bytes = contents.as_bytes();
    std::fs::write(&target, bytes)
        .map_err(|e| format!("Couldn't write export to {}: {e}", target.display()))?;

    tracing::info!(
        "cmd_export_history_to_file: wrote {} bytes to {}",
        bytes.len(),
        target.display()
    );
    Ok(bytes.len() as u64)
}
