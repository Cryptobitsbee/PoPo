// focus/app_icon.rs — Extract the icon of the foreground application.
//
// Used by the pill to show WHICH app will receive the transcription.
//
// Win32 fallback chain (tries each in order until one works):
//   1. SendMessageW(hwnd, WM_GETICON, ICON_BIG, 0)
//   2. SendMessageW(hwnd, WM_GETICON, ICON_SMALL2, 0)
//   3. GetClassLongPtrW(hwnd, GCLP_HICON)
//   4. GetClassLongPtrW(hwnd, GCLP_HICONSM)
//   5. SHGetFileInfoW on the process's .exe path (Chrome, VS Code,
//      Electron apps, UWP — most modern apps don't set window icons,
//      the icon lives in the .exe's resources instead)
//
// After getting an HICON:
//   6. GetIconInfo → HBITMAP (color bitmap)
//   7. GetDIBits → raw BGRA pixel data
//   8. Convert BGRA → RGBA → encode as PNG (miniz_oxide deflate)
//   9. Base64-encode for the frontend

use windows::core::PCWSTR;
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, MAX_PATH, WPARAM};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, SelectObject, BITMAP,
    BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Shell::{
    ExtractIconExW, SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON,
};
use windows::Win32::UI::WindowsAndMessaging::{
    DestroyIcon, GetClassLongPtrW, GetIconInfo, GetWindowThreadProcessId, SendMessageW, GCLP_HICON,
    GCLP_HICONSM, HICON, ICONINFO, WM_GETICON,
};

/// Extract the foreground app's icon as base64-encoded PNG.
/// Returns empty string on failure (non-fatal).
pub fn get_app_icon_base64(hwnd_raw: isize) -> String {
    tracing::info!("icon: starting extraction for hwnd={hwnd_raw}");
    match extract_icon_png(hwnd_raw) {
        Some(png_bytes) => {
            tracing::info!("icon: extraction succeeded, {} PNG bytes", png_bytes.len());
            use base64::Engine;
            base64::engine::general_purpose::STANDARD.encode(&png_bytes)
        }
        None => {
            tracing::warn!("icon: extraction returned None for hwnd={hwnd_raw}");
            String::new()
        }
    }
}

/// Extract a display-friendly name for the foreground app.
///
/// Strategy: resolve the process's .exe path, take the file-stem
/// ("chrome.exe" → "chrome"), then title-case it ("chrome" → "Chrome").
/// A small override table patches well-known exe names that don't
/// title-case nicely ("Code.exe" → "VS Code", "msedge" → "Edge").
///
/// Returns `None` on any failure; callers should fall back to a
/// generic "Unknown app" label.
pub fn get_app_name(hwnd_raw: isize) -> Option<String> {
    let name = std::panic::catch_unwind(|| unsafe {
        let hwnd = HWND(hwnd_raw as *mut _);
        let path = get_process_exe_path(hwnd)?;
        let s = String::from_utf16_lossy(&path[..path.len().saturating_sub(1)]);
        Some(pretty_app_name(&s))
    })
    .ok()
    .flatten();

    if let Some(ref n) = name {
        tracing::info!("icon: resolved app name = {n:?}");
    }
    name
}

/// Convert a full .exe path into a human-readable app name.
/// `C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe` → `Chrome`.
///
/// Visibility: `pub(super)` so `focus::app_enum` can reuse the same
/// mapping — the running-apps picker MUST produce the same friendly
/// names this function does, otherwise paste-override / mode-binding
/// matches won't fire at runtime.
pub(super) fn pretty_app_name(exe_path: &str) -> String {
    // Get the file stem (filename without extension).
    let stem = std::path::Path::new(exe_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();

    if stem.is_empty() {
        return "Unknown".into();
    }

    // Well-known overrides. Key comparison is case-insensitive.
    let lower = stem.to_lowercase();
    let override_name = match lower.as_str() {
        "code" => Some("VS Code"),
        "code - insiders" => Some("VS Code Insiders"),
        "cursor" => Some("Cursor"),
        "msedge" => Some("Edge"),
        "msedgewebview2" => Some("Edge WebView"),
        "iexplore" => Some("Internet Explorer"),
        "chrome" => Some("Chrome"),
        "firefox" => Some("Firefox"),
        "brave" => Some("Brave"),
        "opera" => Some("Opera"),
        "arc" => Some("Arc"),
        "zen" => Some("Zen"),
        "slack" => Some("Slack"),
        "discord" => Some("Discord"),
        "teams" => Some("Teams"),
        "whatsapp" => Some("WhatsApp"),
        "telegram" => Some("Telegram"),
        "signal" => Some("Signal"),
        "zoom" => Some("Zoom"),
        "outlook" => Some("Outlook"),
        "winword" => Some("Word"),
        "excel" => Some("Excel"),
        "powerpnt" => Some("PowerPoint"),
        "onenote" => Some("OneNote"),
        "explorer" => Some("File Explorer"),
        "notepad" => Some("Notepad"),
        "notepad++" => Some("Notepad++"),
        "sublime_text" => Some("Sublime Text"),
        "idea64" | "idea" => Some("IntelliJ IDEA"),
        "webstorm64" | "webstorm" => Some("WebStorm"),
        "pycharm64" | "pycharm" => Some("PyCharm"),
        "rider64" | "rider" => Some("Rider"),
        "goland64" | "goland" => Some("GoLand"),
        "figma" => Some("Figma"),
        "linear" => Some("Linear"),
        "notion" => Some("Notion"),
        "obsidian" => Some("Obsidian"),
        "typora" => Some("Typora"),
        "spotify" => Some("Spotify"),
        "terminal" | "windowsterminal" => Some("Windows Terminal"),
        "powershell" => Some("PowerShell"),
        "pwsh" => Some("PowerShell"),
        "cmd" => Some("Command Prompt"),
        "wt" => Some("Windows Terminal"),
        "popo" => Some("popo"),
        _ => None,
    };

    if let Some(o) = override_name {
        return o.into();
    }

    // Default: title-case the first letter; leave the rest intact so
    // camel-cased names (like "MyApp") render as "MyApp" not "Myapp".
    let mut chars = stem.chars();
    match chars.next() {
        Some(c) => c.to_uppercase().chain(chars).collect(),
        None => "Unknown".into(),
    }
}

fn extract_icon_png(hwnd_raw: isize) -> Option<Vec<u8>> {
    // Wrap in catch_unwind because unsafe Win32 calls can
    // segfault/panic on certain HWNDs (e.g., elevated processes,
    // system windows, or popo's own windows).
    match std::panic::catch_unwind(|| unsafe { extract_icon_png_inner(hwnd_raw) }) {
        Ok(result) => result,
        Err(_) => {
            tracing::error!("icon: PANIC during icon extraction for hwnd={hwnd_raw}");
            None
        }
    }
}

/// Extract an icon PNG from a file path (null-terminated wide string).
/// Used by `focus::app_enum` to get icons for Start Menu `.lnk` files
/// + installed-app exes that don't have a live HWND.
///
/// Wrapped in catch_unwind for the same reason as `extract_icon_png`:
/// some system files produce edge-case HICONs that crash GDI.
/// Returns None silently on any failure.
pub(super) fn extract_icon_png_from_wide_path(wide_path: &[u16]) -> Option<Vec<u8>> {
    let path_vec = wide_path.to_vec();
    match std::panic::catch_unwind(|| unsafe { extract_icon_from_path_inner(&path_vec) }) {
        Ok(result) => result,
        Err(_) => None,
    }
}

unsafe fn extract_icon_from_path_inner(wide_path: &[u16]) -> Option<Vec<u8>> {
    // Try ExtractIconExW first (works for .exe / .dll / .ico).
    // Then fall back to SHGetFileInfoW which handles .lnk by
    // dereferencing the shortcut's target. Both return HICONs we own.
    let h_and_owned = icon_via_extract_icon_ex(wide_path)
        .map(|h| (h, true))
        .or_else(|| icon_from_exe_path(wide_path).map(|h| (h, true)));
    let (hicon, owned) = h_and_owned?;
    let result = hicon_to_png(hicon);
    if owned {
        let _ = DestroyIcon(hicon);
    }
    result
}

unsafe fn extract_icon_png_inner(hwnd_raw: isize) -> Option<Vec<u8>> {
    let hwnd = HWND(hwnd_raw as *mut _);

    tracing::info!("icon: entering get_hicon_with_fallback");
    let (hicon, owned) = get_hicon_with_fallback(hwnd)?;
    tracing::info!("icon: got hicon, converting to PNG");

    let result = hicon_to_png(hicon);

    if owned {
        let _ = DestroyIcon(hicon);
    }

    result
}

/// Try all possible ways to get an HICON for the given window.
/// Returns (hicon, owned) where `owned` is true only for icons we
/// allocated ourselves (must be destroyed via DestroyIcon).
unsafe fn get_hicon_with_fallback(hwnd: HWND) -> Option<(HICON, bool)> {
    // 1. WM_GETICON(ICON_BIG)
    let h = HICON(SendMessageW(hwnd, WM_GETICON, WPARAM(1), LPARAM(0)).0 as *mut _);
    if !h.0.is_null() {
        tracing::debug!("icon: WM_GETICON(ICON_BIG) succeeded");
        return Some((h, false));
    }

    // 2. WM_GETICON(ICON_SMALL2)
    let h = HICON(SendMessageW(hwnd, WM_GETICON, WPARAM(2), LPARAM(0)).0 as *mut _);
    if !h.0.is_null() {
        tracing::debug!("icon: WM_GETICON(ICON_SMALL2) succeeded");
        return Some((h, false));
    }

    // 3. Class icon (large)
    let ptr = GetClassLongPtrW(hwnd, GCLP_HICON);
    if ptr != 0 {
        tracing::debug!("icon: GetClassLongPtrW(GCLP_HICON) succeeded");
        return Some((HICON(ptr as *mut _), false));
    }

    // 4. Class icon (small)
    let ptr = GetClassLongPtrW(hwnd, GCLP_HICONSM);
    if ptr != 0 {
        tracing::debug!("icon: GetClassLongPtrW(GCLP_HICONSM) succeeded");
        return Some((HICON(ptr as *mut _), false));
    }

    tracing::info!("icon: window-level APIs returned null, falling back to .exe extraction");

    // 5. Get process .exe path
    let exe_path = match get_process_exe_path(hwnd) {
        Some(p) => p,
        None => {
            tracing::warn!("icon: failed to get process .exe path");
            return None;
        }
    };

    tracing::info!("icon: extracting from resolved executable path");

    // 5a. Try ExtractIconExW first (simpler, no COM init needed)
    if let Some(h) = icon_via_extract_icon_ex(&exe_path) {
        tracing::info!("icon: ExtractIconExW succeeded");
        return Some((h, true));
    }

    // 5b. Fall back to SHGetFileInfoW
    if let Some(h) = icon_from_exe_path(&exe_path) {
        tracing::info!("icon: SHGetFileInfoW succeeded");
        return Some((h, true));
    }

    tracing::warn!("icon: both ExtractIconExW and SHGetFileInfoW failed");
    None
}

/// ExtractIconExW approach — simpler than SHGetFileInfoW, no COM init needed.
/// Caller MUST DestroyIcon the returned HICON.
unsafe fn icon_via_extract_icon_ex(path: &[u16]) -> Option<HICON> {
    let mut large: [HICON; 1] = [HICON(std::ptr::null_mut())];
    let mut small: [HICON; 1] = [HICON(std::ptr::null_mut())];

    let count = ExtractIconExW(
        PCWSTR(path.as_ptr()),
        0, // first icon in the file
        Some(large.as_mut_ptr()),
        Some(small.as_mut_ptr()),
        1,
    );

    if count == u32::MAX || count == 0 {
        return None;
    }

    // Prefer large, destroy the unused small icon
    if !large[0].0.is_null() {
        if !small[0].0.is_null() {
            let _ = DestroyIcon(small[0]);
        }
        Some(large[0])
    } else if !small[0].0.is_null() {
        Some(small[0])
    } else {
        None
    }
}

/// Get the .exe path of the process that owns `hwnd`. Returns a
/// null-terminated wide string suitable for passing to SHGetFileInfoW.
unsafe fn get_process_exe_path(hwnd: HWND) -> Option<Vec<u16>> {
    let mut pid: u32 = 0;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    if pid == 0 {
        tracing::warn!("icon: GetWindowThreadProcessId returned pid=0");
        return None;
    }
    tracing::debug!("icon: foreground PID = {pid}");

    let handle = match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
        Ok(h) => h,
        Err(e) => {
            tracing::warn!("icon: OpenProcess({pid}) failed: {e:?}");
            return None;
        }
    };

    let mut buf = vec![0u16; MAX_PATH as usize];
    let mut size = buf.len() as u32;

    let result = QueryFullProcessImageNameW(
        handle,
        PROCESS_NAME_FORMAT(0), // 0 = Win32 path format
        windows::core::PWSTR(buf.as_mut_ptr()),
        &mut size,
    );
    let _ = CloseHandle(handle);

    if let Err(e) = result {
        tracing::warn!("icon: QueryFullProcessImageNameW failed: {e:?}");
        return None;
    }
    if size == 0 {
        tracing::warn!("icon: QueryFullProcessImageNameW returned size=0");
        return None;
    }

    buf.truncate(size as usize);
    buf.push(0); // ensure null-terminated
    Some(buf)
}

/// Call SHGetFileInfoW on the given .exe path to get its icon handle.
/// Caller MUST DestroyIcon the returned HICON.
unsafe fn icon_from_exe_path(path: &[u16]) -> Option<HICON> {
    let mut sfi = SHFILEINFOW::default();
    let result = SHGetFileInfoW(
        PCWSTR(path.as_ptr()),
        windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES(0),
        Some(&mut sfi),
        std::mem::size_of::<SHFILEINFOW>() as u32,
        SHGFI_ICON | SHGFI_LARGEICON,
    );

    if result == 0 || sfi.hIcon.0.is_null() {
        None
    } else {
        Some(sfi.hIcon)
    }
}

/// Convert an HICON to a PNG byte buffer. Handles all the GDI glue.
unsafe fn hicon_to_png(hicon: HICON) -> Option<Vec<u8>> {
    let mut icon_info = ICONINFO::default();
    if GetIconInfo(hicon, &mut icon_info as *mut _).is_err() {
        tracing::warn!("icon/png: GetIconInfo failed");
        return None;
    }

    let hbm_color = icon_info.hbmColor;
    let hbm_mask = icon_info.hbmMask;

    tracing::info!(
        "icon/png: GetIconInfo ok, hbmColor null={}, hbmMask null={}",
        hbm_color.0.is_null(),
        hbm_mask.0.is_null()
    );

    let cleanup = |hbm_c: windows::Win32::Graphics::Gdi::HBITMAP,
                   hbm_m: windows::Win32::Graphics::Gdi::HBITMAP| {
        if !hbm_c.0.is_null() {
            let _ = DeleteObject(hbm_c);
        }
        if !hbm_m.0.is_null() {
            let _ = DeleteObject(hbm_m);
        }
    };

    if hbm_color.0.is_null() {
        tracing::warn!("icon/png: hbmColor is null (monochrome icon?)");
        cleanup(hbm_color, hbm_mask);
        return None;
    }

    // Get bitmap dimensions via GetObjectW (reliable, unlike GetDIBits query)
    let mut bm = BITMAP::default();
    let obj_result = GetObjectW(
        hbm_color,
        std::mem::size_of::<BITMAP>() as i32,
        Some(&mut bm as *mut _ as *mut _),
    );

    let width = bm.bmWidth;
    let height = bm.bmHeight;

    tracing::info!("icon/png: GetObjectW returned {obj_result}, dimensions: {width}x{height}");

    if width == 0 || height == 0 {
        tracing::warn!("icon/png: zero dimensions from GetObjectW");
        cleanup(hbm_color, hbm_mask);
        return None;
    }

    // Now get the pixel data with known dimensions
    let mut bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height, // negative = top-down
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };

    let hdc = CreateCompatibleDC(None);
    let old_bm = SelectObject(hdc, hbm_color);

    let mut pixels = vec![0u8; (width * height * 4) as usize];

    let scanlines = GetDIBits(
        hdc,
        hbm_color,
        0,
        height as u32,
        Some(pixels.as_mut_ptr() as *mut _),
        &mut bmi,
        DIB_RGB_COLORS,
    );

    tracing::info!("icon/png: GetDIBits returned {scanlines} scanlines");

    SelectObject(hdc, old_bm);
    let _ = DeleteDC(hdc);
    cleanup(hbm_color, hbm_mask);

    if scanlines == 0 {
        tracing::warn!("icon/png: GetDIBits returned 0 scanlines");
        return None;
    }

    // BGRA → RGBA (swap B and R channels)
    for chunk in pixels.chunks_exact_mut(4) {
        chunk.swap(0, 2);
    }

    tracing::info!("icon/png: encoding {}x{} RGBA to PNG", width, height);
    encode_rgba_png(width as u32, height as u32, &pixels)
}

/// Encode RGBA pixel data as a PNG file.
fn encode_rgba_png(width: u32, height: u32, rgba: &[u8]) -> Option<Vec<u8>> {
    // Build raw scanlines with PNG filter byte (0 = None) per row.
    let stride = width as usize * 4;
    let mut raw = Vec::with_capacity(rgba.len() + height as usize);
    for row in 0..height as usize {
        raw.push(0);
        raw.extend_from_slice(&rgba[row * stride..(row + 1) * stride]);
    }

    let compressed = miniz_oxide::deflate::compress_to_vec_zlib(&raw, 6);

    let mut png = Vec::new();
    // PNG signature
    png.extend_from_slice(&[137, 80, 78, 71, 13, 10, 26, 10]);

    // IHDR
    let mut ihdr = Vec::new();
    ihdr.extend_from_slice(&width.to_be_bytes());
    ihdr.extend_from_slice(&height.to_be_bytes());
    ihdr.push(8); // bit depth
    ihdr.push(6); // color type: RGBA
    ihdr.push(0); // compression
    ihdr.push(0); // filter
    ihdr.push(0); // interlace
    write_png_chunk(&mut png, b"IHDR", &ihdr);

    // IDAT
    write_png_chunk(&mut png, b"IDAT", &compressed);

    // IEND
    write_png_chunk(&mut png, b"IEND", &[]);

    Some(png)
}

fn write_png_chunk(out: &mut Vec<u8>, chunk_type: &[u8; 4], data: &[u8]) {
    let len = data.len() as u32;
    out.extend_from_slice(&len.to_be_bytes());
    out.extend_from_slice(chunk_type);
    out.extend_from_slice(data);

    let mut crc_data = Vec::with_capacity(4 + data.len());
    crc_data.extend_from_slice(chunk_type);
    crc_data.extend_from_slice(data);
    let crc = crc32(&crc_data);
    out.extend_from_slice(&crc.to_be_bytes());
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc: u32 = 0xFFFFFFFF;
    for &byte in data {
        crc ^= byte as u32;
        for _ in 0..8 {
            if crc & 1 != 0 {
                crc = (crc >> 1) ^ 0xEDB88320;
            } else {
                crc >>= 1;
            }
        }
    }
    !crc
}
