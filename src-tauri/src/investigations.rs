//! Transport for the desktop INVESTIGATIONS surface.
//!
//! Investigations is a case manager, not a lookup: listing cases, creating one,
//! renaming it, closing it and writing notes run no providers and spend no
//! credits. The server reflects that by gating POST /api/desktop/investigations
//! on the ordinary signed-in mutation gate rather than on the metered lookup
//! gate, so this deliberately does NOT go through `api::lookup`.
//!
//! It lives here rather than beside the other transports for the same reason
//! `quick` and `updater` do: it is one fixed path with no fan-out, no image
//! rewriting and no streaming, and folding it into the lookup module would have
//! meant a reader of that module having to know which of its calls are metered.
//!
//! Why it exists at all: the session cookie lives on this side and deliberately
//! never reaches the webview, so the frontend cannot make an authenticated
//! request of its own. Every call the Investigations screen makes comes through
//! here.
//!
//! `action` is a key into a closed set on the SERVER (lib/desktop/
//! investigations.ts), never a URL, a path fragment or a store key. The path is
//! a constant in this file, so there is no caller-supplied destination anywhere
//! in this request.

use crate::api::client::ApiClient;
use crate::error::AppError;
use serde::Serialize;

const INVESTIGATIONS_PATH: &str = "/api/desktop/investigations";

/// What the route is asked to do, plus that action's arguments.
///
/// The arguments stay an untyped `serde_json::Value`, exactly as a lookup's
/// input does. Typing them here would cost a client release every time the case
/// shape gained a field, for no safety gain: the server validates every field it
/// reads and refuses anything it does not recognise, and the renderer already
/// tolerates absent fields.
#[derive(Serialize)]
struct InvestigationsBody<'a> {
    action: &'a str,
    #[serde(flatten)]
    input: &'a serde_json::Value,
}

/// Runs one case-manager action and returns the route's payload.
///
/// A refusal (a dead session, a rate limit, a 404 for a case that is not the
/// caller's) surfaces as `AppError::Api` carrying the server's own message, the
/// same as every other call in the app, so the screen classifies it with the
/// shared `classifyError`.
pub async fn call(
    client: &ApiClient,
    action: &str,
    input: serde_json::Value,
) -> Result<serde_json::Value, AppError> {
    // A non-object would serialise as a bare value under `flatten` and produce a
    // body the server cannot read, so it is normalised to an empty object here
    // rather than turning into an opaque serialisation failure.
    let input = if input.is_object() { input } else { serde_json::json!({}) };
    client.post_json(INVESTIGATIONS_PATH, &InvestigationsBody { action, input: &input }).await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The body must be `{action, ...args}`: the server reads `action` at the
    /// top level and each argument beside it.
    #[test]
    fn the_action_and_its_arguments_are_one_flat_object() {
        let input = serde_json::json!({ "id": "case_1", "patch": { "notes": "hi" } });
        let body = serde_json::to_value(InvestigationsBody { action: "update", input: &input })
            .expect("serialises");
        assert_eq!(body["action"], "update");
        assert_eq!(body["id"], "case_1");
        assert_eq!(body["patch"]["notes"], "hi");
    }

    #[test]
    fn an_action_with_no_arguments_is_still_a_valid_body() {
        let input = serde_json::json!({});
        let body = serde_json::to_value(InvestigationsBody { action: "list", input: &input })
            .expect("serialises");
        assert_eq!(body, serde_json::json!({ "action": "list" }));
    }

    /// The path is a constant. Nothing the caller passes can move this request
    /// to another endpoint.
    #[test]
    fn the_path_is_fixed() {
        assert_eq!(INVESTIGATIONS_PATH, "/api/desktop/investigations");
        assert!(!INVESTIGATIONS_PATH.contains("{"));
    }
}
