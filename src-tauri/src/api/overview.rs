//! Dashboard overview payload, mirroring lib/desktop/overview.ts in the
//! Parallax repo. Field names are camelCase on the wire; keep the rename
//! attributes in sync if that endpoint changes.

use crate::api::client::ApiClient;
use crate::error::AppError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
pub struct User {
    pub id: String,
    #[serde(rename = "userNumber")]
    pub user_number: i64,
    pub email: Option<String>,
    pub handle: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Telegram {
    pub username: Option<String>,
    pub linked: bool,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Security {
    #[serde(rename = "twofaEnabled")]
    pub twofa_enabled: bool,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Plan {
    pub id: String,
    pub label: String,
    #[serde(rename = "monthlyLimit")]
    pub monthly_limit: i64,
    pub since: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct SeriesPoint {
    pub date: String,
    pub count: i64,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Usage {
    #[serde(rename = "todayCount")]
    pub today_count: i64,
    #[serde(rename = "monthCount")]
    pub month_count: i64,
    #[serde(rename = "allTimeCount")]
    pub all_time_count: i64,
    #[serde(rename = "nextResetMs")]
    pub next_reset_ms: i64,
    pub series: Vec<SeriesPoint>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Api {
    pub active: bool,
    #[serde(rename = "tierLabel")]
    pub tier_label: Option<String>,
    #[serde(rename = "usedToday")]
    pub used_today: i64,
    #[serde(rename = "dailyLimit")]
    pub daily_limit: Option<i64>,
    #[serde(rename = "expiresAt")]
    pub expires_at: Option<String>,
    pub key: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Overview {
    pub user: User,
    pub telegram: Telegram,
    pub security: Security,
    pub plan: Plan,
    pub usage: Usage,
    pub api: Api,
}

pub async fn fetch(client: &ApiClient) -> Result<Overview, AppError> {
    client.get_json::<Overview>("/api/desktop/overview").await
}

#[cfg(test)]
mod tests {
    use super::Overview;

    /// Captured from the real GET /api/desktop/overview response shape built by
    /// buildDesktopOverview() in the Parallax repo.
    const SAMPLE: &str = r#"{
      "user": { "id": "u1", "userNumber": 1234, "email": "a@b.c", "handle": "a" },
      "telegram": { "username": "cried", "linked": true },
      "security": { "twofaEnabled": true },
      "plan": { "id": "plus", "label": "Plus", "monthlyLimit": 500, "since": "2026-01-15T00:00:00.000Z" },
      "usage": { "todayCount": 3, "monthCount": 128, "allTimeCount": 4021,
                 "nextResetMs": 1788220800000,
                 "series": [{ "date": "2026-08-01", "count": 5 }] },
      "api": { "active": true, "tierLabel": "Pro", "usedToday": 7, "dailyLimit": 500,
               "expiresAt": "2026-12-01T00:00:00.000Z", "key": "sk_live_abc" }
    }"#;

    #[test]
    fn deserializes_the_server_payload() {
        let o: Overview = serde_json::from_str(SAMPLE).expect("parse");
        assert_eq!(o.user.user_number, 1234);
        assert_eq!(o.telegram.username.as_deref(), Some("cried"));
        assert_eq!(o.plan.label, "Plus");
        assert_eq!(o.usage.series.len(), 1);
        assert_eq!(o.usage.next_reset_ms, 1788220800000);
        assert_eq!(o.api.key.as_deref(), Some("sk_live_abc"));
    }

    #[test]
    fn tolerates_null_optional_fields() {
        let json = SAMPLE
            .replace("\"cried\"", "null")
            .replace("\"sk_live_abc\"", "null")
            .replace("\"Pro\"", "null")
            .replace("\"a@b.c\"", "null");
        let o: Overview = serde_json::from_str(&json).expect("parse");
        assert!(o.telegram.username.is_none());
        assert!(o.api.key.is_none());
        assert!(o.user.email.is_none());
    }

    /// A free account with no API add-on: nulls where a paid account has values.
    #[test]
    fn parses_an_account_with_no_api_access() {
        let json = SAMPLE
            .replace("\"active\": true", "\"active\": false")
            .replace("\"tierLabel\": \"Pro\"", "\"tierLabel\": null")
            .replace("\"dailyLimit\": 500", "\"dailyLimit\": null")
            .replace("\"expiresAt\": \"2026-12-01T00:00:00.000Z\"", "\"expiresAt\": null");
        let o: Overview = serde_json::from_str(&json).expect("parse");
        assert!(!o.api.active);
        assert!(o.api.tier_label.is_none());
        assert!(o.api.daily_limit.is_none());
    }
}
