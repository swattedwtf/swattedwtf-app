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
mod integrity;
pub mod session;

use api::client::ApiClient;
use commands::AppState;
use session::SessionStore;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // The keychain is the primary store; this path is only the fallback
            // used on Linux systems with no Secret Service provider.
            let fallback = app
                .path()
                .app_local_data_dir()
                .map(|d| d.join("session.json"))
                .unwrap_or_else(|_| std::path::PathBuf::from("session.json"));

            let client =
                ApiClient::new(SessionStore::new(fallback)).expect("failed to build the API client");

            app.manage(AppState { client });
            Ok(())
        })
        // Only the commands that exist so far. verify_integrity, the updater
        // pair and open_external are added by their own tasks.
        .invoke_handler(tauri::generate_handler![
            commands::session_status,
            commands::login,
            commands::register,
            commands::logout,
            commands::get_overview,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
