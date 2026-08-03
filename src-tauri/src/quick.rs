//! Global hotkey and the quick-lookup overlay window.
//!
//! The point of the overlay is that it works while you are doing something
//! else, so the shortcut is registered system-wide and the window is created
//! once at startup and then only shown and hidden. Creating it on each press
//! would cost a webview boot (visibly slow) and would race a rapid second
//! press against the still-closing first window.
//!
//! The overlay renders from the same bundle as the main window, keyed off the
//! `quick` window label, so it shares the theme and needs no second frontend.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const QUICK_LABEL: &str = "quick";

/// Default binding. Chosen to sit outside the common Windows and browser
/// shortcuts: Ctrl+Space is IME switching, Ctrl+Shift+Space is generally free.
pub const DEFAULT_SHORTCUT: &str = "CmdOrCtrl+Shift+Space";

const WIDTH: f64 = 640.0;
const HEIGHT: f64 = 116.0;

/// Builds the overlay window, hidden. Called once during setup.
pub fn create(app: &AppHandle) -> tauri::Result<()> {
    if app.get_webview_window(QUICK_LABEL).is_some() {
        return Ok(());
    }

    WebviewWindowBuilder::new(app, QUICK_LABEL, WebviewUrl::App("index.html".into()))
        .title("Quick lookup")
        .inner_size(WIDTH, HEIGHT)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        // Absent from the taskbar and the alt-tab list: it is a transient
        // overlay, not a window you manage.
        .skip_taskbar(true)
        .center()
        .visible(false)
        .build()?;

    Ok(())
}

/// Shows and focuses the overlay, creating it first if it is somehow gone.
///
/// Re-centres on every show so it lands on whichever monitor is currently
/// active rather than wherever it was last dismissed.
pub fn show(app: &AppHandle) {
    if app.get_webview_window(QUICK_LABEL).is_none() {
        let _ = create(app);
    }

    if let Some(win) = app.get_webview_window(QUICK_LABEL) {
        let _ = win.center();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

pub fn hide(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(QUICK_LABEL) {
        let _ = win.hide();
    }
}

/// Shows the overlay if hidden, hides it if already up, so the same keystroke
/// both summons and dismisses it.
pub fn toggle(app: &AppHandle) {
    match app.get_webview_window(QUICK_LABEL) {
        Some(win) if win.is_visible().unwrap_or(false) => {
            let _ = win.hide();
        }
        _ => show(app),
    }
}
