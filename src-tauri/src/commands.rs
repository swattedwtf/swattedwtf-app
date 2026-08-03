//! Thin #[tauri::command] wrappers.
//!
//! All logic lives in the modules these call, so this file stays a readable
//! inventory of everything the webview is allowed to do. Note what is absent:
//! nothing here returns the session cookie, so the frontend has no path to it.

use crate::api::{auth, client::ApiClient, overview};
use crate::captcha;
use crate::error::AppError;
use serde::Serialize;
use tauri::{AppHandle, State};

pub struct AppState {
    pub client: ApiClient,
}

#[derive(Serialize)]
pub struct SessionStatus {
    pub authenticated: bool,
}

#[tauri::command]
pub fn session_status(state: State<'_, AppState>) -> SessionStatus {
    SessionStatus { authenticated: state.client.has_session() }
}

#[tauri::command]
pub async fn login(
    app: AppHandle,
    state: State<'_, AppState>,
    code: String,
    otp: Option<String>,
) -> Result<auth::LoginOutcome, AppError> {
    let token = captcha::solve(&app).await?;
    Ok(auth::login(&state.client, &code, otp.as_deref(), &token).await)
}

#[tauri::command]
pub async fn register(
    app: AppHandle,
    state: State<'_, AppState>,
    email: Option<String>,
) -> Result<auth::RegisterOutcome, AppError> {
    let token = captcha::solve(&app).await?;
    Ok(auth::register(&state.client, email.as_deref(), &token).await)
}

#[tauri::command]
pub async fn logout(state: State<'_, AppState>) -> Result<(), AppError> {
    auth::logout(&state.client).await
}

#[tauri::command]
pub async fn get_overview(state: State<'_, AppState>) -> Result<overview::Overview, AppError> {
    overview::fetch(&state.client).await
}
