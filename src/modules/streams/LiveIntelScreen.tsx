import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { Loader2, Search as SearchIcon, X } from "lucide-react"

import { classifyError, type ClassifiedError } from "../../lib/errors"
import { startStream, type StreamFrame, type StreamHandle } from "../../lib/ipc"
import { OutcomePanel } from "../ModuleScreen"
import { PageHeader } from "../PageHeader"
import type { StreamStatus } from "../stream-types"
import { liveIntelligenceDescriptor } from "./live-intelligence"

/**
 * Live Intelligence, hand-built to match swattedw.tf/dashboard/live-intelligence
 * rather than rendered by the generic StreamScreen.
 *
 * The web page is not a left-aligned pill toggle over a boxed form; it is the
 * icon+title+description header, then Email / Phone as centred underline tabs,
 * then one centred input with a square search button. That centred composition
 * is the whole difference the desktop was missing, so Live Intelligence owns its
 * screen the same way Search does. Transport and validation are unchanged: this
 * reuses the descriptor's resolve and Result and the shared startStream.
 */

const MODES = liveIntelligenceDescriptor.modes ?? []
const Result = liveIntelligenceDescriptor.Result

export function LiveIntelScreen({
  initial,
  onPrefillConsumed,
}: {
  /** A query handed over from the quick-lookup overlay: run automatically. */
  initial?: { query: string; mode?: string | null }
  onPrefillConsumed?: () => void
} = {}) {
  const [query, setQuery] = useState(initial?.query ?? "")
  const [mode, setMode] = useState<string>(initial?.mode ?? MODES[0]?.id ?? "email")
  const [error, setError] = useState<string | null>(null)

  const [status, setStatus] = useState<StreamStatus>("idle")
  const [frames, setFrames] = useState<StreamFrame[]>([])
  const [refusal, setRefusal] = useState<ClassifiedError | null>(null)
  const [streamError, setStreamError] = useState<string | null>(null)

  const handleRef = useRef<StreamHandle | null>(null)
  const runIdRef = useRef(0)

  const stop = useCallback(() => {
    handleRef.current?.cancel()
    handleRef.current = null
  }, [])

  useEffect(() => () => stop(), [stop])

  const run = useCallback(async (rawQuery: string, m: string) => {
    const q = rawQuery.trim()
    if (!q) {
      setError(m === "phone" ? "Enter a phone number." : "Enter an email address.")
      return
    }
    const resolved = liveIntelligenceDescriptor.resolve({ query: q }, m)
    if ("error" in resolved) {
      setError(resolved.error)
      return
    }
    setError(null)

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

  // A quick-lookup handoff runs itself once with the values it arrived with.
  const didPrefill = useRef(false)
  useEffect(() => {
    if (didPrefill.current || !initial?.query) return
    didPrefill.current = true
    void run(initial.query, initial.mode ?? MODES[0]?.id ?? "email")
    onPrefillConsumed?.()
  }, [initial, run, onPrefillConsumed])

  const reset = useCallback(() => {
    stop()
    runIdRef.current++
    setStatus("idle")
    setQuery("")
    setFrames([])
    setRefusal(null)
    setStreamError(null)
    setError(null)
  }, [stop])

  function switchMode(id: string) {
    if (id === mode) return
    setMode(id)
    if (error) setError(null)
  }

  const busy = status === "streaming"
  const active = status !== "idle"
  const showClear = active || query.length > 0

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 fade-in">
      <PageHeader
        icon={liveIntelligenceDescriptor.icon}
        title={liveIntelligenceDescriptor.label}
        description={liveIntelligenceDescriptor.description}
      />

      {/* Centred underline tabs, then a centred input + square button, exactly
          as on the web. */}
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-3 flex items-center justify-center gap-10" role="tablist" aria-label="Lookup type">
          {MODES.map((m) => {
            const on = mode === m.id
            return (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => switchMode(m.id)}
                className={`relative pb-2 text-sm tracking-tight transition-colors ${
                  on ? "font-semibold text-white" : "text-white/50 hover:text-white/80"
                }`}
              >
                {m.label}
                {on ? (
                  <span
                    className="absolute bottom-0 left-1/2 h-px w-6 -translate-x-1/2 bg-white"
                    aria-hidden="true"
                  />
                ) : null}
              </button>
            )
          })}
        </div>

        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            void submit()
          }}
          className="flex items-stretch gap-2"
        >
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              if (error) setError(null)
            }}
            inputMode={mode === "phone" ? "tel" : "email"}
            placeholder={mode === "phone" ? "Phone number" : "Email address"}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            aria-label={mode === "phone" ? "Phone number" : "Email address"}
            className="glass-input h-11 min-w-0 flex-1 select-text px-4 text-sm outline-none disabled:opacity-60"
          />
          <button
            type="submit"
            aria-label="Search"
            disabled={busy || !query.trim()}
            className="glass-tile glass-tile-hover flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--glass-radius-input)] text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <SearchIcon className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </form>

        {error ? (
          <p role="alert" className="mt-3 text-center text-xs text-[var(--color-destructive)]">
            {error}
          </p>
        ) : null}

        {showClear ? (
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs text-white/50 transition-colors hover:text-white"
            >
              <X className="h-3 w-3" aria-hidden="true" />
              Clear
            </button>
          </div>
        ) : null}
      </div>

      {refusal ? (
        <div className="mx-auto max-w-2xl">
          <OutcomePanel outcome={refusal} onRetry={() => void submit()} />
        </div>
      ) : null}

      {active && !refusal ? (
        <div className="space-y-6">
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
