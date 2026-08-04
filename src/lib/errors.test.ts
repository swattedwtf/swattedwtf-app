import { describe, expect, it } from "vitest"
import {
  classifyError,
  isNetworkFailure,
  isUnauthorized,
  messageOf,
  parseAppError,
} from "./errors"

// Shapes below are exactly what serde emits for AppError
// (#[serde(tag = "kind", content = "detail")] in src-tauri/src/error.rs).
const NETWORK = { kind: "Network", detail: "error sending request: connection refused" }
const UNAUTHORIZED = { kind: "Api", detail: { status: 401, message: "Not authenticated" } }
const RATE_LIMITED = {
  kind: "Api",
  detail: { status: 429, message: "Too many login attempts. Try again later." },
}
const INTERNAL = { kind: "Internal", detail: "captcha window closed" }

describe("messageOf", () => {
  it("never returns [object Object] for a tagged error", () => {
    for (const err of [NETWORK, UNAUTHORIZED, RATE_LIMITED, INTERNAL]) {
      expect(messageOf(err)).not.toContain("[object Object]")
    }
  })

  it("surfaces the server's own message verbatim", () => {
    expect(messageOf(RATE_LIMITED)).toBe("Too many login attempts. Try again later.")
  })

  it("uses the detail string for non-API errors", () => {
    expect(messageOf(INTERNAL)).toBe("captcha window closed")
  })

  it("passes through a bare string, which is how ACL denials arrive", () => {
    expect(messageOf("window.close not allowed")).toBe("window.close not allowed")
  })

  it("reads an Error instance", () => {
    expect(messageOf(new Error("boom"))).toBe("boom")
  })

  it("falls back to friendly copy rather than stringifying an unknown object", () => {
    expect(messageOf({ weird: true })).toBe("Something went wrong.")
    expect(messageOf(null)).toBe("Something went wrong.")
    expect(messageOf(undefined)).toBe("Something went wrong.")
  })

  it("synthesises a message when the API sends a status but no text", () => {
    expect(messageOf({ kind: "Api", detail: { status: 502 } })).toBe("Request failed (502)")
  })
})

describe("isUnauthorized", () => {
  it("recognises a 401", () => {
    expect(isUnauthorized(UNAUTHORIZED)).toBe(true)
  })

  it("recognises the message even without a status", () => {
    expect(isUnauthorized({ kind: "Api", detail: { message: "Not authenticated" } })).toBe(true)
  })

  it("does not treat a rate limit or a network failure as a dead session", () => {
    expect(isUnauthorized(RATE_LIMITED)).toBe(false)
    expect(isUnauthorized(NETWORK)).toBe(false)
    expect(isUnauthorized(INTERNAL)).toBe(false)
  })

  /** The exact regression: a 401 that reads as "[object Object]" loops forever. */
  it("is not fooled by the shape that used to stringify to [object Object]", () => {
    expect(String(UNAUTHORIZED)).toBe("[object Object]")
    expect(isUnauthorized(UNAUTHORIZED)).toBe(true)
  })
})

describe("isNetworkFailure", () => {
  it("distinguishes unreachable from refused", () => {
    expect(isNetworkFailure(NETWORK)).toBe(true)
    expect(isNetworkFailure(UNAUTHORIZED)).toBe(false)
  })
})

describe("parseAppError", () => {
  it("carries the status through for callers that branch on it", () => {
    expect(parseAppError(UNAUTHORIZED)).toEqual({
      kind: "Api",
      status: 401,
      message: "Not authenticated",
    })
  })
})

// Every refusal below is copied from the shape lib/access-control.ts returns,
// wrapped the way serde hands it to us: {kind: "Api", detail: {...}}.
const api = (status: number, message: string, code?: string) => ({
  kind: "Api",
  detail: code === undefined ? { status, message } : { status, message, code },
})

describe("classifyError", () => {
  it("routes every paywall code to the upgrade panel with the server's copy", () => {
    const cases: [string, string][] = [
      [
        "launch_locked",
        "Swatted is in early access - only Swatted Heist members can run searches right now.",
      ],
      ["heist_required", "This is a Swatted Heist feature. Upgrade to Heist to unlock it."],
      ["premium_required", "You need a plan to run searches. Pick Swatted Premium or Swatted Heist."],
      ["credits_required", "You are out of credits."],
    ]
    for (const [code, message] of cases) {
      const out = classifyError(api(402, message, code))
      expect(out.kind, code).toBe("upgrade")
      expect(out.code).toBe(code)
      // Verbatim. The server owns this copy; the client never rewrites it.
      expect(out.message).toBe(message)
    }
  })

  it("routes the legal re-consent 403 to its own panel", () => {
    const out = classifyError(
      api(403, "Please review and accept our updated Terms.", "legal_acceptance_required"),
    )
    expect(out.kind).toBe("legal")
    expect(out.message).toBe("Please review and accept our updated Terms.")
  })

  it("recognises a suspension from the code Rust normalises it to", () => {
    const out = classifyError(api(403, "Account suspended.", "account_suspended"))
    expect(out.kind).toBe("suspended")
    expect(out.message).toBe("Account suspended.")
  })

  /**
   * requireLookupAccess answers a suspended account with a 403 carrying a
   * `reason` and NO code, so the reason itself has to be enough. A suspension
   * shown as a generic error would offer a Retry button that can never work.
   */
  it("recognises a 403 that carries only a reason", () => {
    const out = classifyError({
      kind: "Api",
      detail: { status: 403, message: "Account suspended.", reason: "CSAM attempt" },
    })
    expect(out.kind).toBe("suspended")
  })

  it("does not read a plain 403 as a suspension", () => {
    expect(classifyError(api(403, "Forbidden.")).kind).toBe("error")
  })

  it("routes every 429 to an inline retry", () => {
    for (const code of ["limit_reached", "rate_limited", "daily_limit_reached"]) {
      const out = classifyError(api(429, "Slow down.", code))
      expect(out.kind, code).toBe("retry")
      expect(out.code).toBe(code)
    }
    // Status alone is enough; a 429 with no code is still a retry.
    expect(classifyError(api(429, "Slow down.")).kind).toBe("retry")
  })

  it("routes a 401 to auth, so the app returns to login rather than showing a panel", () => {
    expect(classifyError(api(401, "Not authenticated.")).kind).toBe("auth")
    expect(classifyError(UNAUTHORIZED).kind).toBe("auth")
  })

  it("falls back to a generic error for a 5xx, a network drop and an unknown code", () => {
    expect(classifyError(api(500, "Upstream exploded.")).kind).toBe("error")
    expect(classifyError(api(402, "Something new.", "some_future_code")).kind).toBe("error")
    // Unreachable is still an inline error with a Retry. isNetworkFailure stays
    // the way to tell the two apart where that matters.
    expect(classifyError(NETWORK).kind).toBe("error")
    expect(classifyError(INTERNAL).kind).toBe("error")
  })

  /**
   * The shipped bug this whole module exists for. A rejected invoke() hands
   * JavaScript a plain object, so String(err) is "[object Object]" and a user
   * saw exactly that on screen. No branch may ever produce it.
   */
  it("never renders a raw AppError as [object Object]", () => {
    const raw = { kind: "Api", detail: { status: 402, message: "Nope.", code: "heist_required" } }
    expect(String(raw)).toBe("[object Object]")
    for (const err of [
      raw,
      NETWORK,
      UNAUTHORIZED,
      RATE_LIMITED,
      INTERNAL,
      { weird: true },
      null,
      undefined,
      [],
      new Error("boom"),
    ]) {
      const out = classifyError(err)
      expect(out.message).not.toContain("[object Object]")
      expect(out.message.length).toBeGreaterThan(0)
    }
  })

  it("omits code entirely when the server sent none", () => {
    expect(classifyError(api(500, "Upstream exploded.")).code).toBeUndefined()
  })
})

describe("parseAppError, with the code the desktop surface added", () => {
  it("carries the code through for callers that branch on it", () => {
    expect(parseAppError(api(402, "Nope.", "heist_required"))).toEqual({
      kind: "Api",
      status: 402,
      message: "Nope.",
      code: "heist_required",
    })
  })

  it("ignores a non-string code rather than trusting the shape", () => {
    expect(parseAppError({ kind: "Api", detail: { status: 402, message: "x", code: 7 } }).code)
      .toBeUndefined()
  })
})
