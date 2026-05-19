// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Initialize tracing so all those tracing::info! / warn! / error!
    // calls in the codebase actually produce visible output.
    //
    // Dev mode (pnpm tauri dev): logs go to stderr → visible in the
    // terminal that launched the command.
    //
    // Release mode (installed app): logs go to a rolling file at
    // %APPDATA%\popo\popo.log (most recent) + popo.log.old (previous).
    // This is the ONLY way to debug the installed build since
    // windows_subsystem="windows" hides the console.
    init_tracing();

    popo_lib::run();
}

fn init_tracing() {
    use tracing_subscriber::EnvFilter;

    // Default filter: info-level for our crate, warn for everything else.
    // Override at runtime with RUST_LOG env var (e.g. RUST_LOG=popo=debug).
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("popo=info,warn"));

    if cfg!(debug_assertions) {
        // Dev mode: write to stderr (the terminal running `pnpm tauri dev`).
        tracing_subscriber::fmt()
            .with_env_filter(filter)
            .with_target(false)
            .with_thread_ids(false)
            .with_file(false)
            .with_line_number(false)
            .init();
    } else {
        // Release mode: write to a file in %APPDATA%\popo\.
        // Creates the directory if it doesn't exist.
        let app_data = std::env::var("APPDATA")
            .unwrap_or_else(|_| ".".to_string());
        let log_dir = std::path::PathBuf::from(&app_data).join("popo");
        let _ = std::fs::create_dir_all(&log_dir);

        let file_appender = tracing_appender::rolling::never(&log_dir, "popo.log");
        let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);

        // Leak the guard so it lives for the process lifetime.
        // (If guard drops, the writer closes and logs stop.)
        std::mem::forget(_guard);

        tracing_subscriber::fmt()
            .with_env_filter(filter)
            .with_writer(non_blocking)
            .with_target(false)
            .with_thread_ids(false)
            .with_ansi(false) // no ANSI colors in log files
            .init();
    }
}
