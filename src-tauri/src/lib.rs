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
pub mod quick;
pub mod window_chrome;
pub mod session;
pub mod updater;

use api::client::ApiClient;
use commands::AppState;
use session::SessionStore;
use tauri::Manager;

/// Binds the system-wide shortcut that summons the overlay.
///
/// A failure here is deliberately not fatal: the shortcut can be taken by
/// another application, and losing one convenience is no reason to refuse to
/// start. The Settings screen reports whether it bound.
fn register_quick_shortcut(app: &tauri::AppHandle) {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    let handle = app.clone();
    let result = app.global_shortcut().on_shortcut(
        quick::DEFAULT_SHORTCUT,
        move |_app, _shortcut, event| {
            // Fire on press only; without this the release fires a second
            // toggle and the overlay flickers shut again.
            if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                quick::toggle(&handle);
            }
        },
    );

    if let Err(e) = result {
        eprintln!("[quick] could not register {}: {e}", quick::DEFAULT_SHORTCUT);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
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

            // Rounded corners need the webview background cleared as well as
            // the window being transparent; WebView2 paints its own background
            // beneath the HTML and does not inherit the window's alpha.
            if let Some(main) = app.get_webview_window("main") {
                window_chrome::force_transparent(&main);
            }

            // The overlay is built once, hidden, so the hotkey only has to
            // show it. Building on demand would cost a visible webview boot.
            let _ = quick::create(app.handle());
            if let Some(overlay) = app.get_webview_window(quick::QUICK_LABEL) {
                window_chrome::force_transparent(&overlay);
            }
            register_quick_shortcut(app.handle());

            app.manage(AppState { client });
            app.manage(updater::PendingUpdate::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::verify_integrity,
            commands::check_update,
            commands::install_update_and_restart,
            commands::open_external,
            commands::hide_quick,
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
