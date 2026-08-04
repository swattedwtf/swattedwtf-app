import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"

import { classifyError, type ClassifiedError } from "../lib/errors"
import { startStream, type StreamFrame, type StreamHandle } from "../lib/ipc"
import { OutcomePanel, SubmitButton, validateAll } from "./ModuleScreen"
import type { StreamModuleDescriptor, StreamStatus } from "./stream-types"

/**
 * The screen every streaming module is rendered on, beside ModuleScreen.
 *
 * It owns the same chrome ModuleScreen does (heading, fields, validation
 * messages, every refusal panel) plus the parts a stream needs: a Cancel
 * control, a live "what has arrived so far" body, and the bookkeeping to keep a
 * superseded stream from writing into a newer one.
 *
 * A module contributes the shape of its own answer through `Result`, which is
 * handed every frame received so far. The screen deliberately holds the raw
 * frames rather than a reduced state, so the module owns interpretation and the
 * screen owns the transport.
 */
export function StreamScreen({ descriptor }: { descriptor: StreamModuleDescriptor }) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [mode, setMode] = useState<string | null>(descriptor.modes?.[0]?.id ?? null)

  const [status, setStatus] = useState<StreamStatus>("idle")
  const [frames, setFrames] = useState<StreamFrame[]>([])
  // A refusal at connect time (402, 429, dead session). Rendered by the shared
  // OutcomePanel, exactly as on a one-shot lookup.
  const [refusal, setRefusal] = useState<ClassifiedError | null>(null)
  // A mid-stream failure (an `error` frame from a producer, or a dropped
  // connection). Distinct from "done with nothing".
  const [streamError, setStreamError] = useState<string | null>(null)

  // The live handle, so an in-flight stream can be cancelled on a new submit or
  // on unmount.
  const handleRef = useRef<StreamHandle | null>(null)
  // Monotonic run id: a frame from a superseded stream must never land in a
  // newer run's results.
  const runIdRef = useRef(0)

  const stop = useCallback(() => {
    handleRef.current?.cancel()
    handleRef.current = null
  }, [])

  // Cancel a live stream if the screen goes away.
  useEffect(() => () => stop(), [stop])

  const inline = descriptor.inputs.length <= 1

  const submit = useCallback(async () => {
    const validationErrors = validateAll(descriptor.inputs, values)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }
    setErrors({})

    const trimmed: Record<string, string> = {}
    for (const field of descriptor.inputs) trimmed[field.name] = (values[field.name] ?? "").trim()

    const resolved = descriptor.resolve(trimmed, mode)
    if ("error" in resolved) {
      // A shape the client can already reject: surface it on the first field so
      // it reads like any other validation message, and never spend a request.
      const firstField = descriptor.inputs[0]?.name ?? "query"
      setErrors({ [firstField]: resolved.error })
      return
    }

    // Supersede any running stream and start a fresh run.
    stop()
    const runId = ++runIdRef.current
    setFrames([])
    setRefusal(null)
    setStreamError(null)
    setStatus("streaming")

    // Guards every callback: a late frame from an aborted stream must not write
    // into the current run.
    const live = () => runId === runIdRef.current

    try {
      const handle = await startStream(resolved.module, resolved.input, {
        onFrame: (frame) => {
          if (!live()) return
          // A producer can emit its own terminal `error` frame; treat it as a
          // stream failure so the screen shows Retry, not an empty result.
          if (frame.t === "error") {
            const message = typeof frame.error === "string" ? frame.error : "Lookup failed"
            setStreamError(message)
            setStatus("error")
            return
          }
          setFrames((prev) => [...prev, frame])
        },
        onDone: () => {
          if (!live()) return
          handleRef.current = null
          // An error frame already moved us to "error"; don't overwrite it.
          setStatus((s) => (s === "error" ? s : "done"))
        },
        onError: (message) => {
          if (!live()) return
          handleRef.current = null
          setStreamError(message)
          setStatus("error")
        },
      })
      // The run may already have been superseded while connecting; if so, drop
      // this handle immediately rather than leaving it live.
      if (!live()) {
        handle.cancel()
        return
      }
      handleRef.current = handle
    } catch (err) {
      if (!live()) return
      // Connect-time refusal: classify it the same way a lookup does, so a 402
      // renders the upgrade panel and a 429 an inline Retry.
      setRefusal(classifyError(err))
      setStatus("idle")
    }
  }, [descriptor, values, mode, stop])

  const busy = status === "streaming"

  const renderField = (field: (typeof descriptor.inputs)[number], trailing?: ReactNode) => {
    const id = `${descriptor.id}-${field.name}`
    const error = errors[field.name]
    return (
      <div key={field.name} className="min-w-0">
        <label
          htmlFor={id}
          className="block font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]"
        >
          {field.label}
        </label>
        <div className="mt-2 flex items-center gap-3">
          <input
            id={id}
            name={field.name}
            value={values[field.name] ?? ""}
            placeholder={field.placeholder}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit()
            }}
            className="h-10 min-w-0 flex-1 select-text rounded-lg border border-[var(--color-border)] bg-[var(--secondary)] px-3.5 text-sm shadow-[inset_0_1px_2px_0_rgba(0,0,0,0.45)] outline-none transition-colors placeholder:text-white/20 focus:border-white/40"
          />
          {trailing}
        </div>
        {error ? (
          <p role="alert" className="mt-2 text-xs text-[var(--color-destructive)]">
            {error}
          </p>
        ) : null}
      </div>
    )
  }

  // While streaming the primary control cancels; otherwise it submits. The label
  // is stable so the button does not resize under the pointer as it is pressed.
  const primary = busy ? (
    <button type="button" onClick={stopAndReset(setStatus, stop)} className="btn-secondary shrink-0">
      Cancel
    </button>
  ) : (
    <SubmitButton busy={false} onClick={() => void submit()} />
  )

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">{descriptor.label}</h1>

      <div className="glass">
        <div className="glass-body space-y-4">
          {descriptor.modes ? (
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Search mode">
              {descriptor.modes.map((m) => {
                const on = mode === m.id
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => setMode(m.id)}
                    className={on ? "btn-primary btn-compact" : "btn-secondary btn-compact"}
                  >
                    {m.label}
                  </button>
                )
              })}
            </div>
          ) : null}

          <div data-layout={inline ? "inline" : "stacked"} className={inline ? "" : "space-y-4"}>
            {inline ? (
              descriptor.inputs[0] ? (
                renderField(descriptor.inputs[0], primary)
              ) : (
                primary
              )
            ) : (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {descriptor.inputs.map((field) => renderField(field))}
                </div>
                {primary}
              </>
            )}
          </div>
        </div>
      </div>

      {refusal ? <OutcomePanel outcome={refusal} onRetry={() => void submit()} /> : null}

      {status === "error" && streamError ? (
        <OutcomePanel
          outcome={{ kind: "error", message: streamError }}
          onRetry={() => void submit()}
        />
      ) : null}

      {status !== "idle" && !refusal ? (
        <descriptor.Result frames={frames} status={status} error={streamError} />
      ) : null}
    </div>
  )
}

/** Cancel the stream and drop the screen back to a resting state that keeps the
 *  results already on screen. Extracted so the Cancel button stays a one-liner. */
function stopAndReset(
  setStatus: (s: StreamStatus) => void,
  stop: () => void,
): () => void {
  return () => {
    stop()
    setStatus("cancelled")
  }
}
