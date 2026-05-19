// focus/app_enum.rs — enumerate currently-running top-level apps
// AND installed apps (via Start Menu walk), deduped into one list.
//
// Used by `cmd_list_running_apps` which powers the AppPicker in:
//   - Settings → Paste → per-app paste shortcut overrides
//   - Modes   → ModeEditor → per-mode app bindings
//
// Two sources get merged:
//
// 1. RUNNING apps (EnumWindows). Fast, icons from live HWNDs, always
//    fresh. Running apps carry `isRunning = true` + a window title.
//
// 2. INSTALLED apps (Start Menu .lnk walk). Covers everything the user
//    could plausibly paste into — including apps not currently open.
//    Matches what the Windows Start Menu shows. Icons extracted via
//    `SHGetFileInfoW` on the .lnk path (Windows resolves the shortcut
//    target automatically). `isRunning = false`, no title.
//
// Dedup key: case-insensitive friendly name. Running entries win when
// both sources produce the same name — the running version has fresher
// state + already-extracted icon.
//
// Installed-apps enumeration is CACHED in a module-level OnceLock.
// First call: ~1-5 s (walks Start Menu + extracts ~100-300 icons).
// Subsequent calls: <50 ms (returns cache + re-runs the fast running
// enum). Cache is invalidated when the frontend calls with
// `refresh=true` (the AppPicker's refresh button).
//
// Cost on a typical workstation:
//   - Running-only: ~300 ms (80 top-level windows, ~15 unique apps,
//     ~20 ms/icon).
//   - First full scan: ~2-5 s (150-300 Start Menu .lnks).
//   - Cached: ~300 ms (just the running-apps refresh).

use std::collections::{HashMap, HashSet};
use std::ffi::c_void;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use serde::Serialize;

#[cfg(target_os = "windows")]
use windows::core::{Interface, PWSTR};
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{BOOL, HANDLE, HWND, LPARAM, MAX_PATH};
#[cfg(target_os = "windows")]
use windows::Win32::Storage::FileSystem::WIN32_FIND_DATAW;
#[cfg(target_os = "windows")]
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, IPersistFile,
    CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, STGM_READ,
};
#[cfg(target_os = "windows")]
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION,
};
#[cfg(target_os = "windows")]
use windows::Win32::UI::Shell::{
    FOLDERID_CommonPrograms, FOLDERID_Programs, IShellLinkW, SHGetKnownFolderPath, ShellLink,
    KF_FLAG_DEFAULT,
};
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible,
};

/// One entry in the running-apps list returned to the frontend.
/// Mirrors `packages/shared-types/src/index.ts::RunningApp`.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RunningApp {
    /// Friendly name (e.g. "Chrome", "VS Code"). Key used for dedupe
    /// AND for matching in the paste-override / mode-binding resolvers.
    pub name: String,
    /// Full path to the source file — .exe for running apps, .lnk for
    /// installed-only entries. Used as the picker tooltip + debug aid.
    pub exe_path: String,
    /// Window title of the first visible window we saw for this app.
    /// Only populated for running apps; None for installed-only entries.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Base64-encoded PNG of the app's icon. `None` when the icon
    /// couldn't be extracted (rare — usually elevated processes or
    /// system windows we couldn't open).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_base64: Option<String>,
    /// True when the app has at least one visible window right now.
    /// Installed-only entries have `isRunning = false` and typically
    /// render with slightly softer color in the picker.
    pub is_running: bool,
}

/// Intermediate bucket used during enumeration. We can't emit
/// `RunningApp` directly from the EnumWindows callback because the
/// callback only sees one HWND at a time — dedupe has to happen
/// across the whole walk.
#[cfg(target_os = "windows")]
struct Bucket {
    /// First HWND we saw for this app (used for icon extraction).
    first_hwnd: isize,
    exe_path: String,
    title: Option<String>,
}

/// Module-level cache of the installed-apps list. Populated on first
/// call; reused thereafter. The AppPicker's refresh button blows this
/// away via `list_all_apps(true)`.
static INSTALLED_APPS_CACHE: OnceLock<Mutex<Option<Vec<RunningApp>>>> = OnceLock::new();

fn installed_apps_cache() -> &'static Mutex<Option<Vec<RunningApp>>> {
    INSTALLED_APPS_CACHE.get_or_init(|| Mutex::new(None))
}

/// Public entry point. Called by `commands::apps::cmd_list_running_apps`.
///
/// Returns a sorted, deduped list of:
///   - Every currently-running top-level app (`isRunning = true`)
///   - Every app with a Start Menu entry (`isRunning = false`)
///
/// Running entries win on name collision. `refresh = true` forces a
/// rescan of the Start Menu + icon re-extraction; without it, installed
/// apps come from the module-level cache.
///
/// popo itself is filtered out.
#[cfg(target_os = "windows")]
pub fn list_running_apps(refresh: bool) -> Vec<RunningApp> {
    let mut running = enumerate_running_apps();
    for a in &mut running {
        a.is_running = true;
    }

    let installed = installed_apps(refresh);

    // Dedupe: running wins. Build a lowercase-name set from running
    // entries, then append installed entries whose name doesn't
    // collide.
    let running_names: HashSet<String> = running.iter().map(|a| a.name.to_lowercase()).collect();
    let mut combined = running;
    for app in installed {
        if !running_names.contains(&app.name.to_lowercase()) {
            combined.push(app);
        }
    }

    combined.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    combined
}

/// Non-Windows stub so `cargo check` on Linux/Mac compiles. popo is
/// Windows-only at runtime.
#[cfg(not(target_os = "windows"))]
pub fn list_running_apps(_refresh: bool) -> Vec<RunningApp> {
    Vec::new()
}

// ── Running apps (EnumWindows) ──────────────────────────────

#[cfg(target_os = "windows")]
fn enumerate_running_apps() -> Vec<RunningApp> {
    let mut buckets: HashMap<String, Bucket> = HashMap::new();

    // SAFETY: EnumWindows is a synchronous OS call with a well-defined
    // callback contract. The callback uses `&mut buckets` via the
    // LPARAM pointer cast; no references escape the enumeration.
    unsafe {
        let ptr = &mut buckets as *mut HashMap<String, Bucket> as *mut c_void;
        let _ = EnumWindows(Some(enum_proc), LPARAM(ptr as isize));
    }

    // Extract icons + build the RunningApp list.
    let mut out: Vec<RunningApp> = Vec::with_capacity(buckets.len());
    for (name, bucket) in buckets.into_iter() {
        let icon_b64 = {
            let raw = super::app_icon::get_app_icon_base64(bucket.first_hwnd);
            if raw.is_empty() {
                None
            } else {
                Some(raw)
            }
        };
        out.push(RunningApp {
            name,
            exe_path: bucket.exe_path,
            title: bucket.title,
            icon_base64: icon_b64,
            is_running: false, // patched by caller
        });
    }
    out
}

/// Called once per top-level HWND on the current desktop. Accumulates
/// visible titled apps into the HashMap pointed to by `lparam`.
///
/// Returns TRUE to continue enumeration. We never bail early — every
/// candidate is evaluated.
#[cfg(target_os = "windows")]
unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let buckets = &mut *(lparam.0 as *mut HashMap<String, Bucket>);

    if !IsWindowVisible(hwnd).as_bool() {
        return BOOL(1);
    }
    let title_len = GetWindowTextLengthW(hwnd);
    if title_len <= 0 {
        return BOOL(1);
    }

    let mut title_buf = vec![0u16; (title_len as usize) + 1];
    let read = GetWindowTextW(hwnd, &mut title_buf);
    if read <= 0 {
        return BOOL(1);
    }
    title_buf.truncate(read as usize);
    let title = String::from_utf16_lossy(&title_buf);

    let exe_path = match get_exe_path_for_hwnd(hwnd) {
        Some(p) => p,
        None => return BOOL(1),
    };

    let friendly = super::app_icon::pretty_app_name(&exe_path);
    if friendly.eq_ignore_ascii_case("popo") {
        return BOOL(1);
    }

    buckets.entry(friendly).or_insert(Bucket {
        first_hwnd: hwnd.0 as isize,
        exe_path,
        title: if title.trim().is_empty() {
            None
        } else {
            Some(title)
        },
    });

    BOOL(1)
}

/// Resolve the full .exe path of the process that owns `hwnd`.
#[cfg(target_os = "windows")]
unsafe fn get_exe_path_for_hwnd(hwnd: HWND) -> Option<String> {
    let mut pid: u32 = 0;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    if pid == 0 {
        return None;
    }

    let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;

    let mut buf = vec![0u16; MAX_PATH as usize];
    let mut size = buf.len() as u32;
    let result = QueryFullProcessImageNameW(
        handle,
        PROCESS_NAME_FORMAT(0),
        PWSTR(buf.as_mut_ptr()),
        &mut size,
    );
    let _ = windows::Win32::Foundation::CloseHandle(handle);

    if result.is_err() || size == 0 {
        return None;
    }
    buf.truncate(size as usize);
    Some(String::from_utf16_lossy(&buf))
}

// ── Installed apps (Start Menu walk) ───────────────────────

/// Return the cached installed-apps list, or build it if the cache is
/// empty / `refresh` is true.
#[cfg(target_os = "windows")]
fn installed_apps(refresh: bool) -> Vec<RunningApp> {
    if !refresh {
        if let Ok(guard) = installed_apps_cache().lock() {
            if let Some(cached) = guard.as_ref() {
                tracing::debug!("installed_apps: cache hit ({} entries)", cached.len());
                return cached.clone();
            }
        }
    } else {
        // Clear cache so the next cache read (from a peer call) also misses.
        if let Ok(mut guard) = installed_apps_cache().lock() {
            *guard = None;
        }
    }

    let started = std::time::Instant::now();
    let fresh = scan_installed_apps();
    let took = started.elapsed();
    tracing::info!(
        "installed_apps: scanned {} entries in {}ms",
        fresh.len(),
        took.as_millis()
    );

    if let Ok(mut guard) = installed_apps_cache().lock() {
        *guard = Some(fresh.clone());
    }
    fresh
}

/// Walk both Start Menu folders, collect all .lnk files, resolve each
/// one's TARGET `.exe` via `IShellLinkW`, dedupe by friendly name,
/// extract an icon per unique entry.
///
/// Why resolve targets (added in follow-up to initial ship):
///
/// 1. **Clean icons.** `SHGetFileInfoW` on a `.lnk` returns the icon
///    WITH the Windows shortcut-arrow overlay composited on top.
///    Extracting from the target `.exe` directly gives a clean icon.
///
/// 2. **Correct dedup with running apps.** Running apps go through
///    `pretty_app_name(exe_path)` which maps `Code.exe` → "VS Code",
///    `chrome.exe` → "Chrome", etc. Installed apps whose `.lnk`
///    filename differs from what that map produces (e.g. "Visual
///    Studio Code.lnk") would otherwise show up as a duplicate
///    entry in the picker. Resolving the target then running it
///    through the same map eliminates the mismatch.
///
/// 3. **Informative tooltip path.** Users scroll tooltips and see the
///    actual `.exe` path, not a `.lnk` path with shortcut-arrow
///    icons that look half-broken.
///
/// If target resolution fails (Store apps, UWP, non-`.exe` targets,
/// COM errors) we fall back to the `.lnk` itself for icon + name.
/// That still works — just with the shortcut-arrow overlay and the
/// raw filename. Rare enough to not bother designing around.
#[cfg(target_os = "windows")]
fn scan_installed_apps() -> Vec<RunningApp> {
    let mut folders: Vec<PathBuf> = Vec::new();
    // SAFETY: SHGetKnownFolderPath is a well-behaved COM-free shell
    // API with a clear ownership contract (caller frees via
    // CoTaskMemFree). The FOLDERID_ constants are `&'static KNOWNFOLDERID`.
    unsafe {
        if let Some(p) = known_folder_path(&FOLDERID_Programs as *const _ as *const _) {
            folders.push(p);
        }
        if let Some(p) = known_folder_path(&FOLDERID_CommonPrograms as *const _ as *const _) {
            folders.push(p);
        }
    }

    // Collect ALL .lnk paths first (dedup by filename stem just to
    // avoid re-reading same stub from both user + all-users menus).
    let mut lnks: HashMap<String, PathBuf> = HashMap::new();
    for folder in folders {
        walk_for_lnk(&folder, &mut lnks, 0);
    }

    // Initialize COM once for the whole batch. Shell interfaces want
    // single-thread apartment. Per-lnk init would add ~1 ms overhead
    // x 200 lnks = 200 ms wasted; one-shot is ~instant.
    //
    // CoInitializeEx returns S_OK on fresh init OR S_FALSE if this
    // thread already has COM initialized with the same concurrency
    // model. We only call CoUninitialize when S_OK (we initialized)
    // to avoid tearing down a caller-owned init.
    let com_owned = unsafe {
        let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        // `hr` is an HRESULT returned as windows::core::Result<()>.
        // S_OK + S_FALSE both mean "we can use COM now"; only S_OK
        // means "we own the init" and must pair with Uninitialize.
        hr.is_ok()
    };

    // Per-lnk: resolve target → pick friendly name + icon source.
    // Dedup by friendly name across the whole batch.
    let mut buckets: HashMap<String, (PathBuf, PathBuf)> = HashMap::new();
    //                                ^icon_source ^display_path
    for (_stem, lnk_path) in lnks.into_iter() {
        let target = unsafe { resolve_lnk_target(&lnk_path) };

        // Figure out friendly name + icon source based on target.
        let (friendly, icon_source, display_path) = match &target {
            Some(t) if is_exe_like(t) => {
                let name = super::app_icon::pretty_app_name(&t.to_string_lossy());
                (name, t.clone(), t.clone())
            }
            _ => {
                // Fall back to the .lnk itself for both icon + name.
                let stem = lnk_path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("Unknown")
                    .to_string();
                (stem, lnk_path.clone(), lnk_path.clone())
            }
        };

        if friendly.eq_ignore_ascii_case("popo") {
            continue;
        }
        // Skip uninstaller / helper stubs.
        let lower = friendly.to_lowercase();
        if lower.contains("uninstall")
            || lower.contains("readme")
            || lower == "help"
            || lower == "documentation"
            || lower == "release notes"
        {
            continue;
        }

        buckets
            .entry(friendly)
            .or_insert((icon_source, display_path));
    }

    // Icon extraction. Sequential; each call is ~5-30 ms. 200 items
    // => ~2-5 s total on cold run. Parallelism would help but GDI is
    // single-threaded-ish and the cache kills re-invocation cost.
    let mut out: Vec<RunningApp> = Vec::with_capacity(buckets.len());
    for (name, (icon_source, display_path)) in buckets.into_iter() {
        let icon = extract_icon_for_path(&icon_source);
        out.push(RunningApp {
            name,
            exe_path: display_path.to_string_lossy().into_owned(),
            title: None,
            icon_base64: icon,
            is_running: false,
        });
    }

    if com_owned {
        unsafe {
            CoUninitialize();
        }
    }

    out
}

/// True when `path` looks like an executable (`.exe` extension).
/// Non-exe targets (folders, URLs, documents) get fallback treatment.
#[cfg(target_os = "windows")]
fn is_exe_like(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|s| s.to_str())
        .map(|s| s.eq_ignore_ascii_case("exe"))
        .unwrap_or(false)
}

/// Resolve a `.lnk` file to its target path via `IShellLinkW` COM.
///
/// Returns `None` on any failure: non-exe targets (URLs, docs), Store
/// apps (which use `.lnk`-like "AppUserModelID" references that GetPath
/// can't resolve), broken shortcuts, COM errors, etc.
///
/// SAFETY: caller must have CoInitializeEx'd the current thread with
/// COINIT_APARTMENTTHREADED (see `scan_installed_apps`). This function
/// creates a fresh `IShellLinkW` per call so there's no state leak
/// between invocations.
#[cfg(target_os = "windows")]
unsafe fn resolve_lnk_target(lnk_path: &std::path::Path) -> Option<PathBuf> {
    use std::os::windows::ffi::OsStrExt;

    // 1. Create ShellLink COM object.
    let shell_link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).ok()?;

    // 2. QueryInterface for IPersistFile.
    let persist_file: IPersistFile = shell_link.cast().ok()?;

    // 3. Load the .lnk file into the shell-link object.
    let wide_path: Vec<u16> = lnk_path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let pcwstr = windows::core::PCWSTR(wide_path.as_ptr());
    persist_file.Load(pcwstr, STGM_READ).ok()?;

    // 4. Read the target path. MAX_PATH wide chars + null terminator.
    let mut target_buf = vec![0u16; MAX_PATH as usize];
    let mut find_data = WIN32_FIND_DATAW::default();
    // fflags = 0 (default) → Windows resolves env vars + returns the
    // best available path (MUI-localized, CSIDL-expanded, etc.).
    shell_link
        .GetPath(&mut target_buf, &mut find_data, 0)
        .ok()?;

    // Trim at the null terminator.
    let len = target_buf
        .iter()
        .position(|&c| c == 0)
        .unwrap_or(target_buf.len());
    if len == 0 {
        return None;
    }

    let target_str = String::from_utf16_lossy(&target_buf[..len]);
    if target_str.trim().is_empty() {
        return None;
    }
    Some(PathBuf::from(target_str))
}

/// Resolve a known folder GUID to a PathBuf. Returns None on any
/// failure (permission denied, missing folder, malformed path).
#[cfg(target_os = "windows")]
unsafe fn known_folder_path(rfid: *const windows::core::GUID) -> Option<PathBuf> {
    use std::os::windows::ffi::OsStringExt;

    let result = SHGetKnownFolderPath(rfid, KF_FLAG_DEFAULT, HANDLE::default());
    let pwstr = result.ok()?;
    if pwstr.0.is_null() {
        return None;
    }

    // Compute length until null terminator.
    let mut len = 0usize;
    while *pwstr.0.add(len) != 0 {
        len += 1;
    }
    let slice = std::slice::from_raw_parts(pwstr.0, len);
    let os = std::ffi::OsString::from_wide(slice);

    // The shell allocated pwstr via CoTaskMemAlloc; we MUST free it.
    CoTaskMemFree(Some(pwstr.0 as *mut _));

    Some(PathBuf::from(os))
}

/// Recursively walk `dir` for .lnk files. Stops at `MAX_DEPTH` to
/// avoid symlink loops / pathological nesting. Populates `buckets`
/// with `{ friendly_name: lnk_path }`, first-match-wins when the
/// same friendly name appears in multiple subfolders.
#[cfg(target_os = "windows")]
fn walk_for_lnk(dir: &std::path::Path, buckets: &mut HashMap<String, PathBuf>, depth: usize) {
    const MAX_DEPTH: usize = 6;
    if depth > MAX_DEPTH {
        return;
    }

    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(ftype) = entry.file_type() else {
            continue;
        };
        let path = entry.path();
        if ftype.is_dir() {
            walk_for_lnk(&path, buckets, depth + 1);
            continue;
        }
        // Only .lnk (case-insensitive).
        let is_lnk = path
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.eq_ignore_ascii_case("lnk"))
            .unwrap_or(false);
        if !is_lnk {
            continue;
        }
        // Friendly name = filename stem. No deep target-resolution —
        // the user-facing label IS what the Start Menu shows, so using
        // the .lnk's filename keeps what they see in the picker
        // identical to what they see when they press the Windows key.
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let friendly = stem.to_string();
        // Skip uninstaller / helper stubs the user would never paste into.
        let lower = friendly.to_lowercase();
        if lower.contains("uninstall")
            || lower.contains("readme")
            || lower == "help"
            || lower == "documentation"
            || lower == "release notes"
        {
            continue;
        }
        buckets.entry(friendly).or_insert(path);
    }
}

/// Convert a filesystem path to a null-terminated UTF-16 buffer, then
/// hand it to `focus::app_icon::extract_icon_png_from_wide_path` for
/// HICON + PNG encoding. Returns a base64-encoded PNG on success.
#[cfg(target_os = "windows")]
fn extract_icon_for_path(path: &std::path::Path) -> Option<String> {
    use std::os::windows::ffi::OsStrExt;

    let wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let bytes = super::app_icon::extract_icon_png_from_wide_path(&wide)?;
    use base64::Engine;
    Some(base64::engine::general_purpose::STANDARD.encode(&bytes))
}
