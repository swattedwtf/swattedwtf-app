import { describe, expect, it } from "vitest"
import { BUILT_IN_ROUTES, MODULES } from "../modules/registry"
import { streamRoutes } from "../modules/stream-registry"
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
  it("enables the built-in screens plus every registered module and streaming screen", () => {
    // Derived from the registries, not hand-listed. An earlier version spelled
    // the expected routes out and had to be edited every time a module shipped,
    // which tests the editor rather than the derivation.
    expect(ENABLED_ROUTES).toEqual([
      ...BUILT_IN_ROUTES,
      ...MODULES.map((m) => m.route),
      ...streamRoutes(),
    ])
    expect(isEnabled("/dashboard")).toBe(true)
    expect(isEnabled("/settings")).toBe(true)
    for (const m of MODULES) expect(isEnabled(m.route), `${m.route} should be enabled`).toBe(true)
    // The streaming screens are live this pass.
    for (const r of streamRoutes()) expect(isEnabled(r), `${r} should be enabled`).toBe(true)
    expect(isEnabled("/search")).toBe(true)
    expect(isEnabled("/live-intelligence")).toBe(true)
  })

  it("disables any nav route that has neither a descriptor nor a built-in screen", () => {
    const live = new Set([...MODULES.map((m) => m.route), ...streamRoutes()])
    const unbuilt = flattenNav()
      .map((i) => i.href)
      .filter((h) => !live.has(h) && !BUILT_IN_ROUTES.includes(h) && !h.startsWith("http"))
    // Every remaining nav destination is now either built (a module, a stream or
    // a built-in) or an external link (Agent, Support), so `unbuilt` may be
    // empty; the guarantee under test is only that anything left in it is
    // disabled, never that some route is still unbuilt.
    for (const href of unbuilt) expect(isEnabled(href), `${href} should be disabled`).toBe(false)
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

describe("platform group headers", () => {
  /**
   * The group header row is a disclosure control, not a destination, and it
   * used to be dimmed and pilled "soon" unconditionally. That was written when
   * every platform under it was unbuilt, and it never followed the children: by
   * the time Roblox, Instagram, TikTok, Snapchat and Telegram all worked, their
   * headers still read as coming-soon, which is how the user found it.
   *
   * Sidebar derives the header's state from `isEnabled` over the children now,
   * so this pins the invariant rather than the current answer.
   */
  it("has at least one live child under every platform group that owns children", () => {
    const groups = NAV.flatMap((g) => g.items).filter((i) => i.children?.length)
    expect(groups.length).toBeGreaterThan(0)

    const dead = groups
      .filter((g) => !g.children!.some((c) => isEnabled(c.href)))
      .map((g) => g.label)

    // A group may legitimately be entirely unbuilt. What must never happen is a
    // group whose children are live being reported as dead, so this records
    // which groups are which and fails when a live one regresses.
    expect(dead).toEqual([])
  })

  it("routes every platform child through the same isEnabled the header reads", () => {
    for (const group of NAV.flatMap((g) => g.items).filter((i) => i.children?.length)) {
      for (const child of group.children!) {
        expect(ENABLED_ROUTES.includes(child.href)).toBe(isEnabled(child.href))
      }
    }
  })
})
