//! Thin #[tauri::command] wrappers.
//!
//! All logic lives in the modules these call, so this file stays a readable
//! inventory of everything the webview is allowed to do. Note what is absent:
//! nothing here returns the session cookie, so the frontend has no path to it.

use crate::api::{auth, client::ApiClient, overview};
use crate::captcha;
use crate::error::AppError;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

pub struct AppState {
    pub client: ApiClient,
}

#[derive(Serialize)]
pub struct SessionStatus {
    pub authenticated: bool,
}

#[tauri::command]
pub fn session_status(state: State<'_, AppState>) -> SessionStatus {
    SessionStatus { authenticated: state.client.has_session() }
}

#[tauri::command]
pub async fn login(
    app: AppHandle,
    state: State<'_, AppState>,
    code: String,
    otp: Option<String>,
) -> Result<auth::LoginOutcome, AppError> {
    let token = captcha::solve(&app).await?;
    Ok(auth::login(&state.client, &code, otp.as_deref(), &token).await)
}

#[tauri::command]
pub async fn register(
    app: AppHandle,
    state: State<'_, AppState>,
    email: Option<String>,
) -> Result<auth::RegisterOutcome, AppError> {
    let token = captcha::solve(&app).await?;
    Ok(auth::register(&state.client, email.as_deref(), &token).await)
}

#[tauri::command]
pub async fn logout(state: State<'_, AppState>) -> Result<(), AppError> {
    auth::logout(&state.client).await
}

#[tauri::command]
pub async fn get_overview(state: State<'_, AppState>) -> Result<overview::Overview, AppError> {
    overview::fetch(&state.client).await
}

/// Public half of the release key that signs integrity.json, baked in at
/// compile time from INTEGRITY_PUBKEY (CI sets it to the public half of the
/// INTEGRITY_SIGNING_KEY secret; a developer sets it to whatever seed they
/// generated locally).
///
/// The all-zero default means "no key configured", and every manifest fails
/// against it. That is deliberate: an unconfigured build reports tampering
/// rather than silently passing, so a release that forgot the key is loudly
/// broken instead of quietly unverified.
const INTEGRITY_PUBKEY_HEX: &str = match option_env!("INTEGRITY_PUBKEY") {
    Some(key) => key,
    None => "0000000000000000000000000000000000000000000000000000000000000000",
};

#[tauri::command]
pub fn verify_integrity(app: AppHandle) -> crate::integrity::IntegrityReport {
    let resource_dir = match app.path().resource_dir() {
        Ok(d) => d,
        Err(e) => {
            return crate::integrity::IntegrityReport {
                ok: false,
                changed: vec![format!("<resource dir unavailable: {e}>")],
                manifest_version: String::new(),
            }
        }
    };

    let manifest = std::fs::read_to_string(resource_dir.join("integrity.json")).unwrap_or_default();
    let pubkey = hex::decode(INTEGRITY_PUBKEY_HEX).unwrap_or_default();

    crate::integrity::verify_integrity(&resource_dir, &manifest, &pubkey)
}

#[tauri::command]
pub async fn check_update(app: AppHandle) -> crate::updater::UpdateResult {
    crate::updater::check_and_download(&app).await
}

#[tauri::command]
pub fn install_update_and_restart(app: AppHandle) -> Result<(), AppError> {
    crate::updater::install_and_restart(&app)
}

/// Opens a URL in the user's browser.
///
/// Allowlisted by ORIGIN, not by prefix: a bare `starts_with("https://github.com")`
/// would also match `https://github.com.evil.test/...`, so each candidate is
/// parsed and its host compared exactly.
#[tauri::command]
pub fn open_external(app: AppHandle, url: String) -> Result<(), AppError> {
    let parsed = url::Url::parse(&url).map_err(|_| AppError::Internal("invalid url".into()))?;
    if parsed.scheme() != "https" {
        return Err(AppError::Internal("blocked external url".into()));
    }

    let api_host = url::Url::parse(crate::config::api_base())
        .ok()
        .and_then(|u| u.host_str().map(str::to_owned));

    let allowed = match parsed.host_str() {
        Some(host) => {
            Some(host) == api_host.as_deref() || host == "t.me" || host == "github.com"
        }
        None => false,
    };

    if !allowed {
        return Err(AppError::Internal("blocked external url".into()));
    }

    tauri_plugin_opener::OpenerExt::opener(&app)
        .open_url(url, None::<&str>)
        .map_err(|e| AppError::Internal(e.to_string()))
}

#[cfg(test)]
mod tests {
    /// The allowlist logic, extracted so it can be tested without an AppHandle.
    fn is_allowed(url: &str, api_base: &str) -> bool {
        let Ok(parsed) = url::Url::parse(url) else { return false };
        if parsed.scheme() != "https" {
            return false;
        }
        let api_host = url::Url::parse(api_base).ok().and_then(|u| u.host_str().map(str::to_owned));
        match parsed.host_str() {
            Some(host) => Some(host) == api_host.as_deref() || host == "t.me" || host == "github.com",
            None => false,
        }
    }

    const BASE: &str = "https://swattedw.tf";

    #[test]
    fn allows_the_api_host_the_bot_and_github() {
        assert!(is_allowed("https://swattedw.tf/dashboard/plans", BASE));
        assert!(is_allowed("https://t.me/swatted_bot", BASE));
        assert!(is_allowed("https://github.com/sujrb/swattedwtf-app/releases", BASE));
    }

    #[test]
    fn rejects_a_lookalike_host() {
        assert!(!is_allowed("https://github.com.evil.test/x", BASE));
        assert!(!is_allowed("https://swattedw.tf.evil.test/x", BASE));
    }

    #[test]
    fn rejects_other_schemes() {
        assert!(!is_allowed("http://swattedw.tf/x", BASE));
        assert!(!is_allowed("file:///etc/passwd", BASE));
        assert!(!is_allowed("javascript:alert(1)", BASE));
    }

    #[test]
    fn rejects_an_unrelated_host() {
        assert!(!is_allowed("https://example.com", BASE));
    }
}
