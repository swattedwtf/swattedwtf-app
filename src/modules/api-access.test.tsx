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
  it("says plainly that this is a separate add-on when it is not subscribed", () => {
    // It used to render "Status: Inactive" over an empty key box, which reads
    // as a broken feature rather than as one that has not been bought.
    const html = renderToStaticMarkup(<ApiAccess overview={overviewWith({ active: false })} />)
    expect(html).toContain("separate add-on")
    expect(html).toContain("not part of any plan")
    expect(html).toContain("Get API Access")
    // The tier list, so the price is visible without leaving the app.
    expect(html).toContain("1,000 / day")
    expect(html).toContain("Unlimited")
  })

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
    // Thousands-separated, like every other count in the app.
    expect(html).toContain("1,000")
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

  it("does not offer a key box at all when the add-on is not bought", () => {
    const html = renderToStaticMarkup(<ApiAccess overview={overviewWith({ active: false, key: null })} />)
    expect(html).not.toContain("Reveal")
    expect(html).toContain("Read the docs")
  })

  it("distinguishes an active account with no key yet", () => {
    // Subscribed but keyless is a real state and must not repeat the
    // not-subscribed pitch.
    const html = renderToStaticMarkup(
      <ApiAccess overview={overviewWith({ active: true, key: null, tierLabel: "1,000 / day" })} />,
    )
    expect(html).toContain("No key has been generated")
    expect(html).not.toContain("separate add-on")
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
