import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

import { Result, ScraperResult, descriptor, scraperDescriptor } from "./roblox"

// ---------------------------------------------------------------------------
// Profile leaf
// ---------------------------------------------------------------------------

/** What the server sends when a user resolves and the plan is Heist. */
const full = {
  query: "builderman",
  found: true,
  profile: {
    id: "156",
    username: "builderman",
    displayName: "builderman",
    avatarUrl: "/api/desktop/image?u=avatar.png",
    profileUrl: "https://www.roblox.com/users/156/profile",
    status: "online",
    isVerified: true,
    isPremium: true,
    joined: "2006-02-27",
    description: "Welcome to Roblox.",
  },
  stats: { friends: 12, followers: 3400000, following: 5 },
  groups: [
    { id: "7", name: "The Robloxians", role: "Owner", members: 1200, rank: 255, iconUrl: null },
  ],
  badges: [
    { id: "1", name: "Administrator", description: "A Roblox admin", awarded: "2008-01-01", rare: true },
  ],
  favorites: [
    { id: "9", name: "Crossroads", creator: "Roblox", visits: 9000000, thumbnailUrl: null },
  ],
  usernameHistory: [{ username: "oldbuilder", changedAt: "2007-05-05" }],
  linkedDiscord: { id: "175928847299117063", avatarUrl: null },
  stealer: {
    stealerEntries: [
      {
        id: "e1",
        log_id: "L1",
        url: "android://com.roblox.client",
        link: null,
        domain: ["roblox.com"],
        username: "victim",
        password: "hunter2",
        indexed_at: "2024-02-02",
      },
      {
        id: "e2",
        log_id: "L2",
        url: "https://roblox.com/login",
        link: "https://roblox.com/login",
        domain: ["roblox.com"],
        username: "victim2",
        password: "swordfish",
        indexed_at: "2024-03-03",
      },
    ],
    victims: [
      {
        log_id: "L1",
        machine_grant: "DESKTOP-1",
        device_user_str: ["admin"],
        device_ips: ["1.2.3.4"],
        device_emails_str: ["a@b.c"],
        discord_ids: ["1"],
        total_docs: 42,
        pwned_at: "2024-01-01",
        indexed_at: "2024-01-02",
      },
    ],
    breaches: [
      {
        id: "b1",
        email: "a@b.c",
        username: "victim",
        password: "hunter2",
        password_hash: "",
        full_name: "A B",
        phone_number: "555",
        ip: "1.2.3.4",
        dbname: "somedb",
        indexed_at: "2024-01-01",
      },
    ],
  },
  stealerLocked: false,
}

/** The same shape with every optional field absent, and no user resolved. */
const sparse = {
  query: "nobody",
  found: false,
  profile: {
    id: "",
    username: "",
    displayName: "",
    avatarUrl: null,
    profileUrl: null,
    status: "offline",
    isVerified: false,
    isPremium: false,
    joined: "",
    description: "",
  },
  stats: { friends: 0, followers: 0, following: 0 },
  groups: [],
  badges: [],
  favorites: [],
  usernameHistory: [],
  linkedDiscord: null,
  stealer: { stealerEntries: [], victims: [], breaches: [] },
  stealerLocked: false,
}

const render = (data: unknown, partial: string[] = []) =>
  renderToStaticMarkup(<Result data={data} partial={partial} />)

describe("Roblox stealer victim coercion", () => {
  // A victim row missing device_user_str used to reach `.join(", ")` and throw
  // in render, white-windowing the whole app. Each element is coerced now.
  const withBrokenVictim = {
    ...full,
    stealer: {
      stealerEntries: [],
      breaches: [],
      victims: [
        // Every string-array field absent or the wrong type, plus a null row.
        { log_id: "L1" },
        { log_id: "L2", device_user_str: null, device_ips: "not-an-array", total_docs: "x" },
        null,
      ],
    },
  }

  it("does not throw on a victim with missing or mistyped fields", () => {
    expect(() => render(withBrokenVictim)).not.toThrow()
  })

  it("still renders the coerced victim's log id as a fallback", () => {
    const html = render(withBrokenVictim)
    expect(html).toContain("L1")
  })
})

describe("Roblox profile result", () => {
  it("renders the identity, stats, groups, badges and favorites", () => {
    const html = render(full)
    expect(html).toContain("builderman")
    expect(html).toContain("@builderman")
    expect(html).toContain("156")
    expect(html).toContain("Verified")
    expect(html).toContain("Premium")
    expect(html).toContain("3,400,000")
    expect(html).toContain("The Robloxians")
    expect(html).toContain("Administrator")
    expect(html).toContain("Crossroads")
    expect(html).toContain("oldbuilder")
    expect(html).toContain("Open profile")
  })

  it("shows an empty state, not a card, when no user resolves", () => {
    const html = render(sparse)
    expect(html).toContain("No Roblox account resolves from")
    expect(html).not.toContain("Open profile")
  })

  it("renders every section without throwing on a resolved-but-empty user", () => {
    const emptyFound = { ...sparse, found: true, profile: { ...sparse.profile, username: "x" } }
    const html = render(emptyFound)
    expect(html).toContain("No groups found.")
    expect(html).toContain("No badges found.")
    expect(html).toContain("No favorite games found.")
    expect(html).toContain("No previous usernames recorded.")
  })

  it("shows a locked section, not empty states, when the plan gates the stealer block", () => {
    // The server returns the whole block empty with a 200 below Heist, so without
    // the flag this would read as "we checked and found nothing".
    const html = render({
      ...full,
      stealer: { stealerEntries: [], victims: [], breaches: [] },
      stealerLocked: true,
    })
    expect(html).toContain("Heist")
    expect(html).not.toContain("No compromised accounts found.")
    expect(html).not.toContain("No compromised devices found.")
    expect(html).not.toContain("No breach records found.")
  })

  it("shows empty states, not a lock, when Heist is present and there is nothing", () => {
    const html = render({
      ...full,
      stealer: { stealerEntries: [], victims: [], breaches: [] },
      stealerLocked: false,
    })
    expect(html).toContain("No compromised accounts found.")
    expect(html).toContain("No compromised devices found.")
    expect(html).toContain("No breach records found.")
    expect(html).not.toContain("Heist")
  })

  it("renders a stealer URL with no safe link as plain text, not a dead anchor", () => {
    // The android:// entry has link: null, so its URL must show as text with no
    // button; the http entry keeps its button.
    const html = render(full)
    expect(html).toContain("android://com.roblox.client")
    // The one stripped-link entry is the android one; its URL appears outside a
    // button. The http entry is the only button-wrapped stealer URL.
    expect(html.match(/https:\/\/roblox\.com\/login/g)?.length).toBeGreaterThan(0)
  })

  it("says the lookup failed, not that the account does not exist, on a failure", () => {
    // The server splits a 404 (a complete answer) from every other non-2xx (a
    // provider failure named "lookup"). Discarding that turned a Roblox outage
    // into "this account does not exist", which is false about a real person.
    const html = render(sparse, ["lookup"])
    expect(html).toContain("did not complete")
    expect(html).toContain("cannot say whether that account exists")
    expect(html).not.toContain("No Roblox account resolves from")
  })

  it("still says not found when the lookup succeeded and found nothing", () => {
    const html = render(sparse, [])
    expect(html).toContain("No Roblox account resolves from")
    expect(html).toContain("nobody")
    expect(html).not.toContain("did not complete")
  })

  it("does not render partial a second time, since ResultView already names it", () => {
    // Two lists meaning "this section is missing", in two vocabularies, was the
    // same fact told twice. ResultView owns the one rendering.
    expect(render(full, ["lookup"])).not.toContain("Some sources did not answer")
    expect(render(full, ["lookup"])).not.toContain("Some sections did not load")
  })

  it("uses no em dashes in its own copy", () => {
    expect(render(sparse)).not.toContain("—")
    expect(render(sparse, ["lookup"])).not.toContain("—")
    expect(render(full)).not.toContain("—")
  })
})

// ---------------------------------------------------------------------------
// Scraper leaf
// ---------------------------------------------------------------------------

const scrapeFull = {
  entries: [
    {
      userId: 1234,
      username: "adminbot",
      displayName: "Admin Bot",
      verified: true,
      deleted: false,
      status: "online",
      profileUrl: "https://www.roblox.com/users/1234/profile",
    },
  ],
  scanned: 1000,
  matched: 1,
  capped: false,
}

const scrapeSparse = { entries: [], scanned: 0, matched: 0, capped: false }

const renderScrape = (data: unknown, partial: string[] = []) =>
  renderToStaticMarkup(<ScraperResult data={data} partial={partial} />)

describe("Roblox scraper result", () => {
  it("renders the counts and each matched account", () => {
    const html = renderScrape(scrapeFull)
    expect(html).toContain("1,000")
    expect(html).toContain("adminbot")
    expect(html).toContain("Admin Bot")
    expect(html).toContain("Open")
  })

  it("surfaces a capped scan rather than presenting a truncated run as complete", () => {
    const html = renderScrape({ ...scrapeFull, capped: true })
    expect(html).toContain("truncated")
  })

  it("does not claim truncation on a complete scan", () => {
    const html = renderScrape(scrapeFull)
    expect(html).not.toContain("truncated")
  })

  it("never presents an uncapped run as a proven complete pass", () => {
    // `capped` covers only the 25,000-ID scan cap. The 95s time budget and the
    // 10,000-row result cap also truncate a run and report nothing at all, so
    // the screen says what the only trustworthy number is instead of implying
    // the whole requested range was visited.
    const html = renderScrape(scrapeFull)
    expect(html).toContain("stop early")
    expect(html).toContain("IDs visited")
  })

  it("distinguishes the live-match count from the number of rows returned", () => {
    // `matched` counts LIVE accounts; `entries` also carries the deleted IDs
    // when showDeleted was on. Two different numbers under near-identical
    // labels ("Matched: N" beside "Matches (M)") read as one number disagreeing
    // with itself.
    const html = renderScrape({
      ...scrapeFull,
      matched: 1,
      entries: [
        ...scrapeFull.entries,
        {
          userId: 1235,
          username: "",
          displayName: "",
          verified: false,
          deleted: true,
          status: "",
          profileUrl: null,
        },
      ],
    })
    expect(html).toContain("Live accounts matched")
    expect(html).toContain("Rows returned (2)")
    expect(html).not.toContain(">Matched<")
    expect(html).not.toContain("Matches (2)")
  })

  it("says the scan failed rather than reporting an empty range", () => {
    // The server names a scan that threw or blew its budget as "scrape" and
    // hands back zeroed counts. Rendering those said the range was empty.
    const html = renderScrape(scrapeSparse, ["scrape"])
    expect(html).toContain("did not complete")
    expect(html).not.toContain("No accounts matched")
    expect(html).not.toContain("Live accounts matched")
  })

  it("shows an empty state when the scan ran and nothing matched", () => {
    const html = renderScrape(scrapeSparse)
    expect(html).toContain("No accounts matched")
    expect(html).not.toContain("did not complete")
  })

  it("does not render partial a second time, since ResultView already names it", () => {
    expect(renderScrape(scrapeFull, ["scrape"])).not.toContain("Some sources did not answer")
  })

  it("uses no em dashes in its own copy", () => {
    expect(renderScrape(scrapeSparse)).not.toContain("—")
    expect(renderScrape(scrapeSparse, ["scrape"])).not.toContain("—")
    expect(renderScrape(scrapeFull)).not.toContain("—")
  })
})

// ---------------------------------------------------------------------------
// Descriptors
// ---------------------------------------------------------------------------

describe("Roblox descriptor", () => {
  it("declares the id and route the server and nav expect", () => {
    expect(descriptor.id).toBe("roblox")
    expect(descriptor.route).toBe("/roblox")
  })

  it("accepts a username or id and rejects blank and over-long queries", () => {
    const check = descriptor.inputs[0].validate
    expect(check("builderman")).toBeNull()
    expect(check("156")).toBeNull()
    expect(check("")).toBeTruthy()
    expect(check("   ")).toBeTruthy()
    expect(check("x".repeat(81))).toBeTruthy()
  })
})

describe("Roblox scraper descriptor", () => {
  it("declares the id and route the server and nav expect", () => {
    expect(scraperDescriptor.id).toBe("roblox-scraper")
    expect(scraperDescriptor.route).toBe("/roblox/scraper")
  })

  it("declares all seven scraper fields", () => {
    const names = scraperDescriptor.inputs.map((f) => f.name)
    expect(names).toEqual([
      "startId",
      "amount",
      "keywords",
      "startsWith",
      "endsWith",
      "exactLength",
      "showDeleted",
      "showStatus",
    ])
  })

  const field = (name: string) => {
    const f = scraperDescriptor.inputs.find((x) => x.name === name)
    if (!f) throw new Error(`no field ${name}`)
    return f.validate
  }

  it("rejects blank only where blank is not a legitimate answer", () => {
    // startId and amount define the scan and cannot be guessed. The six filters
    // are optional server-side, and forcing a value on them would be UX
    // invented by a test rather than by the product.
    for (const f of scraperDescriptor.inputs) {
      if (f.optional) {
        expect(f.validate(""), `${f.name} should accept blank`).toBeNull()
      } else {
        expect(f.validate(""), `${f.name} should reject blank`).toBeTruthy()
      }
    }
    expect(scraperDescriptor.inputs.filter((f) => f.optional).map((f) => f.name)).toEqual([
      "keywords",
      "startsWith",
      "endsWith",
      "exactLength",
      "showDeleted",
      "showStatus",
    ])
  })

  it("mirrors the server bounds on startId", () => {
    const check = field("startId")
    expect(check("1")).toBeNull()
    expect(check("999999999")).toBeNull()
    expect(check("0")).toBeTruthy()
    expect(check("-5")).toBeTruthy()
    expect(check("abc")).toBeTruthy()
    expect(check("1e3")).toBeTruthy()
  })

  it("mirrors the server bounds on amount, including the 1,000,000 ceiling", () => {
    const check = field("amount")
    expect(check("1")).toBeNull()
    expect(check("1000")).toBeNull()
    expect(check("1000000")).toBeNull()
    expect(check("0")).toBeTruthy()
    expect(check("1000001")).toBeTruthy()
  })

  it("accepts a number or blank for exactLength, and rejects non-numbers", () => {
    const f = scraperDescriptor.inputs.find((i) => i.name === "exactLength")!
    expect(f.validate("")).toBeNull()
    expect(f.validate("0")).toBeNull()
    expect(f.validate("12")).toBeNull()
    expect(f.validate("abc")).toBeTruthy()
    expect(f.validate("1.5")).toBeTruthy()
  })

  it('accepts blank or the literal "true" or "false" for the toggles', () => {
    for (const name of ["showDeleted", "showStatus"]) {
      const check = field(name)
      expect(check("true")).toBeNull()
      expect(check("false")).toBeNull()
      expect(check("yes")).toBeTruthy()
      expect(check("1")).toBeTruthy()
      // Blank means the server's own default, which is false. Demanding a
      // literal here would make an optional toggle behave like a required one.
      expect(check("")).toBeNull()
    }
  })

  it("bounds the text filters but allows them to be left out", () => {
    for (const [name, max] of [["keywords", 512], ["startsWith", 64], ["endsWith", 64]] as const) {
      const f = scraperDescriptor.inputs.find((i) => i.name === name)!
      expect(f.validate("")).toBeNull()
      expect(f.validate("x")).toBeNull()
      expect(f.validate("x".repeat(max))).toBeNull()
      expect(f.validate("x".repeat(max + 1))).toBeTruthy()
    }
  })
})
