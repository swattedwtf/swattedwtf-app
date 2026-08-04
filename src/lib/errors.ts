/**
 * Errors crossing the IPC boundary.
 *
 * The Rust side serialises AppError as a tagged union
 * (`#[serde(tag = "kind", content = "detail")]` in src-tauri/src/error.rs), so a
 * rejected invoke() hands JavaScript a plain OBJECT, not an Error and not a
 * string:
 *
 *   { kind: "Network",  detail: "connection refused" }
 *   { kind: "Api",      detail: { status: 401, message: "Not authenticated" } }
 *
 * `String(err)` on that yields "[object Object]", which is how an expired
 * session used to become an unbreakable "Can't reach swatted.wtf" screen: the
 * 401 was never recognised, so the app looped through the offline state instead
 * of returning to login. Everything that displays or branches on an IPC error
 * must go through this module.
 */

type ApiDetail = { status: number; message: string; code?: string }

export type AppErrorShape =
  | { kind: "Network" | "Keychain" | "Integrity" | "Internal"; detail: string }
  | { kind: "Api"; detail: ApiDetail }

export type ParsedError = {
  kind: AppErrorShape["kind"] | "Unknown"
  /** HTTP status, when the failure came from the API. */
  status?: number
  /** Text safe to show a user. Never "[object Object]". */
  message: string
  /**
   * The server's machine-readable reason: `heist_required`, `launch_locked`,
   * `legal_acceptance_required`, `rate_limited`, and so on. Present on almost
   * every refusal, and the only reliable thing to branch on: "you need
   * Premium", "you need Heist" and "accept the updated terms" are all a 402 or
   * a 403, and matching the copy would break the moment it is reworded.
   */
  code?: string
  /** Why an account was suspended, when the server said. */
  reason?: string
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null
}

export function parseAppError(err: unknown): ParsedError {
  if (isRecord(err) && typeof err.kind === "string") {
    const { kind, detail } = err as { kind: string; detail?: unknown }

    if (kind === "Api" && isRecord(detail)) {
      const status = typeof detail.status === "number" ? detail.status : undefined
      const message =
        typeof detail.message === "string" && detail.message
          ? detail.message
          : `Request failed${status ? ` (${status})` : ""}`
      const parsed: ParsedError = { kind: "Api", status, message }
      // Only when they really are strings. A caller branching on `code` must
      // never be handed a number that happens to sit under that key.
      if (typeof detail.code === "string" && detail.code) parsed.code = detail.code
      if (typeof detail.reason === "string" && detail.reason) parsed.reason = detail.reason
      return parsed
    }

    if (typeof detail === "string" && detail) {
      return { kind: kind as AppErrorShape["kind"], message: detail }
    }

    return { kind: kind as AppErrorShape["kind"], message: kind }
  }

  if (typeof err === "string" && err) return { kind: "Unknown", message: err }
  if (err instanceof Error) return { kind: "Unknown", message: err.message }

  // Tauri ACL denials arrive as plain strings, and anything else is a bug, so
  // never fall through to String(err) and print "[object Object]".
  return { kind: "Unknown", message: "Something went wrong." }
}

/** Text to show the user for any IPC failure. */
export function messageOf(err: unknown): string {
  return parseAppError(err).message
}

/**
 * True when the server rejected us as unauthenticated.
 *
 * A locally stored cookie can still be expired server-side, so this is the only
 * reliable signal that the session is dead and the user must sign in again.
 */
export function isUnauthorized(err: unknown): boolean {
  const parsed = parseAppError(err)
  if (parsed.status === 401) return true
  return parsed.kind === "Api" && /not authenticated/i.test(parsed.message)
}

/** True when the API could not be reached at all, as opposed to refusing us. */
export function isNetworkFailure(err: unknown): boolean {
  return parseAppError(err).kind === "Network"
}

/**
 * What a screen should DO about a failure.
 *
 * - `upgrade`   the server's copy plus a link to the plans page
 * - `suspended` account-suspended panel, not an error toast and not a Retry
 * - `legal`     a link to accept the updated terms
 * - `retry`     inline "try again" with a Retry button
 * - `auth`      nothing to show: the app is already returning to login
 * - `error`     inline error with a Retry
 */
export type ErrorKind = "upgrade" | "suspended" | "legal" | "retry" | "auth" | "error"

export type ClassifiedError = {
  kind: ErrorKind
  /** The server's own copy, verbatim wherever it had any. */
  message: string
  code?: string
}

/** 402 refusals that are all "buy something", differing only in what. */
const UPGRADE_CODES = new Set([
  "heist_required",
  "premium_required",
  "launch_locked",
  "credits_required",
])

/** 429 refusals. All of them mean "the same request will work later". */
const RETRY_CODES = new Set(["limit_reached", "rate_limited", "daily_limit_reached"])

/**
 * Turns any IPC failure into the one thing the UI has to decide.
 *
 * Keyed on the server's `code` rather than the status, because the status
 * cannot separate the cases: launch lock, Premium, Heist and out-of-credits are
 * one status between them, and legal re-consent shares its status with
 * suspension. During early access the launch lock means every module answers
 * 402 `launch_locked` for anyone below Heist, so this is the dominant path
 * rather than an edge case.
 *
 * The server's message is passed through untouched in every branch. It is
 * written for the user, it is more specific than anything the client could
 * invent, and it changes without a client release.
 */
export function classifyError(err: unknown): ClassifiedError {
  const parsed = parseAppError(err)
  const out = (kind: ErrorKind): ClassifiedError =>
    parsed.code
      ? { kind, message: parsed.message, code: parsed.code }
      : { kind, message: parsed.message }

  // The code first, wherever there is one: it is more specific than the status
  // and it is what the server actually intends us to act on.
  if (parsed.code) {
    if (UPGRADE_CODES.has(parsed.code)) return out("upgrade")
    if (parsed.code === "legal_acceptance_required") return out("legal")
    if (parsed.code === "account_suspended") return out("suspended")
    if (RETRY_CODES.has(parsed.code)) return out("retry")
  }

  // requireLookupAccess answers a suspended account with a 403 carrying a
  // `reason` and NO code, so the reason itself has to be the signal. Rust
  // normalises this to account_suspended above; this covers the raw shape too.
  if (parsed.status === 403 && parsed.reason) return out("suspended")

  if (parsed.status === 429) return out("retry")
  if (isUnauthorized(err)) return out("auth")

  // A 5xx, an unreachable API, a keychain failure, an unknown code from a
  // server newer than this build: all of them are "show it and offer Retry".
  // parseAppError has already guaranteed the message is readable.
  return out("error")
}
