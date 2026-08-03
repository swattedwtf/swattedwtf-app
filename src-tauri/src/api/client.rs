//! Shared HTTP client.
//!
//! Every state-changing request carries an explicit `Origin` matching the API
//! base. sameOriginOrAllowed in lib/security.ts rejects a production POST that
//! has neither Origin nor Referer with "Browser origin is required.", so
//! omitting it made login and registration fail with a 403 before the server
//! ever looked at the credentials.
//!
//! Setting it weakens nothing. That guard exists to stop a browser being driven
//! into a cross-site POST by another page; a native client is outside that
//! threat model and can set any header it likes regardless, so sending the
//! honest value is both correct and the only thing that works.

use crate::config::api_base;
use crate::error::AppError;
use crate::session::SessionStore;
use reqwest_cookie_store::CookieStoreMutex;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::sync::Arc;

/// Name of the session cookie the server issues. Presence of this in the jar is
/// what "logged in" means locally.
const SESSION_COOKIE: &str = "parallax_session";

pub struct ApiClient {
    http: reqwest::Client,
    jar: Arc<CookieStoreMutex>,
    store: SessionStore,
}

impl ApiClient {
    pub fn new(store: SessionStore) -> Result<Self, AppError> {
        let jar = Arc::new(CookieStoreMutex::new(store.load().unwrap_or_default()));
        let http = reqwest::Client::builder()
            .cookie_provider(jar.clone())
            .user_agent(concat!("swattedwtf-app/", env!("CARGO_PKG_VERSION")))
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(Self { http, jar, store })
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", api_base(), path)
    }

    /// The Origin the server expects on state-changing requests.
    fn origin() -> &'static str {
        api_base()
    }

    /// True when a session cookie is present in the jar. Does not prove the
    /// session is still valid server-side; the first overview call does.
    pub fn has_session(&self) -> bool {
        self.jar
            .lock()
            .map(|j| j.iter_any().any(|c| c.name() == SESSION_COOKIE))
            .unwrap_or(false)
    }

    /// Writes the current jar back to the keychain. Call after any request that
    /// can set or clear the session cookie.
    ///
    /// The jar lock is released BEFORE the keychain write. That write is a
    /// synchronous D-Bus round-trip on Linux and can block for as long as it
    /// takes the user to type a keyring password; holding the lock across it
    /// would stall every concurrent request through this client.
    pub fn persist(&self) -> Result<(), AppError> {
        let blob = {
            let jar = self
                .jar
                .lock()
                .map_err(|_| AppError::Internal("cookie jar lock poisoned".into()))?;
            crate::session::encode_jar(&jar)?
        };
        self.store.save_blob(&blob)
    }

    /// Drops the session locally, from both the live jar and the keychain, so
    /// logging out survives a restart.
    pub fn forget(&self) -> Result<(), AppError> {
        if let Ok(mut jar) = self.jar.lock() {
            jar.clear();
        }
        self.store.clear()
    }

    /// Reads a response, mapping a non-2xx into AppError::Api carrying the
    /// server's own `error` string so the UI can show it verbatim (rate limits,
    /// "Invalid login code", and so on).
    async fn read<T: DeserializeOwned>(resp: reqwest::Response) -> Result<T, AppError> {
        let status = resp.status();
        let body = resp.text().await.map_err(|e| AppError::Network(e.to_string()))?;

        if !status.is_success() {
            let message = serde_json::from_str::<serde_json::Value>(&body)
                .ok()
                .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(str::to_owned))
                .unwrap_or_else(|| format!("Request failed ({})", status.as_u16()));
            return Err(AppError::Api { status: status.as_u16(), message });
        }

        serde_json::from_str::<T>(&body).map_err(|e| AppError::Internal(e.to_string()))
    }

    pub async fn get_json<T: DeserializeOwned>(&self, path: &str) -> Result<T, AppError> {
        let resp = self
            .http
            .get(self.url(path))
            .send()
            .await
            .map_err(|e| AppError::Network(e.to_string()))?;
        Self::read(resp).await
    }

    pub async fn post_json<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T, AppError> {
        let resp = self
            .http
            .post(self.url(path))
            .header(reqwest::header::ORIGIN, Self::origin())
            .json(body)
            .send()
            .await
            .map_err(|e| AppError::Network(e.to_string()))?;
        Self::read(resp).await
    }

    /// POST returning the raw status and body.
    ///
    /// Needed where the caller must read fields off a NON-2xx response. The
    /// login route signals a second factor with `twofa_required: true` on a 401,
    /// and that flag is the only reliable way to detect it: matching on the
    /// human-readable error text would break the moment the copy is reworded.
    pub async fn post_raw<B: Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<(u16, String), AppError> {
        let resp = self
            .http
            .post(self.url(path))
            .header(reqwest::header::ORIGIN, Self::origin())
            .json(body)
            .send()
            .await
            .map_err(|e| AppError::Network(e.to_string()))?;

        let status = resp.status().as_u16();
        let text = resp.text().await.map_err(|e| AppError::Network(e.to_string()))?;
        Ok((status, text))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn client() -> ApiClient {
        ApiClient::new(SessionStore::new(
            std::env::temp_dir().join("swattedwtf-test-session-does-not-exist.json"),
        ))
        .expect("client builds")
    }

    #[test]
    fn a_fresh_client_reports_no_session() {
        assert!(!client().has_session());
    }

    #[test]
    fn urls_are_built_against_the_api_base() {
        assert_eq!(client().url("/api/auth/login"), format!("{}/api/auth/login", api_base()));
    }

    #[test]
    fn the_default_api_base_is_production_over_https() {
        assert_eq!(api_base(), "https://swattedw.tf");
    }

    /// Regression guard. Without an Origin, lib/security.ts answers a production
    /// POST with 403 "Browser origin is required." and login never reaches the
    /// credential check at all.
    #[test]
    fn the_origin_header_matches_the_api_base_exactly() {
        assert_eq!(ApiClient::origin(), api_base());
        assert!(ApiClient::origin().starts_with("https://"));
        assert!(!ApiClient::origin().ends_with('/'), "a trailing slash would not match the server's expected origin");
    }
}
