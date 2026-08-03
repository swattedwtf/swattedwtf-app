//! Native window chrome tweaks.
//!
//! The window is frameless (`decorations: false`), and a frameless window on
//! Windows gets hard square corners, which looks out of place next to every
//! other Windows 11 app.
//!
//! This asks DWM to round them instead of faking it with a transparent window
//! plus CSS `border-radius`. The transparent-window approach costs the native
//! drop shadow, disables some compositor fast paths, and leaves visible
//! aliasing on the curve, whereas DWM clips the window itself and keeps the
//! shadow. On Windows 10 the attribute is simply unsupported and the call fails
//! harmlessly, so there is nothing to detect or branch on.

/// Rounds the window's corners. No-op on anything but Windows.
#[cfg(windows)]
pub fn round_corners(window: &tauri::WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
        DWM_WINDOW_CORNER_PREFERENCE,
    };

    let Ok(handle) = window.hwnd() else { return };
    let hwnd = HWND(handle.0);
    let preference = DWMWCP_ROUND;

    // SAFETY: hwnd comes from Tauri and is valid for the life of the window;
    // the pointer and size describe a DWM_WINDOW_CORNER_PREFERENCE we own.
    unsafe {
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &preference as *const DWM_WINDOW_CORNER_PREFERENCE as *const std::ffi::c_void,
            std::mem::size_of::<DWM_WINDOW_CORNER_PREFERENCE>() as u32,
        );
    }
}

#[cfg(not(windows))]
pub fn round_corners(_window: &tauri::WebviewWindow) {}
