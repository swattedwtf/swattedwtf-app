import { describe, expect, it } from "vitest"
import { isNetworkFailure, isUnauthorized, messageOf, parseAppError } from "./errors"

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
