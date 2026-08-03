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

type ApiDetail = { status: number; message: string }

export type AppErrorShape =
  | { kind: "Network" | "Keychain" | "Integrity" | "Internal"; detail: string }
  | { kind: "Api"; detail: ApiDetail }

export type ParsedError = {
  kind: AppErrorShape["kind"] | "Unknown"
  /** HTTP status, when the failure came from the API. */
  status?: number
  /** Text safe to show a user. Never "[object Object]". */
  message: string
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
      return { kind: "Api", status, message }
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
