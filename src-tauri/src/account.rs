//! Transport for the account-management actions on the Settings screen.
//!
//! Regenerate the login code, change the email, sign out of every session, and
//! delete the account. Like `monitor` and `investigations` this is one command,
//! one constant path, and an `action` that is a key into a fixed set on the
//! server - nothing here builds a URL from what the webview sent, so a
//! compromised webview cannot aim the session cookie somewhere of its choosing.
//!
//! These are self-gated server-side on the caller's own session; the credential
//! stays on this side, exactly as everywhere else.

use crate::api::client::ApiClient;
use crate::error::AppError;
use serde::Serialize;

const ACCOUNT_PATH: &str = "/api/desktop/account";

#[derive(Serialize)]
struct AccountBody<'a> {
    action: &'a str,
    input: &'a serde_json::Value,
}

/// Runs one account action server-side and returns its payload.
///
/// Every refusal (a 401 on a dead session, a validation error, a suspended
/// account that cannot self-delete) arrives as `AppError::Api` through the
/// shared `error_from`, so the screen classifies it with the same
/// `classifyError` every other screen uses.
pub async fn call(
    client: &ApiClient,
    action: &str,
    input: serde_json::Value,
) -> Result<serde_json::Value, AppError> {
    client.post_json(ACCOUNT_PATH, &AccountBody { action, input: &input }).await
}
