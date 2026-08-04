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
    /// Image fetches only. Identical to `http` except that it REFUSES to follow
    /// redirects: `fetch_image` validates the URL once, and reqwest's default
    /// policy of ten hops would leave that check binding only the first one. The
    /// server-side proxy sets `redirect: "error"` for the same reason.
    images: reqwest::Client,
    /// SSE streaming only. Separate from `http` because `http`'s 30s total
    /// timeout would kill a Live Intelligence sweep, which the server runs for
    /// up to 180s. This client has NO total timeout; instead a read timeout cuts
    /// a connection that has gone silent, which the server's 15s heartbeat keeps
    /// from ever tripping on a healthy stream.
    stream: reqwest::Client,
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
        let images = reqwest::Client::builder()
            .cookie_provider(jar.clone())
            .user_agent(concat!("swattedwtf-app/", env!("CARGO_PKG_VERSION")))
            .timeout(std::time::Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let stream = reqwest::Client::builder()
            .cookie_provider(jar.clone())
            .user_agent(concat!("swattedwtf-app/", env!("CARGO_PKG_VERSION")))
            // No total timeout: a sweep can legitimately run for minutes. The
            // read timeout is the safety net for a connection that stops
            // producing bytes entirely; the server heartbeats every 15s.
            .read_timeout(std::time::Duration::from_secs(60))
            .build()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(Self { http, images, stream, jar, store })
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
    /// "Invalid login code", and so on), plus its machine-readable `code`.
    ///
    /// The body is parsed by `lookup::error_from` rather than here, so there is
    /// exactly one definition of a server error body in the client.
    async fn read<T: DeserializeOwned>(resp: reqwest::Response) -> Result<T, AppError> {
        let status = resp.status();
        let body = resp.text().await.map_err(|e| AppError::Network(e.to_string()))?;

        if !status.is_success() {
            return Err(crate::api::lookup::error_from(status.as_u16(), &body));
        }

        serde_json::from_str::<T>(&body).map_err(|e| AppError::Internal(e.to_string()))
    }

    /// GETs an ABSOLUTE url, returning its content type and body.
    ///
    /// Absolute rather than a path, because the caller passes a URL the server
    /// minted inside a payload. That makes the destination caller-supplied, so
    /// every caller must prove the URL is ours first: `lookup::fetch_image`
    /// does that with `is_api_origin` before calling this.
    ///
    /// The body is accumulated chunk by chunk against `max_bytes`, so an
    /// oversized or endless response is dropped mid-flight rather than after it
    /// has already been held in memory. The declared length is checked first
    /// where it exists, which avoids downloading it at all.
    pub async fn get_bytes(
        &self,
        url: &str,
        max_bytes: usize,
    ) -> Result<(String, Vec<u8>), AppError> {
        let mut resp = self
            .images
            .get(url)
            .send()
            .await
            .map_err(|e| AppError::Network(e.to_string()))?;

        let status = resp.status();
        let content_type = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default()
            .to_owned();

        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(crate::api::lookup::error_from(status.as_u16(), &body));
        }

        if resp.content_length().is_some_and(|len| len > max_bytes as u64) {
            return Err(AppError::Internal("image too large".into()));
        }

        let mut out: Vec<u8> = Vec::new();
        while let Some(chunk) = resp.chunk().await.map_err(|e| AppError::Network(e.to_string()))? {
            if out.len() + chunk.len() > max_bytes {
                return Err(AppError::Internal("image too large".into()));
            }
            out.extend_from_slice(&chunk);
        }

        Ok((content_type, out))
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

    /// Opens an SSE stream, returning the live response for the caller to read
    /// chunk by chunk.
    ///
    /// A non-2xx is turned into `AppError::Api` HERE, before any streaming
    /// starts, and by the same `error_from` the JSON path uses, so a 402
    /// `launch_locked` on a stream renders the upgrade panel exactly as it does
    /// on a lookup rather than opening an empty stream that never produces a
    /// frame. Only a 2xx response is handed back to be pumped.
    pub async fn post_stream<B: Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<reqwest::Response, AppError> {
        let resp = self
            .stream
            .post(self.url(path))
            .header(reqwest::header::ORIGIN, Self::origin())
            .header(reqwest::header::ACCEPT, "text/event-stream")
            .json(body)
            .send()
            .await
            .map_err(|e| AppError::Network(e.to_string()))?;

        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(crate::api::lookup::error_from(status.as_u16(), &text));
        }
        Ok(resp)
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
