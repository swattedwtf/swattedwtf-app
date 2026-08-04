import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

import {
  KNOWN_SCHEMA,
  ModuleScreen,
  OutcomePanel,
  ResultView,
  SubmitButton,
  outcomeAction,
  runLookup,
  validateAll,
} from "./ModuleScreen"
import type { ModuleDescriptor } from "./types"
import type { ClassifiedError } from "../lib/errors"
import { ipc } from "../lib/ipc"

vi.mock("../lib/ipc", () => ({
  ipc: { lookup: vi.fn(), openExternal: vi.fn(), fetchImage: vi.fn() },
}))

const lookup = vi.mocked(ipc.lookup)

const digits: ModuleDescriptor = {
  id: "discord",
  route: "/discord",
  label: "Discord",
  inputs: [
    {
      name: "userId",
      label: "User ID",
      placeholder: "Discord user ID",
      validate: (v) => (/^\d{14,19}$/.test(v) ? null : "Enter a Discord user ID (14 to 19 digits)."),
    },
  ],
  Result: ({ data }) => <p>rendered {String(data.username)}</p>,
}

const two: ModuleDescriptor = {
  id: "scraper",
  route: "/roblox/scraper",
  label: "Profile Scraper",
  inputs: [
    { name: "a", label: "Alpha", placeholder: "alpha", validate: (v) => (v ? null : "Alpha is required.") },
    { name: "b", label: "Beta", placeholder: "beta", validate: () => null },
  ],
  Result: () => <p>two</p>,
}

const none: ModuleDescriptor = {
  id: "server-intel",
  route: "/roblox/server-intel",
  label: "Server Intel",
  inputs: [],
  Result: () => <p>none</p>,
}

const apiError = (status: number, message: string, code?: string) => ({
  kind: "Api",
  detail: code ? { status, message, code } : { status, message },
})

beforeEach(() => {
  lookup.mockReset()
  vi.mocked(ipc.openExternal).mockReset()
})

describe("validateAll", () => {
  it("reports the field's own message for a bad value", () => {
    expect(validateAll(digits.inputs, { userId: "abc" })).toEqual({
      userId: "Enter a Discord user ID (14 to 19 digits).",
    })
  })

  it("reports nothing when every field is acceptable", () => {
    expect(validateAll(digits.inputs, { userId: "123456789012345" })).toEqual({})
  })

  it("validates the trimmed value, since a pasted ID carries whitespace", () => {
    expect(validateAll(digits.inputs, { userId: "  123456789012345 " })).toEqual({})
  })

  it("treats a missing value as an empty one rather than skipping the field", () => {
    expect(validateAll(two.inputs, {})).toEqual({ a: "Alpha is required." })
  })

  it("has nothing to say about a module with no inputs", () => {
    expect(validateAll(none.inputs, {})).toEqual({})
  })
})

describe("runLookup", () => {
  it("sends the trimmed values under the module's id", async () => {
    lookup.mockResolvedValue({ schema: 1, data: { username: "bob" }, partial: [] })
    const outcome = await runLookup(digits, { userId: " 123456789012345 " })
    expect(lookup).toHaveBeenCalledWith("discord", { userId: "123456789012345" })
    expect(outcome).toEqual({
      status: "done",
      result: { schema: 1, data: { username: "bob" }, partial: [] },
    })
  })

  it("never spends a metered request on an obviously bad input", async () => {
    const outcome = await runLookup(digits, { userId: "nope" })
    expect(lookup).not.toHaveBeenCalled()
    expect(outcome).toEqual({
      status: "invalid",
      errors: { userId: "Enter a Discord user ID (14 to 19 digits)." },
    })
  })

  it("runs a module with no inputs at all", async () => {
    lookup.mockResolvedValue({ schema: 1, data: {}, partial: [] })
    const outcome = await runLookup(none, {})
    expect(lookup).toHaveBeenCalledWith("server-intel", {})
    expect(outcome.status).toBe("done")
  })

  it("classifies a 402 as an upgrade and keeps the server's copy", async () => {
    lookup.mockRejectedValue(apiError(402, "Desktop lookups are Heist only for now.", "launch_locked"))
    const outcome = await runLookup(digits, { userId: "123456789012345" })
    expect(outcome).toEqual({
      status: "failed",
      error: {
        kind: "upgrade",
        message: "Desktop lookups are Heist only for now.",
        code: "launch_locked",
      },
    })
  })

  it("classifies a 429 as retryable and a 5xx as an error", async () => {
    lookup.mockRejectedValueOnce(apiError(429, "Slow down.", "rate_limited"))
    expect((await runLookup(digits, { userId: "123456789012345" })).status).toBe("failed")

    lookup.mockRejectedValueOnce(apiError(500, "Upstream failed."))
    const outcome = await runLookup(digits, { userId: "123456789012345" })
    expect(outcome.status === "failed" && outcome.error.kind).toBe("error")
  })

  it("classifies a dead session as auth, which the screen renders as nothing", async () => {
    lookup.mockRejectedValue(apiError(401, "Not authenticated"))
    const outcome = await runLookup(digits, { userId: "123456789012345" })
    expect(outcome.status === "failed" && outcome.error.kind).toBe("auth")
  })
})

describe("OutcomePanel", () => {
  const render = (kind: ClassifiedError["kind"], message: string, code?: string) =>
    renderToStaticMarkup(
      <OutcomePanel
        outcome={code ? { kind, message, code } : { kind, message }}
        onRetry={() => {}}
      />,
    )

  it("shows the server's upgrade copy verbatim with a way to buy", () => {
    const html = render("upgrade", "Heist unlocks Discord.", "heist_required")
    expect(html).toContain("Heist unlocks Discord.")
    expect(html).toContain("Upgrade")
  })

  it("shows the legal copy with a way to accept", () => {
    const html = render("legal", "Accept the updated terms to continue.", "legal_acceptance_required")
    expect(html).toContain("Accept the updated terms to continue.")
    expect(html).toContain("terms")
  })

  it("offers a suspended account no action at all", () => {
    const html = render("suspended", "Your account is suspended.")
    expect(html).toContain("Your account is suspended.")
    expect(html).not.toContain("<button")
  })

  it("offers a retry for a rate limit and for a server error", () => {
    expect(render("retry", "Try again in a minute.", "rate_limited")).toContain("Retry")
    expect(render("error", "Upstream failed.")).toContain("Retry")
  })

  it("renders nothing for a dead session, because the app is already leaving", () => {
    expect(render("auth", "Not authenticated")).toBe("")
  })

  it("points the upgrade action at the plans page and the legal one at the terms", () => {
    const open = vi.mocked(ipc.openExternal)
    open.mockResolvedValue(undefined)

    outcomeAction({ kind: "upgrade", message: "x" }, () => {})?.run()
    expect(open).toHaveBeenLastCalledWith("https://swattedw.tf/dashboard/plans")

    outcomeAction({ kind: "legal", message: "x" }, () => {})?.run()
    expect(open).toHaveBeenLastCalledWith("https://swattedw.tf/terms")
  })

  it("retries in place rather than opening the web", () => {
    const onRetry = vi.fn()
    outcomeAction({ kind: "retry", message: "x" }, onRetry)?.run()
    outcomeAction({ kind: "error", message: "x" }, onRetry)?.run()
    expect(onRetry).toHaveBeenCalledTimes(2)
    expect(ipc.openExternal).not.toHaveBeenCalled()
  })

  it("offers nothing to act on for a suspension or a dead session", () => {
    expect(outcomeAction({ kind: "suspended", message: "x" }, () => {})).toBeNull()
    expect(outcomeAction({ kind: "auth", message: "x" }, () => {})).toBeNull()
  })

  it("survives an opener that refuses, rather than throwing at the click", () => {
    vi.mocked(ipc.openExternal).mockRejectedValue(new Error("blocked"))
    expect(() => outcomeAction({ kind: "upgrade", message: "x" }, () => {})?.run()).not.toThrow()
  })

  it("uses no em dashes in its own copy", () => {
    const all = [
      render("upgrade", "x", "heist_required"),
      render("legal", "x"),
      render("suspended", "x"),
      render("retry", "x"),
      render("error", "x"),
    ].join("")
    expect(all).not.toContain("—")
  })
})

describe("ResultView", () => {
  it("renders the module's own Result", () => {
    const html = renderToStaticMarkup(
      <ResultView
        descriptor={digits}
        result={{ schema: KNOWN_SCHEMA, data: { username: "bob" }, partial: [] }}
      />,
    )
    expect(html).toContain("rendered bob")
  })

  it("refuses to draw a half-empty screen for a schema this build does not know", () => {
    const html = renderToStaticMarkup(
      <ResultView
        descriptor={digits}
        result={{ schema: KNOWN_SCHEMA + 1, data: { username: "bob" }, partial: [] }}
      />,
    )
    expect(html).toContain("Update the app to view this result")
    expect(html).not.toContain("rendered bob")
  })

  it("still renders a result from an older schema", () => {
    const html = renderToStaticMarkup(
      <ResultView
        descriptor={digits}
        result={{ schema: KNOWN_SCHEMA - 1, data: { username: "bob" }, partial: [] }}
      />,
    )
    expect(html).toContain("rendered bob")
  })

  it("names the sections that did not load, quietly, without hiding the result", () => {
    const html = renderToStaticMarkup(
      <ResultView
        descriptor={digits}
        result={{ schema: KNOWN_SCHEMA, data: { username: "bob" }, partial: ["messages", "woogle"] }}
      />,
    )
    expect(html).toContain("rendered bob")
    expect(html).toContain("messages")
    expect(html).toContain("woogle")
  })

  it("says nothing when every section loaded", () => {
    const html = renderToStaticMarkup(
      <ResultView
        descriptor={digits}
        result={{ schema: KNOWN_SCHEMA, data: { username: "bob" }, partial: [] }}
      />,
    )
    expect(html).not.toContain("did not load")
  })
})

describe("SubmitButton", () => {
  it("marks itself busy the way every other button in the app does", () => {
    const html = renderToStaticMarkup(<SubmitButton busy onClick={() => {}} />)
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain("btn-primary")
  })

  it("keeps its label while busy, so it does not resize under the pointer", () => {
    const idle = renderToStaticMarkup(<SubmitButton busy={false} onClick={() => {}} />)
    const busy = renderToStaticMarkup(<SubmitButton busy onClick={() => {}} />)
    expect(idle).toContain("Search")
    expect(busy).toContain("Search")
  })

  it("is not busy by default", () => {
    expect(renderToStaticMarkup(<SubmitButton busy={false} onClick={() => {}} />)).not.toContain(
      "aria-busy",
    )
  })
})

describe("ModuleScreen", () => {
  it("heads the screen with the module's label", () => {
    expect(renderToStaticMarkup(<ModuleScreen descriptor={digits} />)).toContain(">Discord<")
  })

  it("renders one labelled field per input, with its placeholder", () => {
    const html = renderToStaticMarkup(<ModuleScreen descriptor={two} />)
    expect(html).toContain("Alpha")
    expect(html).toContain('placeholder="alpha"')
    expect(html).toContain("Beta")
    expect(html).toContain('placeholder="beta"')
  })

  it("gives each field an id its label points at", () => {
    const html = renderToStaticMarkup(<ModuleScreen descriptor={digits} />)
    expect(html).toContain('id="discord-userId"')
    expect(html).toContain('for="discord-userId"')
  })

  it("puts the button beside a single field and below several", () => {
    expect(renderToStaticMarkup(<ModuleScreen descriptor={digits} />)).toContain(
      'data-layout="inline"',
    )
    expect(renderToStaticMarkup(<ModuleScreen descriptor={two} />)).toContain(
      'data-layout="stacked"',
    )
  })

  it("renders a module with no inputs as a button and nothing to type into", () => {
    const html = renderToStaticMarkup(<ModuleScreen descriptor={none} />)
    expect(html).toContain("Search")
    expect(html).not.toContain("<input")
  })

  it("starts with no result, no error and no busy state", () => {
    const html = renderToStaticMarkup(<ModuleScreen descriptor={digits} />)
    expect(html).not.toContain("rendered")
    expect(html).not.toContain("aria-busy")
    expect(html).not.toContain('role="alert"')
  })
})
