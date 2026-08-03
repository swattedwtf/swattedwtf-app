//! Build-time constants. The API base is overridable so a developer can point
//! the client at a local Next.js instance without editing source.

/// Base URL for every API call. Override at build time with SWATTED_API_BASE.
pub fn api_base() -> &'static str {
    option_env!("SWATTED_API_BASE").unwrap_or("https://swattedw.tf")
}

/// Keychain service name under which the session blob is stored.
pub const KEYCHAIN_SERVICE: &str = "tf.swattedw.desktop";

/// Keychain entry name for the persisted cookie jar.
pub const KEYCHAIN_SESSION_KEY: &str = "session";
