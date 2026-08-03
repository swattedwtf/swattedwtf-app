//! Update check and install.
//!
//! Downloads happen during the boot splash, but installation is never silent:
//! the user gets a Restart now / Later choice. Every update is signature
//! verified by the Tauri updater against the pubkey compiled into the config,
//! which is real cryptographic protection, unlike the integrity check.

use crate::error::AppError;
use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::UpdaterExt;

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum UpdateResult {
    Current,
    Ready { version: String },
    Failed { error: String },
}

/// Holds the downloaded update between the check and the user's Restart click,
/// so choosing Restart does not re-download what we already have.
#[derive(Default)]
pub struct PendingUpdate(std::sync::Mutex<Option<(tauri_plugin_updater::Update, Vec<u8>)>>);

impl PendingUpdate {
    pub fn set(&self, update: tauri_plugin_updater::Update, bytes: Vec<u8>) {
        if let Ok(mut slot) = self.0.lock() {
            *slot = Some((update, bytes));
        }
    }

    pub fn take(&self) -> Option<(tauri_plugin_updater::Update, Vec<u8>)> {
        self.0.lock().ok().and_then(|mut s| s.take())
    }
}

/// Checks for an update and downloads it if there is one.
///
/// A failure here is deliberately NOT fatal: the boot machine treats it as
/// "carry on". A broken release feed or a rate-limited GitHub must not lock
/// anyone out of an app that is working fine.
pub async fn check_and_download(app: &AppHandle) -> UpdateResult {
    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => return UpdateResult::Failed { error: e.to_string() },
    };

    match updater.check().await {
        Ok(Some(update)) => {
            let version = update.version.clone();
            match update.download(|_, _| {}, || {}).await {
                Ok(bytes) => {
                    app.state::<PendingUpdate>().set(update, bytes);
                    UpdateResult::Ready { version }
                }
                Err(e) => UpdateResult::Failed { error: e.to_string() },
            }
        }
        Ok(None) => UpdateResult::Current,
        Err(e) => UpdateResult::Failed { error: e.to_string() },
    }
}

pub fn install_and_restart(app: &AppHandle) -> Result<(), AppError> {
    let (update, bytes) = app
        .state::<PendingUpdate>()
        .take()
        .ok_or_else(|| AppError::Internal("no update pending".into()))?;

    update.install(bytes).map_err(|e| AppError::Internal(e.to_string()))?;
    app.restart();
}
