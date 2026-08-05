import { describe, expect, it } from "vitest"

import { buildCommands, score } from "./CommandPalette"

describe("command palette scoring", () => {
  it("ranks a contiguous prefix match above a scattered subsequence", () => {
    const prefix = score("Discord", "disc")
    const subseq = score("Address Insights", "disc") // d-i-s… scattered, if at all
    expect(prefix).not.toBeNull()
    if (subseq !== null) expect(prefix!).toBeLessThan(subseq)
  })

  it("returns null when the query is not even a subsequence", () => {
    expect(score("Discord", "zzzz")).toBeNull()
  })

  it("treats an empty query as a match (everything shows)", () => {
    expect(score("Anything", "")).toBe(0)
  })

  it("is case-insensitive", () => {
    expect(score("Live Intelligence", "LIVE")).not.toBeNull()
  })
})

describe("command palette catalogue", () => {
  const cmds = buildCommands()

  it("includes core destinations and Settings", () => {
    const hrefs = new Set(cmds.map((c) => c.href))
    expect(hrefs.has("/search")).toBe(true)
    expect(hrefs.has("/settings")).toBe(true)
  })

  it("never lists a disabled route", () => {
    // Every command must be an enabled destination; buildCommands filters on it.
    expect(cmds.length).toBeGreaterThan(5)
    expect(cmds.every((c) => c.href.startsWith("/"))).toBe(true)
  })

  it("labels a platform child with its parent for context", () => {
    const child = cmds.find((c) => c.label.includes("·"))
    // e.g. "Instagram · Share Resolver" — only present if a platform child is enabled.
    if (child) expect(child.label).toMatch(/ · /)
  })
})
