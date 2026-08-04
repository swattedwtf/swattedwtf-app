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
pub mod monitor;
pub mod investigations;
pub mod picker;
pub mod quick;
pub mod settings;
pub mod shortcut;
pub mod window_chrome;
pub mod session;
pub mod updater;

use api::client::ApiClient;
use commands::AppState;
use session::SessionStore;
use settings::{SettingsState, SettingsStore};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // Launch at login. On Windows this writes an HKEY_CURRENT_USER \Run
        // value, so it needs no elevation; on macOS the LaunchAgent form is
        // used rather than AppleScript, because the AppleScript path drives
        // System Events and shows up as an automation permission prompt. No
        // arguments are passed: the app has no autostart-specific behaviour to
        // switch on, and an argument it ignores would only be a thing to
        // explain later.
        //
        // Deliberately NOT exposed to the webview. The frontend goes through
        // set_launch_at_login in commands.rs, the same way it reaches every
        // other privileged operation, so there is one place this is done from.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
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
            // Registry of live SSE streams (Search, Live Intelligence), so a
            // running stream can be cancelled by id from the webview.
            app.manage(api::stream::StreamRegistry::default());

            // Preferences live beside the session fallback, in the same local
            // data dir, and are loaded before anything reads them. A missing or
            // damaged file resolves to the defaults rather than failing here:
            // see the note at the top of settings.rs.
            let settings_path = app
                .path()
                .app_local_data_dir()
                .map(|d| d.join(settings::FILE_NAME))
                .unwrap_or_else(|_| std::env::temp_dir().join("tf.swattedw.desktop-settings.json"));
            app.manage(SettingsState::load(SettingsStore::new(settings_path)));

            // Two separate things, both needed. force_transparent clears the
            // background WebView2 paints beneath the HTML (it does not inherit
            // the window's alpha), which is what lets the page's antialiased
            // curve show. round_corners clips the window itself, which is what
            // makes the shape hold on machines that never granted per-pixel
            // alpha in the first place.
            if let Some(main) = app.get_webview_window("main") {
                window_chrome::force_transparent(&main);
                window_chrome::round_corners(&main, window_chrome::MAIN_RADIUS);
            }

            // The overlay is built once, hidden, so the hotkey only has to
            // show it. Building on demand would cost a visible webview boot.
            let _ = quick::create(app.handle());
            if let Some(overlay) = app.get_webview_window(quick::QUICK_LABEL) {
                window_chrome::force_transparent(&overlay);
                window_chrome::round_corners(&overlay, window_chrome::QUICK_RADIUS);
            }
            // The hotkey comes from settings.json, not from a constant, and the
            // user may have turned it off entirely. Whether it bound is
            // recorded on the state so the Settings screen can report it.
            shortcut::bind_at_startup(app.handle(), &app.state::<SettingsState>());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::verify_integrity,
            commands::check_update,
            commands::install_update_and_restart,
            commands::open_external,
            commands::hide_quick,
            commands::window_diagnostics,
            commands::save_recovery_file,
            commands::session_status,
            commands::login,
            commands::register,
            commands::logout,
            commands::get_overview,
            commands::lookup,
            commands::stream_start,
            commands::stream_cancel,
            commands::investigations,
            commands::fetch_image,
            commands::pick_image,
            commands::monitor,
            commands::get_settings,
            commands::set_shortcut,
            commands::set_launch_at_login,
        ])
        // Closing the main window must end the process.
        //
        // Tauri exits when the window map empties, and the quick-lookup overlay
        // is created hidden at startup and only ever hidden again, never
        // closed. Without this, clicking X destroyed `main` while `quick` kept
        // the map non-empty, leaving a process with no taskbar entry, no tray
        // icon, no way back to a window, and the global hotkey still grabbed:
        // killable only from Task Manager.
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                window.app_handle().exit(0);
            }

            // A clip region is measured in physical pixels and is not rescaled
            // for us, so a window that resized or moved to a monitor with a
            // different DPI is left wearing a region cut for its old size: the
            // login screen's 520x620 shape would still be clipping the 1180x760
            // dashboard, cropping most of it away. Recut on every event that can
            // change either number.
            //
            // Maximizing arrives as a Resized, which is also where the region is
            // dropped for a maximized window. Moved is deliberately NOT in this
            // list: it fires on every frame of a window drag, and recutting the
            // region forces a redraw each time, so the window would flicker for
            // as long as it was being moved. Crossing onto a monitor with a
            // different DPI raises ScaleFactorChanged, followed by a Resized.
            let recut = matches!(
                event,
                tauri::WindowEvent::Resized(_) | tauri::WindowEvent::ScaleFactorChanged { .. }
            );

            if recut {
                if let Some(radius) = window_chrome::radius_for(window.label()) {
                    if let Some(win) = window.app_handle().get_webview_window(window.label()) {
                        window_chrome::round_corners(&win, radius);
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
