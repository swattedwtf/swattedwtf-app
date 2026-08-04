import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

import type { Overview } from "../lib/ipc"
import { ApiAccess } from "./api-access"

/** A minimal Overview whose only meaningful part here is `api`. */
function overviewWith(api: Partial<Overview["api"]>): Overview {
  return {
    user: { id: "1", userNumber: 1, email: null, handle: "u" },
    telegram: { username: null, linked: false },
    security: { twofaEnabled: false },
    plan: {
      id: "p",
      label: "Plan",
      monthlyLimit: 0,
      since: "",
      balanceCents: 0,
      status: "",
      dailyLimit: null,
    },
    usage: { todayCount: 0, monthCount: 0, allTimeCount: 0, nextResetMs: 0, series: [] },
    api: {
      active: false,
      tierLabel: null,
      usedToday: 0,
      dailyLimit: null,
      expiresAt: null,
      key: null,
      ...api,
    },
  }
}

const render = (overview: Overview) => renderToStaticMarkup(<ApiAccess overview={overview} />)

describe("API Access screen", () => {
  it("shows the tier, active status and usage from the overview", () => {
    const html = render(
      overviewWith({
        active: true,
        tierLabel: "Pro",
        usedToday: 42,
        dailyLimit: 1000,
        expiresAt: "2025-01-01T00:00:00Z",
        key: "sk_live_secretvalue_1234",
      }),
    )
    expect(html).toContain("API Access")
    expect(html).toContain("Pro")
    expect(html).toContain("Active")
    expect(html).toContain("42")
    expect(html).toContain("1000")
  })

  it("masks the key by default and never renders it in plain sight", () => {
    const key = "sk_live_secretvalue_1234"
    const html = render(overviewWith({ active: true, key }))
    // The credential is not on screen until the user reveals it.
    expect(html).not.toContain(key)
    expect(html).toContain("•")
    // The reveal and copy controls are present.
    expect(html).toContain("Reveal")
    expect(html).toContain("Copy")
  })

  it("says API access is not enabled when there is no key", () => {
    const html = render(overviewWith({ active: false, key: null }))
    expect(html).toContain("API access is not enabled on this account.")
  })

  it("distinguishes an active account with no key yet", () => {
    const html = render(overviewWith({ active: true, key: null }))
    expect(html).toContain("No key is provisioned on this account yet.")
  })

  it("reads unlimited when no daily limit is set", () => {
    const html = render(overviewWith({ active: true, dailyLimit: null }))
    expect(html).toContain("Unlimited")
  })

  it("does not throw when the api section is absent", () => {
    // A defensive path: the boot payload should always carry `api`, but a field
    // read on an absent object would white-window the app.
    expect(() => renderToStaticMarkup(<ApiAccess overview={{} as Overview} />)).not.toThrow()
  })

  it("uses no em dashes in its copy", () => {
    expect(render(overviewWith({ active: true, key: "k" }))).not.toContain("—")
  })
})
