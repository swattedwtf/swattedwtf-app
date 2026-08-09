import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

import { Result, descriptor } from "./discord"

/** What the server sends when every provider answered. */
const full = {
  profile: {
    id: "175928847299117063",
    username: "sujrb",
    displayName: "Su",
    bio: "line one\nline two",
    avatarUrl: "/api/desktop/image?u=https%3A%2F%2Fcdn.discordapp.com%2Fa.png",
    bannerUrl: null,
    accentColor: "#0000ff",
    createdAt: "2016-04-30T11:18:25.796Z",
  },
  badges: [{ label: "Staff", iconUrl: null }],
  connections: [{ type: "github", name: "sujrb", url: "https://github.com/sujrb" }],
  servers: [{ id: "9", name: "Guild", iconUrl: null, members: 4210 }],
  usernameHistory: [{ username: "old", date: "2020-01-01" }],
  historyUnavailable: false,
  breaches: [{ email: "a@b.c", username: "sujrb" }],
  moderation: [],
  stealerLogs: [{ log_id: "L1", pwned_at: "2024-02-02" }],
  stealerLocked: false,
  alts: ["222"],
  vpnAttempts: 3,
  messages: { total: 12, items: [] },
}

/**
 * The same shape with every optional field absent. Partial provider data is the
 * normal case here, not an edge case, so this is the one that matters.
 */
const sparse = {
  profile: {
    id: "",
    username: "",
    displayName: "",
    bio: "",
    avatarUrl: null,
    bannerUrl: null,
    accentColor: null,
    createdAt: null,
  },
  badges: [],
  connections: [],
  servers: [],
  usernameHistory: [],
  historyUnavailable: false,
  breaches: [],
  moderation: [],
  stealerLogs: [],
  stealerLocked: false,
  alts: [],
  vpnAttempts: 0,
  messages: { total: 0, items: [] },
}

const render = (data: unknown, partial: string[] = []) =>
  renderToStaticMarkup(<Result data={data} partial={partial} />)

describe("Discord result", () => {
  it("renders the identity, badges, servers and breaches", () => {
    const html = render(full)
    expect(html).toContain("Su")
    expect(html).toContain("@sujrb")
    expect(html).toContain("175928847299117063")
    expect(html).toContain("Staff")
    expect(html).toContain("Guild")
    expect(html).toContain("4,210 members")
    expect(html).toContain("a@b.c")
    expect(html).toContain("Breaches (1)")
  })

  it("renders a sparse payload without throwing, hiding empty sections", () => {
    // Hide-empty: sections with no results are omitted entirely rather than
    // shown as an empty-state card. The profile still renders.
    const html = render(sparse)
    expect(html).not.toContain("No linked accounts.")
    expect(html).not.toContain("No servers found.")
    expect(html).not.toContain("No breach records found.")
    expect(html).toContain("Unknown")
  })

  it("says a history is unavailable rather than saying there is none", () => {
    // Different claims. The provider behind this is frequently down, and
    // reporting "no previous usernames" when we could not ask is a statement we
    // have no basis for.
    const html = render({ ...full, usernameHistory: null, historyUnavailable: true })
    expect(html).toContain("Username history is unavailable right now.")
    expect(html).not.toContain("No previous usernames recorded.")
  })

  it("hides username history when the provider answered and had none", () => {
    // Hide-empty: a clean checked-and-empty history is omitted, not shown as an
    // empty-state card. "Unavailable" (a failure) is still shown - see above.
    const html = render({ ...full, usernameHistory: [], historyUnavailable: false })
    expect(html).not.toContain("No previous usernames recorded.")
    expect(html).not.toContain("unavailable")
  })

  it("shows a locked section, not an empty one, when the plan gates it", () => {
    // The server returns an empty list with a 200 for accounts below Heist, so
    // without the flag this would read as "we checked and found nothing".
    const html = render({ ...full, stealerLogs: [], stealerLocked: true })
    expect(html).toContain("Heist")
    expect(html).not.toContain("No compromised devices found.")
  })

  it("hides the compromised-devices section when Heist is present and there is nothing", () => {
    // Hide-empty: a clean empty (Heist present, provider answered, no rows and
    // no failure flag) is omitted rather than shown as an empty-state card.
    const html = render({ ...full, stealerLogs: [], stealerLocked: false })
    expect(html).not.toContain("No compromised devices found.")
    expect(html).not.toContain("Compromised devices")
  })

  it("leaves naming the failed sources to ResultView, which renders it once", () => {
    // Two lists meaning "this section is missing", in two vocabularies, was the
    // same fact told twice. ResultView owns the single rendering, so a module
    // that adds its own is the bug.
    const html = render(full, ["oath", "messages"])
    expect(html).not.toContain("Some sources did not answer")
    expect(html).not.toContain("Some sections did not load")
  })

  it("renders a connection with no URL as plain text, not a dead link", () => {
    // The server nulls any link that is not http(s), so this is the shape a
    // stripped javascript: URL arrives in.
    const html = render({
      ...full,
      connections: [{ type: "steam", name: "someone", url: null }],
    })
    expect(html).toContain("someone")
    expect(html).not.toContain("<button")
  })

  it("uses no em dashes in its own copy", () => {
    expect(render(sparse)).not.toContain("—")
  })
})

describe("Discord descriptor", () => {
  it("accepts a real snowflake and rejects everything else", () => {
    const check = descriptor.inputs[0].validate
    expect(check("175928847299117063")).toBeNull()
    expect(check("  175928847299117063  ")).toBeNull()
    for (const bad of ["", "12", "12345678901234567890123", "abcdefghijklmno", "1759288472991170a"]) {
      expect(check(bad), `${bad} should be rejected`).toBe(
        "Enter a Discord user ID (14 to 19 digits).",
      )
    }
  })

  it("declares the id the server table expects", () => {
    expect(descriptor.id).toBe("discord")
    expect(descriptor.route).toBe("/discord")
  })
})
