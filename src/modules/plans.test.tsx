import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

import type { Overview, PlanTier } from "../lib/ipc"
import { Plans, checkoutUrl, formatUsd, normalizePromo } from "./plans"

/**
 * The Plans screen sells things, so what it renders is a claim about money.
 * These pin the two ways that claim can go wrong: a price the server did not
 * send, and a purchase offered to someone who cannot make it.
 */

const TIERS: Record<string, PlanTier> = {
  free: {
    id: "free",
    name: "Free Plan",
    shortName: "Free",
    term: "forever",
    lifetime: false,
    badge: null,
    highlight: false,
    includes: null,
    features: ["No searches - a paid plan is required"],
    priceUsd: 0,
    yourPriceUsd: 0,
    relation: "default",
  },
  pro: {
    id: "pro",
    name: "Swatted Premium",
    shortName: "Premium",
    term: "monthly",
    lifetime: false,
    badge: "Popular",
    highlight: true,
    includes: null,
    features: ["1,500 monthly lookups"],
    priceUsd: 20,
    yourPriceUsd: 20,
    relation: "upgrade",
  },
  plus: {
    id: "plus",
    name: "Swatted Heist",
    shortName: "Heist",
    term: "lifetime",
    lifetime: true,
    badge: "Best Value",
    highlight: false,
    includes: "Everything in Premium, plus:",
    features: ["5,000 monthly lookups", "Stealer logs access"],
    priceUsd: 55,
    yourPriceUsd: 55,
    relation: "upgrade",
  },
}

function overviewWith(plans: Partial<Overview["plans"]>): Overview {
  return {
    user: { id: "1", userNumber: 1, email: null, handle: "u" },
    telegram: { username: null, linked: false },
    security: { twofaEnabled: false },
    plan: { id: "free", label: "Free", monthlyLimit: 0, since: "", balanceCents: 0, status: "", dailyLimit: null },
    usage: { todayCount: 0, monthCount: 0, allTimeCount: 0, nextResetMs: 0, series: [] },
    api: { active: false, tierLabel: null, usedToday: 0, dailyLimit: null, expiresAt: null, key: null },
    plans: {
      currentId: "free",
      discountPercent: 0,
      tiers: [TIERS.free, TIERS.pro, TIERS.plus],
      ...plans,
    },
  }
}

const render = (overview: Overview) => renderToStaticMarkup(<Plans overview={overview} />)

describe("checkoutUrl", () => {
  it("is an https URL with a host, which is all open_external will open", () => {
    // Mirrors is_allowed() in src-tauri/src/commands.rs: anything else is
    // refused there, which would make every buy button silently inert.
    const url = new URL(checkoutUrl("plus"))
    expect(url.protocol).toBe("https:")
    expect(url.host).toBe("swattedw.tf")
    expect(url.pathname).toBe("/dashboard/checkout")
  })

  it("carries the plan and the billing cycle the checkout page reads", () => {
    const params = new URL(checkoutUrl("pro")).searchParams
    expect(params.get("plan")).toBe("pro")
    expect(params.get("billing")).toBe("monthly")
    expect(params.get("discount")).toBeNull()
    expect(params.get("promo")).toBeNull()
  })

  it("passes the 50% discount marker only when the account actually has it", () => {
    expect(new URL(checkoutUrl("plus", { discountPercent: 50 })).searchParams.get("discount")).toBe("50")
    expect(new URL(checkoutUrl("plus", { discountPercent: 0 })).searchParams.get("discount")).toBeNull()
  })

  it("forwards a promo code so the buyer does not type it twice", () => {
    expect(new URL(checkoutUrl("plus", { promo: "best" })).searchParams.get("promo")).toBe("BEST")
  })

  it("never lets a typed code become another query parameter or a path", () => {
    const url = new URL(checkoutUrl("plus", { promo: "BEST&plan=free/../x?y=1" }))
    expect(url.pathname).toBe("/dashboard/checkout")
    expect(url.searchParams.get("plan")).toBe("plus")
    expect(url.searchParams.get("promo")).toBe("BESTPLANFREEXY1")
  })
})

describe("normalizePromo", () => {
  it("keeps only what a code is made of, and caps its length", () => {
    expect(normalizePromo("  best-code_1 ")).toBe("BEST-CODE_1")
    expect(normalizePromo("x".repeat(200)).length).toBe(64)
  })
})

describe("formatUsd", () => {
  it("keeps cents and drops trailing zeros", () => {
    expect(formatUsd(20)).toBe("$20")
    expect(formatUsd(46.75)).toBe("$46.75")
    expect(formatUsd(35)).toBe("$35")
  })
})

describe("Plans screen", () => {
  it("renders every tier the server priced, with its own features", () => {
    const html = render(overviewWith({}))
    expect(html).toContain("Swatted Premium")
    expect(html).toContain("Swatted Heist")
    expect(html).toContain("1,500 monthly lookups")
    expect(html).toContain("Stealer logs access")
    expect(html).toContain("$20")
    expect(html).toContain("$55")
  })

  it("offers an upgrade as a purchase and never offers the plan already held", () => {
    const html = render(
      overviewWith({
        currentId: "pro",
        tiers: [
          { ...TIERS.free, relation: "default" },
          { ...TIERS.pro, relation: "current" },
          // $55 list, $35 after the Premium credit, exactly as the invoice bills.
          { ...TIERS.plus, yourPriceUsd: 35 },
        ],
      }),
    )
    expect(html).toContain("Get Heist")
    expect(html).not.toContain("Get Premium")
    // The tier already held renders a disabled "Current plan" pill, matching the web.
    expect(html).toContain("Current plan")
    // The credited difference is named rather than shown as a mystery discount.
    expect(html).toContain("$35")
    expect(html).toContain("credited for your current plan")
  })

  it("never offers a downgrade as something to buy", () => {
    const html = render(
      overviewWith({
        currentId: "plus",
        tiers: [
          { ...TIERS.free, relation: "default" },
          { ...TIERS.pro, relation: "downgrade" },
          { ...TIERS.plus, relation: "current" },
        ],
      }),
    )
    expect(html).not.toContain("Get Heist")
    expect(html).not.toContain("Get Premium")
    // A lower tier renders a disabled "Downgrade" pill, never a purchase, matching the web.
    expect(html).toContain("Downgrade")
  })

  it("shows the account discount against the struck-through list price", () => {
    const html = render(
      overviewWith({
        discountPercent: 50,
        tiers: [TIERS.free, { ...TIERS.pro, yourPriceUsd: 10 }, { ...TIERS.plus, yourPriceUsd: 27.5 }],
      }),
    )
    expect(html).toContain("50% off applied")
    expect(html).toContain("$27.50")
    expect(html).toContain("line-through")
  })

  it("says the catalog is missing rather than drawing free tiers", () => {
    const html = render(overviewWith({ tiers: [] }))
    expect(html).toContain("Plan details could not be loaded")
    expect(html).not.toContain("Get Premium")
  })

  it("survives a payload where the plan section is absent entirely", () => {
    // A field read on an absent object throws inside React's render, which in
    // this app is an unrecoverable white window.
    const broken = overviewWith({}) as unknown as Record<string, unknown>
    delete broken.plans
    expect(() => render(broken as unknown as Overview)).not.toThrow()
  })

  it("survives a tier missing every optional field", () => {
    const bare = { id: "pro", relation: "upgrade" } as unknown as PlanTier
    expect(() => render(overviewWith({ tiers: [bare] }))).not.toThrow()
  })

  it("says checkout happens in the browser, because payment is not native here", () => {
    const html = render(overviewWith({}))
    expect(html).toContain("Checkout happens in your browser")
    expect(html).toContain("Refresh plan")
  })

  it("keeps API Access described as a separate add-on, not a tier", () => {
    const html = render(overviewWith({}))
    expect(html).toContain("A separate paid add-on")
  })

  it("uses no em dashes in its copy", () => {
    expect(render(overviewWith({}))).not.toContain("—")
    expect(render(overviewWith({ tiers: [] }))).not.toContain("—")
  })
})
