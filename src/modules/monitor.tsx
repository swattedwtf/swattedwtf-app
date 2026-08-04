import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react"
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
import { PLANS_URL } from "./ui"
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
 * The web's structure is reproduced section for section: an icon header with the
 * scanner count on the right, then the add row, then a two-column body with the
 * watch list on the left and that watch's scanner runs on the right.
 *
 * HEIST ONLY, exactly as on the web. Every monitor route on the server runs
 * `requireFeatureAccess(user, "heist")`, so an account below Heist is refused
 * with a 402 `heist_required` whatever it asks for. This screen does not
 * re-implement that decision: it asks the server, and a refusal renders as the
 * upgrade panel carrying the server's own copy. That way the gate cannot drift
 * out of step with the web by a client release.
 *
 * WHAT IS NOT HERE: the web's lightning bolt, which triggers a scan by hand.
 * That route calls `chargeForSearch`, so it is metered; the desktop transport is
 * not, and a cheaper way to hit the same upstream is exactly the kind of drift
 * the two surfaces must not develop. Pausing a watch is absent for the same
 * reason it is absent from the desktop transport: there is no action for it.
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
 * How many watches an account may hold. The server answers a second one with a
 * 409, so this is the number the header counts against rather than a guess.
 */
export const WATCH_LIMIT = 1

/**
 * The copy shown when the account genuinely watches nothing.
 *
 * Exported because "nothing is being watched" and "the list has not loaded" are
 * different claims and only one of them is safe to make. A test proves the first
 * is absent from a screen that has not loaded, which needs the string once.
 */
export const NO_WATCHES_TITLE = "No monitors yet"

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

/** The dot colour each outcome wears, so the three never share one. */
const TONE_DOT: Record<"hit" | "clear" | "failed", string> = {
  hit: "bg-amber-400",
  clear: "bg-emerald-400",
  failed: "bg-red-400",
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
    <div className="glass fade-in">
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
export const SCANNER_TYPES: { id: string; label: string; hint: string }[] = [
  { id: "breach", label: "Breach", hint: "Public breach corpora" },
  { id: "stealer", label: "Stealer", hint: "Infostealer logs" },
]

/**
 * The alert pane's caption, in two pieces.
 *
 * The pane names the watch it is showing, because with a watch selected it is
 * that address's history and not a general one. The address is deliberately NOT
 * part of the mono caps caption: an email set in capitals reads as a different
 * address from the one the user typed, and the row above it shows the lowercase
 * form the server holds.
 */
export function runsTitle(email: string | null): { caption: string; subject: string | null } {
  return { caption: "Runs", subject: email && email !== "" ? email : null }
}

/** The mono caption the web sets above each of the two columns. */
function ListCaption({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <h2 className="min-w-0 truncate font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]">
        {title}
      </h2>
      {detail ? (
        <span className="shrink-0 font-mono text-[11px] text-white/70">{detail}</span>
      ) : null}
    </div>
  )
}

/** "Nothing here yet", the way the web draws it: a ringed icon over two lines. */
function EmptyPanel({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="glass-tile flex flex-col items-center justify-center px-6 py-12 text-center">
      <span className="glass-tile grid h-12 w-12 place-items-center rounded-2xl">
        <Bell className="h-5 w-5 text-white/70" aria-hidden="true" />
      </span>
      <p className="mt-4 text-sm font-medium text-white">{title}</p>
      <p className="mt-1 max-w-[46ch] text-xs text-white/70">{detail}</p>
    </div>
  )
}

/**
 * One watched address.
 *
 * Exported so the row can be rendered against a fixture and checked for the
 * fields it is supposed to carry, rather than by matching a sentence.
 */
export function WatchRow({
  monitor,
  selected,
  removing,
  onSelect,
  onRemove,
}: {
  monitor: MonitorRow
  selected: boolean
  removing: boolean
  onSelect: () => void
  onRemove: () => void
}) {
  const Icon = monitor.scanner_type === "stealer" ? HardDrive : Database
  const active = monitor.status === "active"

  return (
    <div
      className={`glass-tile glass-tile-hover flex flex-wrap items-center gap-3 px-4 py-3 ${
        selected ? "" : "opacity-85"
      }`}
    >
      <span className="glass-tile grid h-9 w-9 shrink-0 place-items-center rounded-xl">
        <Bell className={`h-4 w-4 ${active ? "text-emerald-300" : "text-white/60"}`} aria-hidden="true" />
      </span>

      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className="min-w-0 flex-1 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-medium text-white">{monitor.email}</span>
          <span className="glass-tile inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-white/70">
            <Icon className="h-2.5 w-2.5" aria-hidden="true" />
            {monitor.scanner_type}
          </span>
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-white/70">
          <span
            aria-hidden="true"
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              active ? "bg-emerald-400 live-dot" : "bg-white/30"
            }`}
          />
          <span>
            {monitor.status} · last run {relativeTime(monitor.last_run_at)} ·{" "}
            {monitor.total_results_found.toLocaleString("en-US")} found · next{" "}
            {untilTime(monitor.next_run_at)}
          </span>
        </span>
      </button>

      <button
        type="button"
        onClick={onRemove}
        disabled={removing}
        aria-busy={removing}
        aria-label={`Remove the watch on ${monitor.email}`}
        className="btn-secondary btn-compact shrink-0"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        Remove
      </button>
    </div>
  )
}

/**
 * One finished scan in the alert history.
 *
 * The dot and the headline come from `runSummary`, so a failed scan cannot pick
 * up the wording or the colour of a clean one.
 */
export function RunRow({ run }: { run: MonitorRun }) {
  const summary = runSummary(run)
  const samples = run.results_sample.slice(0, 3).map(sampleLine).filter((line) => line !== "")

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[summary.tone]}`}
        />
        <span className="text-[13px] font-medium text-white">{summary.text}</span>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-white/50">
          {relativeTime(run.completed_at ?? run.started_at)}
        </span>
      </div>
      {run.error_message ? (
        <p className="mt-1 pl-3.5 text-[12px] text-white/70">{run.error_message}</p>
      ) : (
        samples.map((line, i) => (
          <p key={i} className="mt-1 truncate pl-3.5 font-mono text-[11px] text-white/70">
            {line}
          </p>
        ))
      )}
    </div>
  )
}

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
  const activeCount = monitors.filter((m) => m.status === "active").length
  // The server allows one watch per account and answers a second one with a 409.
  // Saying so up front is friendlier than letting the user type an address and
  // then refusing it.
  const atCapacity = monitors.length >= WATCH_LIMIT
  // Closed while the list is still arriving too. An empty list that has not
  // loaded yet is not proof there is room, and submitting into that gap is how a
  // user meets a 409 they had no way to anticipate.
  const formClosed = adding || atCapacity || state.phase !== "ready"

  return (
    <div className="mx-auto w-full max-w-5xl space-y-7">
      <div className="fade-in flex flex-wrap items-start gap-4">
        <span className="glass-tile grid h-11 w-11 shrink-0 place-items-center rounded-2xl">
          <BellRing className="h-5 w-5 text-white" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]">
            / Monitor
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">Monitor</h1>
          <p className="mt-1 max-w-[70ch] text-sm text-white/70">
            Watch an email for new breaches and stealer-log exposures. The OathNet scanner keeps
            checking on its own and tells you when something turns up.
          </p>
        </div>
        {state.phase === "ready" ? (
          <span className="glass-tile shrink-0 rounded-full px-3 py-1.5 font-mono text-[11px] text-white/70">
            {monitors.length.toLocaleString("en-US")} / {WATCH_LIMIT.toLocaleString("en-US")}{" "}
            {WATCH_LIMIT === 1 ? "scanner" : "scanners"}
          </span>
        ) : null}
      </div>

      {state.phase === "failed" ? (
        // The whole screen, not a corner of it: if the list could not load, the
        // add form would be offering an action that is going to fail the same
        // way, and a Heist refusal applies to every part of this page at once.
        <FailurePanel outcome={state.outcome} onRetry={() => void load()} />
      ) : (
        <>
          {/* Add a watch. One row, the way the web opens the page. */}
          <form onSubmit={onAdd} className="fade-in space-y-2">
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={formClosed}
                placeholder="Email to monitor, for example target@example.com"
                aria-label="Email to monitor"
                className="glass-input h-11 min-w-0 flex-1 select-text px-4 text-sm outline-none"
              />
              <div className="glass-tile flex shrink-0 items-center gap-1 rounded-full p-1">
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
              </div>
              <button
                type="submit"
                disabled={!email.trim() || formClosed}
                aria-busy={adding}
                className="btn-primary shrink-0"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add monitor
              </button>
            </div>

            <p className="text-[12px] text-white/70">
              {SCANNER_TYPES.find((t) => t.id === scannerType)?.hint}
              {atCapacity
                ? ". One watch per account, so remove the one below to watch a different address."
                : null}
            </p>

            {adding ? (
              <p className="flex items-center gap-2 font-mono text-[11px] text-white/70">
                <span aria-hidden="true" className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Provisioning the scanner. Clearing Cloudflare can take about 30 seconds the first
                time.
              </p>
            ) : null}

            {addError ? <FailurePanel outcome={addError} /> : null}
          </form>

          <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
            {/* The watch list. */}
            <div className="space-y-3">
              <ListCaption
                title="Monitored emails"
                detail={
                  state.phase === "ready" && monitors.length > 0
                    ? `${activeCount.toLocaleString("en-US")} active`
                    : undefined
                }
              />

              {state.phase === "loading" ? (
                <div className="skeleton h-[68px]" aria-hidden="true" />
              ) : monitors.length === 0 ? (
                <EmptyPanel
                  title={NO_WATCHES_TITLE}
                  detail="Add an email above to start watching it."
                />
              ) : (
                <ul className="space-y-2">
                  {monitors.map((m, index) => (
                    <li key={m.id} className="stagger-item" style={{ "--i": index } as CSSProperties}>
                      <WatchRow
                        monitor={m}
                        selected={m.id === selectedId}
                        removing={removing === m.id}
                        onSelect={() => setSelectedId(m.id)}
                        onRemove={() => void onRemove(m.id)}
                      />
                    </li>
                  ))}
                </ul>
              )}

              {removeError ? (
                <p className="text-[12px] text-white/75">
                  The watch could not be removed: {removeError}
                </p>
              ) : null}
            </div>

            {/* The alert history for whichever watch is selected. */}
            <aside className="glass fade-in flex flex-col overflow-hidden self-start">
              <div className="flex items-center gap-2 border-b border-white/[0.08] px-4 py-2.5">
                <ShieldCheck
                  className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]"
                  aria-hidden="true"
                />
                <h2 className="flex min-w-0 flex-1 items-baseline gap-2">
                  <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]">
                    {runsTitle(selected?.email ?? null).caption}
                  </span>
                  {runsTitle(selected?.email ?? null).subject ? (
                    <span className="min-w-0 truncate font-mono text-[11px] text-white/70">
                      · {runsTitle(selected?.email ?? null).subject}
                    </span>
                  ) : null}
                </h2>
                {selected ? (
                  <button
                    type="button"
                    onClick={() => void loadRuns(selected.id)}
                    aria-busy={runs.phase === "loading"}
                    aria-label="Refresh the scan history"
                    className="btn-secondary btn-compact shrink-0"
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                ) : null}
              </div>

              {!selected ? (
                <p className="px-4 py-6 text-center text-[13px] text-white/70">
                  Select a watch to see its scan history.
                </p>
              ) : runs.phase === "loading" ? (
                <div className="space-y-2 p-4" aria-hidden="true">
                  <div className="skeleton h-10" />
                  <div className="skeleton h-10" />
                  <div className="skeleton h-10" />
                </div>
              ) : runs.phase === "failed" ? (
                // NOT an empty state. The scanner history could not be read, which
                // says nothing about whether this address has been exposed.
                <div className="p-4">
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
                </div>
              ) : runs.phase === "ready" && runs.runs.length === 0 ? (
                <p className="px-4 py-6 text-center text-[13px] text-white/70">
                  No scans have finished yet. The scanner runs on its own schedule and the first
                  alert lands after it does.
                </p>
              ) : (
                <ul>
                  {runs.phase === "ready"
                    ? runs.runs.map((run, index) => (
                        <li
                          key={run.uid || index}
                          className={`stagger-item ${index > 0 ? "border-t border-white/[0.06]" : ""}`}
                          style={{ "--i": index } as CSSProperties}
                        >
                          <RunRow run={run} />
                        </li>
                      ))
                    : null}
                </ul>
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  )
}
