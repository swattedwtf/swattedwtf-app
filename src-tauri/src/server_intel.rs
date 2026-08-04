//! Transport for the Roblox SERVER INTEL screen.
//!
//! Server Intel is a pairing SESSION, not a lookup. The operator mints a
//! one-time connector, pastes it into their Roblox executor, and the connector
//! reports the server's roster back to our API; the screen then polls that
//! session and steers it. The server route reflects that by gating on the
//! ordinary signed-in mutation gate, plus the Heist plan on minting alone,
//! rather than on the metered lookup gate, so this deliberately does NOT go
//! through `api::lookup`. Polling a screen must not spend a search every few
//! seconds.
//!
//! It lives here rather than beside the other transports for the same reason
//! `monitor` and `investigations` do: it is one fixed path with no fan-out, no
//! image rewriting and no streaming, and folding it into the lookup module would
//! have meant a reader of that module having to know which of its calls are
//! metered.
//!
//! Why it exists at all: the session cookie lives on this side and deliberately
//! never reaches the webview, so the frontend cannot make an authenticated
//! request of its own. Every call the Server Intel screen makes comes through
//! here.
//!
//! `action` is a key into a closed set on the SERVER (lib/desktop/
//! server-intel.ts), never a URL, a path fragment or a store key. The path is a
//! constant in this file, so there is no caller-supplied destination anywhere in
//! this request. In particular the in-game half of the protocol (the roster
//! ingest and the connector script, which authenticate with the pairing key and
//! carry no session) is NOT an action, is not reachable from here, and must not
//! become so: it is the executor's endpoint, not the client's.

use crate::api::client::ApiClient;
use crate::error::AppError;
use serde::Serialize;

const SERVER_INTEL_PATH: &str = "/api/desktop/server-intel";

/// What the route is asked to do, plus that action's arguments.
///
/// The arguments stay an untyped `serde_json::Value`, exactly as a lookup's
/// input does. Typing them here would cost a client release every time the
/// roster shape gained a field, for no safety gain: the server validates every
/// field it reads and refuses anything it does not recognise, and the renderer
/// already tolerates absent fields.
#[derive(Serialize)]
struct ServerIntelBody<'a> {
    action: &'a str,
    #[serde(flatten)]
    input: &'a serde_json::Value,
}

/// Runs one Server Intel action and returns the route's payload.
///
/// A refusal (a 402 `heist_required` from the plan gate on minting, a 429 when
/// the two-per-five-hours connector budget is spent, a dead session, a 404 for a
/// session that has expired) surfaces as `AppError::Api` carrying the server's
/// own message, the same as every other call in the app, so the screen
/// classifies it with the shared `classifyError`.
pub async fn call(
    client: &ApiClient,
    action: &str,
    input: serde_json::Value,
) -> Result<serde_json::Value, AppError> {
    // A non-object would serialise as a bare value under `flatten` and produce a
    // body the server cannot read, so it is normalised to an empty object here
    // rather than turning into an opaque serialisation failure.
    let input = if input.is_object() { input } else { serde_json::json!({}) };
    client.post_json(SERVER_INTEL_PATH, &ServerIntelBody { action, input: &input }).await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The body must be `{action, ...args}`: the server reads `action` at the
    /// top level and each argument beside it.
    #[test]
    fn the_action_and_its_arguments_are_one_flat_object() {
        let input = serde_json::json!({ "userId": "1234", "on": true });
        let body = serde_json::to_value(ServerIntelBody { action: "highlight", input: &input })
            .expect("serialises");
        assert_eq!(body["action"], "highlight");
        assert_eq!(body["userId"], "1234");
        assert_eq!(body["on"], true);
    }

    #[test]
    fn an_action_with_no_arguments_is_still_a_valid_body() {
        let input = serde_json::json!({});
        let body =
            serde_json::to_value(ServerIntelBody { action: "state", input: &input }).expect("serialises");
        assert_eq!(body, serde_json::json!({ "action": "state" }));
    }

    /// An overlay patch is nested, so the flatten must not swallow it.
    #[test]
    fn a_nested_patch_survives_the_flatten() {
        let input = serde_json::json!({ "patch": { "esp": true } });
        let body = serde_json::to_value(ServerIntelBody { action: "overlay", input: &input })
            .expect("serialises");
        assert_eq!(body["patch"]["esp"], true);
    }

    /// The path is a constant. Nothing the caller passes can move this request
    /// to another endpoint, and in particular it can never reach the in-game
    /// ingest or connector routes.
    #[test]
    fn the_path_is_fixed() {
        assert_eq!(SERVER_INTEL_PATH, "/api/desktop/server-intel");
        assert!(!SERVER_INTEL_PATH.contains("{"));
        assert!(!SERVER_INTEL_PATH.contains("roblox/beta"));
    }
}
