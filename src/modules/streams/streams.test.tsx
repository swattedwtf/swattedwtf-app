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

/**
 * Render a descriptor's Result to static HTML for assertion. Rendered as an
 * ELEMENT, not called as a plain function, because a Result may hold state (the
 * Search result carries filter and investigation tabs), and that is exactly how
 * StreamScreen mounts it.
 */
function renderResult(
  descriptor: { Result: (p: StreamResultProps) => unknown },
  frames: StreamFrame[],
  status: StreamResultProps["status"],
  error: string | null = null,
): string {
  const Result = descriptor.Result as (p: StreamResultProps) => ReactElement
  return renderToStaticMarkup(<Result frames={frames} status={status} error={error} />)
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

  it("draws the Live Intelligence form with its Email and Phone tabs", () => {
    const html = renderToStaticMarkup(<StreamScreen descriptor={liveIntelligenceDescriptor} />)
    expect(html).toContain("Live Intelligence")
    // The two tabs, mirroring the web page.
    expect(html).toContain("Email")
    expect(html).toContain("Phone")
    expect(html).toContain("target@example.com")
    // Nothing has run, so no result body yet.
    expect(html).not.toContain("Sweep summary")
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

describe("Live Intelligence resolve picks the right sweep per tab", () => {
  it("lowercases and routes a valid email to the live-intelligence module (default tab)", () => {
    expect(liveIntelligenceDescriptor.resolve({ query: "Victim@Example.com" }, "email")).toEqual({
      module: "live-intelligence",
      input: { email: "victim@example.com" },
    })
    // A null mode falls back to the email tab, the default.
    expect(liveIntelligenceDescriptor.resolve({ query: "Victim@Example.com" }, null)).toEqual({
      module: "live-intelligence",
      input: { email: "victim@example.com" },
    })
  })

  it("canonicalises a phone to E.164 and routes it to the phone-intelligence module", () => {
    // Several free-form shapes, all of which the server's normalizePhone accepts,
    // collapse to the identical E.164 the server meters on.
    for (const raw of ["+49 176 84100605", "0049-176-84100605", "+4917684100605"]) {
      expect(liveIntelligenceDescriptor.resolve({ query: raw }, "phone")).toEqual({
        module: "phone-intelligence",
        input: { phone: "+4917684100605" },
      })
    }
  })

  it("rejects a bad value for the selected tab before any request", () => {
    expect(liveIntelligenceDescriptor.resolve({ query: "nope" }, "email")).toHaveProperty("error")
    // A bare national number has no country context; the phone tab refuses it.
    expect(liveIntelligenceDescriptor.resolve({ query: "17684100605" }, "phone")).toHaveProperty(
      "error",
    )
    expect(liveIntelligenceDescriptor.resolve({ query: "" }, "phone")).toHaveProperty("error")
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

  it("collapses existence-only hits into the registered-services summary, richer ones stay cards", () => {
    const mixed: StreamFrame[] = [
      { t: "start", total: 3 },
      {
        t: "progress",
        checked: 1,
        total: 3,
        hits: 1,
        card: { key: "netflix", provider: "Netflix", existenceOnly: true, fields: [] },
      },
      {
        t: "progress",
        checked: 2,
        total: 3,
        hits: 2,
        card: { key: "spotify", provider: "Spotify", title: "Jane", fields: [{ label: "Plan", value: "Premium" }] },
      },
      { t: "done", stats: { checked: 3, total: 3, hits: 2 } },
    ]
    const html = renderResult(liveIntelligenceDescriptor, mixed, "done")
    // Existence-only Netflix is a pill under the registered-services summary.
    expect(html).toContain("Registered services")
    expect(html).toContain("Netflix")
    // Spotify carried profile detail, so it keeps its own card.
    expect(html).toContain("Spotify")
    expect(html).toContain("Premium")
  })
})

describe("Search folds in the enrichment frames the web fans out to", () => {
  // One breach record so the base result renders; each test adds the enrichment
  // frame under test beside it.
  const recordFrame: StreamFrame = {
    t: "progress",
    checked: 1,
    total: 1,
    hits: 1,
    records: [
      {
        id: "1",
        source: "LeakDB",
        fields: [
          { label: "EMAIL", value: "a@b.co", sensitive: false },
          { label: "PASSWORD", value: "hunter2", sensitive: true },
        ],
      },
    ],
  }

  const investigationFrame: StreamFrame = {
    t: "investigation",
    data: {
      query: "a@b.co",
      credentials: {
        items: [{ domain: "example.com", username: "bob", password: "s3cret", source_type: "combo" }],
        total: 1,
      },
      victims: { items: [], total: 0 },
      evidence: { items: [], total: 0 },
      files: { items: [], total: 0 },
      relatedCredentials: { items: [], total: 0 },
    },
  }

  const hudsonFrame: StreamFrame = {
    t: "hudsonrock",
    infections: [
      {
        id: "h1",
        stealerFamily: "RedLine",
        dateCompromised: "2024-01-02",
        computerName: "VICTIM-PC",
        credentialsCount: 5,
        clientCount: 2,
        antiviruses: ["Defender"],
      },
    ],
  }

  const domainFrame: StreamFrame = {
    t: "domain-intel",
    data: {
      domain: "evil-domain.test",
      riskScore: 82,
      riskLevel: "high",
      riskFactors: [{ name: "young_domain", score: 8, maxScore: 10, detail: "registered recently" }],
      subdomains: ["mail.evil-domain.test"],
      thcRecords: [],
      endpoints: [],
      whois: { registrar: "TestRegistrar" },
    },
  }

  it("renders the unified investigation, its default tab reading from the frame", () => {
    const html = renderResult(searchDescriptor, [recordFrame, investigationFrame, { t: "done", stats: {} }], "done")
    const cred = (investigationFrame.data as { credentials: { items: { password: string; domain: string }[] } })
      .credentials.items[0]
    expect(html).toContain("Full investigation")
    // The credentials tab is the default, so its row's values are on screen.
    expect(html).toContain(cred.password)
    expect(html).toContain(cred.domain)
  })

  it("does not render an investigation section when every section is empty", () => {
    const emptyInv: StreamFrame = {
      t: "investigation",
      data: {
        query: "a@b.co",
        credentials: { items: [], total: 0 },
        victims: { items: [], total: 0 },
        evidence: { items: [], total: 0 },
        files: { items: [], total: 0 },
        relatedCredentials: { items: [], total: 0 },
      },
    }
    const html = renderResult(searchDescriptor, [recordFrame, emptyInv, { t: "done", stats: {} }], "done")
    expect(html).not.toContain("Full investigation")
  })

  it("renders Hudson Rock machines from the hudsonrock frame", () => {
    const html = renderResult(searchDescriptor, [recordFrame, hudsonFrame, { t: "done", stats: {} }], "done")
    const inf = (hudsonFrame.infections as { stealerFamily: string; computerName: string }[])[0]
    expect(html).toContain("Hudson Rock")
    expect(html).toContain(inf.stealerFamily)
    expect(html).toContain(inf.computerName)
  })

  it("renders domain intelligence from the domain-intel frame", () => {
    const html = renderResult(searchDescriptor, [recordFrame, domainFrame, { t: "done", stats: {} }], "done")
    const d = (domainFrame.data as { domain: string; riskScore: number; whois: { registrar: string } })
    expect(html).toContain("Domain intelligence")
    expect(html).toContain(d.domain)
    expect(html).toContain(String(d.riskScore))
    expect(html).toContain(d.whois.registrar)
  })

  it("shows only records and no empty enrichment sections when no enrichment frames arrive", () => {
    const html = renderResult(searchDescriptor, [recordFrame, { t: "done", stats: {} }], "done")
    expect(html).toContain("Breach and leak records")
    // A payload without the new frames must render NONE of their sections, not
    // an empty placeholder for each.
    expect(html).not.toContain("Full investigation")
    expect(html).not.toContain("Hudson Rock")
    expect(html).not.toContain("Domain intelligence")
  })

  it("does not read an interleaved enrichment frame as a breach record", () => {
    // The enrichment frames carry no `records`, so the record count is derived
    // purely from progress frames even when they interleave.
    const html = renderResult(
      searchDescriptor,
      [investigationFrame, recordFrame, hudsonFrame, { t: "done", stats: {} }],
      "done",
    )
    expect(html).toContain("Full investigation")
    expect(html).toContain("Hudson Rock")
    expect(html).toContain("LeakDB")
  })
})
