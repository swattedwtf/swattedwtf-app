import { useState } from "react"
import { Loader2, MessageSquare, Search, Send } from "lucide-react"

import { ipc } from "../lib/ipc"
import { classifyError } from "../lib/errors"
import { PageHeader } from "./PageHeader"
import { EmptyState } from "./ui"

/**
 * Telegram Messages, the app port of the web's indexed-message archive search
 * (components/dashboard/telegram/telegram-messages.tsx). Three search modes
 * (keywords / author / channel), a results list, and offset paging via Load
 * more. Backed by the `telegram-messages` desktop module (ipc.lookup), which
 * reads the same scrape archive the web route reads. Heist-gated server-side.
 */

type Mode = "words" | "author" | "channel"

type MsgResult = {
  channelId: number
  channelTitle: string
  channelUsername: string | null
  messageId: number
  senderId: number | null
  senderUsername: string | null
  text: string
  ts: number
  link: string | null
}

type Sender = { userId: number; username: string | null; firstName: string; lastName: string }

const MODES: { value: Mode; label: string }[] = [
  { value: "words", label: "Keywords" },
  { value: "author", label: "Author" },
  { value: "channel", label: "Channel" },
]

const PLACEHOLDER: Record<Mode, string> = {
  words: "Search message text…",
  author: "@username or user id",
  channel: "@channel or channel id",
}

function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

function fmtTime(ts: number): string {
  if (!ts) return ""
  const d = new Date(ts * 1000)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

function senderName(r: MsgResult, senders: Record<string, Sender>): string {
  const s = r.senderId != null ? senders[String(r.senderId)] : undefined
  if (s) {
    const full = [s.firstName, s.lastName].filter(Boolean).join(" ").trim()
    if (full) return s.username ? `${full} (@${s.username})` : full
    if (s.username) return `@${s.username}`
  }
  if (r.senderUsername) return `@${r.senderUsername}`
  return r.senderId ? `user ${r.senderId}` : "Unknown sender"
}

export function TelegramMessagesScreen() {
  const [mode, setMode] = useState<Mode>("words")
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<MsgResult[]>([])
  const [senders, setSenders] = useState<Record<string, Sender>>({})
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [offset, setOffset] = useState(0)
  const [status, setStatus] = useState<"idle" | "loading" | "loadingMore" | "loaded">("idle")
  const [error, setError] = useState<string | null>(null)

  async function runSearch(nextOffset: number) {
    const q = query.trim()
    if (!q) return
    // Never run two requests at once: a Load-more in flight must not race a fresh
    // search, or the old page's rows get appended onto the new result set.
    if (status === "loading" || status === "loadingMore") return
    setError(null)
    // A fresh search clears the previous results up front, so a search that then
    // errors shows the error alone rather than the old query's rows beneath it.
    if (nextOffset === 0) {
      setResults([])
      setSenders({})
      setTotal(0)
      setHasMore(false)
    }
    setStatus(nextOffset === 0 ? "loading" : "loadingMore")
    try {
      const res = await ipc.lookup("telegram-messages", { query: q, mode, offset: String(nextOffset) })
      const data = (res.data ?? {}) as Record<string, unknown>
      const pageResults = arr<MsgResult>(data.results)
      const pageSenders = (data.senders ?? {}) as Record<string, Sender>
      setResults((prev) => (nextOffset === 0 ? pageResults : [...prev, ...pageResults]))
      setSenders((prev) => (nextOffset === 0 ? pageSenders : { ...prev, ...pageSenders }))
      setTotal(typeof data.total === "number" ? data.total : pageResults.length)
      setHasMore(data.hasMore === true)
      setOffset(nextOffset + pageResults.length)
      setStatus("loaded")
    } catch (err) {
      setError(classifyError(err).message || "That search could not be completed.")
      setStatus(nextOffset === 0 ? "idle" : "loaded")
    }
  }

  const busy = status === "loading"
  const loadingMore = status === "loadingMore"

  return (
    <div>
      <PageHeader icon={MessageSquare} title="Telegram Messages" description="Search the indexed message archive by keyword, author, or channel." />

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void runSearch(0)
        }}
        className="mt-6 space-y-3"
      >
        <div className="flex flex-wrap gap-1.5">
          {MODES.map((m) => {
            const active = mode === m.value
            return (
              <button
                key={m.value}
                type="button"
                onClick={() => setMode(m.value)}
                className={`rounded-full border px-4 py-1.5 text-[12px] transition-colors ${
                  active
                    ? "border-white/40 bg-white text-black"
                    : "border-[var(--color-border)] bg-white/[0.02] text-[var(--color-muted-foreground)] hover:text-white"
                }`}
              >
                {m.label}
              </button>
            )
          })}
        </div>

        <div className="flex gap-2">
          <div className="flex h-11 flex-1 items-center gap-2 rounded-xl border border-[var(--color-border)] bg-white/[0.02] px-3">
            <Search className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={PLACEHOLDER[mode]}
              className="h-full w-full bg-transparent text-[13px] text-white placeholder:text-[var(--color-muted-foreground)] focus:outline-none"
            />
          </div>
          <button type="submit" disabled={!query.trim() || busy} className="btn-primary btn-compact shrink-0 px-6">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : "Search"}
          </button>
        </div>
      </form>

      {error && (
        <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-[12px] text-amber-300">
          {error}
        </div>
      )}

      <div className="mt-6">
        {status === "idle" && !error ? (
          <EmptyState message="Enter a query to search the archived Telegram messages." />
        ) : busy ? (
          <div className="flex items-center gap-2 text-[13px] text-[var(--color-muted-foreground)]">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Searching the archive…
          </div>
        ) : status === "loaded" && results.length === 0 ? (
          <EmptyState message="No messages matched that search." />
        ) : results.length > 0 ? (
          <>
            <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-muted-foreground)]">
              {total.toLocaleString()} {total === 1 ? "message" : "messages"}
            </p>
            <ul className="space-y-2.5">
              {results.map((r, i) => (
                <li key={`${r.channelId}-${r.messageId}-${i}`} className="rounded-xl border border-[var(--color-border)] bg-white/[0.02] p-3.5">
                  <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                    <span className="inline-flex items-center gap-1.5 text-white/85">
                      <Send className="h-3 w-3 text-[var(--color-muted-foreground)]" aria-hidden />
                      <span className="font-medium">{r.channelTitle || r.channelUsername || `Channel ${r.channelId}`}</span>
                    </span>
                    <span className="text-[var(--color-muted-foreground)]">·</span>
                    <span className="text-[var(--color-muted-foreground)]">{senderName(r, senders)}</span>
                    <span className="ml-auto font-mono text-[10px] text-[var(--color-muted-foreground)]">{fmtTime(r.ts)}</span>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-white/80">
                    {r.text || "(no text)"}
                  </p>
                  {r.link ? (
                    <button
                      type="button"
                      onClick={() => void ipc.openExternal(r.link as string).catch(() => {})}
                      className="mt-2 text-[11px] text-sky-300 underline decoration-sky-300/30 underline-offset-2 hover:decoration-sky-300"
                    >
                      Open in Telegram
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            {hasMore ? (
              <button
                type="button"
                onClick={() => void runSearch(offset)}
                disabled={loadingMore}
                className="btn-secondary btn-compact mt-4"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  )
}
