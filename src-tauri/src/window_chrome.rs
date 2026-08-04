//! Makes the frameless windows actually round.
//!
//! There were two strategies here and only one of them survived contact with a
//! real Windows machine.
//!
//! The first was to draw the corners in CSS and make everything behind the page
//! transparent: the window (`transparent: true`), the DWM shadow (`shadow:
//! false`) and WebView2's own background (cleared below, since it does not
//! inherit the window's alpha). That is still configured, and on a machine where
//! per-pixel alpha is actually granted it gives antialiased corners for free.
//! But three shipped builds arrived square, which means something on the way to
//! the screen is compositing an opaque backdrop regardless of what the page
//! paints, and no amount of asking politely from the page changes that.
//!
//! So the shape is now enforced by the OS instead of by the compositor:
//! SetWindowRgn clips the window to a rounded rectangle, and everything outside
//! that region is not drawn at all. Nothing can paint through a clip region, so
//! this holds whether or not transparency was granted, whether or not DWM is
//! composing, and whether or not the user has disabled visual effects. The cost
//! is that the clip is not antialiased, so the CSS radius stays exactly matched
//! to the region radius: the page's own antialiased curve sits just inside the
//! hard clip and softens it.

use tauri::WebviewWindow;

/// Corner radius of the main window, in logical pixels.
///
/// Must stay equal to `.app-root`'s border-radius in theme.css. If the region is
/// tighter than the CSS the page's curve is cut off; if it is looser a sliver of
/// square corner shows outside the curve.
pub const MAIN_RADIUS: f64 = 12.0;

/// Corner radius of the quick-lookup overlay. Matches `.quick-root`.
pub const QUICK_RADIUS: f64 = 16.0;

/// The radius the given window label should be clipped to, if any.
pub fn radius_for(label: &str) -> Option<f64> {
    match label {
        "main" => Some(MAIN_RADIUS),
        crate::quick::QUICK_LABEL => Some(QUICK_RADIUS),
        _ => None,
    }
}

/// Clears the webview background so the page's own alpha reaches the screen.
///
/// Failure is not worth propagating: a window that ends up opaque still works,
/// it just loses the antialiasing on the curve that the region already cut.
pub fn force_transparent(window: &WebviewWindow) {
    if let Err(e) = window.set_background_color(None) {
        eprintln!("[chrome] could not clear the webview background: {e}");
    }
}

/// Clips the window to a rounded rectangle.
///
/// Must be re-applied whenever the window's pixel size changes: a region is
/// measured in physical pixels and is NOT rescaled when the window resizes, so a
/// stale region would either crop the window's new area or leave part of it
/// unclipped. See the Resized and ScaleFactorChanged arms in lib.rs.
/// Returns whether the region was applied, which is reported in the diagnostics:
/// if a machine still shows square corners, this says whether Windows accepted
/// the region and the answer is elsewhere, or refused it outright.
#[cfg(windows)]
pub fn round_corners(window: &WebviewWindow, radius: f64) -> bool {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Gdi::{CreateRoundRectRgn, DeleteObject, SetWindowRgn, HGDIOBJ};

    let Ok(handle) = window.hwnd() else { return false };
    let hwnd = HWND(handle.0);

    // A rounded maximized window leaves four notches of desktop at the screen
    // corners, so it goes back to a plain rectangle. Passing None removes the
    // region entirely rather than replacing it with a square one.
    if window.is_maximized().unwrap_or(false) {
        // SAFETY: the handle comes from Tauri and stays valid while the window
        // lives; this runs on the main thread from the window event loop.
        unsafe { SetWindowRgn(hwnd, None, true) };
        return true;
    }

    let Ok(size) = window.outer_size() else { return false };
    if size.width == 0 || size.height == 0 {
        return false;
    }

    let scale = window.scale_factor().unwrap_or(1.0);
    // The region's right and bottom bounds are exclusive, so the rectangle has
    // to be one pixel larger than the window or the last row and column are
    // clipped away and the window appears to be missing an edge.
    let right = size.width as i32 + 1;
    let bottom = size.height as i32 + 1;
    // CreateRoundRectRgn takes the width and height of the corner ELLIPSE, not
    // the radius, hence the doubling.
    let ellipse = ((radius * scale).round() as i32).max(1) * 2;

    // SAFETY: as above. The region is a fresh GDI object owned by this function
    // until SetWindowRgn takes it.
    unsafe {
        let region = CreateRoundRectRgn(0, 0, right, bottom, ellipse, ellipse);
        if region.is_invalid() {
            return false;
        }
        // On success the window owns the region and it must NOT be deleted here:
        // deleting it would hand the window a freed GDI handle. On failure it is
        // still ours, and leaking one region per resize would exhaust the
        // process's GDI handle quota over a long session.
        if SetWindowRgn(hwnd, Some(region), true) == 0 {
            let _ = DeleteObject(HGDIOBJ(region.0));
            return false;
        }
    }

    true
}

/// Everywhere else the compositor honours the page's alpha, so the CSS radius is
/// already the whole answer and there is nothing to clip.
#[cfg(not(windows))]
pub fn round_corners(_window: &WebviewWindow, _radius: f64) -> bool {
    false
}

/// Everything the window can tell us about itself at runtime, surfaced in
/// Settings so a machine that still looks wrong can report why.
#[derive(serde::Serialize)]
pub struct WindowDiagnostics {
    pub decorated: Option<bool>,
    pub maximized: Option<bool>,
    pub scale_factor: Option<f64>,
    /// None when clearing the webview background succeeded.
    pub background_error: Option<String>,
    /// Windows only. Whether the OS actually gave us a layered (per-pixel
    /// alpha) window. False means the page's transparency never reaches the
    /// screen and the shape is coming entirely from the clip region.
    pub layered: Option<bool>,
    /// Windows only. Whether Windows accepted the rounded clip region. False
    /// with square corners means the region was refused; true with square
    /// corners means it was accepted and something downstream is overpainting.
    pub region_applied: bool,
    /// Windows only. The raw extended window style, for anything the flags
    /// above do not cover.
    pub ex_style: Option<String>,
    pub platform: &'static str,
}

pub fn diagnostics(window: &WebviewWindow) -> WindowDiagnostics {
    // Re-applies the region rather than reporting a cached result, so what is
    // reported is what the call does right now, on this window, at its current
    // size. Setting the same region twice is a no-op to the user.
    let region_applied = radius_for(window.label())
        .map(|radius| round_corners(window, radius))
        .unwrap_or(false);

    WindowDiagnostics {
        decorated: window.is_decorated().ok(),
        maximized: window.is_maximized().ok(),
        scale_factor: window.scale_factor().ok(),
        background_error: window.set_background_color(None).err().map(|e| e.to_string()),
        layered: layered_flag(window),
        region_applied,
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

#[cfg(test)]
mod tests {
    use super::radius_for;

    #[test]
    fn only_the_two_frameless_windows_are_clipped() {
        assert_eq!(radius_for("main"), Some(super::MAIN_RADIUS));
        assert_eq!(radius_for("quick"), Some(super::QUICK_RADIUS));
        // The captcha helper is a plain decorated window; clipping it would cut
        // its own title bar.
        assert_eq!(radius_for("captcha"), None);
    }
}
