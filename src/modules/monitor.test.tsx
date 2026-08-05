import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

import {
  FailurePanel,
  MonitorScreen,
  NO_WATCHES_TITLE,
  RunRow,
  SCANNER_TYPES,
  WATCH_LIMIT,
  WatchRow,
  monitorsFrom,
  relativeTime,
  runSummary,
  runsFrom,
  runsTitle,
  sampleLine,
  toMonitor,
  toRun,
  untilTime,
} from "./monitor"
import { BUILT_IN_ROUTES } from "./registry"
import { isEnabled } from "../shell/nav"
import { classifyError } from "../lib/errors"

/** The shape Rust hands the frontend for a refused request. */
const apiError = (status: number, message: string, code?: string) => ({
  kind: "Api",
  detail: code ? { status, message, code } : { status, message },
})

describe("Monitor is a built-in route, not a lookup module", () => {
  it("is enabled through BUILT_IN_ROUTES so its nav row is live", () => {
    expect(BUILT_IN_ROUTES).toContain("/monitor")
    expect(isEnabled("/monitor")).toBe(true)
  })

  it("stays exact, so a child path is not this screen", () => {
    expect(isEnabled("/monitor/evil")).toBe(false)
  })
})

describe("payload coercion", () => {
  // The failure this guards is specific: a renderer reading .length or
  // .toLocaleString() on an absent field throws inside React's render, which in
  // this app is a white window with no reachable console.
  it("survives a payload with nothing in it", () => {
    expect(monitorsFrom(undefined)).toEqual([])
    expect(monitorsFrom(null)).toEqual([])
    expect(monitorsFrom({})).toEqual([])
    expect(monitorsFrom({ monitors: null })).toEqual([])
    expect(monitorsFrom({ monitors: "nope" })).toEqual([])
    expect(runsFrom(undefined)).toEqual([])
    expect(runsFrom({ runs: 7 })).toEqual([])
  })

  it("fills every field a sparse row leaves out", () => {
    const row = toMonitor({ id: "m1", email: "a@b.c" })
    expect(row.status).toBe("active")
    expect(row.scanner_type).toBe("breach")
    expect(row.total_results_found).toBe(0)
    expect(row.last_run_at).toBe(null)
    expect(row.next_run_at).toBe(null)
    // Formatting the count is exactly where an absent field used to crash a
    // screen, so prove it is always a number.
    expect(() => row.total_results_found.toLocaleString("en-US")).not.toThrow()
  })

  it("drops a row with no id rather than rendering a keyless entry", () => {
    expect(monitorsFrom({ monitors: [{ email: "a@b.c" }, { id: "m1", email: "a@b.c" }] })).toHaveLength(1)
  })

  it("keeps a scanner type it does not recognise out of the UI", () => {
    expect(toMonitor({ id: "m1", scanner_type: "something-new" }).scanner_type).toBe("breach")
    expect(toMonitor({ id: "m1", scanner_type: "stealer" }).scanner_type).toBe("stealer")
  })

  it("never lets a non-array sample reach .slice", () => {
    const run = toRun({ uid: "r1", results_sample: "not an array" })
    expect(run.results_sample).toEqual([])
    expect(() => run.results_sample.slice(0, 3)).not.toThrow()
  })
})

describe("a run says which of the three things happened", () => {
  it("reports hits", () => {
    expect(runSummary(toRun({ uid: "r", results_count: 3 }))).toEqual({
      tone: "hit",
      text: "3 new hits",
    })
    expect(runSummary(toRun({ uid: "r", results_count: 1 })).text).toBe("1 new hit")
  })

  it("reports a clean pass", () => {
    expect(runSummary(toRun({ uid: "r", results_count: 0 })).tone).toBe("clear")
  })

  // The core lesson of this project's review. A scan that FAILED must never read
  // as a scan that found nothing: one means "you are clean", the other means
  // nobody looked.
  it("never reads a failed scan as a clean one", () => {
    const failed = runSummary(toRun({ uid: "r", results_count: 0, error_message: "proxy died" }))
    expect(failed.tone).toBe("failed")
    expect(failed.text).toBe("Scan failed")
    expect(failed.text).not.toContain("No new exposures")
  })
})

describe("sample lines", () => {
  it("reads the fields it knows", () => {
    expect(sampleLine({ email: "a@b.c", password: "hunter2" })).toBe("a@b.c · hunter2")
    expect(sampleLine({ username: "bob" })).toBe("bob")
  })

  it("returns nothing rather than [object Object] for a shape it cannot read", () => {
    expect(sampleLine({ unexpected: 1 })).toBe("")
    expect(sampleLine(null)).toBe("")
    expect(sampleLine(42)).toBe("")
  })
})

describe("times", () => {
  const now = Date.parse("2026-08-04T12:00:00Z")

  it("says never rather than inventing a date", () => {
    expect(relativeTime(null, now)).toBe("never")
    expect(relativeTime("not a date", now)).toBe("never")
    expect(untilTime(null, now)).toBe("not scheduled")
  })

  it("reads back in the units a person would use", () => {
    expect(relativeTime("2026-08-04T11:30:00Z", now)).toBe("30 min ago")
    expect(relativeTime("2026-08-04T09:00:00Z", now)).toBe("3 hr ago")
    expect(untilTime("2026-08-04T15:00:00Z", now)).toBe("in 3 hr")
    expect(untilTime("2026-08-04T11:00:00Z", now)).toBe("soon")
  })
})

describe("refusals", () => {
  it("turns the Heist gate into the server's own copy plus an upgrade action", () => {
    // Every monitor route on the server runs requireFeatureAccess(user, "heist"),
    // so this 402 is what an account below Heist actually receives.
    const outcome = classifyError(
      apiError(402, "This is a Swatted Heist feature. Upgrade to Heist to unlock it.", "heist_required"),
    )
    expect(outcome.kind).toBe("upgrade")
    const html = renderToStaticMarkup(<FailurePanel outcome={outcome} />)
    expect(html).toContain("This is a Swatted Heist feature")
    expect(html).toContain("Upgrade")
    // A gate is not something a Retry can fix.
    expect(html).not.toContain(">Retry<")
  })

  it("offers Retry for a failure that might not repeat", () => {
    const outcome = classifyError({ kind: "Network", detail: "connection refused" })
    const html = renderToStaticMarkup(<FailurePanel outcome={outcome} onRetry={() => {}} />)
    expect(html).toContain("connection refused")
    expect(html).toContain("Retry")
  })

  it("says what a dead session means instead of the server's bare wording", () => {
    const outcome = classifyError(apiError(401, "Not authenticated"))
    const html = renderToStaticMarkup(<FailurePanel outcome={outcome} onRetry={() => {}} />)
    expect(html).toContain("Your session has expired")
    // Nothing here can fix it, so nothing here offers to.
    expect(html).not.toContain("Retry")
  })
})

describe("a watch row carries the row's own data", () => {
  const watch = toMonitor({
    id: "m1",
    email: "target@example.com",
    status: "active",
    scanner_type: "stealer",
    last_run_at: "2026-08-04T09:00:00Z",
    next_run_at: "2026-08-04T15:00:00Z",
    total_results_found: 4210,
  })

  const render = (monitor = watch, selected = true) =>
    renderToStaticMarkup(
      <WatchRow
        monitor={monitor}
        selected={selected}
        removing={false}
        onSelect={() => {}}
        onRemove={() => {}}
      />,
    )

  it("shows the address, the scanner kind and the count as a person reads it", () => {
    const html = render()
    expect(html).toContain(watch.email)
    expect(html).toContain(watch.scanner_type)
    // The thousands separator is the whole reason the count goes through
    // toLocaleString, so assert the formatted form rather than the digits.
    expect(html).toContain(watch.total_results_found.toLocaleString("en-US"))
  })

  it("names the address in the remove control, so two rows are never confused", () => {
    expect(render()).toContain(`Remove the watch on ${watch.email}`)
  })

  it("pulses only while the scanner is actually active", () => {
    expect(render()).toContain("live-dot")
    expect(render(toMonitor({ ...watch, status: "paused" }))).not.toContain("live-dot")
  })
})

describe("a run row", () => {
  const render = (run: unknown) => renderToStaticMarkup(<RunRow run={toRun(run)} />)

  it("prints the summary its own function produced", () => {
    const run = toRun({ uid: "r1", results_count: 2, completed_at: "2026-08-04T09:00:00Z" })
    expect(render(run)).toContain(runSummary(run).text)
  })

  it("shows the sample lines the scanner returned", () => {
    const sample = { email: "a@b.c", password: "hunter2" }
    expect(render({ uid: "r1", results_count: 1, results_sample: [sample] })).toContain(
      sampleLine(sample),
    )
  })

  it("never dresses a failed scan as a clean one", () => {
    const failed = toRun({ uid: "r1", results_count: 0, error_message: "proxy died" })
    const html = render(failed)
    expect(html).toContain(failed.error_message)
    expect(html).toContain(runSummary(failed).text)
    expect(html).not.toContain(runSummary(toRun({ uid: "r2" })).text)
  })
})

describe("the screen itself", () => {
  // Effects do not run in a static render, so this is the first paint: what the
  // user sees before the list has arrived.
  const html = renderToStaticMarkup(<MonitorScreen />)

  it("renders its first paint without a payload, and does not throw", () => {
    expect(html).toContain("Monitor")
    expect(html).toContain("Watch an email for new breaches")
  })

  it("does not claim nothing is being watched before the list has loaded", () => {
    // An unloaded list and an empty one are different claims, and only one of
    // them is safe to make. A shimmer says "still asking"; the empty headline
    // says "there is nothing", and it must not appear yet.
    expect(html).toContain("skeleton")
    expect(html).not.toContain(NO_WATCHES_TITLE)
  })

  it("does not count scanners against the cap before it knows the count", () => {
    expect(html).not.toContain(`/ ${WATCH_LIMIT.toLocaleString("en-US")}`)
  })

  it("offers both scanner kinds on the add row", () => {
    for (const type of SCANNER_TYPES) expect(html).toContain(type.label)
    expect(html).toContain("Email to monitor")
  })

  it("shows the alert pane unnamed until a watch is selected", () => {
    expect(html).toContain(runsTitle(null).caption)
    expect(runsTitle(null).subject).toBeNull()
    expect(html).toContain("Select a watch to see its scan history.")
  })

  it("names the watch it is showing without shouting the address in caps", () => {
    // An email set in mono caps reads as a different address from the one the
    // user typed, so the caption stays capitalised and the address does not.
    const named = runsTitle("Target@Example.com")
    expect(named.subject).toBe("Target@Example.com")
    expect(named.caption).not.toContain(named.subject)
  })

  it("uses no em dashes in any copy", () => {
    expect(html).not.toContain("—")
  })

  it("draws every surface with a shared class rather than a colour of its own", () => {
    // The rule the app is held to: panels, tiles, wells and buttons come from
    // theme.css. A hex or a hand-mixed background here is how sixteen screens
    // drift into sixteen looks.
    expect(html).not.toMatch(/bg-\[#/)
    expect(html).not.toMatch(/style="[^"]*background/)
    expect(html).toContain("glass-tile")
    expect(html).toContain("glass-input")
    expect(html).toContain("btn-primary")
  })
})
