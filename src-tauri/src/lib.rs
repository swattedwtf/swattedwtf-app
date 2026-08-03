//! Library entry point.
//!
//! main.rs is a thin shim that calls run(), so every module is declared here.
//! All HTTP and all secret storage stay on this side of the IPC boundary: the
//! webview is never handed a session token.

pub mod api;
pub mod config;
pub mod error;
mod integrity;
pub mod session;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
