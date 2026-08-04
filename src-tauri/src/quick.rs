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

/// Starting binding, for a machine with no settings.json yet.
///
/// It is only the default. The live binding comes from settings.json and is
/// owned by `shortcut.rs`; nothing in this file registers anything. Ctrl+Shift
/// +Space was chosen to sit outside the common Windows and browser shortcuts
/// (Ctrl+Space is IME switching), but it is not free everywhere: Word uses it
/// for a non-breaking space and JetBrains IDEs for Smart Type Completion, which
/// is why it is now changeable and can be turned off.
pub const DEFAULT_SHORTCUT: &str = "CmdOrCtrl+Shift+Space";

/// Sized for the two-row bar in QuickLookup.tsx: a 62px field row over a 40px
/// footer, plus the frame. Wide enough that a full email or a Discord snowflake
/// never scrolls the field.
const WIDTH: f64 = 660.0;
const HEIGHT: f64 = 124.0;

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
        // Re-cut before it is visible, not after: the window may have been
        // created on a monitor with a different scale factor from the one it is
        // now centred on, and a region cut for the wrong DPI would show as a
        // clipped or square-cornered frame for the frame or two it takes the
        // resize events to arrive.
        crate::window_chrome::round_corners(&win, crate::window_chrome::QUICK_RADIUS);
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
