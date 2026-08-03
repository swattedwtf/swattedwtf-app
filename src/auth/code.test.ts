import { describe, expect, it } from "vitest"
import { formatLoginCode, isCompleteLoginCode, normalizeLoginCode } from "./code"

describe("normalizeLoginCode", () => {
  it("strips everything that is not a digit", () => {
    expect(normalizeLoginCode(" 1234-5678 9012 ")).toBe("123456789012")
  })

  it("truncates past twelve digits", () => {
    expect(normalizeLoginCode("1234567890123456")).toBe("123456789012")
  })

  it("handles an empty string", () => {
    expect(normalizeLoginCode("")).toBe("")
  })
})

describe("formatLoginCode", () => {
  it("groups digits in fours", () => {
    expect(formatLoginCode("123456789012")).toBe("1234 5678 9012")
  })

  it("does not add a trailing space on a group boundary", () => {
    expect(formatLoginCode("1234")).toBe("1234")
    expect(formatLoginCode("12345678")).toBe("1234 5678")
  })

  it("formats a partial third group", () => {
    expect(formatLoginCode("123456789")).toBe("1234 5678 9")
  })

  it("formats pasted text with separators", () => {
    expect(formatLoginCode("1234-5678-9012")).toBe("1234 5678 9012")
  })
})

describe("isCompleteLoginCode", () => {
  it("accepts exactly twelve digits", () => {
    expect(isCompleteLoginCode("1234 5678 9012")).toBe(true)
  })

  it("rejects a short code", () => {
    expect(isCompleteLoginCode("1234 5678 901")).toBe(false)
  })

  it("rejects a code containing letters", () => {
    expect(isCompleteLoginCode("1234 5678 90ab")).toBe(false)
  })
})
