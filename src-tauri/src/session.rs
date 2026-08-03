//! Session persistence.
//!
//! The parallax_session cookie is the user's credential. It lives in a reqwest
//! cookie jar held by the Rust core and is persisted to the OS keychain
//! (Windows Credential Manager / Linux Secret Service). The webview is never
//! given a path to read it: there is no command that returns it.
//!
//! On Linux systems with no Secret Service provider, keyring fails and we fall
//! back to a file in the app's local data dir with 0600 permissions. That is
//! weaker at rest, and the Settings screen says so.

use crate::config::{KEYCHAIN_SERVICE, KEYCHAIN_SESSION_KEY};
use crate::error::AppError;
use cookie_store::CookieStore;
use std::io::Cursor;
use std::path::PathBuf;

/// Serialises a cookie jar to the newline-delimited JSON that cookie_store emits.
pub fn encode_jar(jar: &CookieStore) -> Result<String, AppError> {
    let mut buf = Vec::new();
    jar.save_json(&mut buf)
        .map_err(|e| AppError::Internal(format!("cookie encode failed: {e}")))?;
    String::from_utf8(buf).map_err(|e| AppError::Internal(format!("cookie encode utf8: {e}")))
}

/// Parses the encoded jar.
///
/// An EMPTY blob is a valid empty jar, not corruption: cookie_store writes
/// newline-delimited JSON, so a jar with no cookies serialises to "". Logout
/// produces exactly that, so rejecting it would break our own save/load cycle.
/// Non-empty input that does not parse IS corruption and errors, so a damaged
/// keychain entry stays visible instead of silently masquerading as a logout.
pub fn decode_jar(blob: &str) -> Result<CookieStore, AppError> {
    if blob.trim().is_empty() {
        return Ok(CookieStore::default());
    }
    CookieStore::load_json(Cursor::new(blob.as_bytes()))
        .map_err(|e| AppError::Internal(format!("cookie decode failed: {e}")))
}

pub struct SessionStore {
    fallback_path: PathBuf,
}

impl SessionStore {
    pub fn new(fallback_path: PathBuf) -> Self {
        Self { fallback_path }
    }

    fn entry(&self) -> Result<keyring::Entry, AppError> {
        keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_SESSION_KEY)
            .map_err(|e| AppError::Keychain(e.to_string()))
    }

    /// Loads the persisted jar, preferring the keychain and falling back to the
    /// local file. A decode failure yields None (start logged out) rather than
    /// propagating, since there is nothing the user could do about it at boot.
    pub fn load(&self) -> Option<CookieStore> {
        let blob = match self
            .entry()
            .and_then(|e| e.get_password().map_err(|e| AppError::Keychain(e.to_string())))
        {
            Ok(b) => b,
            Err(_) => std::fs::read_to_string(&self.fallback_path).ok()?,
        };
        decode_jar(&blob).ok()
    }

    pub fn save(&self, jar: &CookieStore) -> Result<(), AppError> {
        let blob = encode_jar(jar)?;
        if let Ok(entry) = self.entry() {
            if entry.set_password(&blob).is_ok() {
                return Ok(());
            }
        }
        self.write_fallback(&blob)
    }

    fn write_fallback(&self, blob: &str) -> Result<(), AppError> {
        if let Some(dir) = self.fallback_path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| AppError::Internal(e.to_string()))?;
        }
        std::fs::write(&self.fallback_path, blob).map_err(|e| AppError::Internal(e.to_string()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(
                &self.fallback_path,
                std::fs::Permissions::from_mode(0o600),
            );
        }
        Ok(())
    }

    /// Drops the session from both stores. Used by logout, which must survive a
    /// restart, so clearing only the in-memory jar would be a bug.
    pub fn clear(&self) -> Result<(), AppError> {
        if let Ok(entry) = self.entry() {
            let _ = entry.delete_credential();
        }
        let _ = std::fs::remove_file(&self.fallback_path);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;


    fn jar_from(set_cookie: &str) -> CookieStore {
        let url = url::Url::parse("https://swattedw.tf/").unwrap();
        let mut jar = CookieStore::default();
        jar.parse(set_cookie, &url).expect("parse cookie");
        jar
    }

    /// Exactly what the server sends: lib/auth.ts sets maxAge alongside
    /// httpOnly/secure/sameSite, so the cookie is persistent.
    const PRODUCTION_SET_COOKIE: &str =
        "parallax_session=jwt.value.here; Path=/; HttpOnly; SameSite=Lax; Max-Age=1209600";

    #[test]
    fn round_trips_the_production_session_cookie() {
        let jar = jar_from(PRODUCTION_SET_COOKIE);
        assert_eq!(jar.iter_any().count(), 1, "fixture should hold one cookie");

        let decoded = decode_jar(&encode_jar(&jar).expect("encode")).expect("decode");

        assert_eq!(decoded.iter_any().count(), 1);
        assert!(decoded.iter_any().any(|c| c.name() == "parallax_session"));
    }

    /// Guards a silent dependency on the server: cookie_store's save_json only
    /// writes cookies that carry an expiry, so a session cookie with no Max-Age
    /// vanishes on restart and the user is logged out every launch. lib/auth.ts
    /// currently sets maxAge (14 days), which is what makes persistence work at
    /// all. If that is ever dropped server-side, this test documents why the
    /// desktop app suddenly stops staying logged in.
    #[test]
    fn a_cookie_without_an_expiry_is_not_persisted() {
        let jar = jar_from("parallax_session=jwt.value.here; Path=/; HttpOnly");
        assert_eq!(jar.iter_any().count(), 1, "it is in the live jar");

        assert_eq!(
            encode_jar(&jar).expect("encode"),
            "",
            "non-persistent cookies are dropped by save_json"
        );
    }

    #[test]
    fn round_trips_an_empty_jar() {
        let jar = CookieStore::default();
        let decoded = decode_jar(&encode_jar(&jar).expect("encode")).expect("decode");
        assert_eq!(decoded.iter_any().count(), 0);
    }

    #[test]
    fn decoding_garbage_returns_an_error_instead_of_panicking() {
        assert!(decode_jar("not json at all").is_err());
    }

    /// An emptied jar serialises to "", which logout produces, so this must be
    /// read back as an empty jar rather than treated as a corrupted entry.
    #[test]
    fn decoding_an_empty_blob_yields_an_empty_jar() {
        let decoded = decode_jar("").expect("empty blob is a valid empty jar");
        assert_eq!(decoded.iter_any().count(), 0);
    }
}
