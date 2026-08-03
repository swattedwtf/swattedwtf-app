import { describe, expect, it } from "vitest"
import { formatCount, formatResetIn, formatSince } from "./format"

describe("formatCount", () => {
  it("groups thousands", () => {
    expect(formatCount(4021)).toBe("4,021")
  })

  it("leaves small numbers alone", () => {
    expect(formatCount(7)).toBe("7")
  })

  it("renders zero", () => {
    expect(formatCount(0)).toBe("0")
  })
})

describe("formatResetIn", () => {
  const now = Date.UTC(2026, 7, 3, 12, 0, 0)

  it("renders whole days when more than a day remains", () => {
    expect(formatResetIn(Date.UTC(2026, 7, 9, 12, 0, 0), now)).toBe("6d")
  })

  it("renders hours and minutes inside the last day", () => {
    expect(formatResetIn(Date.UTC(2026, 7, 3, 18, 30, 0), now)).toBe("6h 30m")
  })

  it("renders minutes only in the last hour", () => {
    expect(formatResetIn(Date.UTC(2026, 7, 3, 12, 45, 0), now)).toBe("45m")
  })

  it("clamps a past reset to zero", () => {
    expect(formatResetIn(Date.UTC(2026, 7, 1), now)).toBe("0m")
  })

  // Boundary: exactly 24h is the first value that reads as a day, so the
  // 23h 59m -> 1d handover is the one place the two branches can disagree.
  it("switches to days at exactly 24 hours", () => {
    expect(formatResetIn(now + 24 * 60 * 60 * 1000, now)).toBe("1d")
    expect(formatResetIn(now + 24 * 60 * 60 * 1000 - 60_000, now)).toBe("23h 59m")
  })
})

describe("formatSince", () => {
  it("renders a short US date", () => {
    expect(formatSince("2026-01-15T00:00:00.000Z")).toBe("Jan 15, 2026")
  })

  it("returns an empty string for an unparseable value", () => {
    expect(formatSince("not a date")).toBe("")
  })
})
