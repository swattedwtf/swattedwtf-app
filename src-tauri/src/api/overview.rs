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
    /// Wallet balance in cents. Defaulted rather than required so a server that
    /// predates the field parses instead of failing the whole overview, which
    /// is the payload the app boots on.
    #[serde(rename = "balanceCents", default)]
    pub balance_cents: i64,
    #[serde(default)]
    pub status: Option<String>,
    /// Lookups per day. `None` means no limit is set, which is not zero.
    #[serde(rename = "dailyLimit", default)]
    pub daily_limit: Option<i64>,
}

/// One purchasable tier, priced by the server for THIS account.
///
/// The prices are the server's, never the client's: `price_usd` is the list
/// price and `your_price_usd` is what this account is actually charged once the
/// Premium -> Heist upgrade credit and any account discount are applied. A
/// client that carried its own price table would eventually quote one number
/// and be billed another.
#[derive(Debug, Default, Deserialize, Serialize)]
pub struct PlanTier {
    pub id: String,
    pub name: String,
    #[serde(rename = "shortName")]
    pub short_name: String,
    pub term: String,
    pub lifetime: bool,
    pub badge: Option<String>,
    pub highlight: bool,
    pub includes: Option<String>,
    pub features: Vec<String>,
    #[serde(rename = "priceUsd")]
    pub price_usd: f64,
    #[serde(rename = "yourPriceUsd")]
    pub your_price_usd: f64,
    /// "current" | "upgrade" | "downgrade" | "default", decided server-side.
    pub relation: String,
}

#[derive(Debug, Default, Deserialize, Serialize)]
pub struct Plans {
    #[serde(rename = "currentId", default)]
    pub current_id: String,
    #[serde(rename = "discountPercent", default)]
    pub discount_percent: f64,
    #[serde(default)]
    pub tiers: Vec<PlanTier>,
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

/// Serde default for `legal_accepted`: absent means the server has not shipped
/// the field, which must NOT read as "not accepted" and strand the user behind
/// an undismissable modal.
fn default_true() -> bool {
    true
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Overview {
    pub user: User,
    pub telegram: Telegram,
    pub security: Security,
    pub plan: Plan,
    pub usage: Usage,
    pub api: Api,
    /// True when the user has accepted the current legal-document version. The
    /// client shows a consent modal on entry when this is false. Defaulted to
    /// TRUE so a server that has not shipped the field yet never blocks the user
    /// behind a modal they cannot dismiss (fail open, exactly as the web only
    /// gates once the version is known).
    #[serde(rename = "legalAccepted", default = "default_true")]
    pub legal_accepted: bool,
    /// Public Mapbox token for the Address Insights interactive map. Absent on a
    /// server that has not shipped it; the screen then shows the static still.
    #[serde(rename = "mapboxToken", default)]
    pub mapbox_token: Option<String>,
    /// The tier catalog, priced for this account. Defaulted so a server that
    /// has not shipped it yet still boots the app: the Plans screen then says
    /// the catalog is unavailable rather than the whole overview failing.
    #[serde(default)]
    pub plans: Plans,
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
               "expiresAt": "2026-12-01T00:00:00.000Z", "key": "sk_live_abc" },
      "plans": { "currentId": "plus", "discountPercent": 0, "tiers": [
        { "id": "plus", "name": "Swatted Heist", "shortName": "Heist", "term": "lifetime",
          "lifetime": true, "badge": "Best Value", "highlight": false,
          "includes": "Everything in Premium, plus:", "features": ["5,000 monthly lookups"],
          "priceUsd": 55, "yourPriceUsd": 46.75, "relation": "current" }
      ] }
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

    /// The prices the Plans screen renders come from the server, so they have to
    /// survive the round trip exactly, cents and all.
    #[test]
    fn carries_the_priced_plan_catalog() {
        let o: Overview = serde_json::from_str(SAMPLE).expect("parse");
        assert_eq!(o.plans.current_id, "plus");
        assert_eq!(o.plans.tiers.len(), 1);
        let tier = &o.plans.tiers[0];
        assert_eq!(tier.short_name, "Heist");
        assert_eq!(tier.price_usd, 55.0);
        assert_eq!(tier.your_price_usd, 46.75);
        assert_eq!(tier.relation, "current");
        assert!(tier.lifetime);
    }

    /// A server that has not shipped the catalog (or the wallet columns) must
    /// not fail the whole overview: this payload is what the app boots on, so a
    /// missing section has to degrade to an empty one.
    #[test]
    fn tolerates_a_server_without_the_plan_catalog() {
        let json = r#"{
          "user": { "id": "u1", "userNumber": 1, "email": null, "handle": "u" },
          "telegram": { "username": null, "linked": false },
          "security": { "twofaEnabled": false },
          "plan": { "id": "free", "label": "Free", "monthlyLimit": 0, "since": "2026-01-01T00:00:00.000Z" },
          "usage": { "todayCount": 0, "monthCount": 0, "allTimeCount": 0, "nextResetMs": 0, "series": [] },
          "api": { "active": false, "tierLabel": null, "usedToday": 0, "dailyLimit": null,
                   "expiresAt": null, "key": null }
        }"#;
        let o: Overview = serde_json::from_str(json).expect("parse");
        assert!(o.plans.tiers.is_empty());
        assert_eq!(o.plan.balance_cents, 0);
        assert!(o.plan.daily_limit.is_none());
    }

    /// The wallet columns the Settings screen renders were dropped by this
    /// struct before they were declared here, so it always showed $0.00.
    #[test]
    fn carries_the_wallet_columns_settings_renders() {
        let json = SAMPLE.replace(
            "\"since\": \"2026-01-15T00:00:00.000Z\"",
            "\"since\": \"2026-01-15T00:00:00.000Z\", \"balanceCents\": 1234, \"status\": \"Active\", \"dailyLimit\": 50",
        );
        let o: Overview = serde_json::from_str(&json).expect("parse");
        assert_eq!(o.plan.balance_cents, 1234);
        assert_eq!(o.plan.status.as_deref(), Some("Active"));
        assert_eq!(o.plan.daily_limit, Some(50));
    }
}
