//! One error type crossing the IPC boundary, serialised as a tagged union so
//! the frontend can switch on `kind` without string matching.

use serde::Serialize;

#[derive(Debug, thiserror::Error, Serialize)]
#[serde(tag = "kind", content = "detail")]
pub enum AppError {
    /// The API could not be reached at all. Drives the blocking offline screen.
    #[error("network error: {0}")]
    Network(String),

    /// The API answered with a non-2xx status. `message` is the server's own
    /// error string, shown verbatim (rate limits, invalid code, and so on).
    ///
    /// `code` is the server's machine-readable reason, present on almost every
    /// refusal (`heist_required`, `launch_locked`, `legal_acceptance_required`,
    /// `rate_limited`, ...). The status alone cannot tell "you need Premium"
    /// from "you need Heist" from "accept the updated terms": all three are a
    /// 402 or a 403, so the UI branches on this and never on the copy.
    #[error("api error {status}: {message}")]
    Api { status: u16, message: String, code: Option<String> },

    #[error("keychain error: {0}")]
    Keychain(String),

    #[error("integrity error: {0}")]
    Integrity(String),

    #[error("internal error: {0}")]
    Internal(String),
}
