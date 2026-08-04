import { describe, expect, it } from "vitest"
import { ENABLED_ROUTES, NAV, flattenNav, isEnabled } from "./nav"

describe("NAV", () => {
  it("mirrors the four sidebar groups from the web dashboard", () => {
    expect(NAV.map((g) => g.label)).toEqual(["Intelligence", "Platforms", "Tools", "Resources"])
  })

  it("includes every top-level intelligence destination", () => {
    expect(NAV[0].items.map((i) => i.label)).toEqual([
      "Dashboard",
      "Search",
      "Live Intelligence",
      "Investigations",
      "Machine Browser",
      "Reverse Face",
      "Agent",
      "Monitor",
    ])
  })

  it("keeps platform subpages nested under their parent", () => {
    const tiktok = NAV[1].items.find((i) => i.label === "TikTok")
    expect(tiktok?.children?.map((c) => c.label)).toEqual([
      "User Info",
      "Share Resolver",
      "Phone -> User",
      "Email -> User",
    ])
  })

  it("carries all six tools", () => {
    expect(NAV[2].items.map((i) => i.label)).toEqual([
      "Samsung Lookup",
      "Skiptracer",
      "Address Insights",
      "Falcon",
      "IntelX",
      "Cobra",
    ])
  })

  it("uses no em dashes in any label", () => {
    const labels = NAV.flatMap((g) => [
      g.label,
      ...g.items.flatMap((i) => [i.label, ...(i.children?.map((c) => c.label) ?? [])]),
    ])
    expect(labels.filter((l) => l.includes("—"))).toEqual([])
  })

  it("gives every leaf a unique href, so React keys and routing cannot collide", () => {
    const leaves = flattenNav()
    const hrefs = leaves.map((l) => l.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })
})

describe("isEnabled", () => {
  it("enables the built-in screens plus every registered module", () => {
    // Derived from the registry rather than hand-maintained, so this list grows
    // exactly when a module ships and the two cannot fall out of step.
    expect(ENABLED_ROUTES).toEqual(["/dashboard", "/settings", "/discord"])
    expect(isEnabled("/dashboard")).toBe(true)
    expect(isEnabled("/settings")).toBe(true)
    expect(isEnabled("/discord")).toBe(true)
  })

  it("still disables a module that has no descriptor yet", () => {
    expect(isEnabled("/tools/falcon")).toBe(false)
    expect(isEnabled("/search")).toBe(false)
    expect(isEnabled("/snapchat")).toBe(false)
  })

  it("does not enable a route merely because it starts with an enabled one", () => {
    expect(isEnabled("/dashboard/evil")).toBe(false)
    expect(isEnabled("/settings-other")).toBe(false)
  })
})

describe("flattenNav", () => {
  it("returns every leaf including nested children", () => {
    const leaves = flattenNav()
    expect(leaves.some((l) => l.label === "Phone -> User")).toBe(true)
    expect(leaves.some((l) => l.label === "Dashboard")).toBe(true)
  })

  it("excludes parents that only group children", () => {
    // TikTok is a group header whose own href duplicates its first child.
    const leaves = flattenNav()
    expect(leaves.filter((l) => l.label === "TikTok")).toEqual([])
  })

  it("marks external links so they open in the browser", () => {
    expect(flattenNav().find((l) => l.label === "Support")?.external).toBe(true)
  })

  it("points Support at the Telegram bot", () => {
    expect(flattenNav().find((l) => l.label === "Support")?.href).toBe("https://t.me/swatted_bot")
  })
})
