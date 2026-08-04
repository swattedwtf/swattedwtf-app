import { list } from "../safe"
import { EmptyState, FieldGrid, Section, type Field } from "../ui"
import type { StreamFrame, StreamModuleDescriptor, StreamResultProps } from "../stream-types"

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

type RecordField = { label?: unknown; value?: unknown; sensitive?: unknown }
type LeakRecord = { source?: unknown; fields?: unknown }

/** A stable, human string from an untrusted field. */
function text(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value)
}

/**
 * Merge the record lists from every progress frame, de-duplicating by source and
 * field values, exactly as the web page does. Re-derived from all frames on each
 * render, so the view always reflects precisely what has arrived.
 */
function mergedRecords(frames: StreamFrame[]): { source: string; fields: Field[] }[] {
  const seen = new Set<string>()
  const out: { source: string; fields: Field[] }[] = []
  for (const frame of frames) {
    if (frame.t !== "progress") continue
    for (const raw of list<LeakRecord>(frame.records)) {
      const source = text(raw?.source) || "Unknown source"
      const fields: Field[] = list<RecordField>(raw?.fields).map((f) => ({
        label: text(f?.label),
        value: text(f?.value),
        // A leaked password reads better monospaced, like every other opaque
        // value in the app.
        mono: f?.sensitive === true,
      }))
      const key = `${source}|${fields.map((f) => `${f.label}=${String(f.value)}`).join("|")}`
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

function SearchResult({ frames, status }: StreamResultProps) {
  const records = mergedRecords(frames)
  const { checked, total, hits } = progress(frames)

  const summary: Field[] = [
    { label: "Sources checked", value: total > 0 ? `${checked} of ${total}` : String(checked) },
    { label: "Sources with hits", value: String(hits) },
    { label: "Records", value: String(records.length) },
  ]

  return (
    <div className="space-y-4">
      <Section title={status === "streaming" ? "Searching sources" : "Sweep summary"}>
        <FieldGrid fields={summary} />
      </Section>

      {records.length === 0 ? (
        <EmptyState
          message={
            status === "streaming"
              ? "Querying breach sources. Records appear here as each source answers."
              : status === "cancelled"
                ? "Search cancelled before any records were found."
                : status === "error"
                  ? "The search stopped before finishing. Retry to run it again."
                  : "No records found for this search."
          }
        />
      ) : (
        records.map((record, i) => (
          <Section key={`${record.source}-${i}`} title={record.source}>
            <FieldGrid fields={record.fields} />
          </Section>
        ))
      )}

      {status === "cancelled" && records.length > 0 ? (
        <p className="text-[12px] text-[var(--color-muted-foreground)]">
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
