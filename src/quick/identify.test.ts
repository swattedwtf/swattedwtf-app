import { describe, expect, it } from "vitest"
import { identify, targetUrl } from "./identify"

const kindOf = (q: string) => identify(q)?.kind ?? null

describe("identify", () => {
  it("recognises an email", () => {
    expect(kindOf("cried2@proton.me")).toBe("email")
    expect(kindOf("  Someone@Example.co.uk ")).toBe("email")
  })

  it("recognises a Discord snowflake", () => {
    // Snowflakes are 17 to 20 digits. Shorter runs of digits are not IDs.
    expect(kindOf("326715046303252480")).toBe("discord")
    expect(kindOf("12345678901234567890")).toBe("discord")
  })

  it("does not treat a short number as a Discord id", () => {
    expect(kindOf("1234567")).not.toBe("discord")
  })

  it("recognises a phone number in international form", () => {
    expect(kindOf("+447700900123")).toBe("phone")
    expect(kindOf("+1 (555) 010-9999")).toBe("phone")
  })

  it("recognises an IPv4 address", () => {
    expect(kindOf("192.168.1.1")).toBe("ip")
    expect(kindOf("8.8.8.8")).toBe("ip")
  })

  it("rejects an out-of-range IPv4 address", () => {
    expect(kindOf("999.1.1.1")).not.toBe("ip")
  })

  it("recognises a domain", () => {
    expect(kindOf("swattedw.tf")).toBe("domain")
    expect(kindOf("sub.example.co.uk")).toBe("domain")
  })

  it("recognises a URL and reduces it to its host", () => {
    const r = identify("https://example.com/some/path?x=1")
    expect(r?.kind).toBe("domain")
    expect(r?.value).toBe("example.com")
  })

  it("falls back to username for a bare handle", () => {
    expect(kindOf("cried")).toBe("username")
    expect(kindOf("@cried")).toBe("username")
  })

  it("strips a leading at sign from a username", () => {
    expect(identify("@cried")?.value).toBe("cried")
  })

  it("returns null for empty or whitespace input", () => {
    expect(identify("")).toBeNull()
    expect(identify("   ")).toBeNull()
  })

  it("returns null for something with no plausible identifier in it", () => {
    expect(identify("hello there friend")).toBeNull()
  })

  it("prefers the more specific kind when input is ambiguous", () => {
    // A digit run this long is a snowflake, not a phone number without a +.
    expect(kindOf("326715046303252480")).toBe("discord")
  })
})

describe("targetUrl", () => {
  it("sends each kind to its own page", () => {
    expect(targetUrl({ kind: "discord", value: "1" })).toContain("/dashboard/discord")
    expect(targetUrl({ kind: "telegram", value: "x" })).toContain("/dashboard/telegram")
    expect(targetUrl({ kind: "email", value: "a@b.c" })).toContain("/dashboard/search")
  })

  it("url-encodes the query so a + in a phone number survives", () => {
    const url = targetUrl({ kind: "phone", value: "+447700900123" })
    expect(url).toContain("%2B447700900123")
    expect(url).not.toContain("+447700900123")
  })

  it("always points at the configured origin", () => {
    for (const kind of ["discord", "email", "phone", "ip", "domain", "username"] as const) {
      expect(targetUrl({ kind, value: "x" }).startsWith("https://swattedw.tf/")).toBe(true)
    }
  })
})
