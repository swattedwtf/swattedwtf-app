//! The global hotkey: validating a combo, and rebinding it safely.
//!
//! Three things about the platform APIs shape everything below.
//!
//! 1. **Validation must happen by parsing, before any OS call.**
//!    `Shortcut::from_str` answers without touching the system, so a typo costs
//!    nothing. The parser is looser than we want, though: it accepts a bare
//!    unmodified key such as `F5`, and a system-wide grab on `F5` would swallow
//!    that key in every other application on the machine. That is our own rule,
//!    not the parser's, so we add it.
//!
//! 2. **Rebinding is not transactional.** `unregister` removes the plugin's map
//!    entry only after the OS call succeeds, and `register` can fail on its own,
//!    so a naive unregister-then-register can leave the user with nothing bound
//!    and no way to tell. Every path here ends by reporting which combo is
//!    ACTUALLY live, and a failed registration puts the previous one back.
//!
//! 3. **Conflict detection is not available.** `is_registered` consults only
//!    this process's own map; its own documentation says a shortcut held by
//!    another application still reports false. Attempting the registration is
//!    the only real test. On Windows and X11 a collision surfaces as an error,
//!    which we pass through verbatim; on macOS Carbon does not report another
//!    application's hotkey at all, so a success there is not proof and the UI
//!    must not present it as one. `global-hotkey`'s Windows path additionally
//!    maps *any* Win32 error to `AlreadyRegistered`, so the message may name a
//!    cause that is not the real one, which is another reason to quote the
//!    system rather than paraphrase it.

use serde::Serialize;
use std::str::FromStr;
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::settings::SettingsState;

/// The result of asking for a binding. Always describes reality, never the
/// request: `active` is what the operating system has right now.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutOutcome {
    /// True when the requested binding is the live one.
    pub applied: bool,
    /// The combo currently registered, or None when nothing is.
    pub active: Option<String>,
    /// Why the request did not take effect. The system's own words wherever the
    /// failure came from the system.
    pub error: Option<String>,
}

impl ShortcutOutcome {
    fn ok(active: Option<String>) -> Self {
        Self { applied: true, active, error: None }
    }

    fn failed(active: Option<String>, error: impl Into<String>) -> Self {
        Self { applied: false, active, error: Some(error.into()) }
    }
}

/// Checks a combo without calling the operating system at all.
///
/// Returns the parsed shortcut, or copy to show the user. The parse error from
/// `global-hotkey` is not passed through: it is a developer-facing string that
/// ends with a request to file a GitHub issue, which is not useful to someone
/// who has just pressed a key their keyboard has and ours does not.
pub fn validate(input: &str) -> Result<Shortcut, String> {
    let combo = input.trim();
    if combo.is_empty() {
        return Err("Press a key combination first.".into());
    }

    let parsed = Shortcut::from_str(combo).map_err(|_| {
        format!("\"{combo}\" is not a combination this app can bind. Try a letter, a number or a function key with a modifier.")
    })?;

    // Our rule, not the parser's. See the note at the top of the file.
    if parsed.mods.is_empty() {
        return Err(format!(
            "{combo} has no modifier key. A shortcut this app grabs system-wide needs Ctrl, Alt, Shift or Cmd with it, or it would stop that key working everywhere else."
        ));
    }

    Ok(parsed)
}

/// The two operating-system calls, behind a trait.
///
/// Registering a real system-wide hotkey in a unit test would depend on the
/// host having a window server and on what else happens to be running on it, so
/// the rebinding rules are tested against a fake instead. The rules are the part
/// that has the bug in it; the two calls are one line each.
pub trait Binder {
    fn register(&self, shortcut: Shortcut) -> Result<(), String>;
    fn unregister(&self, shortcut: Shortcut) -> Result<(), String>;
}

/// Moves from one binding to another, or to none, without ever silently
/// leaving the user with nothing.
///
/// `previous` is what is currently registered, NOT what is stored: a combo whose
/// registration failed at startup was never bound and must not be unregistered.
pub fn rebind<B: Binder>(binder: &B, previous: Option<&str>, next: Option<&str>) -> ShortcutOutcome {
    // Parse first. A bad combo must cost no OS call, so that a typo cannot take
    // the working shortcut away from the user.
    let wanted = match next {
        Some(combo) => match validate(combo) {
            Ok(parsed) => Some(parsed),
            Err(message) => return ShortcutOutcome::failed(previous.map(str::to_owned), message),
        },
        None => None,
    };

    if previous == next {
        return ShortcutOutcome::ok(previous.map(str::to_owned));
    }

    if let Some(prev) = previous {
        // `previous` was registered, so it parsed once already; a failure here
        // would mean the stored value changed underneath us, and there is then
        // nothing to release.
        if let Ok(parsed) = validate(prev) {
            if let Err(e) = binder.unregister(parsed) {
                // The old binding is still held, so nothing has been lost, but
                // the new one cannot take its place either.
                return ShortcutOutcome::failed(Some(prev.to_owned()), e);
            }
        }
    }

    let Some(wanted) = wanted else {
        // Turning it off. The unregister above was the whole job.
        return ShortcutOutcome::ok(None);
    };

    match binder.register(wanted) {
        Ok(()) => ShortcutOutcome::ok(next.map(str::to_owned)),
        Err(e) => {
            // Not transactional: the previous binding is already gone, from the
            // plugin's map and from the OS both. Put it back, or a rejected
            // request has cost the user the shortcut they had.
            let restored = previous.filter(|prev| {
                validate(prev).map(|parsed| binder.register(parsed).is_ok()).unwrap_or(false)
            });
            ShortcutOutcome::failed(restored.map(str::to_owned), e)
        }
    }
}

/// The real binder, on a running app.
pub struct AppBinder<'a> {
    pub app: &'a AppHandle,
}

impl Binder for AppBinder<'_> {
    fn register(&self, shortcut: Shortcut) -> Result<(), String> {
        let handle = self.app.clone();
        self.app
            .global_shortcut()
            .on_shortcut(shortcut, move |_app, _shortcut, event| {
                // Fire on press only; without this the release fires a second
                // toggle and the overlay flickers shut again.
                if event.state() == ShortcutState::Pressed {
                    crate::quick::toggle(&handle);
                }
            })
            .map_err(|e| e.to_string())
    }

    fn unregister(&self, shortcut: Shortcut) -> Result<(), String> {
        self.app.global_shortcut().unregister(shortcut).map_err(|e| e.to_string())
    }
}

/// Binds whatever the settings file asked for, at startup.
///
/// A failure is deliberately not fatal: the combo can be held by another
/// application, and losing one convenience is no reason to refuse to start. The
/// Settings screen reports whether it bound, which it now genuinely does.
pub fn bind_at_startup(app: &AppHandle, state: &SettingsState) {
    let mut live = state.live.lock().expect("settings lock");
    let wanted = live.settings.shortcut.clone();

    let outcome = rebind(&AppBinder { app }, None, wanted.as_deref());
    if let Some(error) = &outcome.error {
        eprintln!("[quick] could not register {}: {error}", wanted.as_deref().unwrap_or("<none>"));
    }

    live.active = outcome.active;
    live.error = outcome.error;
}

/// Applies a binding requested from the Settings screen and persists it.
///
/// Only a binding that actually took effect is written to disk. Storing a combo
/// we know is dead would mean the next launch quietly starting with no working
/// shortcut and a settings file that claims otherwise.
pub fn set(app: &AppHandle, state: &SettingsState, next: Option<String>) -> ShortcutOutcome {
    let mut live = state.live.lock().expect("settings lock");

    let outcome = rebind(&AppBinder { app }, live.active.as_deref(), next.as_deref());

    live.active = outcome.active.clone();
    live.error = outcome.error.clone();

    if outcome.applied {
        live.settings.shortcut = next;
        // A failed write is not worth undoing a working binding over: the
        // shortcut works for this run, and the screen has the combo on it.
        if let Err(e) = state.store.save(&live.settings) {
            eprintln!("[settings] could not persist: {e}");
        }
    }

    outcome
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[test]
    fn accepts_the_shipped_default() {
        assert!(validate(crate::quick::DEFAULT_SHORTCUT).is_ok());
    }

    #[test]
    fn accepts_a_letter_with_a_modifier() {
        assert!(validate("Control+Alt+KeyK").is_ok());
        assert!(validate("Alt+Shift+F9").is_ok());
        assert!(validate("Super+Space").is_ok());
    }

    #[test]
    fn trims_surrounding_whitespace_rather_than_rejecting_it() {
        assert!(validate("  Control+Alt+KeyK  ").is_ok());
    }

    /// The parser accepts this. We do not: a system-wide grab on a bare key
    /// takes that key away from every other application on the machine.
    #[test]
    fn rejects_a_key_with_no_modifier() {
        let err = validate("F5").expect_err("a bare function key must be rejected");
        assert!(err.contains("modifier"), "the copy should say why: {err}");

        assert!(validate("KeyK").is_err());
        assert!(validate("Space").is_err());
        assert!(validate("Escape").is_err());
    }

    /// Confirms the premise of the rule above: the parser itself is happy with
    /// it, so this is our check and not something we get for free.
    #[test]
    fn the_parser_alone_would_have_allowed_a_bare_key() {
        assert!(Shortcut::from_str("F5").is_ok());
    }

    #[test]
    fn rejects_an_empty_combo() {
        assert!(validate("").is_err());
        assert!(validate("   ").is_err());
    }

    #[test]
    fn rejects_modifiers_with_no_key() {
        assert!(validate("Control+Shift").is_err());
        assert!(validate("Alt").is_err());
    }

    #[test]
    fn rejects_an_unknown_key_name() {
        assert!(validate("Control+Alt+NotAKey").is_err());
        assert!(validate("Control+Alt+KeyK+KeyJ").is_err());
    }

    /// Records what was asked of the operating system, and answers however the
    /// test told it to.
    #[derive(Default)]
    struct FakeBinder {
        calls: RefCell<Vec<String>>,
        /// Combos whose registration fails, as the OS would report it.
        register_fails: Vec<String>,
        /// Combos whose unregistration fails.
        unregister_fails: Vec<String>,
    }

    impl FakeBinder {
        fn calls(&self) -> Vec<String> {
            self.calls.borrow().clone()
        }
    }

    impl Binder for FakeBinder {
        fn register(&self, shortcut: Shortcut) -> Result<(), String> {
            let combo = shortcut.into_string();
            self.calls.borrow_mut().push(format!("register {combo}"));
            if self.register_fails.iter().any(|f| f.eq_ignore_ascii_case(&combo)) {
                return Err("HotKey already registered".into());
            }
            Ok(())
        }

        fn unregister(&self, shortcut: Shortcut) -> Result<(), String> {
            let combo = shortcut.into_string();
            self.calls.borrow_mut().push(format!("unregister {combo}"));
            if self.unregister_fails.iter().any(|f| f.eq_ignore_ascii_case(&combo)) {
                return Err("failed to unregister".into());
            }
            Ok(())
        }
    }

    /// `Shortcut::into_string` normalises to lowercase modifier names in a
    /// fixed order, which is what the fake keys off.
    fn normalised(combo: &str) -> String {
        Shortcut::from_str(combo).expect("parses").into_string()
    }

    #[test]
    fn a_first_binding_registers_and_unregisters_nothing() {
        let binder = FakeBinder::default();
        let out = rebind(&binder, None, Some("Control+Alt+KeyK"));

        assert_eq!(out, ShortcutOutcome::ok(Some("Control+Alt+KeyK".into())));
        assert_eq!(binder.calls(), vec![format!("register {}", normalised("Control+Alt+KeyK"))]);
    }

    #[test]
    fn a_rebind_releases_the_old_one_before_taking_the_new_one() {
        let binder = FakeBinder::default();
        let out = rebind(&binder, Some("Control+Alt+KeyK"), Some("Alt+Shift+KeyJ"));

        assert!(out.applied);
        assert_eq!(out.active.as_deref(), Some("Alt+Shift+KeyJ"));
        assert_eq!(
            binder.calls(),
            vec![
                format!("unregister {}", normalised("Control+Alt+KeyK")),
                format!("register {}", normalised("Alt+Shift+KeyJ")),
            ]
        );
    }

    #[test]
    fn disabling_releases_the_binding_and_registers_nothing() {
        let binder = FakeBinder::default();
        let out = rebind(&binder, Some("Control+Alt+KeyK"), None);

        assert_eq!(out, ShortcutOutcome::ok(None));
        assert_eq!(binder.calls(), vec![format!("unregister {}", normalised("Control+Alt+KeyK"))]);
    }

    /// The point of parsing first: a typo must not cost the user the shortcut
    /// that currently works.
    #[test]
    fn an_invalid_combo_is_rejected_before_any_os_call() {
        let binder = FakeBinder::default();
        let out = rebind(&binder, Some("Control+Alt+KeyK"), Some("F5"));

        assert!(!out.applied);
        assert_eq!(out.active.as_deref(), Some("Control+Alt+KeyK"), "the old binding is untouched");
        assert!(out.error.expect("a reason").contains("modifier"));
        assert!(binder.calls().is_empty(), "nothing may reach the OS: {:?}", binder.calls());
    }

    #[test]
    fn an_unparseable_combo_is_rejected_before_any_os_call() {
        let binder = FakeBinder::default();
        let out = rebind(&binder, Some("Control+Alt+KeyK"), Some("Ctrl+Nonsense"));

        assert!(!out.applied);
        assert_eq!(out.active.as_deref(), Some("Control+Alt+KeyK"));
        assert!(binder.calls().is_empty(), "nothing may reach the OS: {:?}", binder.calls());
    }

    /// The one that matters. unregister-then-register is two operations and the
    /// second can fail on its own, so a rejected new combo must not leave the
    /// user with nothing bound.
    #[test]
    fn a_failed_registration_restores_the_previous_binding() {
        let binder = FakeBinder {
            register_fails: vec![normalised("Alt+Shift+KeyJ")],
            ..Default::default()
        };
        let out = rebind(&binder, Some("Control+Alt+KeyK"), Some("Alt+Shift+KeyJ"));

        assert!(!out.applied);
        assert_eq!(
            out.active.as_deref(),
            Some("Control+Alt+KeyK"),
            "the previous binding must be live again"
        );
        assert_eq!(out.error.as_deref(), Some("HotKey already registered"));
        assert_eq!(
            binder.calls(),
            vec![
                format!("unregister {}", normalised("Control+Alt+KeyK")),
                format!("register {}", normalised("Alt+Shift+KeyJ")),
                format!("register {}", normalised("Control+Alt+KeyK")),
            ]
        );
    }

    /// Both halves failed. Nothing is bound, and the screen has to say so rather
    /// than showing a combo that does nothing.
    #[test]
    fn a_failed_registration_that_cannot_be_undone_reports_nothing_bound() {
        let binder = FakeBinder {
            register_fails: vec![normalised("Alt+Shift+KeyJ"), normalised("Control+Alt+KeyK")],
            ..Default::default()
        };
        let out = rebind(&binder, Some("Control+Alt+KeyK"), Some("Alt+Shift+KeyJ"));

        assert!(!out.applied);
        assert_eq!(out.active, None);
        assert!(out.error.is_some());
    }

    /// If the old binding cannot be released, the OS still holds it, so it is
    /// still the live one and the new combo was never attempted.
    #[test]
    fn a_failed_unregister_keeps_the_old_binding_and_does_not_try_the_new_one() {
        let binder = FakeBinder {
            unregister_fails: vec![normalised("Control+Alt+KeyK")],
            ..Default::default()
        };
        let out = rebind(&binder, Some("Control+Alt+KeyK"), Some("Alt+Shift+KeyJ"));

        assert!(!out.applied);
        assert_eq!(out.active.as_deref(), Some("Control+Alt+KeyK"));
        assert_eq!(binder.calls(), vec![format!("unregister {}", normalised("Control+Alt+KeyK"))]);
    }

    /// Re-selecting the combo that is already live is a no-op, not a release
    /// and a re-grab, which would briefly hand the combo back to whatever else
    /// wanted it.
    #[test]
    fn asking_for_the_binding_that_is_already_live_touches_nothing() {
        let binder = FakeBinder::default();
        let out = rebind(&binder, Some("Control+Alt+KeyK"), Some("Control+Alt+KeyK"));

        assert_eq!(out, ShortcutOutcome::ok(Some("Control+Alt+KeyK".into())));
        assert!(binder.calls().is_empty());
    }

    #[test]
    fn disabling_when_nothing_is_bound_is_a_no_op() {
        let binder = FakeBinder::default();
        assert_eq!(rebind(&binder, None, None), ShortcutOutcome::ok(None));
        assert!(binder.calls().is_empty());
    }

    /// Startup with a combo that another application already holds: nothing is
    /// bound, and `previous` is None, so the next rebind must not try to
    /// release a shortcut that was never taken.
    #[test]
    fn a_failed_first_binding_leaves_nothing_active() {
        let binder =
            FakeBinder { register_fails: vec![normalised("Control+Alt+KeyK")], ..Default::default() };
        let out = rebind(&binder, None, Some("Control+Alt+KeyK"));

        assert!(!out.applied);
        assert_eq!(out.active, None);
        assert_eq!(binder.calls(), vec![format!("register {}", normalised("Control+Alt+KeyK"))]);
    }
}
