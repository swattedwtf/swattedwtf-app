//! Persisted user preferences.
//!
//! One small JSON file, `settings.json`, in the app's local data dir. Not the
//! keychain: a hotkey is not a secret, and putting it there would mean a
//! Secret Service prompt on Linux every time the Settings screen opened. It is
//! still written with the same create-with-0600 treatment `session.rs` gives
//! its fallback file, because a preferences file in a shared home directory has
//! no business being world-readable either.
//!
//! Nothing in here may refuse to start the app. A file that is missing,
//! truncated, hand-edited into invalid JSON, or written by a newer build than
//! this one all resolve to the defaults, because the alternative is an app that
//! will not launch until the user finds and deletes a file they have never
//! heard of.
//!
//! **Launch at login is deliberately NOT stored here.** The operating system
//! already owns that bit (an `HKEY_CURRENT_USER\...\Run` value, a LaunchAgent
//! plist, a `.desktop` entry), the user can change it from outside the app, and
//! a second copy in this file would only ever be the one that was wrong.

use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Name of the file inside the app's local data dir.
pub const FILE_NAME: &str = "settings.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
// Container-level default, so a file written by an older build that lacks a key
// gets this build's default for it rather than failing to parse as a whole.
#[serde(default)]
pub struct Settings {
    /// The global hotkey combo, in `Shortcut::from_str` syntax.
    ///
    /// `null` means the user turned the hotkey off, which is a different thing
    /// from the key being absent: absent is a file that predates the setting and
    /// must get the default, `null` is a deliberate choice that must survive a
    /// restart. Serde gives us exactly that split for free.
    pub shortcut: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self { shortcut: Some(crate::quick::DEFAULT_SHORTCUT.to_string()) }
    }
}

/// Parses the file's contents, falling back to the defaults for anything that
/// is not valid settings. See the module note: this cannot fail.
pub fn decode(blob: &str) -> Settings {
    serde_json::from_str(blob).unwrap_or_default()
}

pub fn encode(settings: &Settings) -> Result<String, AppError> {
    serde_json::to_string_pretty(settings)
        .map_err(|e| AppError::Internal(format!("settings encode failed: {e}")))
}

pub struct SettingsStore {
    path: PathBuf,
}

impl SettingsStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Reads the stored settings. A missing or unreadable file, and a file whose
    /// contents do not parse, both yield the defaults.
    pub fn load(&self) -> Settings {
        match std::fs::read_to_string(&self.path) {
            Ok(blob) => decode(&blob),
            Err(_) => Settings::default(),
        }
    }

    pub fn save(&self, settings: &Settings) -> Result<(), AppError> {
        write_private(&self.path, &encode(settings)?)
    }
}

/// Writes a file created 0600 from the outset.
///
/// The same shape as `SessionStore::write_fallback`, and for the same reason:
/// `std::fs::write` would create the file 0644 (umask permitting) and only then
/// chmod, leaving a window in which another local user can open it and keep the
/// descriptor. Duplicated rather than shared because the two stores have no
/// other relationship, and coupling a preferences file to the credential store
/// would be the more surprising arrangement of the two.
fn write_private(path: &Path, blob: &str) -> Result<(), AppError> {
    use std::io::Write;

    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| AppError::Internal(e.to_string()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
        }
    }

    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }

    let mut file = opts.open(path).map_err(|e| AppError::Internal(e.to_string()))?;
    file.write_all(blob.as_bytes()).map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(())
}

/// What the settings actually resolved to at runtime.
///
/// `settings.shortcut` is what the user asked for; `active` is what the
/// operating system currently has bound. They differ whenever registration
/// failed, and the Settings screen shows both rather than claiming the stored
/// value is live.
pub struct Live {
    pub settings: Settings,
    /// The combo registered with the OS right now, or None when nothing is.
    pub active: Option<String>,
    /// Why `settings.shortcut` is not the live binding, when it is not. The
    /// operating system's own message, verbatim.
    pub error: Option<String>,
}

pub struct SettingsState {
    pub store: SettingsStore,
    pub live: Mutex<Live>,
}

impl SettingsState {
    /// Loads from disk. Nothing is bound yet: `shortcut::bind_at_startup` does
    /// that, and it is what fills in `active` and `error`.
    pub fn load(store: SettingsStore) -> Self {
        let settings = store.load();
        Self { store, live: Mutex::new(Live { settings, active: None, error: None }) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("swatted-settings-test-{}-{name}", std::process::id()));
        p.push(FILE_NAME);
        p
    }

    fn cleanup(path: &Path) {
        let _ = std::fs::remove_file(path);
        if let Some(dir) = path.parent() {
            let _ = std::fs::remove_dir(dir);
        }
    }

    #[test]
    fn round_trips_a_chosen_shortcut() {
        let path = temp_path("roundtrip");
        cleanup(&path);
        let store = SettingsStore::new(path.clone());

        let saved = Settings { shortcut: Some("Alt+Shift+KeyK".into()) };
        store.save(&saved).expect("save");

        assert_eq!(store.load(), saved);
        cleanup(&path);
    }

    /// A disabled hotkey has to survive a restart, so `null` must read back as
    /// None rather than as "no preference recorded, use the default".
    #[test]
    fn round_trips_a_disabled_shortcut_as_disabled_not_as_the_default() {
        let path = temp_path("disabled");
        cleanup(&path);
        let store = SettingsStore::new(path.clone());

        store.save(&Settings { shortcut: None }).expect("save");

        assert_eq!(store.load().shortcut, None);
        cleanup(&path);
    }

    #[test]
    fn a_missing_file_reads_as_the_defaults() {
        let path = temp_path("missing");
        cleanup(&path);
        let store = SettingsStore::new(path.clone());

        assert_eq!(store.load(), Settings::default());
        assert_eq!(store.load().shortcut.as_deref(), Some(crate::quick::DEFAULT_SHORTCUT));
    }

    /// The property that matters: a damaged file must not be able to stop the
    /// app starting. There is nothing the user could do about it at boot, and
    /// the worst case here is one preference reverting to its default.
    #[test]
    fn a_corrupt_file_falls_back_to_the_defaults_instead_of_refusing_to_start() {
        let path = temp_path("corrupt");
        cleanup(&path);
        std::fs::create_dir_all(path.parent().unwrap()).expect("mkdir");
        std::fs::write(&path, "{ this is not json").expect("write");

        let store = SettingsStore::new(path.clone());
        assert_eq!(store.load(), Settings::default());
        cleanup(&path);
    }

    #[test]
    fn a_truncated_or_empty_file_falls_back_to_the_defaults() {
        assert_eq!(decode(""), Settings::default());
        assert_eq!(decode("{"), Settings::default());
        assert_eq!(decode("null"), Settings::default());
    }

    /// A file written by a NEWER build carries keys this one has never heard
    /// of. Rejecting it would mean downgrading the app bricked its own
    /// settings, so unknown keys are ignored and the keys we do know survive.
    #[test]
    fn a_file_from_a_newer_build_keeps_the_keys_this_build_understands() {
        let decoded = decode(r#"{"shortcut":"Control+Alt+KeyJ","somethingNewer":{"a":1}}"#);
        assert_eq!(decoded.shortcut.as_deref(), Some("Control+Alt+KeyJ"));
    }

    /// A shortcut of the wrong TYPE is corruption of one key, not of the file.
    /// Serde fails the whole struct, which is the safe direction: defaults.
    #[test]
    fn a_shortcut_of_the_wrong_type_falls_back_rather_than_panicking() {
        assert_eq!(decode(r#"{"shortcut":42}"#), Settings::default());
    }

    #[cfg(unix)]
    #[test]
    fn the_file_is_created_owner_only() {
        use std::os::unix::fs::PermissionsExt;

        let path = temp_path("perms");
        cleanup(&path);
        let store = SettingsStore::new(path.clone());
        store.save(&Settings::default()).expect("save");

        let mode = std::fs::metadata(&path).expect("stat").permissions().mode();
        assert_eq!(mode & 0o777, 0o600, "settings.json must not be readable by other users");
        cleanup(&path);
    }
}
