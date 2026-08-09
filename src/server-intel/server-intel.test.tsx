import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

import { ipc } from "../lib/ipc"
import { BUILT_IN_ROUTES } from "../modules/registry"
import { NAV, isEnabled } from "../shell/nav"
import {
  LIVE_WINDOW_MS,
  NEW_ACCOUNT_DAYS,
  POLL_MS,
  durationLabel,
  filterPlayers,
  flaggedPlayers,
  isLive,
  mintConnector,
  openPlayer,
  readSession,
  relativeTime,
  scannedCount,
  setHighlight,
  setOverlay,
  shortDate,
  toPlayer,
  toSeen,
  toSession,
  unpair,
  type Player,
} from "./api"
import { LivePill, ServerIntel, StaleBanner } from "./ServerIntel"

vi.mock("../lib/ipc", () => ({
  ipc: {
    serverIntel: vi.fn(),
    openExternal: vi.fn(),
    fetchImage: vi.fn(),
    lookup: vi.fn(),
  },
}))

const call = vi.mocked(ipc.serverIntel)

beforeEach(() => {
  call.mockReset()
  vi.mocked(ipc.lookup).mockReset()
  vi.mocked(ipc.openExternal).mockReset()
  vi.mocked(ipc.openExternal).mockResolvedValue(undefined)
})

const rawPlayer = {
  userId: "1234",
  username: "victim",
  displayName: "Victim",
  accountAge: 400,
  scan: "done",
  hits: 3,
  latestHit: "2026-02-09",
  avatarUrl: "/api/desktop/image?u=https%3A%2F%2Ft3.rbxcdn.com%2Fabc",
  presence: "in-game",
  isVerified: true,
  highlighted: false,
  seen: null,
}

const rawSession = {
  paired: true,
  connected: true,
  lastSeen: 1_700_000_000_000,
  firstConnectedAt: 1_699_999_000_000,
  overlay: { highlight: true, esp: false },
  place: { id: "606849621", name: "Jailbreak" },
  server: { id: "job-1", players: 1 },
  players: [rawPlayer],
}

const player = (over: Partial<Player> = {}): Player => ({ ...toPlayer(rawPlayer), ...over })

// ---------------------------------------------------------------------------

describe("Server Intel opens on the web, like the Agent", () => {
  it("is NOT an in-app built-in route", () => {
    expect(BUILT_IN_ROUTES).not.toContain("/roblox/server-intel")
  })

  it("is an external nav link under Roblox pointing at the web dashboard", () => {
    const roblox = NAV.flatMap((g) => g.items).find((i) => i.label === "Roblox")
    const si = roblox?.children?.find((c) => c.label === "Server Intel")
    expect(si?.external).toBe(true)
    expect(si?.href).toContain("swattedw.tf")
  })

  it("does not shadow the other two Roblox leaves", () => {
    expect(isEnabled("/roblox")).toBe(true)
    expect(isEnabled("/roblox/scraper")).toBe(true)
  })
})

describe("payload coercion", () => {
  // The failure this guards is specific: a renderer reading .length or
  // .toLocaleString() on an absent field throws inside React's render, which in
  // this app is a white window with no reachable console.
  it("survives a session payload with nothing in it", () => {
    for (const payload of [undefined, null, {}, "session", 7, []]) {
      const session = toSession(payload)
      expect(session.players).toEqual([])
      expect(session.connected).toBe(false)
      expect(session.overlay).toEqual({ highlight: false, esp: false })
      expect(() => session.players.map((p) => p.displayName)).not.toThrow()
    }
  })

  it("reads a well formed session", () => {
    const session = toSession(rawSession)
    expect(session.connected).toBe(true)
    expect(session.place).toEqual({ id: "606849621", name: "Jailbreak" })
    expect(session.server).toEqual({ id: "job-1", players: 1 })
    expect(session.overlay).toEqual({ highlight: true, esp: false })
    expect(session.players).toHaveLength(1)
  })

  it("keeps a place with no id at all out of the header", () => {
    // An empty object is "the connector did not say", not "a game called
    // nothing". Rendering it would put a blank title on the session panel.
    expect(toSession({ ...rawSession, place: {}, server: {} }).place).toBe(null)
    expect(toSession({ ...rawSession, place: {}, server: {} }).server).toBe(null)
  })

  it("never lets a non-array roster reach .map", () => {
    expect(toSession({ ...rawSession, players: "lots" }).players).toEqual([])
  })

  it("gives every player something to render as a name", () => {
    expect(toPlayer({ userId: "9" }).displayName).toBe("9")
    expect(toPlayer({ userId: "9", username: "bob" }).displayName).toBe("bob")
    expect(toPlayer({}).displayName).toBe("")
  })

  it("treats a scan state it does not know as queued", () => {
    // A state this build cannot render must not become a row that claims to be
    // finished and opens an empty dossier.
    expect(toPlayer({ userId: "9", scan: "reticulating" }).scan).toBe("queued")
    expect(toPlayer({ userId: "9" }).scan).toBe("queued")
    for (const scan of ["pending", "done", "error"]) {
      expect(toPlayer({ userId: "9", scan }).scan).toBe(scan)
    }
  })

  it("keeps an avatar that is not a string out of the DOM", () => {
    expect(toPlayer({ userId: "9", avatarUrl: 7 }).avatarUrl).toBe(null)
    expect(toPlayer({ userId: "9", avatarUrl: "" }).avatarUrl).toBe(null)
  })

  it("reads a prior sighting, or says there was none", () => {
    expect(toSeen(null)).toBe(null)
    expect(toSeen({})).toBe(null)
    // Without a lastSeen there is no sighting to report, and "seen 0 times" on
    // a stranger's row is a claim rather than an absence.
    expect(toSeen({ count: 4 })).toBe(null)
    expect(toSeen({ lastSeen: 10, count: 0, lastPlace: "Jailbreak" })).toEqual({
      firstSeen: 10,
      lastSeen: 10,
      count: 1,
      lastPlace: "Jailbreak",
    })
  })
})

describe("what the roster says", () => {
  it("flags only players carrying rows", () => {
    const players = [player(), player({ userId: "2", hits: 0 })]
    expect(flaggedPlayers(players).map((p) => p.userId)).toEqual(["1234"])
  })

  it("counts what was actually checked, not who is in the server", () => {
    // "No hits" over a roster nobody has been through yet reads as a clean
    // server, which is the one thing this screen must not imply.
    const players = [player(), player({ userId: "2", scan: "queued" }), player({ userId: "3", scan: "error" })]
    expect(scannedCount(players)).toBe(1)
  })

  it("filters on name, handle or id, and never as a regex", () => {
    const players = [player(), player({ userId: "77", username: "other", displayName: "Other" })]
    expect(filterPlayers(players, "vic").map((p) => p.userId)).toEqual(["1234"])
    expect(filterPlayers(players, "OTHER").map((p) => p.userId)).toEqual(["77"])
    expect(filterPlayers(players, "77").map((p) => p.userId)).toEqual(["77"])
    expect(filterPlayers(players, "   ")).toHaveLength(2)
    // A query full of punctuation is a search, not a syntax error.
    expect(() => filterPlayers(players, "(*")).not.toThrow()
    expect(filterPlayers(players, "(*")).toEqual([])
  })
})

describe("live versus idle", () => {
  const lastSeen = 1_700_000_000_000
  const session = toSession({ ...rawSession, lastSeen })

  it("is live while the connector is still checking in", () => {
    expect(isLive(session, lastSeen + 1000)).toBe(true)
  })

  it("goes idle rather than claiming a stale roster is live", () => {
    // The executor was closed or the player left. The roster on screen is the
    // last one we were told about, and saying Live over it would be a lie.
    expect(isLive(session, lastSeen + LIVE_WINDOW_MS + 1)).toBe(false)
  })

  it("is never live without a session or a heartbeat", () => {
    expect(isLive(toSession({ ...rawSession, connected: false }), lastSeen)).toBe(false)
    expect(isLive(toSession({ ...rawSession, lastSeen: null }), lastSeen)).toBe(false)
  })

  it("renders both states with the class vocabulary, not a flat panel", () => {
    const live = renderToStaticMarkup(<LivePill live={true} />)
    expect(live).toContain("glass-tile")
    expect(live).toContain("Live")
    expect(renderToStaticMarkup(<LivePill live={false} />)).toContain("Idle")
  })
})

describe("clocks", () => {
  const now = 1_700_000_000_000

  it("says never rather than inventing a heartbeat", () => {
    expect(relativeTime(null, now)).toBe("never")
    expect(durationLabel(null, now)).toBe("not yet")
  })

  it("counts up in units a person reads", () => {
    expect(relativeTime(now, now)).toBe("just now")
    expect(relativeTime(now - 12_000, now)).toBe("12 seconds ago")
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5 min ago")
    expect(relativeTime(now - 90 * 60_000, now)).toBe("1h 30m ago")
    expect(durationLabel(now - 30_000, now)).toBe("30 seconds")
    expect(durationLabel(now - 45 * 60_000, now)).toBe("45 min")
    expect(durationLabel(now - 3 * 3_600_000, now)).toBe("3h 0m")
  })

  it("never renders a clock as a negative number", () => {
    // The pairing state's stamps come from the server's clock, which can be a
    // little ahead of this machine's.
    expect(relativeTime(now + 5000, now)).toBe("just now")
    expect(durationLabel(now + 5000, now)).toBe("0 seconds")
  })

  it("returns nothing rather than Invalid Date", () => {
    expect(shortDate("")).toBe("")
    expect(shortDate("not a date")).toBe("")
    expect(shortDate("2026-02-09")).toContain("2026")
  })
})

describe("the six calls", () => {
  it("mints a connector and hands back the loadstring", async () => {
    call.mockResolvedValue({ loadstring: 'loadstring(game:HttpGet("https://swattedw.tf/x"))()' })
    expect(await mintConnector()).toContain("loadstring(")
    expect(call).toHaveBeenCalledWith("pair")
  })

  it("returns an empty loadstring rather than undefined on a shape it cannot read", () => {
    call.mockResolvedValue({})
    return expect(mintConnector()).resolves.toBe("")
  })

  it("reads the session out of its envelope", async () => {
    // The route answers `{ session: ... }`, so a coercion that read the
    // envelope itself would render a permanently disconnected screen over a
    // perfectly good session.
    call.mockResolvedValue({ session: rawSession })
    const session = await readSession()
    expect(call).toHaveBeenCalledWith("state")
    expect(session.connected).toBe(true)
    expect(session.players.map((p) => p.userId)).toEqual(["1234"])
  })

  it("reads a missing envelope as a disconnected session, not a crash", async () => {
    call.mockResolvedValue({})
    const session = await readSession()
    expect(session.connected).toBe(false)
    expect(session.players).toEqual([])
  })

  it("unpairs, toggles the overlay and highlights by id", async () => {
    call.mockResolvedValue({ ok: true })
    await unpair()
    expect(call).toHaveBeenCalledWith("unpair")

    call.mockResolvedValue({ ok: true, overlay: { highlight: true, esp: true } })
    expect(await setOverlay({ esp: true })).toEqual({ highlight: true, esp: true })
    expect(call).toHaveBeenCalledWith("overlay", { patch: { esp: true } })

    call.mockResolvedValue({ ok: true, manualHighlight: ["1234", 7] })
    // A non-string id in the list is dropped rather than rendered as a key.
    expect(await setHighlight("1234", true)).toEqual(["1234"])
    expect(call).toHaveBeenCalledWith("highlight", { userId: "1234", on: true })
  })

  it("reports an unfinished dossier as null plus its reason", async () => {
    // An empty dossier and one that is still coming look identical otherwise,
    // and only one of them is worth waiting for.
    call.mockResolvedValue({ dossier: null, scan: "pending" })
    expect(await openPlayer("1234")).toEqual({ dossier: null, scan: "pending" })

    call.mockResolvedValue({ dossier: "nope", scan: "done" })
    expect((await openPlayer("1234")).dossier).toBe(null)

    call.mockResolvedValue({ dossier: { found: true }, scan: "done" })
    expect((await openPlayer("1234")).dossier).toEqual({ found: true })
  })

  it("never routes a session action through the metered lookup command", async () => {
    // Server Intel is a session the screen POLLS. Sending any of it through
    // `lookup` would charge a search every few seconds for watching a screen.
    call.mockResolvedValue({ session: rawSession })
    await readSession()
    await unpair()
    expect(vi.mocked(ipc.lookup)).not.toHaveBeenCalled()
  })
})

describe("the screen renders defensively", () => {
  it("draws before anything has loaded, without a flat panel anywhere", () => {
    call.mockResolvedValue({ session: rawSession })
    const html = renderToStaticMarkup(<ServerIntel />)
    expect(html).toContain("Server Intel")
    // Every surface is the shared glass vocabulary. A hand-rolled dark panel
    // here would be one screen in its own visual language.
    expect(html).toContain("glass")
    expect(html).not.toContain("bg-[#151515]")
  })

  it("uses no em dashes in its copy", () => {
    call.mockResolvedValue({ session: rawSession })
    expect(renderToStaticMarkup(<ServerIntel />)).not.toContain("—")
  })

  it("says a stale roster is stale rather than pretending it refreshed", () => {
    // A dropped poll over a live session keeps the roster and adds this. The
    // roster is real, it is just not necessarily current, and blanking the
    // screen for a blip would make a shaky connection look like a dropped
    // server link.
    const html = renderToStaticMarkup(<StaleBanner message="connection refused" />)
    expect(html).toContain("out of date")
    expect(html).toContain("connection refused")
    expect(html).toContain("glass-tile")
  })

  it("polls no faster than the web page does", () => {
    // The interval is what an unattended app leaves running, so the number is
    // asserted rather than left to a comment.
    expect(POLL_MS).toBe(3000)
    expect(LIVE_WINDOW_MS).toBeGreaterThan(POLL_MS)
    expect(NEW_ACCOUNT_DAYS).toBe(30)
  })
})
