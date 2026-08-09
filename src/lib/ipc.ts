/**
 * The single place the frontend talks to Rust. Every command is wrapped in a
 * typed function so no component ever calls invoke() with a raw string.
 */
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import type { IntegrityReport, UpdateResult } from "../boot/machine"

export type Overview = {
  user: { id: string; userNumber: number; email: string | null; handle: string }
  telegram: { username: string | null; linked: boolean }
  security: { twofaEnabled: boolean }
  /** True when the user has accepted the current legal-document version. The
   *  app shows a consent modal on entry only when this is explicitly false, so
   *  an older backend that omits it (or a fixture) never blocks. */
  legalAccepted?: boolean
  /** Public Mapbox token for the Address Insights interactive map. Null/absent
   *  when the server has not shipped it, in which case the static still shows. */
  mapboxToken?: string | null
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
  /**
   * The tier catalog, priced by the server for this account.
   *
   * Carried here rather than written into the client because a price is a
   * promise: the server charges from this same table, so a client with its own
   * copy would eventually show one number and bill another. An older server
   * that does not send it yields an empty `tiers`, which the Plans screen
   * reports as a catalog it could not load rather than as a free product.
   */
  plans: {
    /** The plan the account holds right now. */
    currentId: string
    /** Account-wide percent off applied to a paid tier today. 0 when none. */
    discountPercent: number
    tiers: PlanTier[]
  }
}

/**
 * One purchasable tier.
 *
 * `priceUsd` is the list price; `yourPriceUsd` is what THIS account pays, after
 * the Premium -> Heist upgrade credit and any account discount the server
 * already applied. `relation` is the server's own reading of where the tier
 * sits against the current plan, so the client never re-derives the ordering
 * and cannot present a downgrade as something to buy.
 */
export type PlanTier = {
  id: string
  name: string
  shortName: string
  term: string
  lifetime: boolean
  badge: string | null
  highlight: boolean
  includes: string | null
  features: string[]
  priceUsd: number
  yourPriceUsd: number
  relation: "current" | "upgrade" | "downgrade" | "default"
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

/**
 * An image the user picked in the native dialog.
 *
 * `dataUrl` is both the preview `src` and the value uploaded to the face
 * module: the webview cannot read a file and cannot render a remote image, so
 * Rust hands over the one representation that serves both. `name` is the file's
 * own name and never a path; where the user keeps their pictures has no reason
 * to cross the boundary.
 */
export type PickedImage = {
  name: string
  /** Sniffed from the bytes by Rust, not taken from the extension. */
  mime: string
  /** Decoded size in bytes, so a caption does not have to measure base64. */
  bytes: number
  dataUrl: string
}

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
  acceptLegal: () => invoke<void>("accept_legal"),
  getOverview: () => invoke<Overview>("get_overview"),
  windowDiagnostics: () => invoke<WindowDiagnostics>("window_diagnostics"),
  hideQuick: () => invoke<void>("hide_quick"),
  resolveQuick: (route: string, query: string, mode?: string) =>
    invoke<void>("resolve_quick", { route, query, mode: mode ?? null }),
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
   * Runs one Investigations case-manager action.
   *
   * Deliberately separate from `lookup`. A case list and a notepad are not a
   * metered search, and the server gates this route on the ordinary signed-in
   * mutation gate rather than on the lookup gate, so routing it through the
   * lookup command would have charged the desktop for something the web gives
   * away.
   *
   * `action` is a key into a closed set on the server, never a path. The answer
   * stays untyped here for the same reason a lookup's does: the screen that
   * renders it is the right place to describe its shape, and it coerces every
   * field through `withDefaults` before reading one.
   */
  investigations: (action: string, input: Record<string, unknown> = {}) =>
    invoke<Record<string, unknown>>("investigations", { action, input }),

  /**
   * Resolves an image URL from a lookup payload into a `data:` URL.
   *
   * Needed because the webview's CSP is `img-src 'self' data:`, so no remote
   * image renders directly, and our image proxy needs the session cookie, which
   * only Rust holds. Rust accepts our own origin and nothing else, so a
   * rejected URL here is a bug in the payload, not something to work around.
   */
  fetchImage: (url: string) => invoke<string>("fetch_image", { url }),

  /**
   * Opens a native picker and returns the chosen image, or null if cancelled.
   *
   * The dialog, the read and the validation all happen in Rust. The webview
   * holds no filesystem permission at all, so this is the only way a file
   * reaches the app and the only path involved is one a person chose in an OS
   * dialog. What comes back is a `data:` URL because that is the one form the
   * CSP (`img-src 'self' data:`) lets a preview render, and it doubles as the
   * payload the face lookup uploads.
   */
  pickImage: () => invoke<PickedImage | null>("pick_image"),

  /**
   * Runs one Monitor action: `list`, `create`, `delete` or `runs`.
   *
   * Deliberately NOT `lookup`. Monitor is a subscription surface, so its server
   * route is gated on the Heist plan the way the web's monitor routes are but is
   * not metered: opening the screen must not cost a search. `action` is a key
   * into a fixed set on the server, never a path.
   *
   * The answer stays untyped here for the same reason a lookup payload does. The
   * Monitor screen coerces it through `withDefaults`/`list` before rendering, so
   * a server that answers with a shape this build does not know draws a sparse
   * screen rather than throwing inside React's render.
   */
  monitor: (action: string, input: Record<string, unknown> = {}) =>
    invoke<Record<string, unknown>>("monitor", { action, input }),

  /** Account-management actions on the Settings screen (regenerate login code,
   *  change email, sign out everywhere, delete account). */
  account: (action: string, input: Record<string, unknown> = {}) =>
    invoke<Record<string, unknown>>("account", { action, input }),

  /**
   * Runs one Roblox Server Intel action: `pair`, `unpair`, `state`, `overlay`,
   * `highlight` or `player`.
   *
   * Deliberately NOT `lookup`. Server Intel is a pairing session that the screen
   * POLLS, so metering it would spend a search every few seconds for watching a
   * screen. The server gates minting a connector on the Heist plan and on the
   * web's own two-per-five-hours budget, and leaves the rest signed-in only,
   * exactly as the browser does.
   *
   * The answer stays untyped here for the same reason a lookup payload does. The
   * screen coerces it through `withDefaults`/`list` before rendering, so a
   * server that answers with a shape this build does not know draws a sparse
   * screen rather than throwing inside React's render.
   */
  serverIntel: (action: string, input: Record<string, unknown> = {}) =>
    invoke<Record<string, unknown>>("server_intel", { action, input }),
}

/** One parsed SSE `data:` event from a stream. Its shape is the module's own. */
export type StreamFrame = Record<string, unknown>

/** A handle to a running stream. `cancel` is safe to call any number of times,
 *  including after the stream has already finished. */
export type StreamHandle = { cancel: () => void }

export type StreamHandlers = {
  /** One parsed SSE data event. Called in arrival order. */
  onFrame: (frame: StreamFrame) => void
  /** The server closed the stream cleanly. */
  onDone: () => void
  /** The connection failed mid-stream. Distinct from onDone so the screen can
   *  offer Retry rather than treating it as "finished with nothing". */
  onError: (message: string) => void
}

/** The Tauri event every stream chunk, end and error rides. Mirrors
 *  src-tauri/src/api/stream.rs::STREAM_EVENT. */
const STREAM_EVENT = "desktop-stream"

type StreamMsg =
  | { kind: "chunk"; id: number; data: string }
  | { kind: "end"; id: number }
  | { kind: "error"; id: number; message: string }

/**
 * Starts a streaming lookup and delivers its frames as they arrive.
 *
 * The transport is Rust: it owns the connection and the session cookie, and
 * forwards decoded SSE text over the `desktop-stream` Tauri event, one message
 * per chunk, tagged with the stream's id. This function turns that byte stream
 * back into parsed SSE frames.
 *
 * A refusal at connect time (a 402 upgrade wall, a 429, a dead session) REJECTS
 * this promise before any frame arrives, so a caller classifies it exactly as
 * it does a one-shot lookup failure. Once the promise resolves, the stream is
 * live and everything else arrives through the handlers.
 *
 * The listener is attached BEFORE the stream is started and any frames that land
 * before the id is known are buffered and replayed, so an instantly-answering
 * source is never dropped in the gap.
 */
export async function startStream(
  module: string,
  input: Record<string, unknown>,
  handlers: StreamHandlers,
): Promise<StreamHandle> {
  let id: number | null = null
  let closed = false
  const early: StreamMsg[] = []
  let buffer = ""
  let unlisten: (() => void) | null = null

  const cleanup = () => {
    closed = true
    if (unlisten) {
      unlisten()
      unlisten = null
    }
  }

  // Parse whole SSE frames (`data: ...\n\n`) out of the accumulated text and
  // dispatch each JSON event. Comment lines (heartbeats, the open marker, the
  // anti-buffering padding) carry no `data:` line and are skipped.
  const flush = () => {
    let idx: number
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      const data = block
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("\n")
      if (!data) continue
      let frame: StreamFrame
      try {
        frame = JSON.parse(data) as StreamFrame
      } catch {
        continue
      }
      handlers.onFrame(frame)
    }
  }

  const process = (msg: StreamMsg) => {
    if (closed) return
    if (msg.kind === "chunk") {
      buffer += msg.data
      flush()
    } else if (msg.kind === "end") {
      flush()
      cleanup()
      handlers.onDone()
    } else {
      cleanup()
      handlers.onError(msg.message)
    }
  }

  unlisten = await listen<StreamMsg>(STREAM_EVENT, (e) => {
    const msg = e.payload
    if (id === null) {
      early.push(msg)
      return
    }
    if (msg.id !== id) return
    process(msg)
  })

  try {
    id = await invoke<number>("stream_start", { module, input })
  } catch (err) {
    cleanup()
    throw err
  }

  // Replay anything that arrived for our id while the listener was up but the id
  // was not yet known.
  for (const m of early) if (m.id === id) process(m)

  return {
    cancel: () => {
      if (id !== null) void invoke("stream_cancel", { id }).catch(() => {})
      cleanup()
    },
  }
}
