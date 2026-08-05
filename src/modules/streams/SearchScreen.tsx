import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { ArrowRight, ArrowUp, AtSign, Globe, LayoutGrid, Loader2, User } from "lucide-react"

import { classifyError, type ClassifiedError } from "../../lib/errors"
import { startStream, type StreamFrame, type StreamHandle } from "../../lib/ipc"
import { OutcomePanel } from "../ModuleScreen"
import type { StreamStatus } from "../stream-types"
import { searchDescriptor } from "./search"

/**
 * The Search screen, hand-built to match swattedw.tf/dashboard/search rather
 * than rendered by the generic StreamScreen.
 *
 * Every other streaming module is fine with StreamScreen's title-plus-field
 * chrome, but the web's Search is a bespoke hero: a centred "What would you
 * like to investigate?" prompt, a single composer that carries its Email /
 * Username / Domain toggle and submit arrow inline, and a Browse Modules card
 * under it while the page is at rest. Reproducing that here is why Search owns
 * its own screen, exactly as Face, Monitor and Plans each own theirs.
 *
 * The transport is unchanged. This reuses `searchDescriptor.resolve` (so the
 * per-mode validation and metered-module choice stay in one place), the shared
 * `startStream`, and `searchDescriptor.Result` (the same StatTiles / filter
 * tabs / record grid every result uses). Only the entry surface is new.
 */

type Mode = "email" | "username" | "domain"

const MODES: { id: Mode; label: string; icon: typeof AtSign }[] = [
  { id: "email", label: "Email", icon: AtSign },
  { id: "username", label: "Username", icon: User },
  { id: "domain", label: "Domain", icon: Globe },
]

// The same renderer StreamScreen hands frames to; pulled off the descriptor so
// there is exactly one Search result view and it can never drift from the one
// the tests assert against.
const Result = searchDescriptor.Result

export function SearchScreen({
  onNavigate,
  initial,
  onPrefillConsumed,
}: {
  onNavigate: (route: string) => void
  /** A query handed over from the quick-lookup overlay: run automatically. */
  initial?: { query: string; mode?: string | null }
  onPrefillConsumed?: () => void
}) {
  const [query, setQuery] = useState(initial?.query ?? "")
  const [mode, setMode] = useState<Mode>((initial?.mode as Mode) ?? "email")
  // A shape the client can already reject (bad email, short username): shown
  // under the composer, never spent as a request.
  const [error, setError] = useState<string | null>(null)

  const [status, setStatus] = useState<StreamStatus>("idle")
  const [frames, setFrames] = useState<StreamFrame[]>([])
  // Connect-time refusal (402/429/dead session), rendered by the shared panel.
  const [refusal, setRefusal] = useState<ClassifiedError | null>(null)
  // A mid-stream failure, distinct from "done with nothing".
  const [streamError, setStreamError] = useState<string | null>(null)

  const handleRef = useRef<StreamHandle | null>(null)
  // Monotonic run id: a frame from a superseded search must never land in a
  // newer run's results.
  const runIdRef = useRef(0)

  const stop = useCallback(() => {
    handleRef.current?.cancel()
    handleRef.current = null
  }, [])

  // Cancel a live stream if the screen goes away.
  useEffect(() => () => stop(), [stop])

  const run = useCallback(async (rawQuery: string, m: Mode) => {
    const q = rawQuery.trim()
    if (!q) {
      setError("Enter something to search for.")
      return
    }
    const resolved = searchDescriptor.resolve({ query: q }, m)
    if ("error" in resolved) {
      setError(resolved.error)
      return
    }
    setError(null)

    // Supersede any running search and start a fresh run.
    stop()
    const runId = ++runIdRef.current
    setFrames([])
    setRefusal(null)
    setStreamError(null)
    setStatus("streaming")

    const live = () => runId === runIdRef.current

    try {
      const handle = await startStream(resolved.module, resolved.input, {
        onFrame: (frame) => {
          if (!live()) return
          if (frame.t === "error") {
            setStreamError(typeof frame.error === "string" ? frame.error : "Lookup failed")
            setStatus("error")
            return
          }
          setFrames((prev) => [...prev, frame])
        },
        onDone: () => {
          if (!live()) return
          handleRef.current = null
          setStatus((s) => (s === "error" ? s : "done"))
        },
        onError: (message) => {
          if (!live()) return
          handleRef.current = null
          setStreamError(message)
          setStatus("error")
        },
      })
      if (!live()) {
        handle.cancel()
        return
      }
      handleRef.current = handle
    } catch (err) {
      if (!live()) return
      setRefusal(classifyError(err))
      setStatus("idle")
    }
  }, [stop])

  const submit = useCallback(() => void run(query, mode), [run, query, mode])

  // A quick-lookup handoff runs itself once, with the values it arrived with, so
  // it never races the query/mode state it also seeds for display.
  const didPrefill = useRef(false)
  useEffect(() => {
    if (didPrefill.current || !initial?.query) return
    didPrefill.current = true
    void run(initial.query, (initial.mode as Mode) ?? "email")
    onPrefillConsumed?.()
  }, [initial, run, onPrefillConsumed])

  const busy = status === "streaming"
  const active = status !== "idle"

  return (
    <div className="mx-auto w-full max-w-5xl fade-in">
      {/* Hero. Centred and tall at rest so the composer sits in the optical
          middle of the screen; collapsed to the top once a search is running so
          the results own the space, exactly as the web page transitions. */}
      <div
        className={
          active
            ? "mx-auto max-w-2xl pt-1"
            : "mx-auto flex min-h-[42vh] max-w-2xl flex-col justify-center text-center"
        }
      >
        {!active ? (
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
            What would you like to investigate?
          </h1>
        ) : null}
        <div className={active ? "mt-0 text-left" : "mt-7 text-left"}>
          <Composer
            value={query}
            onChange={(v) => {
              setQuery(v)
              if (error) setError(null)
            }}
            onSubmit={() => void submit()}
            busy={busy}
            mode={mode}
            onMode={setMode}
            onCancel={
              busy
                ? () => {
                    stop()
                    setStatus("cancelled")
                  }
                : undefined
            }
          />
        </div>
        {error ? (
          <p role="alert" className="mt-2 text-left text-xs text-[var(--color-destructive)]">
            {error}
          </p>
        ) : !active ? (
          <p className="mt-3 font-mono text-[11px] text-[var(--color-muted-foreground)]">
            Press Enter to run {mode === "email" ? "an" : "a"} {mode} lookup
          </p>
        ) : null}
      </div>

      {/* Idle: the web's Browse OSINT Modules card. */}
      {status === "idle" && !refusal ? <BrowseModules onNavigate={onNavigate} /> : null}

      {refusal ? (
        <div className="mx-auto mt-6 max-w-2xl">
          <OutcomePanel outcome={refusal} onRetry={() => void submit()} />
        </div>
      ) : null}

      {/* Running / done / mid-stream error. A stream error shows the shared
          panel AND whatever records arrived before it, matching StreamScreen. */}
      {active && !refusal ? (
        <div className="mt-8 space-y-6">
          {status === "error" && streamError ? (
            <OutcomePanel
              outcome={{ kind: "error", message: streamError } as ClassifiedError}
              onRetry={() => void submit()}
            />
          ) : null}
          <Result frames={frames} status={status} error={streamError} />
        </div>
      ) : null}
    </div>
  )
}

function Composer({
  value,
  onChange,
  onSubmit,
  busy,
  mode,
  onMode,
  onCancel,
}: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  busy: boolean
  mode: Mode
  onMode: (m: Mode) => void
  onCancel?: () => void
}) {
  function handle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    onSubmit()
  }
  return (
    <form onSubmit={handle} className="composer">
      <div className="composer-body">
        <input
          className="composer-input select-text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Email, username, or domain"
          autoComplete="off"
          spellCheck={false}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the composer is the
          // primary control of the screen; the web autofocuses it too.
          autoFocus
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            {MODES.map((m) => {
              const Icon = m.icon
              const on = mode === m.id
              return (
                <button
                  key={m.id}
                  type="button"
                  data-on={on}
                  aria-pressed={on}
                  onClick={() => onMode(m.id)}
                  className="composer-pill"
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {m.label}
                </button>
              )
            })}
          </div>
          {onCancel ? (
            <button type="button" onClick={onCancel} className="btn-secondary btn-compact shrink-0">
              Cancel
            </button>
          ) : (
            <button
              type="submit"
              aria-label="Search"
              disabled={busy || !value.trim()}
              className="composer-send"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <ArrowUp className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          )}
        </div>
      </div>
    </form>
  )
}

function BrowseModules({ onNavigate }: { onNavigate: (route: string) => void }) {
  return (
    <div className="mx-auto mt-8 w-full max-w-2xl">
      <div className="glass">
        <div className="glass-body flex flex-col items-center gap-4 text-center">
          <span className="glass-tile flex h-12 w-12 items-center justify-center">
            <LayoutGrid className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-base font-semibold tracking-tight">Browse OSINT Modules</h2>
            <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-[var(--color-muted-foreground)]">
              Access the full collection of OSINT tools, breach databases, and intelligence modules
              across every platform.
            </p>
          </div>
          <button type="button" onClick={() => onNavigate("/dashboard")} className="btn-primary">
            Explore Modules
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  )
}
