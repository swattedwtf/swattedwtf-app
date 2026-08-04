//! Thin #[tauri::command] wrappers.
//!
//! All logic lives in the modules these call, so this file stays a readable
//! inventory of everything the webview is allowed to do. Note what is absent:
//! nothing here returns the session cookie, so the frontend has no path to it.

use crate::api::{auth, client::ApiClient, lookup as lookup_api, overview};
use crate::captcha;
use crate::error::AppError;
use crate::settings::SettingsState;
use crate::shortcut::{self, ShortcutOutcome};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

pub struct AppState {
    pub client: ApiClient,
}

#[derive(Serialize)]
pub struct SessionStatus {
    pub authenticated: bool,
}

// async so it does not run inline on the IPC thread and take the jar mutex there.
#[tauri::command]
pub async fn session_status(state: State<'_, AppState>) -> Result<SessionStatus, AppError> {
    // An async command borrowing State must return Result; the frontend still
    // receives the plain object on the success path.
    Ok(SessionStatus { authenticated: state.client.has_session() })
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

/// Runs one lookup module and returns its normalised payload.
///
/// `module` is a key into a static table on the SERVER, never a URL or a path
/// fragment, so there is no caller-supplied destination anywhere in this call.
/// An unknown key is a 400 from the server, not a request to somewhere else.
#[tauri::command]
pub async fn lookup(
    state: State<'_, AppState>,
    module: String,
    input: serde_json::Value,
) -> Result<serde_json::Value, AppError> {
    lookup_api::lookup(&state.client, &module, input).await
}

/// Fetches an image and hands the webview a `data:` URL.
///
/// The webview cannot load a remote image at all (its CSP is
/// `img-src 'self' data:`) and our image proxy needs the session cookie, which
/// only this side holds. Restricted to our own origin: this command carries the
/// session cookie, so accepting an arbitrary host would let anything running in
/// the webview make authenticated requests wherever it liked and read the
/// answer back as base64.
#[tauri::command]
pub async fn fetch_image(state: State<'_, AppState>, url: String) -> Result<String, AppError> {
    lookup_api::fetch_image(&state.client, &url).await
}

/// Everything the Settings screen needs that is not already in the overview.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    /// The combo the user chose, or null when they turned the hotkey off.
    pub shortcut: Option<String>,
    /// What the operating system has bound RIGHT NOW. Not the same thing as
    /// `shortcut`: a combo another application already holds is stored and not
    /// live, and the screen must not claim otherwise.
    pub shortcut_active: Option<String>,
    /// The system's own message when the two differ.
    pub shortcut_error: Option<String>,
    /// Read from the operating system rather than from settings.json. The OS
    /// owns this bit, the user can change it from outside the app, and a second
    /// copy of it in our file would only ever be the one that was wrong.
    pub launch_at_login: bool,
    /// Why we could not tell. Distinguishes "off" from "unknown".
    pub launch_at_login_error: Option<String>,
    /// Where session.json and settings.json live. Shown under Advanced so a
    /// user can find, inspect or delete them.
    pub app_data_dir: String,
}

#[tauri::command]
pub async fn get_settings(
    app: AppHandle,
    state: State<'_, SettingsState>,
) -> Result<SettingsView, AppError> {
    let (shortcut, shortcut_active, shortcut_error) = {
        let live = state.live.lock().map_err(|_| AppError::Internal("settings lock".into()))?;
        (live.settings.shortcut.clone(), live.active.clone(), live.error.clone())
    };

    let (launch_at_login, launch_at_login_error) = match launch_at_login_enabled(&app) {
        Ok(v) => (v, None),
        Err(e) => (false, Some(e)),
    };

    Ok(SettingsView {
        shortcut,
        shortcut_active,
        shortcut_error,
        launch_at_login,
        launch_at_login_error,
        app_data_dir: state
            .store
            .path()
            .parent()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default(),
    })
}

/// Changes or clears the global hotkey.
///
/// `None` disables it. Always resolves: a rejected combo comes back as an
/// outcome describing which binding is actually live, never as a thrown error,
/// because "your new combo did not take and here is what you still have" is
/// information the screen has to render either way.
///
/// async, and that is load-bearing: the plugin marshals both OS calls onto the
/// main thread and blocks on the reply, so running this inline on the main
/// thread would be waiting for itself.
#[tauri::command]
pub async fn set_shortcut(
    app: AppHandle,
    state: State<'_, SettingsState>,
    shortcut: Option<String>,
) -> Result<ShortcutOutcome, AppError> {
    Ok(shortcut::set(&app, &state, shortcut))
}

/// Turns launch at login on or off, and answers with what the OS reports
/// afterwards rather than with what was asked for.
#[tauri::command]
pub async fn set_launch_at_login(app: AppHandle, enabled: bool) -> Result<bool, AppError> {
    use tauri_plugin_autostart::ManagerExt;

    let manager = app.autolaunch();
    let result = if enabled { manager.enable() } else { manager.disable() };
    result.map_err(|e| AppError::Internal(e.to_string()))?;

    launch_at_login_enabled(&app).map_err(AppError::Internal)
}

fn launch_at_login_enabled(app: &AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;

    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

/// Public half of the release key that signs integrity.json, baked in at
/// compile time from INTEGRITY_PUBKEY (CI sets it to the public half of the
/// INTEGRITY_SIGNING_KEY secret; a developer sets it to whatever seed they
/// generated locally).
///
/// The all-zero default means "no key configured" and is rejected explicitly by
/// verify_integrity, so an unconfigured build reports tampering rather than
/// silently passing.
///
/// It is rejected by an explicit check rather than left to fail verification on
/// its own: the all-zero encoding is a valid ed25519 point of order 4, against
/// which a signature over any message can be forged. Relying on it to fail
/// would have meant an unconfigured build accepting an attacker's manifest.
const INTEGRITY_PUBKEY_HEX: &str = match option_env!("INTEGRITY_PUBKEY") {
    Some(key) => key,
    None => "0000000000000000000000000000000000000000000000000000000000000000",
};

// async: this SHA-256s the whole bundle, which must not run on the UI thread.
#[tauri::command]
pub async fn verify_integrity(app: AppHandle) -> crate::integrity::IntegrityReport {
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

    // Both paths come from bundle.resources in tauri.conf.json, which uses the
    // MAP form precisely so these land where this code expects. With the list
    // form Tauri preserves the source path, and the manifest ended up at
    // resource_dir/resources/integrity.json while this read resource_dir/,
    // which surfaced to users as "malformed manifest" on every launch.
    let manifest_path = resource_dir.join("integrity.json");
    let app_dir = resource_dir.join("app");

    let manifest = match std::fs::read_to_string(&manifest_path) {
        Ok(m) => m,
        Err(e) => {
            return crate::integrity::IntegrityReport {
                ok: false,
                changed: vec![format!("<manifest unreadable: {e}>")],
                manifest_version: String::new(),
            }
        }
    };

    let pubkey = hex::decode(INTEGRITY_PUBKEY_HEX).unwrap_or_default();

    // Hash the bundled copy of the frontend, not the resource root: Tauri
    // embeds the served frontend inside the binary, so the files named in the
    // manifest only exist on disk because bundle.resources ships dist/ to app/.
    crate::integrity::verify_integrity(&app_dir, &manifest, &pubkey)
}

#[tauri::command]
pub async fn check_update(app: AppHandle) -> crate::updater::UpdateResult {
    crate::updater::check_and_download(&app).await
}

#[tauri::command]
pub fn install_update_and_restart(app: AppHandle) -> Result<(), AppError> {
    crate::updater::install_and_restart(&app)
}

/// Writes the one-time login code to a file the user picks.
///
/// Deliberately implemented in Rust rather than with the fs plugin in the
/// webview. Granting the UI filesystem access to save one small file would mean
/// any script running in the webview could write anywhere the scope allowed;
/// here the only path ever written is the one the user chose in a native save
/// dialog, and the UI has no fs permission at all.
///
/// Returns the chosen path, or None when the user cancels.
#[tauri::command]
pub async fn save_recovery_file(app: AppHandle, code: String) -> Result<Option<String>, AppError> {
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_file_name("swatted-login-code.txt")
        .add_filter("Text", &["txt"])
        .save_file(move |path| {
            let _ = tx.send(path);
        });

    let Some(path) = rx.await.map_err(|_| AppError::Internal("dialog closed".into()))? else {
        return Ok(None);
    };

    let path = path
        .into_path()
        .map_err(|e| AppError::Internal(format!("invalid save path: {e}")))?;

    let body = format!(
        "swatted.wtf login code\n\n{code}\n\nThis code is the only way to sign in. Keep it private.\n"
    );
    std::fs::write(&path, body).map_err(|e| AppError::Internal(e.to_string()))?;

    // Owner-only where the platform supports it: this file holds a credential.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }

    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Dismisses the quick-lookup overlay.
///
/// The overlay hides itself rather than closing, so the next hotkey press is a
/// show rather than a webview boot.
#[tauri::command]
pub async fn hide_quick(app: AppHandle) -> Result<(), AppError> {
    crate::quick::hide(&app);
    Ok(())
}

/// Reports what the window actually resolved to at runtime.
///
/// Exists because the rounded corners are configured correctly and verifiably
/// transparent in the page, yet render square on Windows. Settings surfaces
/// this so the machine with the problem can report the answer.
#[tauri::command]
pub async fn window_diagnostics(
    app: AppHandle,
) -> Result<crate::window_chrome::WindowDiagnostics, AppError> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| AppError::Internal("no main window".into()))?;
    Ok(crate::window_chrome::diagnostics(&window))
}

/// Opens a URL in the user's browser.
///
/// Allowlisted by ORIGIN, not by prefix: a bare `starts_with("https://github.com")`
/// would also match `https://github.com.evil.test/...`, so each candidate is
/// parsed and its host compared exactly.
#[tauri::command]
pub async fn open_external(app: AppHandle, url: String) -> Result<(), AppError> {
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

    // The NORMALISED url, not the caller's raw string: WHATWG parsing strips
    // ASCII tabs, newlines and leading control characters anywhere in the input,
    // so the two can differ even when validation passed.
    tauri_plugin_opener::OpenerExt::opener(&app)
        .open_url(parsed.as_str(), None::<&str>)
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
        assert!(is_allowed("https://github.com/swattedwtf/swattedwtf-app/releases", BASE));
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
