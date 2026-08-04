import { Database, KeyRound, Layers, Radar } from "lucide-react"

import { list } from "../safe"
import { EmptyState, RecordCard, StatTiles, type LeakField, type LeakRecord, type StatTile } from "../ui"
import type { StreamFrame, StreamModuleDescriptor, StreamResultProps, StreamStatus } from "../stream-types"

/**
 * Search: breach records streamed as each source finishes.
 *
 * Mirrors the web Search page's three modes (Email / Username / Domain), each
 * of which the server meters as its own web route. The mode toggle picks which
 * `search-*` stream module to run; the frames are the identical
 * `{t:"progress", records, checked, total, hits}` / `{t:"done", stats}` shape
 * the web page consumes.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const USERNAME_RE = /^@?[A-Za-z0-9._-]{2,32}$/
// Advisory only. The server normalises and is the authority; this just keeps an
// obviously-not-a-domain value from becoming a metered request.
const DOMAIN_RE = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/.*)?$/i

type RawField = { label?: unknown; value?: unknown; sensitive?: unknown }
type RawRecord = { source?: unknown; fields?: unknown }

/** A stable, human string from an untrusted field. */
function text(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value)
}

/**
 * Merge the record lists from every progress frame, de-duplicating by source and
 * field values, exactly as the web page does. Re-derived from all frames on each
 * render, so the view always reflects precisely what has arrived.
 */
function mergedRecords(frames: StreamFrame[]): LeakRecord[] {
  const seen = new Set<string>()
  const out: LeakRecord[] = []
  for (const frame of frames) {
    if (frame.t !== "progress") continue
    for (const raw of list<RawRecord>(frame.records)) {
      const source = text(raw?.source) || "Unknown source"
      const fields: LeakField[] = list<RawField>(raw?.fields).map((f) => ({
        label: text(f?.label),
        value: text(f?.value),
        // The server's own sensitivity flag: a captured secret, tinted and
        // monospaced so it never reads as ordinary profile text.
        sensitive: f?.sensitive === true,
      }))
      const key = `${source}|${fields.map((f) => `${f.label}=${f.value}`).join("|")}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ source, fields })
    }
  }
  return out.slice(0, 500)
}

/** The most recent progress/done counters, coerced to numbers. */
function progress(frames: StreamFrame[]): { checked: number; total: number; hits: number } {
  let checked = 0
  let total = 0
  let hits = 0
  for (const frame of frames) {
    if (frame.t === "progress") {
      if (typeof frame.checked === "number") checked = frame.checked
      if (typeof frame.total === "number") total = frame.total
      if (typeof frame.hits === "number") hits = frame.hits
    } else if (frame.t === "done" && frame.stats && typeof frame.stats === "object") {
      const s = frame.stats as Record<string, unknown>
      if (typeof s.modulesQueried === "number") checked = s.modulesQueried
      if (typeof s.modulesHit === "number") hits = s.modulesHit
    }
  }
  return { checked, total, hits }
}

/** A leaked secret is any field the server flagged sensitive. */
function secretCount(records: LeakRecord[]): number {
  let n = 0
  for (const r of records) for (const f of r.fields) if (f.sensitive) n += 1
  return n
}

/** The distinct sources that actually returned a record. */
function sourceCount(records: LeakRecord[]): number {
  return new Set(records.map((r) => r.source)).size
}

/**
 * The summary tiles that open the result, deriving every figure from the frames
 * so the row always states exactly what has arrived. This mirrors the web page's
 * Records / Passwords / Sources header rather than the old flat field grid.
 */
function summaryTiles(
  records: LeakRecord[],
  counters: { checked: number; total: number; hits: number },
): StatTile[] {
  const { checked, total, hits } = counters
  const sources = sourceCount(records)
  return [
    {
      icon: Database,
      label: "Records",
      value: records.length,
      caption: records.length === 1 ? "leaked record found" : "leaked records found",
    },
    {
      icon: KeyRound,
      label: "Passwords",
      value: secretCount(records),
      caption: "exposed secrets",
    },
    {
      icon: Layers,
      label: "Sources",
      value: sources,
      caption: `${hits} of ${checked} returned data`,
    },
    {
      icon: Radar,
      label: "Queried",
      value: total > 0 ? `${checked}/${total}` : String(checked),
      caption: total > 0 ? "sources checked" : "sources checked so far",
    },
  ]
}

/** Copy for the empty state, distinguishing a failed sweep from a clean miss. */
function emptyMessage(status: StreamStatus): string {
  if (status === "streaming") {
    return "Querying breach sources. Records appear here as each source answers."
  }
  if (status === "cancelled") return "Search cancelled before any records were found."
  if (status === "error") return "The search stopped before finishing. Retry to run it again."
  return "No records found for this search."
}

function SearchResult({ frames, status }: StreamResultProps) {
  const records = mergedRecords(frames)
  const counters = progress(frames)
  const streaming = status === "streaming"

  return (
    <div className="space-y-5">
      <StatTiles tiles={summaryTiles(records, counters)} />

      {streaming ? (
        <div className="glass-tile flex items-center gap-3 px-4 py-2.5 text-[12px] text-white/70">
          <span
            className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[var(--color-positive)]"
            aria-hidden="true"
          />
          <span>
            Searching sources. {records.length}{" "}
            {records.length === 1 ? "record" : "records"} so far across {sourceCount(records)}{" "}
            {sourceCount(records) === 1 ? "source" : "sources"}.
          </span>
        </div>
      ) : null}

      {records.length === 0 ? (
        <EmptyState message={emptyMessage(status)} />
      ) : (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-white">Breach and leak records</h3>
            <span className="glass-tile px-1.5 py-0.5 font-mono text-[10px] text-white/70">
              {records.length}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {records.map((record, i) => (
              <RecordCard key={`${record.source}-${i}`} record={record} />
            ))}
          </div>
        </section>
      )}

      {status === "cancelled" && records.length > 0 ? (
        <p className="text-[12px] text-white/60">
          Cancelled. Showing the sources that answered before you stopped.
        </p>
      ) : null}
    </div>
  )
}

export const searchDescriptor: StreamModuleDescriptor = {
  id: "search",
  route: "/search",
  label: "Search",
  modes: [
    { id: "email", label: "Email" },
    { id: "username", label: "Username" },
    { id: "domain", label: "Domain" },
  ],
  inputs: [
    {
      name: "query",
      label: "Query",
      placeholder: "Email, username, or domain",
      // Non-empty only here; the mode-specific check lives in resolve, since a
      // field validator cannot see which mode is selected.
      validate: (v) => (v.trim() ? null : "Enter something to search for."),
    },
  ],
  resolve: (values, mode) => {
    const query = (values.query ?? "").trim()
    if (!query) return { error: "Enter something to search for." }

    if (mode === "username") {
      if (!USERNAME_RE.test(query)) {
        return { error: "Enter a valid username (2 to 32 letters, digits, . _ or -)." }
      }
      return { module: "search-username", input: { query } }
    }
    if (mode === "domain") {
      if (!DOMAIN_RE.test(query)) return { error: "Enter a valid domain like example.com." }
      return { module: "search-domain", input: { query } }
    }
    // Email is the default mode.
    if (!EMAIL_RE.test(query)) return { error: "Enter a valid email address." }
    return { module: "search-email", input: { query } }
  },
  Result: SearchResult,
}
