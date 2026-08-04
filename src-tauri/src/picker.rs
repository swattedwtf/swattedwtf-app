//! The native image picker behind Reverse Face.
//!
//! Reverse Face is the one module whose input is a file rather than a string,
//! and the file is chosen, read and validated ENTIRELY on this side. The webview
//! is granted no filesystem permission at all (see capabilities/default.json,
//! which deliberately omits `fs:`), exactly as `save_recovery_file` does for the
//! login code: the only path ever touched is the one the user picked in a native
//! dialog, so nothing running in the webview can name a path of its own.
//!
//! What comes back is a `data:` URL. That is not a convenience: the webview's
//! CSP is `img-src 'self' data:`, so a `data:` URL is the only form the preview
//! can render, and it doubles as the payload the lookup uploads. One value, one
//! validation, no second representation to keep honest.

use crate::api::lookup::{data_url, MAX_IMAGE_BYTES};
use crate::error::AppError;
use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// Extensions offered in the dialog. Cosmetic only, and deliberately so: the
/// filter is what the user sees, `sniff` is what decides.
const IMAGE_EXTENSIONS: [&str; 8] = ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "jfif"];

/// What the frontend gets back: enough to preview it, upload it, and say what
/// was picked.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedImage {
    /// The file's own name, for the caption. Never a path: the directory the
    /// user browsed is their business and has no reason to cross the boundary.
    pub name: String,
    /// The sniffed media type, not the extension's.
    pub mime: String,
    /// Decoded size, so the screen can show it without measuring base64.
    pub bytes: usize,
    /// `data:<mime>;base64,...`. Both the preview `src` and the upload.
    pub data_url: String,
}

/// The image's real media type from its leading bytes, or None.
///
/// The extension is not evidence. A `.png` holding an SVG or an executable would
/// otherwise be base64'd into a data URL and posted to a provider we pay per
/// call, so the bytes are what decide. Mirrors `sniffImageType` in the server's
/// lib/desktop/modules/face.ts, which refuses the same file a second time: the
/// two ends check independently, and neither is the laxer.
pub fn sniff(bytes: &[u8]) -> Option<&'static str> {
    let has = |offset: usize, sig: &[u8]| -> bool {
        bytes.len() >= offset + sig.len() && &bytes[offset..offset + sig.len()] == sig
    };

    if has(0, &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        return Some("image/png");
    }
    if has(0, &[0xff, 0xd8, 0xff]) {
        return Some("image/jpeg");
    }
    if has(0, b"GIF8") {
        return Some("image/gif");
    }
    if has(0, b"BM") {
        return Some("image/bmp");
    }
    if has(0, b"RIFF") && has(8, b"WEBP") {
        return Some("image/webp");
    }
    // An ISO-BMFF brand, so the box size comes first and `ftyp` is at offset 4.
    if has(4, b"ftypavi") {
        return Some("image/avif");
    }
    None
}

/// Opens the native picker and returns the chosen image, or None if cancelled.
pub async fn pick(app: &AppHandle) -> Result<Option<PickedImage>, AppError> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Images", &IMAGE_EXTENSIONS)
        .pick_file(move |path| {
            let _ = tx.send(path);
        });

    let Some(path) = rx.await.map_err(|_| AppError::Internal("dialog closed".into()))? else {
        return Ok(None);
    };

    let path = path
        .into_path()
        .map_err(|e| AppError::Internal(format!("invalid image path: {e}")))?;

    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "image".to_owned());

    // Checked BEFORE the read, so a multi-gigabyte file picked by mistake is
    // refused rather than pulled into memory first and refused afterwards.
    let size = std::fs::metadata(&path)
        .map_err(|e| AppError::Internal(format!("could not read that file: {e}")))?
        .len();
    if size > MAX_IMAGE_BYTES as u64 {
        return Err(AppError::Internal("That image is too large (max 8 MB).".into()));
    }

    let bytes =
        std::fs::read(&path).map_err(|e| AppError::Internal(format!("could not read that file: {e}")))?;

    let mime = sniff(&bytes).ok_or_else(|| AppError::Internal("That file is not an image.".into()))?;

    // Reuses the API layer's builder rather than formatting a data URL here:
    // it is the one place that knows which media types are allowed and re-checks
    // the size cap against the bytes actually in hand.
    let data_url = data_url(mime, &bytes)?;

    Ok(Some(PickedImage { name, mime: mime.to_owned(), bytes: bytes.len(), data_url }))
}

#[cfg(test)]
mod tests {
    use super::sniff;

    #[test]
    fn recognises_every_type_the_server_accepts() {
        assert_eq!(sniff(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]), Some("image/png"));
        assert_eq!(sniff(&[0xff, 0xd8, 0xff, 0xe0]), Some("image/jpeg"));
        assert_eq!(sniff(b"GIF89a....."), Some("image/gif"));
        assert_eq!(sniff(b"GIF87a....."), Some("image/gif"));
        assert_eq!(sniff(b"BM\x00\x00"), Some("image/bmp"));
        assert_eq!(sniff(b"RIFF\x00\x00\x00\x00WEBPVP8 "), Some("image/webp"));
        assert_eq!(sniff(b"\x00\x00\x00\x20ftypavif"), Some("image/avif"));
        assert_eq!(sniff(b"\x00\x00\x00\x20ftypavis"), Some("image/avif"));
    }

    /// The extension is not evidence, and this is the file that proves it: an
    /// SVG is a scriptable document, and the server refuses it too. Neither end
    /// may be the laxer of the two on a check they both perform.
    #[test]
    fn refuses_a_file_that_is_not_an_image_however_it_is_named() {
        assert_eq!(sniff(b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>"), None);
        assert_eq!(sniff(b"<!DOCTYPE html>"), None);
        assert_eq!(sniff(b"MZ\x90\x00"), None);
        assert_eq!(sniff(b"%PDF-1.7"), None);
        assert_eq!(sniff(b"\x7fELF"), None);
    }

    /// A truncated header must not be read past its end. Every one of these is
    /// shorter than the signature it starts to look like.
    #[test]
    fn a_truncated_file_is_refused_rather_than_read_out_of_bounds() {
        assert_eq!(sniff(b""), None);
        assert_eq!(sniff(&[0x89]), None);
        assert_eq!(sniff(&[0xff, 0xd8]), None);
        assert_eq!(sniff(b"RIFF"), None);
        assert_eq!(sniff(b"RIFF\x00\x00\x00\x00WEB"), None);
        assert_eq!(sniff(b"ftyp"), None);
    }

    /// A RIFF container that is not a WebP (a .wav, say) has the same first
    /// four bytes and is a different file entirely.
    #[test]
    fn a_riff_container_that_is_not_a_webp_is_refused() {
        assert_eq!(sniff(b"RIFF\x00\x00\x00\x00WAVEfmt "), None);
    }
}
