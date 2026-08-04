import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

import { ipc } from "../lib/ipc"
import {
  NAME_MAX,
  NOTES_MAX,
  createCase,
  listCases,
  openCase,
  patchCase,
  relativeTime,
  removeCase,
  toAssistant,
  toCase,
  toSummary,
  validateName,
} from "./api"
import {
  AssistantPanel,
  CaseCard,
  CaseList,
  CaseWorkspace,
  Investigations,
  NO_CASES_TITLE,
  NotesMarkdown,
  NotesPanel,
  QUEMLY_URL,
  caseWebUrl,
} from "./Investigations"

vi.mock("../lib/ipc", () => ({
  ipc: { investigations: vi.fn(), openExternal: vi.fn(), fetchImage: vi.fn(), lookup: vi.fn() },
}))

const call = vi.mocked(ipc.investigations)

beforeEach(() => {
  call.mockReset()
  vi.mocked(ipc.openExternal).mockReset()
  vi.mocked(ipc.openExternal).mockResolvedValue(undefined)
})

const row = {
  id: "case_1",
  name: "John Doe fraud lead",
  status: "open",
  notes: "found the seller",
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-02T11:00:00.000Z",
}

describe("coercion", () => {
  it("reads a well formed case", () => {
    const c = toCase(row)
    expect(c).toEqual({ ...row, status: "open" })
  })

  it("survives a payload with every field missing", () => {
    // The failure this prevents is specific: a field read on an absent object
    // throws inside React's render, which here is a white window with no
    // console the user can reach.
    for (const payload of [undefined, null, {}, "case", 7, []]) {
      const c = toCase(payload)
      expect(c.name).toBe("Untitled case")
      expect(c.status).toBe("open")
      expect(c.notes).toBe("")
      expect(typeof c.id).toBe("string")
    }
  })

  it("never lets a non-string field reach the screen as one", () => {
    const c = toCase({ id: 5, name: { a: 1 }, notes: ["x"], status: "deleted" })
    expect(c.id).toBe("")
    expect(c.name).toBe("Untitled case")
    expect(c.notes).toBe("")
    // Any status but "closed" reads as open: an unknown one must not render as
    // itself, and it certainly must not render as undefined.
    expect(c.status).toBe("open")
  })

  it("keeps a closed case closed", () => {
    expect(toCase({ ...row, status: "closed" }).status).toBe("closed")
    expect(toSummary({ ...row, status: "closed" }).status).toBe("closed")
  })

  it("falls back to the created time when a row has no updated time", () => {
    // A list row sorts and renders on this, so an empty string would read as
    // an ancient case rather than a new one.
    expect(toCase({ ...row, updatedAt: undefined }).updatedAt).toBe(row.createdAt)
    expect(toSummary({ ...row, updatedAt: "" }).updatedAt).toBe(row.createdAt)
  })

  it("summarises the notepad by size rather than carrying it", () => {
    const s = toSummary({ ...row, notesChars: 42 })
    expect(s.notesChars).toBe(42)
    expect("notes" in s).toBe(false)
  })

  it("reads a nonsense note count as zero rather than as NaN on the screen", () => {
    for (const value of [undefined, null, "12", -4, Number.NaN, Infinity]) {
      expect(toSummary({ ...row, notesChars: value }).notesChars).toBe(0)
    }
  })

  it("treats an unstated assistant as unavailable, never as available", () => {
    // Defaulting the other way would tell someone without the subscription that
    // they have it, and send them to a panel that refuses them.
    for (const payload of [undefined, null, {}, { active: "yes" }, { active: 1 }]) {
      expect(toAssistant(payload).active).toBe(false)
    }
    expect(toAssistant({ active: true }).active).toBe(true)
  })
})

describe("validateName", () => {
  it("refuses a blank name before the round trip", () => {
    expect(validateName("")).toBeTruthy()
    expect(validateName("   ")).toBeTruthy()
  })

  it("refuses a name the server would refuse", () => {
    expect(validateName("x".repeat(NAME_MAX + 1))).toBeTruthy()
    expect(validateName("x".repeat(NAME_MAX))).toBeNull()
  })

  it("accepts an ordinary case name", () => {
    expect(validateName("  John Doe fraud lead ")).toBeNull()
  })
})

describe("relativeTime", () => {
  const now = Date.UTC(2026, 7, 4, 12, 0, 0)

  it("says the ordinary things", () => {
    expect(relativeTime(new Date(now - 10_000).toISOString(), now)).toBe("just now")
    expect(relativeTime(new Date(now - 5 * 60_000).toISOString(), now)).toBe("5 min ago")
    expect(relativeTime(new Date(now - 3 * 3_600_000).toISOString(), now)).toBe("3 hr ago")
    expect(relativeTime(new Date(now - 26 * 3_600_000).toISOString(), now)).toBe("yesterday")
    expect(relativeTime(new Date(now - 3 * 86_400_000).toISOString(), now)).toBe("3 days ago")
  })

  it("does not print NaN for a missing or malformed timestamp", () => {
    // A row written before a field existed still has to render.
    for (const iso of ["", "not a date", "0000"]) {
      expect(relativeTime(iso, now)).not.toContain("NaN")
    }
  })
})

describe("the calls", () => {
  it("lists cases and the assistant's availability in one call", async () => {
    call.mockResolvedValue({
      investigations: [{ ...row, notesChars: 3 }],
      assistant: { active: true },
    })
    const payload = await listCases()
    expect(call).toHaveBeenCalledWith("list")
    expect(payload.cases).toHaveLength(1)
    expect(payload.cases[0].id).toBe("case_1")
    expect(payload.assistant.active).toBe(true)
  })

  it("renders an answer with no cases field at all as an empty list", async () => {
    call.mockResolvedValue({})
    const payload = await listCases()
    expect(payload.cases).toEqual([])
    expect(payload.assistant.active).toBe(false)
  })

  it("renders a cases field that is not a list as an empty one", async () => {
    call.mockResolvedValue({ investigations: "none" })
    expect((await listCases()).cases).toEqual([])
  })

  it("opens one case", async () => {
    call.mockResolvedValue({ investigation: row, assistant: { active: false } })
    const payload = await openCase("case_1")
    expect(call).toHaveBeenCalledWith("get", { id: "case_1" })
    expect(payload.investigation.notes).toBe("found the seller")
    expect(payload.assistant.active).toBe(false)
  })

  it("trims a case name on the way out", async () => {
    call.mockResolvedValue({ investigation: row })
    await createCase("  spaced  ")
    expect(call).toHaveBeenCalledWith("create", { name: "spaced" })
  })

  it("sends a patch as a patch, so a partial edit stays partial", async () => {
    call.mockResolvedValue({ investigation: row })
    await patchCase("case_1", { notes: "typed" })
    expect(call).toHaveBeenCalledWith("update", { id: "case_1", patch: { notes: "typed" } })
  })

  it("deletes by id", async () => {
    call.mockResolvedValue({ ok: true })
    await removeCase("case_1")
    expect(call).toHaveBeenCalledWith("delete", { id: "case_1" })
  })

  it("never routes a case action through the metered lookup command", async () => {
    // Investigations is not a search. Sending it through `lookup` would charge
    // the desktop for opening a notepad, which the web gives away.
    call.mockResolvedValue({ investigations: [] })
    await listCases()
    expect(vi.mocked(ipc.lookup)).not.toHaveBeenCalled()
  })
})

describe("the screen renders defensively", () => {
  it("draws the list view before anything has loaded", () => {
    call.mockResolvedValue({ investigations: [] })
    const html = renderToStaticMarkup(<Investigations />)
    expect(html).toContain("Investigations")
    expect(html).toContain("New case")
  })

  it("draws a case workspace before anything has loaded", () => {
    call.mockResolvedValue({ investigation: row })
    const html = renderToStaticMarkup(<CaseWorkspace id="case_1" onBack={() => {}} />)
    expect(html).toContain("All cases")
  })

  it("uses no em dashes anywhere in its copy", () => {
    const views = [
      renderToStaticMarkup(<CaseList onOpen={() => {}} />),
      renderToStaticMarkup(<CaseWorkspace id="case_1" onBack={() => {}} />),
      renderToStaticMarkup(<AssistantPanel active={false} caseId="case_1" />),
      renderToStaticMarkup(<AssistantPanel active caseId="case_1" />),
      renderToStaticMarkup(
        <CaseCard
          summary={toSummary(row)}
          confirming={false}
          onOpen={() => {}}
          onAskDelete={() => {}}
          onCancelDelete={() => {}}
          onDelete={() => {}}
        />,
      ),
      renderToStaticMarkup(<NotesPanel notes="" view="edit" onView={() => {}} onChange={() => {}} />),
    ]
    for (const html of views) expect(html).not.toContain("—")
  })

  it("styles nothing of its own: every surface is a shared glass class", () => {
    const html = renderToStaticMarkup(<CaseList onOpen={() => {}} />)
    expect(html).toContain("glass-tile")
    expect(html).toContain("glass-input")
    expect(html).toContain("btn-primary")
    // A hex or a hand-mixed background is how sixteen screens drift into
    // sixteen looks, so neither may appear.
    expect(html).not.toMatch(/bg-\[#/)
    expect(html).not.toMatch(/style="[^"]*background/)
  })

  it("does not claim the account has no cases before the list has loaded", () => {
    // A shimmer says "still asking". The empty headline says "there are none",
    // and only one of those is safe to say before the answer arrives.
    const html = renderToStaticMarkup(<CaseList onOpen={() => {}} />)
    expect(html).toContain("skeleton")
    expect(html).not.toContain(NO_CASES_TITLE)
  })
})

describe("a case card carries the case's own data", () => {
  const summary = toSummary({ ...row, notesChars: 4210 })

  const render = (over: Partial<typeof summary> = {}, confirming = false) =>
    renderToStaticMarkup(
      <CaseCard
        summary={{ ...summary, ...over }}
        confirming={confirming}
        onOpen={() => {}}
        onAskDelete={() => {}}
        onCancelDelete={() => {}}
        onDelete={() => {}}
      />,
    )

  it("shows the name, the state and the size of the notepad", () => {
    const html = render()
    expect(html).toContain(summary.name)
    expect(html).toContain(summary.notesChars.toLocaleString("en-US"))
    expect(html).toContain(relativeTime(summary.updatedAt))
  })

  it("says a case has no notes rather than showing it as a zero", () => {
    expect(render({ notesChars: 0 })).not.toContain("0 characters")
  })

  it("names the case in its delete control, so two cards are never confused", () => {
    expect(render()).toContain(`Delete ${summary.name}`)
  })

  it("asks twice before deleting, because there is no undo", () => {
    const asked = render({}, true)
    expect(asked).toContain("Delete for good")
    expect(asked).toContain("Keep")
    expect(render()).not.toContain("Delete for good")
  })
})

describe("the notepad", () => {
  it("renders the notes it was given, and offers both views", () => {
    const notes = "the seller used a burner"
    const html = renderToStaticMarkup(
      <NotesPanel notes={notes} view="edit" onView={() => {}} onChange={() => {}} />,
    )
    expect(html).toContain(notes)
    // The counter is what tells a user how close the notepad is to its limit.
    expect(html).toContain(NOTES_MAX.toLocaleString("en-US"))
  })

  it("says there is nothing to preview rather than showing an empty card", () => {
    const html = renderToStaticMarkup(
      <NotesPanel notes="   " view="preview" onView={() => {}} onChange={() => {}} />,
    )
    expect(html).toContain("Nothing to preview yet.")
  })

  it("formats the markdown the assistant writes into a case", () => {
    // These notes come back from the web assistant already formatted, so a
    // preview that showed the source would look like the desktop had lost the
    // formatting rather than never applied it.
    const html = renderToStaticMarkup(
      <NotesMarkdown text={"# Findings\n- **seller** used `burner@example.com`"} />,
    )
    expect(html).toContain("<strong")
    expect(html).toContain("<code")
    expect(html).toContain("Findings")
    // The markers themselves are consumed, not printed.
    expect(html).not.toContain("**seller**")
  })

  it("never puts note text into the DOM as markup", () => {
    // A notepad holds whatever a lookup returned, including markup pasted out
    // of a breach record.
    const html = renderToStaticMarkup(<NotesMarkdown text={"<img src=x onerror=alert(1)>"} />)
    expect(html).not.toContain("<img")
    expect(html).toContain("&lt;img")
  })
})

describe("the assistant panel", () => {
  it("says the assistant is a separate subscription, not a broken plan", () => {
    // The exact failure this exists to prevent: a customer who had bought Heist
    // AND the API add-on opened Investigations, read the web's bare "Quemly plan
    // required", and concluded the purchase had failed.
    const html = renderToStaticMarkup(<AssistantPanel active={false} caseId="case_1" />)
    expect(html).toContain("separate subscription")
    expect(html).toContain("Quemly")
    expect(html).toMatch(/Nothing on your account is broken or missing/)
    expect(html).toContain("API Access")
    // Never the bare refusal the web shows.
    expect(html).not.toContain("Quemly plan required")
  })

  it("does not repeat the sales pitch to somebody who already subscribes", () => {
    const html = renderToStaticMarkup(<AssistantPanel active caseId="case_1" />)
    expect(html).toContain("Your Quemly subscription is active")
    expect(html).not.toContain("separate subscription")
  })

  it("points at the spelling of the Quemly host that actually resolves", () => {
    // "quemly.swattedw.tf" is what the product name suggests and it does not
    // exist. Sending someone there is a dead end at the exact moment they have
    // been told where to go.
    expect(QUEMLY_URL).toBe("https://qemuly.swattedw.tf")
  })

  it("links a case to its own page on the web, with the id escaped", () => {
    expect(caseWebUrl("case_1")).toBe("https://swattedw.tf/dashboard/investigations/case_1")
    expect(caseWebUrl("a b/../evil")).toBe(
      "https://swattedw.tf/dashboard/investigations/a%20b%2F..%2Fevil",
    )
  })

  it("offers both destinations only where each one helps", () => {
    const locked = renderToStaticMarkup(<AssistantPanel active={false} caseId="case_1" />)
    expect(locked).toContain("About Quemly")
    expect(locked).toContain("Open this case on the web")
    // A subscriber has nothing to read about: they already bought it.
    const active = renderToStaticMarkup(<AssistantPanel active caseId="case_1" />)
    expect(active).not.toContain("About Quemly")
    expect(active).toContain("Open this case on the web")
  })

  it("opens every link in the browser, never in the webview", () => {
    // Buttons rather than anchors, precisely so nothing can navigate the
    // webview: every destination goes out through ipc.openExternal.
    const html = renderToStaticMarkup(<AssistantPanel active={false} caseId="case_1" />)
    expect(html).not.toContain("<a ")
    expect(html).not.toContain("href=")
  })
})
