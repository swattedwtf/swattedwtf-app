import { useCallback, useEffect, useState, type FormEvent } from "react"
import {
  Bell,
  BellRing,
  Database,
  HardDrive,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react"

import { ipc } from "../lib/ipc"
import { classifyError, type ClassifiedError } from "../lib/errors"
import { EmptyState, PLANS_URL, Section } from "./ui"
import { list, withDefaults } from "./safe"

/**
 * Monitor, laid out to match the web page at /dashboard/monitor.
 *
 * NOT A LOOKUP, and deliberately not a module. Nothing here is searched for: the
 * user subscribes an email address to a scanner and the server tells them later
 * when it turns up in a breach or a stealer log. There is no query to submit, no
 * result to cache and nothing to meter, so it is a built-in route beside
 * /dashboard, /settings and /api rather than an entry in MODULES.
 *
 * HEIST ONLY, exactly as on the web. Every monitor route on the server runs
 * `requireFeatureAccess(user, "heist")`, so an account below Heist is refused
 * with a 402 `heist_required` whatever it asks for. This screen does not
 * re-implement that decision: it asks the server, and a refusal renders as the
 * upgrade panel carrying the server's own copy. That way the gate cannot drift
 * out of step with the web by a client release.
 *
 * The distinction this screen works hardest to keep is between "nothing has
 * turned up" and "we could not ask". An empty watch list and a list that failed
 * to load look nothing alike here, and a scanner history the proxy could not
 * reach never renders as "no alerts": that reading is the difference between a
 * user relaxing and a user being told, wrongly, that they are clean.
 */

/** One watched identifier, as the server stores it. */
export type MonitorRow = {
  id: string
  email: string
  status: string
  scanner_type: string
  scanner_uid: string
  last_run_at: string | null
  next_run_at: string | null
  total_results_found: number
}

/** One scanner run: the alert history for a watch. */
export type MonitorRun = {
  uid: string
  status: string
  started_at: string | null
  completed_at: string | null
  results_count: number
  results_sample: unknown[]
  error_message: string | null
}

const EMPTY_MONITOR: MonitorRow = {
  id: "",
  email: "",
  status: "active",
  scanner_type: "breach",
  scanner_uid: "",
  last_run_at: null,
  next_run_at: null,
  total_results_found: 0,
}

const EMPTY_RUN: MonitorRun = {
  uid: "",
  status: "",
  started_at: null,
  completed_at: null,
  results_count: 0,
  results_sample: [],
  error_message: null,
}

const TERMS_URL = "https://swattedw.tf/terms"

/**
 * Coerces a row the server sent into something safe to render.
 *
 * Every field is read defensively, including the ones the server currently
 * always sends. A renderer that reads `.length` or `.toLocaleString()` on an
 * absent field throws inside React's render, and in this app that is a white
 * window with no reachable console and no fix short of shipping a release.
 */
export function toMonitor(value: unknown): MonitorRow {
  const row = withDefaults(value, EMPTY_MONITOR)
  return {
    ...row,
    id: typeof row.id === "string" ? row.id : "",
    email: typeof row.email === "string" ? row.email : "",
    status: typeof row.status === "string" ? row.status : "active",
    scanner_type: row.scanner_type === "stealer" ? "stealer" : "breach",
    scanner_uid: typeof row.scanner_uid === "string" ? row.scanner_uid : "",
    total_results_found:
      typeof row.total_results_found === "number" && Number.isFinite(row.total_results_found)
        ? row.total_results_found
        : 0,
  }
}

export function toRun(value: unknown): MonitorRun {
  const run = withDefaults(value, EMPTY_RUN)
  return {
    ...run,
    uid: typeof run.uid === "string" ? run.uid : "",
    results_count:
      typeof run.results_count === "number" && Number.isFinite(run.results_count)
        ? run.results_count
        : 0,
    results_sample: list<unknown>(run.results_sample),
    error_message: typeof run.error_message === "string" ? run.error_message : null,
  }
}

/** Every watch in a server payload, in order, each one coerced. */
export function monitorsFrom(payload: unknown): MonitorRow[] {
  const body = withDefaults(payload, { monitors: [] as unknown })
  return list<unknown>(body.monitors)
    .map(toMonitor)
    .filter((m) => m.id !== "")
}

export function runsFrom(payload: unknown): MonitorRun[] {
  const body = withDefaults(payload, { runs: [] as unknown })
  return list<unknown>(body.runs).map(toRun)
}

/** "3 hr ago". Takes `now` so the same input always renders the same string. */
export function relativeTime(iso: string | null | undefined, nowMs: number = Date.now()): string {
  if (typeof iso !== "string" || iso === "") return "never"
  const at = new Date(iso).getTime()
  if (Number.isNaN(at)) return "never"
  const minutes = Math.round((nowMs - at) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.round(hours / 24)
  if (days === 1) return "yesterday"
  if (days < 7) return `${days} days ago`
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

/** "in 4 hr". Blank rather than a fabricated time when the server sent none. */
export function untilTime(iso: string | null | undefined, nowMs: number = Date.now()): string {
  if (typeof iso !== "string" || iso === "") return "not scheduled"
  const at = new Date(iso).getTime()
  if (Number.isNaN(at)) return "not scheduled"
  const minutes = Math.round((at - nowMs) / 60_000)
  if (minutes <= 0) return "soon"
  if (minutes < 60) return `in ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `in ${hours} hr`
  return `in ${Math.round(hours / 24)} days`
}

/**
 * One line of a run's sample, without ever assuming the shape.
 *
 * The sample rows come straight from the scanner and differ per source, so this
 * reads the fields it knows and falls back to the value itself rather than
 * rendering an empty bullet.
 */
export function sampleLine(item: unknown): string {
  if (typeof item === "string") return item.slice(0, 120)
  if (typeof item !== "object" || item === null) return ""
  const row = item as Record<string, unknown>
  const pick = (key: string) => (typeof row[key] === "string" ? (row[key] as string) : "")
  const head = pick("email") || pick("username") || pick("url") || pick("domain")
  const parts = [head, pick("password")].filter(Boolean)
  return parts.length > 0 ? parts.join(" · ") : ""
}

/**
 * What a run actually says.
 *
 * Three outcomes that must never be confused: hits, a clean pass, and a run that
 * failed. The last one is the reason this is a function and not a ternary in the
 * markup: a failed scan rendering as "No new exposures" would be the app telling
 * a user they are clean when nobody looked.
 */
export function runSummary(run: MonitorRun): { tone: "hit" | "clear" | "failed"; text: string } {
  if (run.error_message) return { tone: "failed", text: "Scan failed" }
  if (run.results_count > 0) {
    return {
      tone: "hit",
      text: `${run.results_count.toLocaleString("en-US")} new ${
        run.results_count === 1 ? "hit" : "hits"
      }`,
    }
  }
  return { tone: "clear", text: "No new exposures" }
}

/** The session-expired copy, written for this screen rather than the server's
 *  bare "Not authenticated". Nothing here clears the session: only the overview
 *  path in app.tsx does that. */
const AUTH_MESSAGE =
  "Your session has expired, so Monitor could not load. Open Settings, log out, and sign in again to continue."

/**
 * What the app does about a refusal, said once for this screen.
 *
 * The server's copy is shown verbatim in every branch but `auth`, because it is
 * written for the user, it is more specific than anything this client could
 * invent, and it is reworded without a client release. A Heist refusal lands
 * here as `upgrade` carrying the server's own 402 message, which is how the
 * plan gate reaches the screen at all.
 */
export function FailurePanel({
  outcome,
  onRetry,
}: {
  outcome: ClassifiedError
  onRetry?: () => void
}) {
  const open = (url: string) => void ipc.openExternal(url).catch(() => {})

  let action: { label: string; run: () => void } | null = null
  if (outcome.kind === "upgrade") action = { label: "Upgrade", run: () => open(PLANS_URL) }
  else if (outcome.kind === "legal") action = { label: "Open the terms", run: () => open(TERMS_URL) }
  else if ((outcome.kind === "retry" || outcome.kind === "error") && onRetry)
    action = { label: "Retry", run: onRetry }

  return (
    <div className="glass">
      <div className="glass-body">
        <p className="max-w-[62ch] text-sm text-white/85">
          {outcome.kind === "auth" ? AUTH_MESSAGE : outcome.message}
        </p>
        {action ? (
          <button type="button" onClick={action.run} className="btn-secondary btn-compact mt-4">
            {action.label}
          </button>
        ) : null}
      </div>
    </div>
  )
}

/** A failure inside a section, where a whole panel would be too loud. */
function InlineFailure({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="glass-tile px-4 py-5 text-center">
      <p className="mx-auto max-w-[52ch] text-[13px] text-white/75">{message}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="btn-secondary btn-compact mt-3">
          Retry
        </button>
      ) : null}
    </div>
  )
}

/** The two kinds of scanner, as the server names them. */
const SCANNER_TYPES: { id: string; label: string; hint: string }[] = [
  { id: "breach", label: "Breach", hint: "Public breach corpora" },
  { id: "stealer", label: "Stealer", hint: "Infostealer logs" },
]

type ListState =
  | { phase: "loading" }
  | { phase: "ready"; monitors: MonitorRow[] }
  | { phase: "failed"; outcome: ClassifiedError }

type RunsState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready"; runs: MonitorRun[] }
  | { phase: "failed"; outcome: ClassifiedError }

export function MonitorScreen() {
  const [state, setState] = useState<ListState>({ phase: "loading" })
  const [email, setEmail] = useState("")
  const [scannerType, setScannerType] = useState("breach")
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<ClassifiedError | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [runs, setRuns] = useState<RunsState>({ phase: "idle" })

  const load = useCallback(async () => {
    setState({ phase: "loading" })
    try {
      const payload = await ipc.monitor("list")
      setState({ phase: "ready", monitors: monitorsFrom(payload) })
    } catch (err) {
      // Never an empty list. A refused or unreachable request that rendered as
      // "no monitors" would tell the user nothing is being watched, which is a
      // different and much worse claim than "we could not load this".
      setState({ phase: "failed", outcome: classifyError(err) })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Follow the list: select the first watch once there is one, and drop a
  // selection whose row is gone.
  useEffect(() => {
    if (state.phase !== "ready") return
    const ids = state.monitors.map((m) => m.id)
    if (selectedId && ids.includes(selectedId)) return
    setSelectedId(ids[0] ?? null)
  }, [state, selectedId])

  const loadRuns = useCallback(async (id: string) => {
    setRuns({ phase: "loading" })
    try {
      const payload = await ipc.monitor("runs", { id })
      setRuns({ phase: "ready", runs: runsFrom(payload) })
    } catch (err) {
      setRuns({ phase: "failed", outcome: classifyError(err) })
    }
  }, [])

  useEffect(() => {
    if (!selectedId) {
      setRuns({ phase: "idle" })
      return
    }
    void loadRuns(selectedId)
  }, [selectedId, loadRuns])

  async function onAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = email.trim().toLowerCase()
    if (!value || adding) return
    setAdding(true)
    setAddError(null)
    try {
      const payload = await ipc.monitor("create", { email: value, scanner_type: scannerType })
      const monitors = monitorsFrom(payload)
      setState({ phase: "ready", monitors })
      setEmail("")
      const created = withDefaults(payload, { monitor: null as unknown })
      const id = toMonitor(created.monitor).id
      if (id) setSelectedId(id)
    } catch (err) {
      setAddError(classifyError(err))
    } finally {
      setAdding(false)
    }
  }

  async function onRemove(id: string) {
    if (removing) return
    setRemoving(id)
    setRemoveError(null)
    try {
      const payload = await ipc.monitor("delete", { id })
      setState({ phase: "ready", monitors: monitorsFrom(payload) })
    } catch (err) {
      // The row stays on screen. Removing it optimistically and putting it back
      // on failure is how a user ends up believing a watch is gone when the
      // server still has it.
      setRemoveError(classifyError(err).message)
    } finally {
      setRemoving(null)
    }
  }

  const monitors = state.phase === "ready" ? state.monitors : []
  const selected = monitors.find((m) => m.id === selectedId) ?? null
  // The server allows one watch per account and answers a second one with a 409.
  // Saying so up front is friendlier than letting the user type an address and
  // then refusing it.
  const atCapacity = monitors.length >= 1
  // Closed while the list is still arriving too. An empty list that has not
  // loaded yet is not proof there is room, and submitting into that gap is how a
  // user meets a 409 they had no way to anticipate.
  const formClosed = adding || atCapacity || state.phase !== "ready"

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]">
          / Monitor
        </p>
        <h1 className="mt-1 flex items-center gap-2 text-3xl font-semibold tracking-tight text-white">
          <BellRing className="h-6 w-6" aria-hidden="true" />
          Monitor
        </h1>
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
          Watch an email for new breaches and stealer-log exposures. The scanner keeps checking on
          its own and records what it finds.
        </p>
      </div>

      {state.phase === "failed" ? (
        // The whole screen, not a corner of it: if the list could not load, the
        // add form would be offering an action that is going to fail the same
        // way, and a Heist refusal applies to every part of this page at once.
        <FailurePanel outcome={state.outcome} onRetry={() => void load()} />
      ) : (
        <>
          <Section title="Add a watch">
            <form onSubmit={onAdd} className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={formClosed}
                  placeholder="target@example.com"
                  aria-label="Email to monitor"
                  className="glass-input min-w-0 flex-1 px-3 py-2 text-[13px]"
                />
                <button
                  type="submit"
                  disabled={!email.trim() || formClosed}
                  aria-busy={adding}
                  className="btn-primary btn-compact"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add watch
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {SCANNER_TYPES.map((type) => {
                  const on = scannerType === type.id
                  const Icon = type.id === "stealer" ? HardDrive : Database
                  return (
                    <button
                      key={type.id}
                      type="button"
                      aria-pressed={on}
                      disabled={formClosed}
                      onClick={() => setScannerType(type.id)}
                      className={on ? "btn-primary btn-compact" : "btn-secondary btn-compact"}
                    >
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                      {type.label}
                    </button>
                  )
                })}
                <span className="text-[12px] text-[var(--color-muted-foreground)]">
                  {SCANNER_TYPES.find((t) => t.id === scannerType)?.hint}
                </span>
              </div>

              {adding ? (
                <p className="font-mono text-[11px] text-[var(--color-muted-foreground)]">
                  Provisioning the scanner. Clearing Cloudflare can take about 30 seconds the first
                  time.
                </p>
              ) : null}

              {atCapacity ? (
                <p className="text-[12px] text-[var(--color-muted-foreground)]">
                  One watch per account. Remove the one below to watch a different address.
                </p>
              ) : null}

              {addError ? <FailurePanel outcome={addError} /> : null}
            </form>
          </Section>

          <Section
            title="Watched"
            action={
              state.phase === "ready" ? (
                <button
                  type="button"
                  onClick={() => void load()}
                  className="btn-secondary btn-compact"
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  Refresh
                </button>
              ) : null
            }
          >
            {state.phase === "loading" ? (
              <p className="text-[13px] text-[var(--color-muted-foreground)]">Loading watches.</p>
            ) : monitors.length === 0 ? (
              <EmptyState message="Nothing is being watched yet. Add an email above to start." />
            ) : (
              <ul className="space-y-2">
                {monitors.map((m) => {
                  const Icon = m.scanner_type === "stealer" ? HardDrive : Database
                  const isSelected = m.id === selectedId
                  return (
                    <li key={m.id}>
                      <div
                        className={`glass-tile flex flex-wrap items-center gap-3 px-4 py-3 ${
                          isSelected ? "" : "opacity-90"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedId(m.id)}
                          aria-pressed={isSelected}
                          className="min-w-0 flex-1 text-left"
                        >
                          <span className="flex items-center gap-2">
                            <Bell className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            <span className="truncate text-[13px] text-white">{m.email}</span>
                            <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted-foreground)]">
                              <Icon className="h-3 w-3" aria-hidden="true" />
                              {m.scanner_type}
                            </span>
                          </span>
                          <span className="mt-1 block font-mono text-[11px] text-[var(--color-muted-foreground)]">
                            {m.status} · last run {relativeTime(m.last_run_at)} ·{" "}
                            {m.total_results_found.toLocaleString("en-US")} found · next{" "}
                            {untilTime(m.next_run_at)}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void onRemove(m.id)}
                          disabled={removing === m.id}
                          aria-busy={removing === m.id}
                          aria-label={`Remove the watch on ${m.email}`}
                          className="btn-secondary btn-compact"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          Remove
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}

            {removeError ? (
              <p className="mt-3 text-[12px] text-white/75">
                The watch could not be removed: {removeError}
              </p>
            ) : null}
          </Section>

          <Section
            title={selected ? `Recent alerts for ${selected.email}` : "Recent alerts"}
            action={
              selected ? (
                <button
                  type="button"
                  onClick={() => void loadRuns(selected.id)}
                  aria-busy={runs.phase === "loading"}
                  className="btn-secondary btn-compact"
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  Refresh
                </button>
              ) : null
            }
          >
            {!selected ? (
              <p className="text-[13px] text-[var(--color-muted-foreground)]">
                Select a watch to see its scan history.
              </p>
            ) : runs.phase === "loading" ? (
              <p className="text-[13px] text-[var(--color-muted-foreground)]">Loading alerts.</p>
            ) : runs.phase === "failed" ? (
              // NOT an empty state. The scanner history could not be read, which
              // says nothing about whether this address has been exposed.
              <InlineFailure
                message={
                  runs.outcome.kind === "auth"
                    ? AUTH_MESSAGE
                    : `The scan history could not be loaded, so this is not a clean result: ${runs.outcome.message}`
                }
                onRetry={
                  runs.outcome.kind === "upgrade" || runs.outcome.kind === "auth"
                    ? undefined
                    : () => void loadRuns(selected.id)
                }
              />
            ) : runs.phase === "ready" && runs.runs.length === 0 ? (
              <EmptyState message="No scans have finished yet. The scanner runs on its own schedule and the first alert lands after it does." />
            ) : (
              <ul className="space-y-2">
                {runs.phase === "ready"
                  ? runs.runs.map((run, index) => {
                      const summary = runSummary(run)
                      const samples = run.results_sample
                        .slice(0, 3)
                        .map(sampleLine)
                        .filter((line) => line !== "")
                      return (
                        <li key={run.uid || index} className="glass-tile px-4 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <ShieldCheck
                              className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]"
                              aria-hidden="true"
                            />
                            <span className="text-[13px] text-white">{summary.text}</span>
                            <span className="ml-auto font-mono text-[10px] text-[var(--color-muted-foreground)]">
                              {relativeTime(run.completed_at ?? run.started_at)}
                            </span>
                          </div>
                          {run.error_message ? (
                            <p className="mt-1 text-[12px] text-white/70">{run.error_message}</p>
                          ) : (
                            samples.map((line, i) => (
                              <p
                                key={i}
                                className="mt-1 truncate font-mono text-[11px] text-[var(--color-muted-foreground)]"
                              >
                                {line}
                              </p>
                            ))
                          )}
                        </li>
                      )
                    })
                  : null}
              </ul>
            )}
          </Section>
        </>
      )}
    </div>
  )
}
