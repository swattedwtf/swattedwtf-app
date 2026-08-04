/**
 * The single place the frontend talks to Rust. Every command is wrapped in a
 * typed function so no component ever calls invoke() with a raw string.
 */
import { invoke } from "@tauri-apps/api/core"
import type { IntegrityReport, UpdateResult } from "../boot/machine"

export type Overview = {
  user: { id: string; userNumber: number; email: string | null; handle: string }
  telegram: { username: string | null; linked: boolean }
  security: { twofaEnabled: boolean }
  plan: {
    id: string
    label: string
    monthlyLimit: number
    since: string
    /** Wallet balance in cents. Zero, never undefined, when the row has none. */
    balanceCents: number
    /** Shown verbatim. Empty means the server did not report one, which is not
     *  the same as inactive, so do not render it as a status of its own. */
    status: string
    /** Lookups per day. Null means no limit is set, which is not zero. */
    dailyLimit: number | null
  }
  usage: {
    todayCount: number
    monthCount: number
    allTimeCount: number
    nextResetMs: number
    series: { date: string; count: number }[]
  }
  api: {
    active: boolean
    tierLabel: string | null
    usedToday: number
    dailyLimit: number | null
    expiresAt: string | null
    key: string | null
  }
}

/**
 * What one module lookup answers with.
 *
 * `data` is deliberately untyped here. The server normalises each module into
 * its own documented shape and that shape is additive only, so a module's own
 * renderer is the right place to describe it: typing it centrally would mean
 * touching this file every time any of sixteen modules gained a field.
 *
 * `schema` is bumped only by a genuinely breaking change, so a client older
 * than the server can say "update the app" instead of drawing a half-empty
 * screen. `partial` names the sections whose provider failed or timed out;
 * it is never fatal, and an empty list is the normal case.
 */
export type LookupResult = {
  schema: number
  data: Record<string, unknown>
  partial: string[]
}

/**
 * The desktop-only preferences, plus what the operating system actually did
 * with them.
 *
 * `shortcut` and `shortcutActive` are separate on purpose. The first is what the
 * user chose and what is stored; the second is what is bound right now. They
 * differ whenever registration failed, and a screen that showed only the first
 * would be telling the user a hotkey works when it does not.
 */
export type SettingsView = {
  shortcut: string | null
  shortcutActive: string | null
  shortcutError: string | null
  /** Read from the OS, not from our settings file, which does not store it. */
  launchAtLogin: boolean
  /** Set when we could not tell, which is not the same as "off". */
  launchAtLoginError: string | null
  appDataDir: string
}

/**
 * What came of a rebind request. Describes reality rather than the request:
 * `active` is the combo that is live afterwards, which on a failure is the one
 * the user had before.
 */
export type ShortcutOutcome = {
  applied: boolean
  active: string | null
  /** The operating system's own message, shown verbatim. */
  error: string | null
}

export type LoginOutcome =
  | { status: "ok" }
  | { status: "twofa_required"; message: string }
  | { status: "error"; message: string }

export type RegisterOutcome = { status: "ok"; code: string } | { status: "error"; message: string }

export type WindowDiagnostics = {
  decorated: boolean | null
  maximized: boolean | null
  scale_factor: number | null
  background_error: string | null
  layered: boolean | null
  region_applied: boolean
  ex_style: string | null
  platform: string
}

export const ipc = {
  verifyIntegrity: () => invoke<IntegrityReport>("verify_integrity"),
  checkUpdate: () => invoke<UpdateResult>("check_update"),
  installUpdateAndRestart: () => invoke<void>("install_update_and_restart"),
  sessionStatus: () => invoke<{ authenticated: boolean }>("session_status"),
  login: (code: string, otp?: string) => invoke<LoginOutcome>("login", { code, otp }),
  register: (email?: string) => invoke<RegisterOutcome>("register", { email }),
  saveRecoveryFile: (code: string) => invoke<string | null>("save_recovery_file", { code }),
  logout: () => invoke<void>("logout"),
  getOverview: () => invoke<Overview>("get_overview"),
  windowDiagnostics: () => invoke<WindowDiagnostics>("window_diagnostics"),
  hideQuick: () => invoke<void>("hide_quick"),
  openExternal: (url: string) => invoke<void>("open_external", { url }),

  getSettings: () => invoke<SettingsView>("get_settings"),

  /**
   * Changes the global hotkey. `null` turns it off.
   *
   * Resolves even when the combo was refused: the outcome says which binding is
   * live, so a rejected request never leaves the screen guessing.
   */
  setShortcut: (shortcut: string | null) => invoke<ShortcutOutcome>("set_shortcut", { shortcut }),

  /** Returns what the OS reports afterwards, not what was asked for. */
  setLaunchAtLogin: (enabled: boolean) => invoke<boolean>("set_launch_at_login", { enabled }),

  /**
   * Runs one lookup module. `module` is a key into a static table on the
   * server, never a path or a host, and the server runs the module's whole
   * provider fan-out, so this is one call however many upstreams it takes.
   */
  lookup: (module: string, input: Record<string, unknown>) =>
    invoke<LookupResult>("lookup", { module, input }),

  /**
   * Resolves an image URL from a lookup payload into a `data:` URL.
   *
   * Needed because the webview's CSP is `img-src 'self' data:`, so no remote
   * image renders directly, and our image proxy needs the session cookie, which
   * only Rust holds. Rust accepts our own origin and nothing else, so a
   * rejected URL here is a bug in the payload, not something to work around.
   */
  fetchImage: (url: string) => invoke<string>("fetch_image", { url }),
}
