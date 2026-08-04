import { useState, type ReactNode } from "react"

import { classifyError, type ClassifiedError } from "../lib/errors"
import { ipc, type LookupResult } from "../lib/ipc"
import { PLANS_URL } from "./ui/LockedSection"
import type { InputField, ModuleDescriptor } from "./types"

/**
 * The one screen every lookup module is rendered on.
 *
 * It owns the heading, the fields, the submit and busy state, the validation
 * messages and every refusal panel. A module file contributes the shape of its
 * own answer and nothing else, which is what stops sixteen screens written one
 * at a time from becoming sixteen different products.
 */

/** Terms page, for the one refusal that is answered by reading something. */
const TERMS_URL = "https://swattedw.tf/terms"

/**
 * The response shape this build understands.
 *
 * The server's normalised shapes are additive only, so a new field never needs
 * a bump. This goes up solely for a genuinely breaking change, and a client
 * older than that says "update the app" rather than drawing a screen with half
 * its content silently missing.
 */
export const KNOWN_SCHEMA = 1

export type Outcome =
  | { status: "idle" }
  | { status: "invalid"; errors: Record<string, string> }
  | { status: "done"; result: LookupResult }
  | { status: "failed"; error: ClassifiedError }

/**
 * Every field's complaint, keyed by field name. Empty means "go ahead".
 *
 * Advisory only, and deliberately mirrors the server's own regexes: it exists
 * so an obviously malformed input never becomes a metered request. The server
 * is still the authority, so a value this accepts can still be refused.
 */
export function validateAll(
  inputs: InputField[],
  values: Record<string, string>,
): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const input of inputs) {
    const message = input.validate((values[input.name] ?? "").trim())
    if (message) errors[input.name] = message
  }
  return errors
}

/** Validate, call, classify. Everything the submit button does, minus React. */
export async function runLookup(
  descriptor: ModuleDescriptor,
  values: Record<string, string>,
): Promise<Outcome> {
  const errors = validateAll(descriptor.inputs, values)
  if (Object.keys(errors).length > 0) return { status: "invalid", errors }

  const input: Record<string, string> = {}
  for (const field of descriptor.inputs) input[field.name] = (values[field.name] ?? "").trim()

  try {
    return { status: "done", result: await ipc.lookup(descriptor.id, input) }
  } catch (err) {
    return { status: "failed", error: classifyError(err) }
  }
}

/**
 * The submit control. Its label never changes while running: swapping it for
 * "Searching..." resizes the button under the pointer at the exact moment it is
 * being pressed. Busy is `aria-busy` plus the ring `.btn-primary` draws.
 */
export function SubmitButton({
  busy,
  onClick,
  label = "Search",
}: {
  busy: boolean
  onClick: () => void
  label?: string
}) {
  return (
    <button
      type="button"
      disabled={busy}
      aria-busy={busy || undefined}
      onClick={onClick}
      className="btn-primary shrink-0"
    >
      {label}
    </button>
  )
}

/**
 * The one thing a refusal offers the user, or nothing.
 *
 * Separate from the panel so the destinations are checkable: a wrong URL here
 * is a dead end for someone who has just been told to buy something, and it
 * would be invisible in a render assertion.
 */
export function outcomeAction(
  outcome: ClassifiedError,
  onRetry: () => void,
): { label: string; run: () => void } | null {
  switch (outcome.kind) {
    case "upgrade":
      return { label: "Upgrade", run: () => void ipc.openExternal(PLANS_URL).catch(() => {}) }
    case "legal":
      return { label: "Open the terms", run: () => void ipc.openExternal(TERMS_URL).catch(() => {}) }
    case "retry":
    case "error":
      return { label: "Retry", run: onRetry }
    // Neither is something the user can act on from here, so both get no button
    // rather than a Retry that would fail identically. A dead session is fixed
    // by logging out and back in from Settings, which the panel says in words;
    // there is nothing this screen can do about it on the user's behalf.
    case "suspended":
    case "auth":
      return null
  }
}

/**
 * What a dead session looks like on a module screen.
 *
 * The server's own copy for a 401 is "Not authenticated", which tells the user
 * nothing they can act on, so this is the one branch where we write our own.
 * Nothing here clears the session: only the overview path in app.tsx does that,
 * and a screen that logged the user out from under a half-typed query would be
 * a second bug rather than a fix for this one.
 */
const AUTH_MESSAGE =
  "Your session has expired, so this lookup was refused. Open Settings, log out, and sign in again to continue."

/**
 * What the app does about a refusal.
 *
 * The server's copy is shown verbatim in every branch but one. It is written
 * for the user, it is more specific than anything the client could invent, and
 * it can be reworded without a client release. The exception is `auth`, whose
 * server copy is the bare string "Not authenticated".
 */
export function OutcomePanel({
  outcome,
  onRetry,
}: {
  outcome: ClassifiedError
  onRetry: () => void
}) {
  const action = outcomeAction(outcome, onRetry)

  return (
    <div className="glass">
      <div className="glass-body">
        {/* A 401 on a module lookup does NOT send the app back to login: only
            the overview path in app.tsx clears a dead session. Rendering
            nothing here left a blank panel and a session that stayed dead, so
            this branch says what happened and what to do about it. */}
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

/** A successful answer: the module's own rendering, plus what did not load. */
export function ResultView({
  descriptor,
  result,
}: {
  descriptor: ModuleDescriptor
  result: LookupResult
}) {
  if (result.schema > KNOWN_SCHEMA) {
    return (
      <div className="glass">
        <div className="glass-body">
          <p className="text-sm text-white/85">Update the app to view this result.</p>
          <p className="mt-1 text-[13px] text-[var(--color-muted-foreground)]">
            The server answered in a newer format than this build understands.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <descriptor.Result data={result.data} partial={result.partial} />
      {result.partial.length > 0 ? (
        // Quiet on purpose: a provider timing out is normal and the rest of the
        // answer is still good, so this is a footnote, not a failure panel.
        <p className="text-[12px] text-[var(--color-muted-foreground)]">
          Some sections did not load: {result.partial.join(", ")}.
        </p>
      ) : null}
    </div>
  )
}

export function ModuleScreen({ descriptor }: { descriptor: ModuleDescriptor }) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<Outcome>({ status: "idle" })
  // Bumped on every completed lookup, and used as the Result's key.
  //
  // A module's Result may hold its own state: the Machine Browser keeps the
  // victim the user picked. Result is a stable module-level component and was
  // rendered without a key, so React reused the instance across searches and
  // that pick survived, attaching one person's machine dump to the next
  // person's query, which in an OSINT tool is a serious data-integrity fault,
  // not a cosmetic one. Keying by the run forces a fresh mount per result, so
  // internal state cannot bleed between two searches.
  const [runId, setRunId] = useState(0)

  const inline = descriptor.inputs.length <= 1

  async function submit() {
    if (busy) return
    setBusy(true)
    const next = await runLookup(descriptor, values)
    setBusy(false)
    if (next.status === "invalid") {
      setErrors(next.errors)
      return
    }
    setErrors({})
    setRunId((n) => n + 1)
    setOutcome(next)
  }

  /**
   * One field. `trailing` sits on the input's own row rather than beside the
   * whole field, so a validation message appearing underneath does not drag
   * the submit button down with it.
   */
  const renderField = (field: InputField, trailing?: ReactNode) => {
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
            className="h-10 min-w-0 flex-1 select-text glass-input px-3.5 text-sm outline-none"
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

  const button = <SubmitButton busy={busy} onClick={() => void submit()} />

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">{descriptor.label}</h1>

      {/* One field takes the button on its own row; several stack above it,
          because a row of seven inputs and a button is unreadable at this
          window width. A module with no inputs at all is the button alone. */}
      <div className="glass">
        <div className="glass-body">
          <div data-layout={inline ? "inline" : "stacked"} className={inline ? "" : "space-y-4"}>
            {inline ? (
              descriptor.inputs[0] ? (
                renderField(descriptor.inputs[0], button)
              ) : (
                button
              )
            ) : (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {descriptor.inputs.map((field) => renderField(field))}
                </div>
                {button}
              </>
            )}
          </div>
        </div>
      </div>

      {outcome.status === "failed" ? (
        <OutcomePanel outcome={outcome.error} onRetry={() => void submit()} />
      ) : null}

      {outcome.status === "done" ? (
        <ResultView key={runId} descriptor={descriptor} result={outcome.result} />
      ) : null}
    </div>
  )
}
