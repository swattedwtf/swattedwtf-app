import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

import { QuickActions } from "./QuickActions"
import { BUILT_IN_ROUTES, MODULES } from "../modules/registry"
import { streamRoutes } from "../modules/stream-registry"

vi.mock("../lib/ipc", () => ({ ipc: { openExternal: vi.fn(async () => {}) } }))

/**
 * Quick Actions used to send all six of its tiles to the browser, because when
 * it was written nothing was native. Almost everything is now, so the panel has
 * to tell the two apart, and the arrow glyph is the user-visible promise that a
 * click leaves the window.
 *
 * These derive the expected answer from the registry rather than restating it.
 * The equivalent hard-coded assumption in the sidebar is precisely what left
 * five platform groups greyed out and labelled "soon" for weeks after the pages
 * behind them shipped.
 */
const live = new Set<string>([...BUILT_IN_ROUTES, ...MODULES.map((m) => m.route), ...streamRoutes()])

describe("QuickActions", () => {
  const html = renderToStaticMarkup(<QuickActions onNavigate={() => {}} />)

  const outbound = [...html.matchAll(/title="Opens ([^"]+) in your browser"/g)].map((m) => m[1])

  it("always hands off the two that are deliberately browser-only", () => {
    // The Agent is not built natively and API docs is a documentation site, so
    // neither is waiting on a route and neither should ever go native.
    expect(outbound).toContain("https://swattedw.tf/dashboard/agent")
    expect(outbound).toContain("https://swattedw.tf/dashboard/api/docs")
  })

  it("hands off a tile only when the app does not own its route", () => {
    // The rule, not today's answer. /plans hands off while its screen is still
    // being built and stops doing so the moment the route exists, with nobody
    // editing this component. That is the entire point of deriving it.
    for (const url of outbound) {
      const route = url.replace("https://swattedw.tf/dashboard", "")
      const deliberate = route === "/agent" || route === "/api/docs"
      expect(deliberate || !live.has(route), `${route} is live but still hands off`).toBe(true)
    }
  })

  it("does not hand off any tile whose route the app already owns", () => {
    for (const route of ["/search", "/live-intelligence", "/investigations", "/face"]) {
      // Guards the test itself: if one of these stops being a real route the
      // assertion below would pass vacuously.
      expect(live.has(route), `${route} is no longer a live route`).toBe(true)
      expect(html).not.toContain(`https://swattedw.tf/dashboard${route}"`)
    }
  })

  it("no longer offers the Modules tile", () => {
    expect(html).not.toContain("Modules")
  })

  it("uses no em dashes", () => {
    expect(html).not.toContain("—")
  })
})
