import { describe, expect, it, vi } from "vitest"
import type { ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { searchDescriptor } from "./search"
import { liveIntelligenceDescriptor } from "./live-intelligence"
import { StreamScreen } from "../StreamScreen"
import { STREAM_MODULES, streamModuleForRoute, streamRoutes } from "../stream-registry"
import type { StreamFrame, StreamResultProps } from "../stream-types"
import { flattenNav } from "../../shell/nav"

vi.mock("../../lib/ipc", () => ({
  ipc: { openExternal: vi.fn(), fetchImage: vi.fn() },
  startStream: vi.fn(),
}))

/** Render a descriptor's Result to static HTML for assertion. */
function renderResult(
  descriptor: { Result: (p: StreamResultProps) => unknown },
  frames: StreamFrame[],
  status: StreamResultProps["status"],
  error: string | null = null,
): string {
  return renderToStaticMarkup(
    (descriptor.Result as (p: StreamResultProps) => ReactElement)({ frames, status, error }),
  )
}

describe("stream registry and nav stay in sync", () => {
  it("every streaming route exists in the nav tree", () => {
    const routes = new Set(flattenNav().map((i) => i.href))
    for (const r of streamRoutes()) expect(routes.has(r), `${r} missing from NAV`).toBe(true)
  })

  it("resolves a streaming module by its exact route only", () => {
    expect(streamModuleForRoute("/search")).toBe(searchDescriptor)
    expect(streamModuleForRoute("/live-intelligence")).toBe(liveIntelligenceDescriptor)
    expect(streamModuleForRoute("/search/evil")).toBeUndefined()
    expect(streamModuleForRoute("/dashboard")).toBeUndefined()
  })

  it("gives every streaming module a unique id and route", () => {
    expect(new Set(STREAM_MODULES.map((m) => m.id)).size).toBe(STREAM_MODULES.length)
    expect(new Set(STREAM_MODULES.map((m) => m.route)).size).toBe(STREAM_MODULES.length)
  })

  it("uses no em dashes in any user-facing copy", () => {
    for (const m of STREAM_MODULES) {
      const copy = [
        m.label,
        ...(m.modes?.map((mode) => mode.label) ?? []),
        ...m.inputs.flatMap((i) => [i.label, i.placeholder]),
      ]
      expect(copy.filter((c) => c.includes("—"))).toEqual([])
    }
  })
})

describe("StreamScreen renders each descriptor's form at rest", () => {
  it("draws the Search heading and its three mode toggles", () => {
    const html = renderToStaticMarkup(<StreamScreen descriptor={searchDescriptor} />)
    expect(html).toContain("Search")
    expect(html).toContain("Email")
    expect(html).toContain("Username")
    expect(html).toContain("Domain")
    // Nothing has run, so no result body yet.
    expect(html).not.toContain("Sweep summary")
  })

  it("draws the Live Intelligence form with no mode toggle", () => {
    const html = renderToStaticMarkup(<StreamScreen descriptor={liveIntelligenceDescriptor} />)
    expect(html).toContain("Live Intelligence")
    expect(html).toContain("target@example.com")
  })
})

describe("Search resolve picks the right metered module per mode", () => {
  it("routes an email to search-email", () => {
    expect(searchDescriptor.resolve({ query: "User@Example.com" }, "email")).toEqual({
      module: "search-email",
      input: { query: "User@Example.com" },
    })
  })

  it("routes a username to search-username and a domain to search-domain", () => {
    expect(searchDescriptor.resolve({ query: "@bob_99" }, "username")).toEqual({
      module: "search-username",
      input: { query: "@bob_99" },
    })
    expect(searchDescriptor.resolve({ query: "example.com" }, "domain")).toEqual({
      module: "search-domain",
      input: { query: "example.com" },
    })
  })

  it("rejects an input the client can already tell is wrong, before any request", () => {
    expect(searchDescriptor.resolve({ query: "not an email" }, "email")).toHaveProperty("error")
    expect(searchDescriptor.resolve({ query: "a" }, "username")).toHaveProperty("error")
    expect(searchDescriptor.resolve({ query: "nope" }, "domain")).toHaveProperty("error")
    expect(searchDescriptor.resolve({ query: "" }, "email")).toHaveProperty("error")
  })
})

describe("Live Intelligence resolve", () => {
  it("lowercases and routes a valid email to the live-intelligence module", () => {
    expect(liveIntelligenceDescriptor.resolve({ email: "Victim@Example.com" }, null)).toEqual({
      module: "live-intelligence",
      input: { email: "victim@example.com" },
    })
  })

  it("rejects a non-email before any request", () => {
    expect(liveIntelligenceDescriptor.resolve({ email: "nope" }, null)).toHaveProperty("error")
  })
})

describe("SearchResult renders progressively and coerces safely", () => {
  const frames: StreamFrame[] = [
    {
      t: "progress",
      checked: 1,
      total: 4,
      hits: 1,
      records: [
        { id: "1", source: "LeakDB", fields: [{ label: "Email", value: "a@b.co", sensitive: false }] },
      ],
    },
    { t: "done", stats: { modulesQueried: 4, modulesHit: 1, records: 1, durationMs: 10 } },
  ]

  it("renders each source and its fields as they arrive", () => {
    const html = renderResult(searchDescriptor, frames, "done")
    // The source and its value, drawn as a record card.
    expect(html).toContain("LeakDB")
    expect(html).toContain("a@b.co")
    // And the summary tiles that open the result. The record count is derived
    // from the fixture, not a hardcoded copy string.
    expect(html).toContain("Breach and leak records")
    const recordCount = frames
      .filter((f) => f.t === "progress")
      .reduce((n, f) => n + (Array.isArray(f.records) ? f.records.length : 0), 0)
    expect(html).toContain(`>${recordCount}<`)
  })

  it("shows an explicit no-results state when a completed sweep found nothing", () => {
    const html = renderResult(searchDescriptor, [{ t: "done", stats: {} }], "done")
    expect(html).toContain("No records found")
  })

  it("does not read a completed-empty state as 'nothing found' when the stream FAILED", () => {
    // The distinction the review demanded: an errored sweep must never render as
    // one that finished with nothing.
    const html = renderResult(searchDescriptor, [{ t: "progress", checked: 1, total: 4, hits: 0 }], "error")
    expect(html).not.toContain("No records found")
    expect(html).toContain("stopped before finishing")
  })

  it("does not throw on a sparse frame missing its fields or records", () => {
    expect(() =>
      renderResult(
        searchDescriptor,
        [{ t: "progress" }, { t: "progress", records: [{ source: "X" }] }],
        "streaming",
      ),
    ).not.toThrow()
  })
})

describe("LiveIntelResult renders only hits and coerces safely", () => {
  const frames: StreamFrame[] = [
    { t: "start", total: 3 },
    { t: "progress", checked: 1, total: 3, hits: 0, card: null },
    {
      t: "progress",
      checked: 2,
      total: 3,
      hits: 1,
      card: { key: "spotify", provider: "Spotify", title: "Jane", fields: [{ label: "Plan", value: "Premium" }] },
    },
    { t: "done", stats: { checked: 3, total: 3, hits: 1 } },
  ]

  it("renders a hit card but not a checked-but-no-hit source", () => {
    const html = renderResult(liveIntelligenceDescriptor, frames, "done")
    expect(html).toContain("Spotify")
    expect(html).toContain("Premium")
    expect(html).toContain("Jane")
  })

  it("shows a no-accounts state only on a clean completion", () => {
    const done = renderResult(liveIntelligenceDescriptor, [{ t: "done", stats: {} }], "done")
    expect(done).toContain("No accounts surfaced")
    const errored = renderResult(liveIntelligenceDescriptor, [{ t: "start", total: 3 }], "error")
    expect(errored).not.toContain("No accounts surfaced")
    expect(errored).toContain("stopped before finishing")
  })

  it("does not throw on a card missing its fields", () => {
    expect(() =>
      renderResult(
        liveIntelligenceDescriptor,
        [{ t: "progress", checked: 1, total: 1, hits: 1, card: { provider: "X" } }],
        "done",
      ),
    ).not.toThrow()
  })
})
