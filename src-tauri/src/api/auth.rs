//! Auth against /api/auth/*.
//!
//! swatted.wtf identifies users by a 12-digit login code, not email/password.
//! Both login and register require a Turnstile token; 2FA accounts additionally
//! require a 6-digit OTP, which the server signals with `twofa_required: true`
//! on a 401.

use crate::api::client::ApiClient;
use crate::error::AppError;
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
struct LoginBody<'a> {
    code: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    otp: Option<&'a str>,
    #[serde(rename = "turnstileToken")]
    turnstile_token: &'a str,
}

#[derive(Serialize)]
struct RegisterBody<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    email: Option<&'a str>,
    #[serde(rename = "turnstileToken")]
    turnstile_token: &'a str,
}

/// Shape of both success and error bodies from the auth routes. Every field is
/// optional so one struct can read either.
#[derive(Deserialize, Default)]
struct AuthResponse {
    #[serde(default)]
    code: Option<String>,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    twofa_required: bool,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum LoginOutcome {
    Ok,
    TwofaRequired { message: String },
    Error { message: String },
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum RegisterOutcome {
    Ok { code: String },
    Error { message: String },
}

const GENERIC_ERROR: &str = "Something went wrong. Please try again.";
const OFFLINE: &str = "Can't reach swatted.wtf. Check your connection.";

/// Classifies a login response. Split out from the request so it can be tested
/// against the exact bodies app/api/auth/login/route.ts returns.
fn classify_login(status: u16, body: &str) -> LoginOutcome {
    let parsed: AuthResponse = serde_json::from_str(body).unwrap_or_default();

    if (200..300).contains(&status) {
        return LoginOutcome::Ok;
    }

    let message = parsed.error.clone().unwrap_or_else(|| GENERIC_ERROR.to_string());

    if parsed.twofa_required {
        LoginOutcome::TwofaRequired { message }
    } else {
        LoginOutcome::Error { message }
    }
}

fn classify_register(status: u16, body: &str) -> RegisterOutcome {
    let parsed: AuthResponse = serde_json::from_str(body).unwrap_or_default();

    if (200..300).contains(&status) {
        return match parsed.code {
            Some(code) if !code.is_empty() => RegisterOutcome::Ok { code },
            // A 200 with no code would leave the user with an account they can
            // never sign into again, so surface it loudly rather than continuing.
            _ => RegisterOutcome::Error {
                message: "The server did not return a login code. Contact support before signing out.".into(),
            },
        };
    }

    RegisterOutcome::Error {
        message: parsed.error.unwrap_or_else(|| GENERIC_ERROR.to_string()),
    }
}

pub async fn login(
    client: &ApiClient,
    code: &str,
    otp: Option<&str>,
    turnstile_token: &str,
) -> LoginOutcome {
    let body = LoginBody { code, otp, turnstile_token };

    match client.post_raw("/api/auth/login", &body).await {
        Ok((status, text)) => {
            let outcome = classify_login(status, &text);
            if outcome == LoginOutcome::Ok {
                if let Err(e) = client.persist() {
                    return LoginOutcome::Error { message: e.to_string() };
                }
            }
            outcome
        }
        Err(AppError::Network(_)) => LoginOutcome::Error { message: OFFLINE.into() },
        Err(e) => LoginOutcome::Error { message: e.to_string() },
    }
}

pub async fn register(
    client: &ApiClient,
    email: Option<&str>,
    turnstile_token: &str,
) -> RegisterOutcome {
    let body = RegisterBody { email, turnstile_token };

    match client.post_raw("/api/auth/register", &body).await {
        Ok((status, text)) => {
            let outcome = classify_register(status, &text);
            if matches!(outcome, RegisterOutcome::Ok { .. }) {
                if let Err(e) = client.persist() {
                    return RegisterOutcome::Error { message: e.to_string() };
                }
            }
            outcome
        }
        Err(AppError::Network(_)) => RegisterOutcome::Error { message: OFFLINE.into() },
        Err(e) => RegisterOutcome::Error { message: e.to_string() },
    }
}

/// Best effort server-side logout, then always drop the local session. Clearing
/// locally must happen even if the network call fails, otherwise "log out" would
/// leave the user signed in after a restart.
pub async fn logout(client: &ApiClient) -> Result<(), AppError> {
    let _ = client.post_raw("/api/auth/logout", &()).await;
    client.forget()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Bodies below are copied from app/api/auth/{login,register}/route.ts.

    #[test]
    fn a_200_is_a_successful_login() {
        assert_eq!(classify_login(200, r#"{"ok":true}"#), LoginOutcome::Ok);
    }

    #[test]
    fn a_401_with_the_twofa_flag_asks_for_the_otp() {
        let body = r#"{"error":"Enter your authenticator code.","twofa_required":true}"#;
        assert_eq!(
            classify_login(401, body),
            LoginOutcome::TwofaRequired { message: "Enter your authenticator code.".into() }
        );
    }

    #[test]
    fn a_wrong_otp_still_asks_for_the_otp_rather_than_restarting_login() {
        let body = r#"{"error":"That authenticator code is incorrect.","twofa_required":true}"#;
        assert!(matches!(classify_login(401, body), LoginOutcome::TwofaRequired { .. }));
    }

    #[test]
    fn a_bad_code_is_a_plain_error_shown_verbatim() {
        assert_eq!(
            classify_login(401, r#"{"error":"Invalid login code"}"#),
            LoginOutcome::Error { message: "Invalid login code".into() }
        );
    }

    #[test]
    fn the_rate_limit_message_reaches_the_user_unchanged() {
        let body = r#"{"error":"Too many login attempts. Try again later."}"#;
        assert_eq!(
            classify_login(429, body),
            LoginOutcome::Error { message: "Too many login attempts. Try again later.".into() }
        );
    }

    #[test]
    fn a_captcha_failure_is_reported_as_sent() {
        let body = r#"{"error":"CAPTCHA verification failed. Please try again."}"#;
        assert!(matches!(classify_login(400, body), LoginOutcome::Error { .. }));
    }

    /// 2FA detection must not depend on the wording of the error text, which is
    /// user-facing copy and can be reworded at any time.
    #[test]
    fn twofa_detection_survives_the_message_being_reworded() {
        let body = r#"{"error":"Something completely different","twofa_required":true}"#;
        assert!(matches!(classify_login(401, body), LoginOutcome::TwofaRequired { .. }));
    }

    #[test]
    fn a_non_json_error_body_falls_back_to_generic_copy() {
        assert_eq!(
            classify_login(502, "<html>bad gateway</html>"),
            LoginOutcome::Error { message: GENERIC_ERROR.into() }
        );
    }

    #[test]
    fn registration_returns_the_one_time_code() {
        assert_eq!(
            classify_register(200, r#"{"ok":true,"code":"123456789012"}"#),
            RegisterOutcome::Ok { code: "123456789012".into() }
        );
    }

    #[test]
    fn registration_without_a_code_is_an_error_not_a_silent_success() {
        assert!(matches!(classify_register(200, r#"{"ok":true}"#), RegisterOutcome::Error { .. }));
    }

    #[test]
    fn a_duplicate_email_error_is_shown_verbatim() {
        let body = r#"{"error":"That email is already registered."}"#;
        assert_eq!(
            classify_register(409, body),
            RegisterOutcome::Error { message: "That email is already registered.".into() }
        );
    }
}
