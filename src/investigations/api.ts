/**
 * The Investigations case manager, minus React.
 *
 * Everything the screen does that is not drawing lives here: the five calls,
 * the coercion of what comes back, the name rule and the relative clock. It is
 * separated for the reason ModuleScreen separates `runLookup` and `validateAll`
 * from its component, which is that this is the part worth testing and none of
 * it needs a DOM.
 *
 * Investigations is NOT a lookup. Nothing here is metered, nothing spends a
 * search, and the server route it calls is gated on the ordinary signed-in
 * mutation gate rather than on the lookup gate.
 *
 * Every payload is coerced through `withDefaults`/`list` before a single field
 * is read. A renderer that reads `.length` on an absent field throws inside
 * React's render, which in this app is a white window with no console the user
 * can reach and no way to fix without shipping a release.
 */
import { ipc } from "../lib/ipc"
import { list, withDefaults } from "../modules/safe"

/** Longest case name. Mirrors the server, so a name it would refuse is caught
 *  before the round trip rather than after it. */
export const NAME_MAX = 120

/** Longest notepad. Mirrors the server and lib/investigations.ts. */
export const NOTES_MAX = 100_000

/** A case as the list shows it. The notepad is deliberately not included: the
 *  server sends its SIZE so the list can say whether a case has been written
 *  in, without pulling a hundred thousand characters per row. */
export type CaseSummary = {
  id: string
  name: string
  status: "open" | "closed"
  notesChars: number
  createdAt: string
  updatedAt: string
}

/** One open case, with its notepad. */
export type Case = {
  id: string
  name: string
  status: "open" | "closed"
  notes: string
  createdAt: string
  updatedAt: string
}

export type CasePatch = {
  name?: string
  status?: "open" | "closed"
  notes?: string
}

const EMPTY_SUMMARY: CaseSummary = {
  id: "",
  name: "",
  status: "open",
  notesChars: 0,
  createdAt: "",
  updatedAt: "",
}

const EMPTY_CASE: Case = {
  id: "",
  name: "",
  status: "open",
  notes: "",
  createdAt: "",
  updatedAt: "",
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function status(value: unknown): "open" | "closed" {
  return value === "closed" ? "closed" : "open"
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

export function toSummary(raw: unknown): CaseSummary {
  const c = withDefaults(raw, EMPTY_SUMMARY)
  return {
    id: str(c.id),
    // A case always has a name on the server. An empty one here means a field
    // arrived in a shape we did not expect, and a blank row is unclickable.
    name: str(c.name) || "Untitled case",
    status: status(c.status),
    notesChars: count(c.notesChars),
    createdAt: str(c.createdAt),
    updatedAt: str(c.updatedAt) || str(c.createdAt),
  }
}

export function toCase(raw: unknown): Case {
  const c = withDefaults(raw, EMPTY_CASE)
  return {
    id: str(c.id),
    name: str(c.name) || "Untitled case",
    status: status(c.status),
    notes: str(c.notes),
    createdAt: str(c.createdAt),
    updatedAt: str(c.updatedAt) || str(c.createdAt),
  }
}

/**
 * Whether the OSINT case assistant is available on this account.
 *
 * A SEPARATE subscription (Quemly) from the Swatted plan, which is the whole
 * reason this flag is carried at all: without it the screen cannot tell "you
 * have the assistant, it lives on the web" apart from "your plan is fine and
 * the assistant is sold separately", and a customer already read the second one
 * as their purchase being broken.
 *
 * Absent means "the server did not say", which is not the same as "no", so it
 * defaults to false and the copy that goes with false says what to do rather
 * than accusing the account of missing something.
 */
export type Assistant = { active: boolean }

export function toAssistant(raw: unknown): Assistant {
  const a = withDefaults(raw, { active: false })
  return { active: a.active === true }
}

/** The name rule, applied before the round trip. Null means "go ahead". */
export function validateName(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return "A case name is required."
  if (trimmed.length > NAME_MAX) return `Keep the name under ${NAME_MAX} characters.`
  return null
}

/**
 * "3 min ago", the way the web case list says it.
 *
 * `now` is injected so this is testable without freezing the clock, and a
 * malformed or absent timestamp reads as "just now" rather than as "NaN min
 * ago" or as a crash.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const at = new Date(iso).getTime()
  if (!Number.isFinite(at)) return "just now"
  const minutes = Math.round((now - at) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.round(hours / 24)
  if (days === 1) return "yesterday"
  if (days < 7) return `${days} days ago`
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

/** What a list call answers with: the cases plus the assistant's availability. */
export type CaseListPayload = { cases: CaseSummary[]; assistant: Assistant }

export async function listCases(): Promise<CaseListPayload> {
  const payload = await ipc.investigations("list")
  const body = withDefaults(payload, {} as Record<string, unknown>)
  return {
    cases: list<unknown>(body.investigations).map(toSummary),
    assistant: toAssistant(body.assistant),
  }
}

export async function openCase(id: string): Promise<{ investigation: Case; assistant: Assistant }> {
  const payload = await ipc.investigations("get", { id })
  const body = withDefaults(payload, {} as Record<string, unknown>)
  return {
    investigation: toCase(body.investigation),
    assistant: toAssistant(body.assistant),
  }
}

export async function createCase(name: string): Promise<Case> {
  const payload = await ipc.investigations("create", { name: name.trim() })
  return toCase(withDefaults(payload, {} as Record<string, unknown>).investigation)
}

export async function patchCase(id: string, patch: CasePatch): Promise<Case> {
  const payload = await ipc.investigations("update", { id, patch })
  return toCase(withDefaults(payload, {} as Record<string, unknown>).investigation)
}

export async function removeCase(id: string): Promise<void> {
  await ipc.investigations("delete", { id })
}
