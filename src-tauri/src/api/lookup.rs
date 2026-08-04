//! Transport for the desktop lookup surface.
//!
//! Two commands and one error parser.
//!
//! `lookup` is the whole client side of a module: the server runs the module's
//! entire provider fan-out behind `POST /api/desktop/lookup` and answers with
//! one normalised payload, so a module that makes seven upstream calls is still
//! one call from here. The payload stays an untyped `serde_json::Value`.
//! Parsing it into structs would cost a client release every time the
//! normalised shape gains a field, for no safety gain: the renderers already
//! tolerate absent fields because partial data is normal here. Rust owns the
//! credential and the failure classification; it does not need to own the shape
//! of the answer.
//!
//! `fetch_image` exists because the webview's CSP is `img-src 'self' data:`, so
//! nothing remote renders directly, and our image proxy needs the session
//! cookie, which lives on this side and deliberately never reaches the webview.
//! The server has already rewritten every image URL in a payload to our own
//! origin, so this command accepts that one origin and nothing else.

use crate::api::client::ApiClient;
use crate::config::api_base;
use crate::error::AppError;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use serde::Serialize;

/// Largest image body we will turn into a data URL. A data URL costs about a
/// third again in base64, and it is held in memory by both processes, so this
/// is a real ceiling rather than a formality. Matches the proxy's own cap.
pub const MAX_IMAGE_BYTES: usize = 8 * 1024 * 1024;

const LOOKUP_PATH: &str = "/api/desktop/lookup";

#[derive(Serialize)]
struct LookupBody<'a> {
    module: &'a str,
    input: &'a serde_json::Value,
}

/// Turns a non-2xx response into `AppError::Api`.
///
/// The single place a server error body is parsed. `client.rs::read` calls it
/// too, so there is exactly one definition of what `{error, code}` means and a
/// new refusal shape cannot be understood by one call path and not the other.
///
/// A body that is not JSON, or is JSON without an `error` string, still yields
/// a message naming the status: an HTML error page from a proxy in front of the
/// API must not surface as an empty panel.
pub fn error_from(status: u16, body: &str) -> AppError {
    let parsed = serde_json::from_str::<serde_json::Value>(body).ok();
    let field = |key: &str| {
        parsed
            .as_ref()
            .and_then(|v| v.get(key))
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
    };

    let message = field("error").unwrap_or_else(|| format!("Request failed ({status})"));

    // requireLookupAccess answers a suspended account with 403 {error, reason}
    // and NO code, while the agent surface answers the same condition with
    // code: "account_suspended". Normalise here so the UI has one thing to
    // branch on, rather than teaching every caller that suspension is the one
    // refusal identified by the presence of a field.
    let code = field("code").or_else(|| {
        (status == 403 && field("reason").is_some()).then(|| "account_suspended".to_owned())
    });

    AppError::Api { status, message, code }
}

/// True when `url` is on exactly the API origin: same scheme, same host, same
/// port.
///
/// Written the way `captcha.rs::token_from_url` is written, and for the same
/// reason. A substring or prefix test is wrong in both directions: "w.tf" is a
/// substring of "https://swattedw.tf", and "swattedw.tf.evil.test" starts with
/// our host, so either sloppy check would turn `fetch_image` into a general
/// purpose fetcher that a compromised webview could point at any host while
/// carrying our session cookie.
pub fn is_api_origin(url: &str) -> bool {
    let Ok(parsed) = url::Url::parse(url) else { return false };
    let Ok(base) = url::Url::parse(api_base()) else { return false };

    if parsed.scheme() != base.scheme() {
        return false;
    }
    // An explicit None check, so two host-less URLs (file:///etc/passwd against
    // a malformed base) can never compare equal.
    let (Some(host), Some(base_host)) = (parsed.host_str(), base.host_str()) else {
        return false;
    };
    host == base_host && parsed.port_or_known_default() == base.port_or_known_default()
}

/// Builds the `data:` URL, refusing anything that is not an image.
///
/// Split from the request so the refusal is testable without a server. The
/// media type is taken up to the first `;` (a proxy may append `charset=`) and
/// must look like a media type: an unvalidated one would be interpolated into
/// the data URL, where a stray `,` ends the type and turns the rest of it into
/// content the webview would render under a type we never checked.
pub fn data_url(content_type: &str, bytes: &[u8]) -> Result<String, AppError> {
    let mime = content_type.split(';').next().unwrap_or("").trim().to_ascii_lowercase();

    if !mime.starts_with("image/") || mime.len() <= "image/".len() {
        return Err(AppError::Internal(format!("not an image ({mime})")));
    }
    if !mime.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'/' | b'.' | b'+' | b'-')) {
        return Err(AppError::Internal("unsupported image type".into()));
    }
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(AppError::Internal("image too large".into()));
    }

    Ok(format!("data:{};base64,{}", mime, BASE64.encode(bytes)))
}

/// Runs one module server-side and returns its normalised payload.
pub async fn lookup(
    client: &ApiClient,
    module: &str,
    input: serde_json::Value,
) -> Result<serde_json::Value, AppError> {
    client.post_json(LOOKUP_PATH, &LookupBody { module, input: &input }).await
}

/// Fetches an image from our own origin and returns it as a `data:` URL.
pub async fn fetch_image(client: &ApiClient, url: &str) -> Result<String, AppError> {
    if !is_api_origin(url) {
        // Deliberately not echoing the URL: the message is user-visible and the
        // caller already knows what it asked for.
        return Err(AppError::Internal("blocked image url".into()));
    }

    let (content_type, bytes) = client.get_bytes(url, MAX_IMAGE_BYTES).await?;
    data_url(&content_type, &bytes)
}

#[cfg(test)]
mod tests {
    use super::error_from;
    use super::{data_url, is_api_origin, MAX_IMAGE_BYTES};

    #[test]
    fn a_402_carries_its_code_so_the_ui_can_branch() {
        let e = error_from(
            402,
            r#"{"error":"This is a Swatted Heist feature.","code":"heist_required"}"#,
        );
        match e {
            crate::error::AppError::Api { status, code, message } => {
                assert_eq!(status, 402);
                assert_eq!(code.as_deref(), Some("heist_required"));
                assert_eq!(message, "This is a Swatted Heist feature.");
            }
            other => panic!("expected Api, got {other:?}"),
        }
    }

    #[test]
    fn a_body_with_no_code_still_yields_the_message() {
        let e = error_from(500, r#"{"error":"Upstream exploded."}"#);
        assert!(matches!(e, crate::error::AppError::Api { code: None, .. }));
    }

    #[test]
    fn a_non_json_body_falls_back_to_a_status_message() {
        let e = error_from(502, "<html>bad gateway</html>");
        match e {
            crate::error::AppError::Api { message, .. } => assert!(message.contains("502")),
            other => panic!("expected Api, got {other:?}"),
        }
    }

    /// requireLookupAccess answers a suspended account with a 403 carrying a
    /// `reason` and no code at all. Without this the UI would show it as a
    /// generic error with a Retry button that can never succeed.
    #[test]
    fn a_403_carrying_a_reason_is_recognised_as_a_suspension() {
        let e = error_from(403, r#"{"error":"Account suspended.","reason":"CSAM attempt"}"#);
        match e {
            crate::error::AppError::Api { code, message, .. } => {
                assert_eq!(code.as_deref(), Some("account_suspended"));
                assert_eq!(message, "Account suspended.");
            }
            other => panic!("expected Api, got {other:?}"),
        }
    }

    /// A reason on any other status must not be read as a suspension.
    #[test]
    fn a_reason_on_a_non_403_does_not_invent_a_code() {
        let e = error_from(400, r#"{"error":"Bad input.","reason":"whatever"}"#);
        assert!(matches!(e, crate::error::AppError::Api { code: None, .. }));
    }

    #[test]
    fn an_empty_error_string_does_not_produce_an_empty_panel() {
        match error_from(500, r#"{"error":""}"#) {
            crate::error::AppError::Api { message, .. } => assert!(message.contains("500")),
            other => panic!("expected Api, got {other:?}"),
        }
    }

    #[test]
    fn our_own_origin_is_accepted() {
        assert!(is_api_origin("https://swattedw.tf/api/desktop/image?u=x"));
        assert!(is_api_origin("https://swattedw.tf:443/api/desktop/image?u=x"));
    }

    /// The exact bug this check exists to prevent: a host that merely contains
    /// or extends ours. `swattedw.tf.evil.test` starts with our hostname, so a
    /// prefix test would hand our session cookie to that server.
    #[test]
    fn a_lookalike_host_is_refused() {
        assert!(!is_api_origin("https://swattedw.tf.evil.test/api/desktop/image"));
        assert!(!is_api_origin("https://evil.test/swattedw.tf/a.png"));
        assert!(!is_api_origin("https://swattedw.tf@evil.test/a.png"));
        assert!(!is_api_origin("https://w.tf/a.png"));
        assert!(!is_api_origin("https://tf/a.png"));
    }

    #[test]
    fn a_scheme_downgrade_or_a_local_scheme_is_refused() {
        assert!(!is_api_origin("http://swattedw.tf/a.png"));
        assert!(!is_api_origin("file:///etc/passwd"));
        assert!(!is_api_origin("data:image/png;base64,AAAA"));
        assert!(!is_api_origin("http://127.0.0.1/a.png"));
        assert!(!is_api_origin("http://169.254.169.254/latest/meta-data"));
    }

    #[test]
    fn an_off_port_on_our_own_host_is_refused() {
        assert!(!is_api_origin("https://swattedw.tf:8443/a.png"));
    }

    #[test]
    fn a_malformed_url_is_refused() {
        assert!(!is_api_origin("not a url"));
        assert!(!is_api_origin(""));
    }

    #[test]
    fn an_image_becomes_a_data_url() {
        assert_eq!(data_url("image/png", b"hi").unwrap(), "data:image/png;base64,aGk=");
    }

    #[test]
    fn a_charset_parameter_is_dropped_and_the_type_is_lowercased() {
        assert_eq!(
            data_url("IMAGE/JPEG; charset=binary", b"hi").unwrap(),
            "data:image/jpeg;base64,aGk="
        );
    }

    #[test]
    fn a_non_image_content_type_is_refused() {
        for ct in ["text/html", "application/json", "", "image/", "imagex/png", "not/image/png"] {
            assert!(data_url(ct, b"hi").is_err(), "{ct} should be refused");
        }
    }

    /// The type is interpolated into the data URL, so a `,` in it would end the
    /// media type and smuggle content past the image check.
    #[test]
    fn a_content_type_with_url_syntax_in_it_is_refused() {
        assert!(data_url("image/png,text/html", b"hi").is_err());
        assert!(data_url("image/<svg>", b"hi").is_err());
    }

    #[test]
    fn an_oversized_body_is_refused() {
        assert!(data_url("image/png", &vec![0u8; MAX_IMAGE_BYTES + 1]).is_err());
        assert!(data_url("image/png", &vec![0u8; MAX_IMAGE_BYTES]).is_ok());
    }
}
