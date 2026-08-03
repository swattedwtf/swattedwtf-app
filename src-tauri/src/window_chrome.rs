//! Forces the window to actually be transparent so the CSS rounded corners show.
//!
//! The corners are drawn in CSS on `.app-root`, which only reads as rounded if
//! everything painted behind the page is transparent. Three separate things can
//! paint an opaque square and each has to be turned off:
//!
//!   1. the window itself (`transparent: true` in tauri.conf.json),
//!   2. the DWM drop shadow, which on Windows composites an opaque backdrop
//!      behind a borderless window (`shadow: false`),
//!   3. the webview's own background, which WebView2 paints beneath the HTML
//!      and which does NOT follow the window's transparency.
//!
//! This handles the third. It is done in Rust rather than config because the
//! config's `backgroundColor` sets a colour, and what is needed is the absence
//! of one.

use tauri::WebviewWindow;

/// Clears the webview background so the page's own alpha reaches the screen.
///
/// Failure is not worth propagating: a window that ends up opaque still works,
/// it just has square corners, and refusing to start over cosmetics would be
/// the wrong trade.
pub fn force_transparent(window: &WebviewWindow) {
    if let Err(e) = window.set_background_color(None) {
        eprintln!("[chrome] could not clear the webview background: {e}");
    }
}
