// lib.rs — popo daemon entry point.
//
// Phase 2 [6] brings the Rust core online:
//   - cpal audio capture + 16-bar RMS waveform extraction
//   - Win32 foreground-window + clipboard snapshotting
//   - fake GCP transcribe stub (real gRPC + Chirp in [6] polish)
//   - global hotkey Ctrl+Shift+Space (push-to-talk)
//   - state machine: press → record → release → transcribe → clipboard
//
// The end-to-end slice works TODAY:
//   hold Ctrl+Shift+Space → pill animates → speak → release →
//   pill success flash → clipboard contains a fake transcript.
//
// Still deferred:
//   - Phase 2 [7]: the 4-method paste orchestrator (enigo Ctrl+V etc.)
//                  + previous-clipboard restore.
//   - Phase 2 [6] polish: real tonic/Chirp gRPC + proto vendoring.
//   - Phase 3 [9]: end-to-end validation across all paste targets.

#![allow(dead_code)] // Scaffold: some items exist without callers yet.

mod audio;
mod commands;
mod focus;
mod gcp;
mod hotkey;

use std::fs;
use std::path::PathBuf;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

/// Name of the marker file dropped in %APPDATA%\popo on first successful
/// launch. Its presence tells us the user has installed+opened popo at
/// least once. Subsequent launches start silently in the tray.
const FIRST_RUN_MARKER: &str = ".installed";

use crate::commands::audio as audio_cmds;
use crate::commands::gcp as gcp_cmds;
use crate::commands::oauth as oauth_cmds;
use crate::commands::settings as settings_cmds;

/// Prewarm whichever Gemini provider the user selected. Branches on
/// `PopoState.gemini_provider`:
///   - "vertex": mints an OAuth token from the GCP service account
///     (same one Chirp uses) and warms the Vertex endpoint.
///   - "aistudio" (default): warms the AI Studio endpoint with the
///     stored API key.
/// No-op when the chosen provider's credentials aren't configured.
/// Shared by the boot prewarm + the 4-minute keep-warm loop.
async fn prewarm_gemini_for_state(state: &crate::hotkey::PopoState) {
    let provider = state
        .gemini_provider
        .lock()
        .map(|g| g.clone())
        .unwrap_or_else(|_| "aistudio".to_string());

    if provider == "vertex" {
        let gcp_snap = state.gcp.lock().ok().and_then(|g| g.clone());
        let location = state
            .vertex_location
            .lock()
            .map(|g| g.clone())
            .unwrap_or_else(|_| "global".to_string());
        if let Some((config, auth)) = gcp_snap {
            if config.is_configured() {
                if let Ok(token) = auth.access_token().await {
                    crate::gcp::gemini::prewarm(crate::gcp::gemini::GeminiBackend::Vertex {
                        access_token: &token,
                        project_id: &config.project_id,
                        location: &location,
                    })
                    .await;
                }
            }
        }
    } else {
        let key = state
            .gemini_api_key
            .lock()
            .ok()
            .and_then(|g| g.clone())
            .unwrap_or_default();
        if !key.trim().is_empty() {
            crate::gcp::gemini::prewarm(crate::gcp::gemini::GeminiBackend::AiStudio {
                api_key: &key,
            })
            .await;
        }
    }
}
use crate::commands::system as system_cmds;
use crate::commands::test as test_cmds;
use crate::commands::test::TestRecordingState;

/// Custom Tauri commands are otherwise globally invokable by every webview.
/// Keep the narrow switcher surface explicit and deny the pill all custom IPC;
/// plugin/core capabilities remain governed by the capability JSON files.
fn custom_command_allowed(window_label: &str, command: &str) -> bool {
    match window_label {
        "main" => true,
        "switcher" => matches!(
            command,
            "cmd_set_mode_bindings" | "cmd_set_auto_format_prompt" | "cmd_hide_mode_switcher"
        ),
        _ => false,
    }
}

use crate::hotkey::{default_hotkey, switcher_hotkey, PopoState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // popo's runtime state (current recording session, future flags).
        .manage(PopoState::default())
        .manage(TestRecordingState::default())
        // ── Single-instance ────────────────────────────────────────
        // If a second popo.exe is launched (e.g. Windows double-firing
        // autostart on resume-from-sleep, or user clicking the shortcut
        // while the daemon is already running), focus the existing
        // main window instead of spawning another process.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            tracing::info!("second instance detected — focusing existing main window");
            show_main(app);
        }))
        // Platform plugins. URL opening is explicit and capability-scoped;
        // do not inject automatic target=_blank/Ctrl-click handlers.
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None, // no extra launch args
        ))
        // Global shortcut with our press/release handler. Hotkey itself
        // is registered in the setup hook below.
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(hotkey::on_event)
                .build(),
        )
        // GCP config commands (Phase 2 [6] polish). Frontend invokes
        // these from the GCP Setup wizard + Settings page.
        .invoke_handler(|invoke: tauri::ipc::Invoke<tauri::Wry>| {
            let window_label = invoke.message.webview_ref().label().to_string();
            let command = invoke.message.command().to_string();
            if !custom_command_allowed(&window_label, &command) {
                tracing::warn!(
                    "blocked custom IPC command {command:?} from webview {window_label:?}"
                );
                invoke
                    .resolver
                    .reject("command is not allowed from this window");
                return true;
            }

            let command_handler: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool =
                tauri::generate_handler![
                gcp_cmds::cmd_set_gcp_config,
                gcp_cmds::cmd_get_gcp_config,
                gcp_cmds::cmd_gcp_test_connection,
                gcp_cmds::cmd_gemini_test_connection,
                gcp_cmds::cmd_update_language,
                oauth_cmds::cmd_start_oauth_listener,
                oauth_cmds::cmd_open_oauth_url,
                settings_cmds::cmd_list_mics,
                settings_cmds::cmd_set_mic,
                settings_cmds::cmd_set_hotkey,
                settings_cmds::cmd_get_current_hotkey,
                settings_cmds::cmd_set_recording_mode,
                settings_cmds::cmd_set_restore_clipboard,
                settings_cmds::cmd_set_silence_detection,
                settings_cmds::cmd_set_store_audio,
                settings_cmds::cmd_set_sound_effects,
                settings_cmds::cmd_set_start_at_login,
                // Phase C (Chirp 3 feature flags)
                settings_cmds::cmd_set_spoken_punctuation,
                settings_cmds::cmd_set_spoken_emojis,
                settings_cmds::cmd_set_profanity_filter,
                settings_cmds::cmd_set_multi_language_codes,
                // Phase D (Gemini Flash auto-format)
                settings_cmds::cmd_set_auto_format,
                settings_cmds::cmd_set_auto_format_prompt,
                // Snippets + Dictionary
                settings_cmds::cmd_set_snippets,
                settings_cmds::cmd_set_dictionary,
                // Per-mode app bindings + per-app paste overrides
                settings_cmds::cmd_set_mode_bindings,
                settings_cmds::cmd_set_paste_overrides,
                // Endpointing sensitivity (Chirp 3)
                settings_cmds::cmd_set_endpointing_sensitivity,
                // Gemini 3.5 Flash-Lite polish (Session 58)
                // Session 35: cmd_set_smart_cleanup removed; auto_format gates Gemini.
                settings_cmds::cmd_set_gemini_api_key,
                crate::commands::secrets::cmd_get_gemini_api_key,
                settings_cmds::cmd_set_gemini_provider,
                // Running-apps enumeration for AppPicker UIs
                crate::commands::apps::cmd_list_running_apps,
                // Export + account management
                crate::commands::export::cmd_export_history,
                crate::commands::account::cmd_clear_local_user_data,
                // Quick Mode Switcher
                crate::commands::switcher::cmd_show_mode_switcher,
                crate::commands::switcher::cmd_hide_mode_switcher,
                crate::commands::switcher::cmd_set_pending_forced_mode,
                crate::commands::switcher::cmd_clear_pending_forced_mode,
                audio_cmds::cmd_read_audio_bytes,
                audio_cmds::cmd_delete_audio_file,
                audio_cmds::cmd_get_audio_peaks,
                test_cmds::cmd_test_dictate_start,
                test_cmds::cmd_test_dictate_stop,
                system_cmds::cmd_launch_uninstaller,
            ];
            command_handler(invoke)
        })
        .setup(|app| {
            // --- First-run detection -----------------------------------
            // We treat "no marker file in %APPDATA%\popo" as first run.
            // On first run we:
            //   1. show the main window immediately (so users can see
            //      the app instead of hunting for the tray icon), and
            //   2. programmatically enable autostart so popo starts
            //      with Windows from now on.
            //
            // Subsequent launches skip both — the tray is the only
            // visible surface (per brief § daemon semantics).
            let is_first_run = detect_first_run(&app.handle());
            if is_first_run {
                tracing::info!("first run detected — will show main window + enable autostart");
            }

            // --- Tray icon ----------------------------------------------
            // Left-click opens main window. Menu: Open / Quit.
            let open_item = MenuItem::with_id(app, "open", "Open popo", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &quit_item])?;

            let _tray = TrayIconBuilder::with_id("main-tray")
                .tooltip("popo")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;

            // --- Register the push-to-talk hotkey -----------------------
            // Ctrl+Shift+Space. Hotkey events route through
            // hotkey::on_event (already wired via plugin's with_handler).
            if let Err(e) = app.global_shortcut().register(default_hotkey()) {
                tracing::error!("failed to register push-to-talk hotkey Ctrl+Shift+Space: {e}");
                // Non-fatal: app still runs, just without a global hotkey.
            } else {
                tracing::info!("hotkey Ctrl+Shift+Space registered");
            }

            // Quick Mode Switcher hotkey — Ctrl+Shift+M. Non-fatal on
            // failure (the user just loses the quick switcher; every
            // other feature works).
            if let Err(e) = app.global_shortcut().register(switcher_hotkey()) {
                tracing::warn!("failed to register switcher hotkey Ctrl+Shift+M: {e}");
            } else {
                tracing::info!("hotkey Ctrl+Shift+M registered (quick mode switcher)");
            }

            // --- First-run: open main window + enable autostart --------
            if is_first_run {
                // Show the main window so the first-run overlay can
                // introduce the app. The frontend reads the same marker
                // (via localStorage popo:first-run-complete) to decide
                // whether to render the overlay.
                show_main(&app.handle());

                // Enable autostart on first install for release builds.
                // Development binaries must never register
                // target\debug\popo.exe: that file survives an installed
                // app uninstall and would reopen a console + pill at login.
                // Users can still opt out in Settings → System.
                #[cfg(all(desktop, not(debug_assertions)))]
                {
                    use tauri_plugin_autostart::ManagerExt;
                    if let Err(e) = app.autolaunch().enable() {
                        tracing::warn!("failed to enable autostart on first run: {e}");
                    } else {
                        tracing::info!("autostart enabled on first run");
                    }
                }

                // Drop the marker file so the next launch is silent.
                mark_first_run_complete(&app.handle());
            }

            // --- Pill HWND styles (Windows-only) ------------------------
            #[cfg(target_os = "windows")]
            if let Some(pill) = app.get_webview_window("pill") {
                apply_pill_window_styles(&pill);
                position_pill_bottom_center(&pill);
            }

            // --- Restore GCP config from disk (if present) --------------
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let state = app_handle.state::<PopoState>();
                gcp_cmds::restore_gcp_config_on_boot(&app_handle, state.inner()).await;
                match crate::commands::secrets::load_gemini_api_key(&app_handle) {
                    Ok(key) => {
                        if let Ok(mut slot) = state.inner().gemini_api_key.lock() {
                            *slot = key;
                        }
                    }
                    Err(error) => {
                        tracing::warn!("could not restore encrypted Gemini key: {error}");
                    }
                }
                // Pre-warm the GCP TLS channel immediately after config
                // restores so the first dictation doesn't pay the ~200-400ms
                // cold handshake cost.
                crate::gcp::client::prewarm().await;

                // Pre-warm the Chirp 3 STREAMING endpoint. This forces
                // Google to allocate a model instance for our project so
                // the first real dictation's `streaming_recognize()` call
                // returns in <500ms instead of ~12 seconds (cold start).
                // Cost: ~$0.0004 per app launch. See Session 29 diagnosis.
                let gcp_snap = state.inner().gcp.lock().ok().and_then(|g| g.clone());
                if let Some((config, auth)) = gcp_snap {
                    crate::gcp::client::prewarm_streaming(&auth, &config.project_id).await;
                } else {
                    // No GCP config on disk. Don't emit a persistent
                    // tooltip here — the user will see a perfectly
                    // readable setup hint pasted into their cursor
                    // the first time they press the hotkey (the
                    // fake-transcribe path in hotkey::on_release)
                    // AND a matching 10s tooltip above the pill at
                    // the same moment. One clear teachable moment
                    // beats a forever-on-screen nag.
                    tracing::info!("streaming prewarm: skipped (no GCP config yet)");
                }

                // Initial Gemini prewarm. Same idea — warm the TLS
                // connection + serving worker so the first user
                // dictation's smart-cleanup pass doesn't pay
                // cold-start latency. Branches on the selected
                // provider (AI Studio key vs Vertex service-account
                // token); no-op when credentials aren't set.
                prewarm_gemini_for_state(state.inner()).await;
            });

            // --- Periodic keep-warm task ---------------------
            //
            // Google's serving infrastructure tears down the warm
            // model worker after ~5 minutes of idle traffic, so the
            // boot prewarm above goes stale during any longer pause.
            // Session 34 diagnosed a real symptom: 8 minutes idle →
            // first dictation paid 14 s for Chirp gRPC open + 10 s+
            // for Gemini (timed out our 10 s ceiling).
            //
            // Fix: spawn a background task that re-prewarms BOTH
            // services every 4 minutes (just under the typical 5-min
            // teardown window).
            //
            // Cost:
            //   - Chirp prewarm sends 0.5 s of silence + half-closes;
            //     well under the 15 s billing increment, so $0.
            //   - Gemini prewarm is a 1-token reply request, ≈$0.000003
            //     per call → ≈$0.001/day at 4-minute cadence.
            //
            // Both functions are no-ops when their credentials aren't
            // set yet, so this loop is safe to start before the user
            // configures GCP / Gemini.
            let app_keepwarm = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut ticker = tokio::time::interval(std::time::Duration::from_secs(4 * 60));
                ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                // First tick fires immediately; skip it so we don't
                // double-prewarm right after boot.
                ticker.tick().await;

                loop {
                    ticker.tick().await;
                    let state = app_keepwarm.state::<PopoState>();

                    // Chirp: needs config + auth. Snapshot first so
                    // we don't hold the lock across the await.
                    let gcp_snap = state.inner().gcp.lock().ok().and_then(|g| g.clone());
                    if let Some((config, auth)) = gcp_snap {
                        tracing::info!("keep-warm: re-prewarming Chirp streaming");
                        crate::gcp::client::prewarm_streaming(&auth, &config.project_id).await;
                    }

                    // Gemini: branch on the selected provider. The
                    // helper mints a Vertex OAuth token when needed,
                    // or uses the AI Studio key. No-op when unset.
                    {
                        let provider = state
                            .inner()
                            .gemini_provider
                            .lock()
                            .map(|g| g.clone())
                            .unwrap_or_else(|_| "aistudio".to_string());
                        tracing::info!("keep-warm: re-prewarming Gemini ({provider})");
                        prewarm_gemini_for_state(state.inner()).await;
                    }
                }
            });

            // --- Pill cursor-proximity emitter (Windows-only) -----------
            // The pill window is click-through (setIgnoreCursorEvents=true)
            // in all states except ready/active. That means the drag region
            // never fires in sleep state — the OS just doesn't deliver events
            // to a click-through window.
            //
            // Fix: poll GetCursorPos + GetWindowRect every 40ms in a Tokio
            // task. When the cursor enters the pill's bounding box we emit
            // `pill:cursor:near` = true; when it leaves, = false. The
            // PillPage listener temporarily disables click-through so
            // drag-region events reach the WebView.
            //
            // Cost: effectively zero. GetCursorPos + GetWindowRect each
            // take <1 μs; one Tauri event emit only when proximity changes.
            #[cfg(target_os = "windows")]
            {
                let pill_hwnd_raw: Option<isize> = app
                    .get_webview_window("pill")
                    .and_then(|w| w.hwnd().ok())
                    .map(|h| h.0 as isize);

                if let Some(hwnd_raw) = pill_hwnd_raw {
                    let app_cursor = app.handle().clone();
                    tauri::async_runtime::spawn(async move {
                        use windows::Win32::Foundation::{HWND, POINT, RECT};
                        use windows::Win32::UI::WindowsAndMessaging::{
                            GetCursorPos, GetWindowRect,
                        };

                        // `hwnd_raw: isize` is Send; reconstruct HWND
                        // inside each loop iteration where it's used.
                        let mut was_near = false;

                        let mut ticker =
                            tokio::time::interval(std::time::Duration::from_millis(40));
                        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

                        loop {
                            ticker.tick().await;

                            // Reconstruct HWND each iteration (not across await).
                            let hwnd = HWND(hwnd_raw as *mut _);

                            // Get pill window rect (top-left, bottom-right in screen coords).
                            let mut rect = RECT::default();
                            if unsafe { GetWindowRect(hwnd, &mut rect) }.is_err() {
                                continue;
                            }

                            // Get the current cursor position in screen coords.
                            let mut pt = POINT::default();
                            let _ = unsafe { GetCursorPos(&mut pt) };

                            // Hit zone is restricted to the pill's actual
                            // visible area, not the full 260×110 window.
                            //
                            // Y: covers BOTH below AND above the pill bar
                            //    (Session 33 expanded this so click/hover
                            //    interactivity has a generous target). The
                            //    original zone was `[bottom-36, bottom+12]`
                            //    (48 px of vertical hit area, mostly below).
                            //    Now we ALSO extend UP by the same 36 px
                            //    gives a total of 84 px of vertical slack,
                            //    ready for future pill-open interactions
                            //    (mode switch, quick settings, etc.).
                            //
                            // X: only the horizontal range that covers the
                            //    pill bar. Session 50 shrunk the sleep pill
                            //    30% (80→56 wide) per user request, so this
                            //    zone shrunk too — pill_half_w went 40→28.
                            //    Active states are handled by the state-
                            //    based logic in PillPage's intercept calc;
                            //    we only need to cover the 56px sleep pill
                            //    here. We use the window center ±(28+MARGIN)px.
                            const MARGIN: i32 = 12;
                            const BOTTOM_ZONE: i32 = 36;
                            const TOP_EXTRA: i32 = 36;
                            let win_cx = (rect.left + rect.right) / 2;
                            // Sleep pill half-width = 28 px (Session 50;
                            // was 40 when sleep pill was 80 px wide).
                            let pill_half_w: i32 = 28;
                            let near = pt.x >= win_cx - pill_half_w - MARGIN
                                && pt.x <= win_cx + pill_half_w + MARGIN
                                && pt.y >= rect.bottom - BOTTOM_ZONE - TOP_EXTRA
                                && pt.y <= rect.bottom + MARGIN;

                            if near != was_near {
                                was_near = near;
                                let _ = app_cursor.emit_to("pill", "pill:cursor:near", near);
                            }
                        }
                    });
                }
            }

            // --- Pill always-on-top reassertion (Windows-only) ---------
            // The pill window is configured with `alwaysOnTop: true` in
            // tauri.conf.json AND has WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW.
            // Both are correct, but Windows still demotes topmost windows
            // in several scenarios:
            //
            //   - Other apps explicitly call `SetWindowPos(HWND_TOPMOST)`
            //     for their own windows (some apps assert it aggressively
            //     on every focus change).
            //   - Fullscreen apps (games, video players in exclusive
            //     fullscreen) take the topmost slot for themselves and
            //     evict everything else.
            //   - UAC prompts, screensavers, the Win+L lock screen, and
            //     occasionally just routine focus changes between
            //     elevated apps will demote our window.
            //   - Some Electron apps and certain games re-assert
            //     topmost on every render frame, which can fight us.
            //
            // The standard mitigation — used by every long-lived
            // tray/overlay app on Windows (Discord, Spotify Lyrics,
            // Wispr Flow, etc.) — is to periodically re-assert
            // HWND_TOPMOST. We do it every 2 seconds, which is
            // imperceptible to the user but reliably keeps the pill
            // visible.
            //
            // Cost: SetWindowPos is ~1 μs. Once every 2 s = effectively
            // zero CPU.
            #[cfg(target_os = "windows")]
            {
                let pill_hwnd_raw: Option<isize> = app
                    .get_webview_window("pill")
                    .and_then(|w| w.hwnd().ok())
                    .map(|h| h.0 as isize);

                if let Some(hwnd_raw) = pill_hwnd_raw {
                    tauri::async_runtime::spawn(async move {
                        use windows::Win32::Foundation::HWND;
                        use windows::Win32::UI::WindowsAndMessaging::{
                            SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
                        };

                        loop {
                            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                            let pill_hwnd = HWND(hwnd_raw as *mut _);
                            unsafe {
                                // SWP_NOMOVE | SWP_NOSIZE: keep current
                                //   geometry; we only want to change the
                                //   z-order and the topmost flag.
                                // SWP_NOACTIVATE: don't steal focus from
                                //   whatever the user is actually using
                                //   (the entire premise of the pill is
                                //   that it never takes focus).
                                let _ = SetWindowPos(
                                    pill_hwnd,
                                    HWND_TOPMOST,
                                    0,
                                    0,
                                    0,
                                    0,
                                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                                );
                            }
                        }
                    });
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Show + focus the main window. Used by both tray-click and the Open menu.
fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[cfg(target_os = "windows")]
fn apply_pill_window_styles(window: &tauri::WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    };

    let hwnd_raw = match window.hwnd() {
        Ok(h) => h.0,
        Err(e) => {
            tracing::error!("could not obtain pill hwnd: {e}");
            return;
        }
    };
    let hwnd = HWND(hwnd_raw as _);

    unsafe {
        let current = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let new_style = current | (WS_EX_NOACTIVATE.0 as isize) | (WS_EX_TOOLWINDOW.0 as isize);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new_style);
    }
}

/// Position the pill window at the bottom-center of the primary monitor
/// on boot. Called once at setup. The user's subsequent drags are
/// preserved in-session; they reset to bottom-center at next launch
/// (position persistence is a v0.2 settings feature).
#[cfg(target_os = "windows")]
fn position_pill_bottom_center(window: &tauri::WebviewWindow) {
    use tauri::PhysicalPosition;

    let monitor = match window.primary_monitor() {
        Ok(Some(m)) => m,
        _ => {
            tracing::warn!("primary monitor not found; leaving pill at default position");
            return;
        }
    };
    let size = monitor.size();
    let scale = monitor.scale_factor();

    let win_size = match window.outer_size() {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!("could not read pill outer_size: {e}");
            return;
        }
    };

    // Center horizontally on the monitor.
    let x = (size.width as i32 - win_size.width as i32) / 2 + monitor.position().x;

    // Offset from the bottom: 56 logical px clears the typical Windows
    // taskbar (40–48 px) with a small breathing gap. Converted to
    // physical px via the monitor scale factor.
    let bottom_offset_phys = (56.0 * scale) as i32;
    let y =
        (size.height as i32) - (win_size.height as i32) - bottom_offset_phys + monitor.position().y;

    if let Err(e) = window.set_position(PhysicalPosition::new(x, y)) {
        tracing::warn!("failed to position pill at bottom-center: {e}");
    }
}

// ── First-run helpers ─────────────────────────────────────────────
//
// Marker file lives at `<app_config_dir>/.installed`.
// On Windows that resolves to `%APPDATA%\ai.popo.desktop\.installed`
// (Roaming AppData under the bundle identifier).
//
// The frontend keeps its own flag in localStorage (`popo:first-run-complete`)
// which governs whether the FirstRunOverlay is rendered. The two flags
// are intentionally independent: Rust decides whether to *open* the main
// window, React decides what to *render* inside it.

fn first_run_marker_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    Some(dir.join(FIRST_RUN_MARKER))
}

/// Returns true if the marker file does NOT exist, i.e. this is a
/// fresh install (or the user manually wiped their config dir).
/// Errors reading the path are treated as "assume first run" so a
/// broken AppData folder still gives the user the welcome flow.
fn detect_first_run(app: &tauri::AppHandle) -> bool {
    match first_run_marker_path(app) {
        Some(p) => !p.exists(),
        None => {
            tracing::warn!("could not resolve app_config_dir for first-run marker");
            true
        }
    }
}

/// Create the parent dir if needed and touch the marker file.
/// Errors are logged but non-fatal; worst case the user sees the
/// welcome flow one extra time.
fn mark_first_run_complete(app: &tauri::AppHandle) {
    let Some(marker) = first_run_marker_path(app) else {
        return;
    };
    if let Some(parent) = marker.parent() {
        if let Err(e) = fs::create_dir_all(parent) {
            tracing::warn!("could not create config dir {}: {e}", parent.display());
            return;
        }
    }
    if let Err(e) = fs::write(&marker, b"popo first-run complete\n") {
        tracing::warn!("could not write first-run marker {}: {e}", marker.display());
    } else {
        tracing::info!("first-run marker written: {}", marker.display());
    }
}

#[cfg(test)]
mod ipc_origin_tests {
    use super::custom_command_allowed;

    #[test]
    fn main_can_use_registered_custom_commands() {
        assert!(custom_command_allowed("main", "cmd_get_gemini_api_key"));
        assert!(custom_command_allowed("main", "cmd_clear_local_user_data"));
    }

    #[test]
    fn switcher_has_only_its_required_command_surface() {
        assert!(custom_command_allowed("switcher", "cmd_set_mode_bindings"));
        assert!(custom_command_allowed(
            "switcher",
            "cmd_set_auto_format_prompt"
        ));
        assert!(custom_command_allowed("switcher", "cmd_hide_mode_switcher"));
        assert!(!custom_command_allowed(
            "switcher",
            "cmd_get_gemini_api_key"
        ));
        assert!(!custom_command_allowed(
            "switcher",
            "cmd_clear_local_user_data"
        ));
    }

    #[test]
    fn pill_and_unknown_webviews_have_no_custom_command_access() {
        assert!(!custom_command_allowed("pill", "cmd_get_gcp_config"));
        assert!(!custom_command_allowed("unknown", "cmd_list_running_apps"));
    }
}
