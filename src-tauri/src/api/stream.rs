//! Transport for the desktop STREAMING surface.
//!
//! A handful of screens (Search, Live Intelligence) receive their results over
//! Server-Sent Events instead of one payload: the server runs a sweep of many
//! sources and emits a frame per source as it lands. This owns the connection
//! for exactly the reason `lookup` does: it carries the session cookie, which
//! lives on this side and deliberately never reaches the webview.
//!
//! The shape is two commands and a background pump:
//!
//!  - `start` POSTs to /api/desktop/stream. A refusal (402, 401, 429, ...) is
//!    turned into `AppError::Api` BEFORE any id exists, so the screen classifies
//!    it exactly like a lookup failure and a 402 still renders the upgrade
//!    panel. Only a live 2xx stream is handed to the pump, which emits Tauri
//!    events as bytes arrive.
//!  - `cancel` tears a running stream down: it drops the response, which closes
//!    the connection, which the server observes as a client disconnect and
//!    stops its own upstream fan-out.
//!
//! Every message rides one Tauri event, `desktop-stream`, and carries the `id`
//! the frontend filters on, so several streams can run at once without their
//! frames being confused.

use crate::api::client::ApiClient;
use crate::error::AppError;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;

const STREAM_PATH: &str = "/api/desktop/stream";

/// The one Tauri event every chunk, end and error is delivered on. One name for
/// all streams; each message carries the `id` the frontend keys on.
pub const STREAM_EVENT: &str = "desktop-stream";

#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum StreamMsg {
    /// A slice of the SSE body, already decoded to valid UTF-8. The frontend
    /// concatenates these and parses SSE frames out of the joined text.
    Chunk { id: u64, data: String },
    /// The response body ended cleanly. No more chunks for this id.
    End { id: u64 },
    /// The connection failed mid-stream (a network drop or the read timeout).
    /// Distinct from a clean end so the screen offers Retry rather than showing
    /// an empty result as though the sweep had finished with nothing.
    Error { id: u64, message: String },
}

#[derive(Serialize)]
struct StreamBody<'a> {
    module: &'a str,
    input: &'a serde_json::Value,
}

/// Live streams, keyed by id, each holding the sender that cancels it.
///
/// The cancel sender is inserted BEFORE the pump task is spawned, so a stream
/// that finishes instantly still finds its own entry to remove and cannot leak.
#[derive(Default)]
pub struct StreamRegistry {
    next: AtomicU64,
    cancels: Mutex<HashMap<u64, oneshot::Sender<()>>>,
}

/// Decodes and removes the longest valid-UTF-8 prefix of `buf`, leaving any
/// trailing bytes of an incomplete multi-byte character in place for the next
/// chunk. A username here is routinely emoji or CJK, and a chunk boundary can
/// fall in the middle of one, so decoding the whole buffer with `from_utf8`
/// would drop a real frame at every such split.
fn take_valid_utf8(buf: &mut Vec<u8>) -> String {
    let valid_up_to = match std::str::from_utf8(buf) {
        Ok(_) => buf.len(),
        Err(e) => e.valid_up_to(),
    };
    // The prefix is guaranteed valid, so lossy decoding is exact here and avoids
    // an unwrap.
    let out = String::from_utf8_lossy(&buf[..valid_up_to]).into_owned();
    buf.drain(..valid_up_to);
    out
}

/// Reads the live response chunk by chunk, emitting a `Chunk` per decoded slice
/// and exactly one terminal `End` or `Error`.
async fn pump(app: &AppHandle, mut resp: reqwest::Response, id: u64) {
    let mut pending: Vec<u8> = Vec::new();
    loop {
        match resp.chunk().await {
            Ok(Some(bytes)) => {
                pending.extend_from_slice(&bytes);
                let text = take_valid_utf8(&mut pending);
                if !text.is_empty() {
                    let _ = app.emit(STREAM_EVENT, StreamMsg::Chunk { id, data: text });
                }
            }
            Ok(None) => {
                let _ = app.emit(STREAM_EVENT, StreamMsg::End { id });
                return;
            }
            Err(e) => {
                let _ = app.emit(STREAM_EVENT, StreamMsg::Error { id, message: e.to_string() });
                return;
            }
        }
    }
}

/// Opens a stream and starts pumping it, returning the id the frontend uses to
/// filter events and to cancel.
pub async fn start(
    app: AppHandle,
    client: &ApiClient,
    registry: &StreamRegistry,
    module: String,
    input: serde_json::Value,
) -> Result<u64, AppError> {
    // Errors surface HERE, before an id exists, so the caller classifies a 402
    // or a 429 exactly as it does a lookup failure.
    let resp = client
        .post_stream(STREAM_PATH, &StreamBody { module: &module, input: &input })
        .await?;

    let id = registry.next.fetch_add(1, Ordering::Relaxed);
    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
    // Registered before the task is spawned: a stream that ends immediately must
    // still find its entry to remove.
    if let Ok(mut map) = registry.cancels.lock() {
        map.insert(id, cancel_tx);
    }

    let app_for_task = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::select! {
            // Whichever settles first wins; if cancel wins, the pump future is
            // dropped, which drops `resp` and closes the connection.
            _ = pump(&app_for_task, resp, id) => {}
            _ = cancel_rx => {}
        }
        // Forget this id however it ended. `remove` on the cancel path is a
        // second removal and harmless; on the natural path it is the only one.
        if let Some(reg) = app_for_task.try_state::<StreamRegistry>() {
            if let Ok(mut map) = reg.cancels.lock() {
                map.remove(&id);
            }
        }
    });

    Ok(id)
}

/// Cancels a running stream. A no-op for an id that already finished.
pub fn cancel(registry: &StreamRegistry, id: u64) {
    if let Ok(mut map) = registry.cancels.lock() {
        if let Some(tx) = map.remove(&id) {
            // The receiver is in the pump task's select; sending wakes it and
            // drops the response. A send failure means the task already ended.
            let _ = tx.send(());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::take_valid_utf8;

    #[test]
    fn a_whole_valid_buffer_is_taken_and_emptied() {
        let mut buf = b"data: {\"t\":\"done\"}\n\n".to_vec();
        assert_eq!(take_valid_utf8(&mut buf), "data: {\"t\":\"done\"}\n\n");
        assert!(buf.is_empty());
    }

    /// The bug this exists to prevent: a multi-byte character split across two
    /// chunks. The trailing bytes must stay in the buffer, not be dropped.
    #[test]
    fn a_split_multibyte_char_keeps_its_tail_for_the_next_chunk() {
        // "é" is 0xC3 0xA9. Feed only the first byte.
        let mut buf = vec![b'x', 0xC3];
        assert_eq!(take_valid_utf8(&mut buf), "x");
        assert_eq!(buf, vec![0xC3], "the lone lead byte must be retained");

        // The next chunk completes it.
        buf.push(0xA9);
        assert_eq!(take_valid_utf8(&mut buf), "é");
        assert!(buf.is_empty());
    }

    #[test]
    fn an_empty_buffer_yields_an_empty_string() {
        let mut buf: Vec<u8> = Vec::new();
        assert_eq!(take_valid_utf8(&mut buf), "");
        assert!(buf.is_empty());
    }
}
