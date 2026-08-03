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

/// Everything the window can tell us about itself at runtime.
///
/// All three opacity causes above are configured, the page is verifiably
/// transparent at its corners, and the corners are still square on Windows.
/// Rather than guess at a fourth cause from a Linux box, this reports what the
/// window actually resolved to, so the answer comes from the machine that has
/// the problem.
#[derive(serde::Serialize)]
pub struct WindowDiagnostics {
    pub decorated: Option<bool>,
    pub maximized: Option<bool>,
    pub scale_factor: Option<f64>,
    /// None when clearing the webview background succeeded.
    pub background_error: Option<String>,
    /// Windows only. Whether the OS actually gave us a layered (per-pixel
    /// alpha) window. If this is false, the window is opaque no matter what the
    /// page paints, and that is the entire answer.
    pub layered: Option<bool>,
    /// Windows only. The raw extended window style, for anything the flags
    /// above do not cover.
    pub ex_style: Option<String>,
    pub platform: &'static str,
}

pub fn diagnostics(window: &WebviewWindow) -> WindowDiagnostics {
    WindowDiagnostics {
        decorated: window.is_decorated().ok(),
        maximized: window.is_maximized().ok(),
        scale_factor: window.scale_factor().ok(),
        background_error: window.set_background_color(None).err().map(|e| e.to_string()),
        layered: layered_flag(window),
        ex_style: ex_style(window),
        platform: std::env::consts::OS,
    }
}

#[cfg(windows)]
fn raw_ex_style(window: &WebviewWindow) -> Option<isize> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{GetWindowLongPtrW, GWL_EXSTYLE};

    let handle = window.hwnd().ok()?;
    // SAFETY: the handle comes from Tauri and stays valid while the window lives.
    Some(unsafe { GetWindowLongPtrW(HWND(handle.0), GWL_EXSTYLE) })
}

/// WS_EX_LAYERED is 0x00080000. Without it there is no per-pixel alpha.
#[cfg(windows)]
fn layered_flag(window: &WebviewWindow) -> Option<bool> {
    raw_ex_style(window).map(|s| s & 0x0008_0000 != 0)
}

#[cfg(windows)]
fn ex_style(window: &WebviewWindow) -> Option<String> {
    raw_ex_style(window).map(|s| format!("0x{s:08X}"))
}

#[cfg(not(windows))]
fn layered_flag(_window: &WebviewWindow) -> Option<bool> {
    None
}

#[cfg(not(windows))]
fn ex_style(_window: &WebviewWindow) -> Option<String> {
    None
}
