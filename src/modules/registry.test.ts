import { describe, expect, it } from "vitest"

import { MODULES, enabledRoutes, moduleForRoute } from "./registry"
import type { ModuleDescriptor } from "./types"
import { NAV, flattenNav, isEnabled } from "../shell/nav"

describe("registry and nav stay in sync", () => {
  it("every module's route exists in the nav tree", () => {
    const routes = new Set(flattenNav().map((i) => i.href))
    for (const m of MODULES) expect(routes.has(m.route), `${m.route} missing from NAV`).toBe(true)
  })

  it("every enabled route is either a built-in screen or a module", () => {
    const ids = new Set(MODULES.map((m) => m.route))
    for (const r of enabledRoutes()) {
      expect(r === "/dashboard" || r === "/settings" || ids.has(r)).toBe(true)
    }
  })

  it("enables the dashboard and settings whether or not any module exists", () => {
    expect(enabledRoutes()).toContain("/dashboard")
    expect(enabledRoutes()).toContain("/settings")
  })

  it("enables exactly the routes the registry carries, so a soon pill cannot drift", () => {
    for (const m of MODULES) expect(isEnabled(m.route)).toBe(true)
    expect(enabledRoutes().length).toBe(MODULES.length + 2)
  })

  it("never lets a nav group header be enabled by one of its children", () => {
    // NAV[1] is Platforms, whose parents duplicate their first child's href.
    const parents = NAV[1].items.filter((i) => i.children?.length)
    for (const p of parents) {
      const enabledChild = p.children?.some((c) => isEnabled(c.href))
      // A parent is only ever enabled by having its own descriptor, never by
      // sharing an href with a child that has one.
      if (enabledChild && !MODULES.some((m) => m.route === p.href)) {
        expect(isEnabled(p.href)).toBe(false)
      }
    }
  })
})

describe("a registered module", () => {
  // The registry is empty until the Discord task lands, so the derivation
  // itself would otherwise be asserted only vacuously. Registering a stub
  // proves the property that matters: a nav row goes live because a descriptor
  // exists, not because someone remembered to edit a second list.
  const stub: ModuleDescriptor = {
    id: "stub",
    route: "/discord",
    label: "Stub",
    inputs: [],
    Result: () => null,
  }

  it("becomes enabled and routable without anything else being edited", () => {
    expect(isEnabled(stub.route)).toBe(false)
    MODULES.push(stub)
    try {
      expect(enabledRoutes()).toContain("/discord")
      expect(isEnabled("/discord")).toBe(true)
      expect(moduleForRoute("/discord")).toBe(stub)
      // Still exact: a child route is a different screen, not this one.
      expect(isEnabled("/discord/evil")).toBe(false)
      expect(moduleForRoute("/discord/evil")).toBeUndefined()
    } finally {
      MODULES.splice(MODULES.indexOf(stub), 1)
    }
    expect(isEnabled("/discord")).toBe(false)
  })
})

describe("moduleForRoute", () => {
  it("matches on the exact route", () => {
    for (const m of MODULES) expect(moduleForRoute(m.route)).toBe(m)
  })

  it("returns undefined for a route no module owns", () => {
    expect(moduleForRoute("/dashboard")).toBeUndefined()
    expect(moduleForRoute("/nothing-here")).toBeUndefined()
  })

  it("does not match a route that merely starts with a module's route", () => {
    for (const m of MODULES) expect(moduleForRoute(`${m.route}/evil`)).toBeUndefined()
  })
})

describe("descriptors", () => {
  it("gives every module a unique id and route", () => {
    expect(new Set(MODULES.map((m) => m.id)).size).toBe(MODULES.length)
    expect(new Set(MODULES.map((m) => m.route)).size).toBe(MODULES.length)
  })

  it("gives every input a unique name, a label and a placeholder", () => {
    for (const m of MODULES) {
      const names = m.inputs.map((i) => i.name)
      expect(new Set(names).size, `${m.id} has duplicate input names`).toBe(names.length)
      for (const input of m.inputs) {
        expect(input.label.length, `${m.id}.${input.name} needs a label`).toBeGreaterThan(0)
        expect(input.placeholder.length).toBeGreaterThan(0)
      }
    }
  })

  it("uses no em dashes in any user-facing copy", () => {
    for (const m of MODULES) {
      const copy = [m.label, ...m.inputs.flatMap((i) => [i.label, i.placeholder])]
      expect(copy.filter((c) => c.includes("—"))).toEqual([])
    }
  })
})
