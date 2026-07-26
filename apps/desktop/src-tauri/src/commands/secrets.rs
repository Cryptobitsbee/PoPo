//
// Windows secret persistence for the Gemini AI Studio API key.
//
// The encrypted blob is stored in PoPo's app-data directory, but only the
// Windows user account that protected it can decrypt it (DPAPI current-user
// scope). No static encryption key is embedded in the executable.

use std::path::PathBuf;

use tauri::{AppHandle, Manager, WebviewWindow};

const GEMINI_KEY_FILE: &str = "gemini-api-key.dpapi";
const MAX_SECRET_BYTES: usize = 16 * 1024;

fn secret_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir failed: {e}"))?;
    std::fs::create_dir_all(&directory)
        .map_err(|e| format!("could not create app-data directory: {e}"))?;
    Ok(directory.join(GEMINI_KEY_FILE))
}

#[cfg(target_os = "windows")]
fn protect(plaintext: &[u8]) -> Result<Vec<u8>, String> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let mut input = plaintext.to_vec();
    let input_blob = CRYPT_INTEGER_BLOB {
        cbData: input
            .len()
            .try_into()
            .map_err(|_| "Gemini API key is too large".to_string())?,
        pbData: input.as_mut_ptr(),
    };
    let mut output_blob = CRYPT_INTEGER_BLOB::default();

    unsafe {
        CryptProtectData(
            &input_blob,
            PCWSTR::null(),
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output_blob,
        )
        .map_err(|e| format!("Windows DPAPI encryption failed: {e}"))?;

        let encrypted =
            std::slice::from_raw_parts(output_blob.pbData, output_blob.cbData as usize).to_vec();
        let _ = LocalFree(HLOCAL(output_blob.pbData.cast()));
        input.fill(0);
        Ok(encrypted)
    }
}

#[cfg(target_os = "windows")]
fn unprotect(ciphertext: &[u8]) -> Result<Vec<u8>, String> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let mut input = ciphertext.to_vec();
    let input_blob = CRYPT_INTEGER_BLOB {
        cbData: input
            .len()
            .try_into()
            .map_err(|_| "encrypted Gemini key is too large".to_string())?,
        pbData: input.as_mut_ptr(),
    };
    let mut output_blob = CRYPT_INTEGER_BLOB::default();

    unsafe {
        CryptUnprotectData(
            &input_blob,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output_blob,
        )
        .map_err(|e| format!("Windows DPAPI decryption failed: {e}"))?;

        let plaintext =
            std::slice::from_raw_parts(output_blob.pbData, output_blob.cbData as usize).to_vec();
        let _ = LocalFree(HLOCAL(output_blob.pbData.cast()));
        input.fill(0);
        Ok(plaintext)
    }
}

#[cfg(not(target_os = "windows"))]
fn protect(_plaintext: &[u8]) -> Result<Vec<u8>, String> {
    Err("secure Gemini key persistence is supported only on Windows".into())
}

#[cfg(not(target_os = "windows"))]
fn unprotect(_ciphertext: &[u8]) -> Result<Vec<u8>, String> {
    Err("secure Gemini key persistence is supported only on Windows".into())
}

pub(crate) fn persist_gemini_api_key(app: &AppHandle, key: Option<&str>) -> Result<(), String> {
    let path = secret_file_path(app)?;
    let Some(key) = key.filter(|value| !value.trim().is_empty()) else {
        if path.exists() {
            std::fs::remove_file(&path)
                .map_err(|e| format!("could not delete encrypted Gemini key: {e}"))?;
        }
        return Ok(());
    };
    if key.len() > MAX_SECRET_BYTES {
        return Err("Gemini API key is too large".into());
    }

    let encrypted = protect(key.as_bytes())?;
    let temporary = path.with_extension("dpapi.tmp");
    std::fs::write(&temporary, encrypted)
        .map_err(|e| format!("could not write encrypted Gemini key: {e}"))?;
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| format!("could not replace encrypted Gemini key: {e}"))?;
    }
    std::fs::rename(&temporary, &path)
        .map_err(|e| format!("could not finalize encrypted Gemini key: {e}"))?;
    Ok(())
}

pub(crate) fn load_gemini_api_key(app: &AppHandle) -> Result<Option<String>, String> {
    let path = secret_file_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let encrypted =
        std::fs::read(&path).map_err(|e| format!("could not read encrypted Gemini key: {e}"))?;
    if encrypted.len() > MAX_SECRET_BYTES * 4 {
        return Err("encrypted Gemini key file is unexpectedly large".into());
    }
    let plaintext = unprotect(&encrypted)?;
    let key = String::from_utf8(plaintext)
        .map_err(|_| "decrypted Gemini key is not valid UTF-8".to_string())?;
    Ok((!key.trim().is_empty()).then_some(key))
}

pub(crate) fn delete_gemini_api_key(app: &AppHandle) -> Result<(), String> {
    persist_gemini_api_key(app, None)
}

#[tauri::command]
pub fn cmd_get_gemini_api_key(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<Option<String>, String> {
    if window.label() != "main" {
        return Err("Gemini credentials are available only to the main window".into());
    }
    load_gemini_api_key(&app)
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::{protect, unprotect};

    #[test]
    fn dpapi_round_trip_uses_current_user_context() {
        let plaintext = b"test-gemini-key-not-a-real-secret";
        let encrypted = protect(plaintext).expect("DPAPI protect");
        assert_ne!(encrypted, plaintext);
        let decrypted = unprotect(&encrypted).expect("DPAPI unprotect");
        assert_eq!(decrypted, plaintext);
    }
}
