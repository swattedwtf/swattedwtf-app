//! Library entry point.
//!
//! main.rs is a thin shim that calls run(), so every module is declared here.
//! All HTTP and all secret storage stay on this side of the IPC boundary: the
//! webview is never handed a session token.

pub mod api;
pub mod captcha;
pub mod commands;
pub mod config;
pub mod error;
pub mod integrity;
pub mod session;
pub mod updater;

use api::client::ApiClient;
use commands::AppState;
use session::SessionStore;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // The keychain is the primary store; this path is only the fallback
            // used on Linux systems with no Secret Service provider.
            let fallback = app
                .path()
                .app_local_data_dir()
                .map(|d| d.join("session.json"))
                // Never the process CWD: an AppImage launched from a service or
                // a .desktop entry with a stripped environment would otherwise
                // drop a session token into whatever directory it started in,
                // possibly a synced or shared folder.
                .unwrap_or_else(|_| std::env::temp_dir().join("tf.swattedw.desktop-session.json"));

            let client =
                ApiClient::new(SessionStore::new(fallback)).expect("failed to build the API client");

            app.manage(AppState { client });
            app.manage(updater::PendingUpdate::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::verify_integrity,
            commands::check_update,
            commands::install_update_and_restart,
            commands::open_external,
            commands::save_recovery_file,
            commands::session_status,
            commands::login,
            commands::register,
            commands::logout,
            commands::get_overview,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
