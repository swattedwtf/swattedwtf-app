//! Transport for the Monitor screen.
//!
//! Monitor is a SUBSCRIPTION surface, not a lookup: the user registers an
//! identifier and the server's scanner tells them later when something turns up.
//! It therefore does not go through `api::lookup`, whose server route runs the
//! metering gate and would charge a search for opening a screen that only lists
//! what is already being watched.
//!
//! One command, one path, and an `action` that is a key into a fixed set on the
//! server. Nothing here builds a URL from what the webview sent, exactly as in
//! `api::lookup`: the destination is this constant and nothing else, so a
//! compromised webview cannot aim the session cookie somewhere of its choosing.
//!
//! The payload stays an untyped `serde_json::Value` for the same reason the
//! lookup payload does. Rust owns the credential and the failure classification;
//! the shape of the answer belongs to the screen that renders it, and typing it
//! here would cost a client release every time a field is added.

use crate::api::client::ApiClient;
use crate::error::AppError;
use serde::Serialize;

const MONITOR_PATH: &str = "/api/desktop/monitor";

#[derive(Serialize)]
struct MonitorBody<'a> {
    action: &'a str,
    input: &'a serde_json::Value,
}

/// Runs one Monitor action server-side and returns its payload.
///
/// Every refusal (a 402 `heist_required` from the plan gate, a 401 on a dead
/// session, a 429, a scanner the proxy could not reach) arrives as
/// `AppError::Api` through the shared `error_from`, so the screen classifies it
/// with the same `classifyError` every other screen uses.
pub async fn call(
    client: &ApiClient,
    action: &str,
    input: serde_json::Value,
) -> Result<serde_json::Value, AppError> {
    client.post_json(MONITOR_PATH, &MonitorBody { action, input: &input }).await
}
