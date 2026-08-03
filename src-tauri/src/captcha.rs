//! Turnstile helper window.
//!
//! Turnstile cannot run on a tauri:// origin, so we open the real page at
//! {api_base}/desktop/captcha in a separate window. When the challenge is
//! solved that page navigates to ?token=..., which we observe here.
//!
//! The remote page is granted no Tauri capability: the token crosses back over
//! a navigation we watch, never over IPC. That keeps the blast radius of a
//! compromised page down to "can hand us a captcha token".

use crate::config::api_base;
use crate::error::AppError;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::oneshot;

const WINDOW_LABEL: &str = "captcha";
const CAPTCHA_PATH: &str = "/desktop/captcha";

/// Pulls the token out of a callback navigation, or None for any URL that is
/// not our captcha page carrying a `token` parameter.
///
/// Scheme, host, port and path must all match the configured API base exactly.
/// A substring test would be wrong in both directions: "w.tf" is a substring of
/// "https://swattedw.tf", and "swattedw.tf.evil.com" contains our host, so
/// either sloppy check turns this window into a token-injection vector.
pub fn token_from_url(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    let base = url::Url::parse(api_base()).ok()?;

    if parsed.scheme() != base.scheme() {
        return None;
    }
    if parsed.host_str()? != base.host_str()? {
        return None;
    }
    if parsed.port_or_known_default() != base.port_or_known_default() {
        return None;
    }
    // Exact path, so /desktop/captcha-something cannot impersonate the callback.
    if parsed.path() != CAPTCHA_PATH {
        return None;
    }

    parsed
        .query_pairs()
        .find(|(k, _)| k == "token")
        .map(|(_, v)| v.into_owned())
}

/// True when a URL is on the same origin as the API. Navigation away from it is
/// refused, so the helper window can only ever show our own captcha page.
fn is_api_origin(u: &url::Url) -> bool {
    let Ok(base) = url::Url::parse(api_base()) else { return false };
    u.scheme() == base.scheme()
        && u.host_str() == base.host_str()
        && u.port_or_known_default() == base.port_or_known_default()
}

/// Opens the helper window and resolves with the Turnstile token.
///
/// Times out rather than hanging forever if the user walks away, and closes the
/// window on every exit path so a stale challenge can never linger.
pub async fn solve(app: &AppHandle) -> Result<String, AppError> {
    if let Some(existing) = app.get_webview_window(WINDOW_LABEL) {
        let _ = existing.close();
    }

    let (tx, rx) = oneshot::channel::<String>();
    let tx = std::sync::Mutex::new(Some(tx));

    let url = format!("{}{}", api_base(), CAPTCHA_PATH);
    let parsed = url::Url::parse(&url).map_err(|e| AppError::Internal(e.to_string()))?;

    let window = WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::External(parsed))
        .title("Verify")
        .inner_size(420.0, 460.0)
        .resizable(false)
        .center()
        .on_navigation(move |u| {
            if let Some(token) = token_from_url(u.as_str()) {
                if let Ok(mut slot) = tx.lock() {
                    if let Some(sender) = slot.take() {
                        let _ = sender.send(token);
                    }
                }
            }
            // Pin navigation to the API origin. Without this the helper is a
            // general-purpose browser window with no address bar inside a
            // trusted-looking app: an open redirect on the captcha page, or a
            // compromised CDN, would turn it into a phishing surface, and it
            // would happily render file:// and data:: documents.
            is_api_origin(&u)
        })
        .build()
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let result = tokio::time::timeout(std::time::Duration::from_secs(180), rx).await;
    let _ = window.close();

    match result {
        Ok(Ok(token)) => Ok(token),
        Ok(Err(_)) => Err(AppError::Internal("captcha window closed".into())),
        Err(_) => Err(AppError::Internal("captcha timed out".into())),
    }
}

#[cfg(test)]
mod tests {
    use super::token_from_url;

    #[test]
    fn extracts_a_token_from_the_callback_url() {
        let u = "https://swattedw.tf/desktop/captcha?token=abc.def-123";
        assert_eq!(token_from_url(u), Some("abc.def-123".to_string()));
    }

    #[test]
    fn decodes_percent_encoding() {
        let u = "https://swattedw.tf/desktop/captcha?token=a%2Bb%3Dc";
        assert_eq!(token_from_url(u), Some("a+b=c".to_string()));
    }

    #[test]
    fn accepts_an_empty_token_when_turnstile_is_disabled_server_side() {
        let u = "https://swattedw.tf/desktop/captcha?token=";
        assert_eq!(token_from_url(u), Some(String::new()));
    }

    #[test]
    fn ignores_the_initial_page_load() {
        assert_eq!(token_from_url("https://swattedw.tf/desktop/captcha"), None);
    }

    #[test]
    fn ignores_an_unrelated_navigation() {
        assert_eq!(token_from_url("https://example.com/?token=x"), None);
    }

    /// A page on another host must never be able to feed us a token, even if it
    /// mimics the path. This is the check that keeps the helper window from
    /// being a redirect-hijack vector.
    #[test]
    fn ignores_a_lookalike_host_with_the_same_path() {
        assert_eq!(token_from_url("https://swattedw.tf.evil.com/desktop/captcha?token=x"), None);
    }

    #[test]
    fn ignores_a_malformed_url() {
        assert_eq!(token_from_url("not a url"), None);
    }

    /// The host must match exactly, not merely be a substring of the API base.
    /// "w.tf" IS a substring of "https://swattedw.tf", so a naive
    /// `api_base().contains(host)` check would accept a token from it.
    #[test]
    fn ignores_a_host_that_is_only_a_substring_of_the_api_base() {
        assert_eq!(token_from_url("https://w.tf/desktop/captcha?token=x"), None);
        assert_eq!(token_from_url("https://tf/desktop/captcha?token=x"), None);
    }

    /// Downgrade to plain HTTP must not be accepted against an https base.
    #[test]
    fn ignores_a_scheme_downgrade() {
        assert_eq!(token_from_url("http://swattedw.tf/desktop/captcha?token=x"), None);
    }
}
