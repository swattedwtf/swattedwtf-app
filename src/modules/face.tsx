import { useCallback, useEffect, useRef, useState } from "react"

import { classifyError, messageOf, type ClassifiedError } from "../lib/errors"
import { formatSince } from "../lib/format"
import {
  ipc,
  startStream,
  type LookupResult,
  type Overview,
  type PickedImage,
  type StreamFrame,
  type StreamHandle,
} from "../lib/ipc"
import { KNOWN_SCHEMA, OutcomePanel, SubmitButton } from "./ModuleScreen"
import { RemoteImage } from "./RemoteImage"
import { list, withDefaults } from "./safe"
import { EmptyState, Section } from "./ui"

/**
 * Reverse Face.
 *
 * Three things make this the odd one out, and all three shape the screen.
 *
 * It is the only feature on the platform billed in CREDIT rather than plan
 * allowance: every search spends $0.60 of a prepaid wallet, and an empty wallet
 * is a 402 `credits_required`. That refusal gets its own panel here rather than
 * the shared upgrade one, because "buy a bigger plan" is the wrong instruction
 * for someone whose plan is fine and whose wallet is empty.
 *
 * Its input is an image rather than a string, which is why it is not a
 * ModuleDescriptor at all: the generic screen renders text fields, and there is
 * no text field here. The picker, the read and the validation happen in Rust
 * (see src-tauri/src/picker.rs); the webview holds no filesystem permission and
 * only ever receives a `data:` URL, which is both the preview and the upload.
 *
 * And it runs over the STREAM transport despite answering all at once, because
 * a face search outlives the one-shot client's 30 second timeout. The server
 * emits a `faces` frame as progress and then exactly one `result` frame in the
 * same `{schema, data, partial}` envelope a lookup answers with, so everything
 * below the transport is ordinary.
 */

/** The server module this screen runs. A key in a static table, never a path. */
const MODULE_ID = "face"

/** What one search costs, mirroring SEARCH_COST_CENTS in the server's plans.ts. */
const SEARCH_COST_CENTS = 60

/**
 * Where credit is bought.
 *
 * The Reverse Face page on the web is where the top-up dialog lives (it reads
 * the live balance and hands off to the payment provider), so that is the
 * honest destination for a "Top up" button. Not the plans page: a plan is not
 * what this user is missing.
 */
const TOP_UP_URL = "https://swattedw.tf/dashboard/face"

type Match = {
  id: string
  quality: number
  sourceUrl: string
  sourceHost: string
  thumbnailUrl: string | null
  crawledAt: string | null
}

type FaceData = {
  /**
   * The explicit marker, and the reason this screen can be trusted.
   *
   * A search that failed and a search that genuinely matched nothing both
   * arrive as empty arrays. Only this separates them, and telling someone "no
   * matches found" about a search that never ran is a claim about a person's
   * face rather than about our provider.
   */
  status: string
  error: string | null
  faces: number
  webCount: number
  socialCount: number
  matches: Match[]
  socialMatches: Match[]
}

/**
 * One SSE frame, read into the three things this screen acts on.
 *
 * Kept out of the component so the transport contract is testable without
 * React. `null` is a frame this build does not know, which a server newer than
 * this one can legitimately send: ignoring it is right, because the `result`
 * frame is what the screen actually waits for.
 */
export type FaceFrame =
  | { kind: "faces"; faces: number }
  | { kind: "result"; result: LookupResult }
  | { kind: "error"; error: string }

export function readFrame(frame: StreamFrame): FaceFrame | null {
  if (frame.t === "faces") {
    const faces = typeof frame.faces === "number" ? frame.faces : 0
    return { kind: "faces", faces }
  }
  if (frame.t === "result") {
    return {
      kind: "result",
      result: {
        schema: typeof frame.schema === "number" ? frame.schema : 0,
        data: withDefaults(frame.data, {} as Record<string, unknown>),
        partial: list<string>(frame.partial),
      },
    }
  }
  // The route's own backstop for a producer that threw outright. It carries no
  // payload, so it cannot become a result; it is the failure itself.
  if (frame.t === "error") {
    return {
      kind: "error",
      error: typeof frame.error === "string" && frame.error ? frame.error : "The search failed.",
    }
  }
  return null
}

/** Cents as money. Total: an absent balance reads as zero, never as "$NaN". */
export function formatCredit(cents: number | null | undefined): string {
  const value = typeof cents === "number" && Number.isFinite(cents) ? Math.max(0, cents) : 0
  return `$${(value / 100).toFixed(2)}`
}

/** Everything the renderer reads, coerced. Never throws on a shape it does not know. */
export function coerce(data: unknown): FaceData {
  const raw = withDefaults(data, {} as Partial<FaceData>)
  const rows = (value: unknown): Match[] =>
    list<Partial<Match>>(value).map((row) =>
      withDefaults(row, {
        id: "",
        quality: 0,
        sourceUrl: "",
        sourceHost: "",
        thumbnailUrl: null,
        crawledAt: null,
      }),
    )

  return {
    // Anything this build does not recognise is treated as a failure, not as an
    // empty result. An unknown status is a server newer than this client, and
    // the safe reading of "I do not understand the answer" is never "nothing
    // was found".
    status:
      raw.status === "matched" || raw.status === "empty" || raw.status === "failed"
        ? raw.status
        : "failed",
    error: typeof raw.error === "string" && raw.error ? raw.error : null,
    faces: typeof raw.faces === "number" ? raw.faces : 0,
    webCount: typeof raw.webCount === "number" ? raw.webCount : 0,
    socialCount: typeof raw.socialCount === "number" ? raw.socialCount : 0,
    matches: rows(raw.matches),
    socialMatches: rows(raw.socialMatches),
  }
}

/** One match. The whole tile is the link, so the thumbnail is the target. */
function MatchTile({ match }: { match: Match }) {
  const crawled = formatSince(match.crawledAt)
  const label = match.sourceHost || "Open the page this face was found on"

  return (
    <button
      type="button"
      onClick={() => void ipc.openExternal(match.sourceUrl).catch(() => {})}
      title={match.sourceUrl}
      className="glass-tile glass-tile-hover block overflow-hidden p-0 text-left"
    >
      <RemoteImage
        url={match.thumbnailUrl}
        alt={`Match on ${label}`}
        name={label}
        className="aspect-square w-full"
      />
      <span className="block px-2.5 py-2">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[12px] text-white/85">{label}</span>
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--color-muted-foreground)]">
            {Math.round(match.quality)}%
          </span>
        </span>
        {crawled ? (
          <span className="mt-0.5 block font-mono text-[10px] text-[var(--color-muted-foreground)]">
            Crawled {crawled}
          </span>
        ) : null}
      </span>
    </button>
  )
}

/** A bucket of matches, or nothing at all when the provider had none. */
function MatchGrid({
  title,
  matches,
  total,
}: {
  title: string
  matches: Match[]
  total: number
}) {
  if (matches.length === 0) return null

  return (
    <Section title={`${title} (${total})`}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {matches.map((match, i) => (
          <MatchTile key={`${match.id}-${i}`} match={match} />
        ))}
      </div>
      {total > matches.length ? (
        <p className="mt-3 text-[12px] text-[var(--color-muted-foreground)]">
          Showing the {matches.length} strongest of {total}.
        </p>
      ) : null}
    </Section>
  )
}

/** The answer to a search that ran. */
export function FaceResult({ result }: { result: LookupResult }) {
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

  const data = coerce(result.data)

  // The search itself did not complete. Said plainly, and never as an empty
  // grid: the credit was spent, so the one thing owed here is the reason.
  if (data.status === "failed") {
    return (
      <Section title="Search failed">
        <EmptyState
          message={
            data.error ??
            "The search did not complete, so there is nothing to show. Try again shortly."
          }
        />
      </Section>
    )
  }

  if (data.status === "empty") {
    return (
      <Section title="Matches">
        <EmptyState
          message={
            data.faces > 0
              ? "That face was not found anywhere we could reach."
              : "No face was detected in that photo. Try a clearer, front-facing shot."
          }
        />
      </Section>
    )
  }

  return (
    <div className="space-y-4">
      <MatchGrid title="Web matches" matches={data.matches} total={data.webCount} />
      <MatchGrid title="Social matches" matches={data.socialMatches} total={data.socialCount} />
    </div>
  )
}

/**
 * The one refusal this screen writes its own copy for.
 *
 * `credits_required` classifies as `upgrade`, which the shared panel answers
 * with "Upgrade" and a link to the plans page. That is the wrong instruction:
 * the account's plan is fine, its wallet is empty, and the two are bought in
 * different places. The server's own sentence is kept; only the action changes.
 */
export function OutOfCreditPanel({ message }: { message: string }) {
  return (
    <div className="glass">
      <div className="glass-body">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]">
          Out of credit
        </p>
        <p className="mt-2 max-w-[62ch] text-sm text-white/85">{message}</p>
        <p className="mt-1 text-[13px] text-[var(--color-muted-foreground)]">
          Reverse Face is billed per search rather than by plan. Each one costs{" "}
          {formatCredit(SEARCH_COST_CENTS)}.
        </p>
        <button
          type="button"
          onClick={() => void ipc.openExternal(TOP_UP_URL).catch(() => {})}
          className="btn-secondary btn-compact mt-4"
        >
          Top up
        </button>
      </div>
    </div>
  )
}

export function FaceScreen({ overview }: { overview: Overview }) {
  const [picked, setPicked] = useState<PickedImage | null>(null)
  // A picker failure (too large, not an image) belongs beside the picker, not
  // in a result panel: nothing was searched and nothing was charged.
  const [pickError, setPickError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** How many faces the detector reported, so the wait says something. */
  const [faces, setFaces] = useState<number | null>(null)
  const [result, setResult] = useState<LookupResult | null>(null)
  // A refusal at connect time: the plan gate, an empty wallet, a rate limit, a
  // dead session. Classified exactly as a one-shot lookup's failure is.
  const [refusal, setRefusal] = useState<ClassifiedError | null>(null)
  // The transport dropped, or the stream ended without an answer. Deliberately
  // NOT folded into the result: a connection that died is not a face nobody has
  // seen, and this screen must never confuse the two.
  const [streamError, setStreamError] = useState<string | null>(null)
  /**
   * The wallet, as this screen believes it to be.
   *
   * Seeded from the overview the app fetched at boot and decremented once per
   * search that actually opened. The gate charges before the module runs, so a
   * stream that OPENS has been paid for whatever it goes on to say; one that
   * was refused at connect time was not charged and leaves this alone.
   */
  const [balanceCents, setBalanceCents] = useState(() => overview.plan.balanceCents)

  // The live stream, so a superseded run can be torn down. Cancelling drops the
  // connection, which the server sees as a disconnect and stops its own upstream
  // work for: there is no refund, but there is no point paying a provider to
  // finish a search nobody is watching either.
  const handleRef = useRef<StreamHandle | null>(null)
  // Monotonic run id, so a frame from a superseded stream cannot land in a
  // newer run's results.
  const runIdRef = useRef(0)

  const stop = useCallback(() => {
    handleRef.current?.cancel()
    handleRef.current = null
  }, [])

  useEffect(() => () => stop(), [stop])

  async function choose() {
    if (busy) return
    setPickError(null)
    try {
      const image = await ipc.pickImage()
      // Null is a cancelled dialog, which is not a failure and not an error to
      // show. The previous selection stays exactly as it was.
      if (!image) return
      setPicked(image)
      setResult(null)
      setRefusal(null)
      setStreamError(null)
      setFaces(null)
    } catch (err) {
      setPickError(messageOf(err))
    }
  }

  async function submit() {
    if (busy || !picked) return

    stop()
    const runId = ++runIdRef.current
    const live = () => runId === runIdRef.current

    setBusy(true)
    setRefusal(null)
    setStreamError(null)
    setResult(null)
    setFaces(null)

    // Whether THIS run ever produced an answer, either a result or a failure.
    // A local rather than state: it is read from the same run's own handlers, it
    // must be correct the instant it is set, and a superseded run's copy dies
    // with its closure.
    let answered = false

    try {
      const handle = await startStream(
        MODULE_ID,
        { image: picked.dataUrl },
        {
          onFrame: (frame) => {
            if (!live()) return
            const read = readFrame(frame)
            if (!read) return
            if (read.kind === "faces") {
              setFaces(read.faces)
              return
            }
            if (read.kind === "error") {
              answered = true
              setStreamError(read.error)
              setBusy(false)
              return
            }
            answered = true
            setResult(read.result)
            setBusy(false)
          },
          onDone: () => {
            if (!live()) return
            handleRef.current = null
            setBusy(false)
            // A stream that closed with neither a result nor a failure lost the
            // answer, and saying so is the only honest thing left: the search
            // was charged for and produced nothing we can show. What it is not
            // is "no matches".
            if (!answered) setStreamError("The search ended without an answer.")
          },
          onError: (message) => {
            if (!live()) return
            answered = true
            handleRef.current = null
            setBusy(false)
            setStreamError(message)
          },
        },
      )
      // The stream is open, which means the gate let it through, which means it
      // has been charged.
      if (live()) setBalanceCents((cents) => Math.max(0, cents - SEARCH_COST_CENTS))
      if (!live()) {
        handle.cancel()
        return
      }
      handleRef.current = handle
    } catch (err) {
      if (!live()) return
      // Refused before the stream existed, so nothing was charged.
      setBusy(false)
      setRefusal(classifyError(err))
    }
  }

  const outOfCredit = refusal?.code === "credits_required"

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Reverse Face</h1>

      <div className="glass">
        <div className="glass-body">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            <RemoteImage
              url={picked?.dataUrl ?? null}
              alt={picked ? picked.name : "No image chosen"}
              name={picked ? picked.name : "?"}
              className="h-32 w-32 shrink-0 rounded-2xl"
            />

            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]">
                Photo
              </p>
              <p className="mt-2 truncate text-sm text-white/85">
                {picked ? picked.name : "Choose a photo to search."}
              </p>
              <p className="mt-1 text-[13px] text-[var(--color-muted-foreground)]">
                {picked
                  ? `${picked.mime.replace("image/", "").toUpperCase()}, ${Math.max(1, Math.round(picked.bytes / 1024))} KB`
                  : "PNG, JPEG, GIF, WebP, AVIF or BMP, up to 8 MB."}
              </p>

              {pickError ? (
                <p role="alert" className="mt-2 text-xs text-[var(--color-destructive)]">
                  {pickError}
                </p>
              ) : null}

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void choose()}
                  className="btn-secondary btn-compact"
                >
                  {picked ? "Change photo" : "Choose photo"}
                </button>
                {picked && !busy ? (
                  <SubmitButton busy={false} onClick={() => void submit()} label="Search this face" />
                ) : null}
                {/* While a search runs the primary control cancels. The label
                    is stable so the button does not resize under the pointer at
                    the moment it is being pressed. */}
                {busy ? (
                  <button
                    type="button"
                    onClick={() => {
                      // Supersede this run so its late frames are dropped.
                      runIdRef.current += 1
                      stop()
                      setBusy(false)
                    }}
                    className="btn-secondary btn-compact"
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          {/* The cost, stated before the button is pressed rather than after.
              This is the one screen in the app where pressing Search spends
              money outright, and a balance nobody was shown is a support
              ticket. */}
          <p className="mt-5 border-t border-white/[0.06] pt-4 text-[13px] text-[var(--color-muted-foreground)]">
            {formatCredit(balanceCents)} credit left, about{" "}
            {Math.floor(balanceCents / SEARCH_COST_CENTS)} searches. Each search costs{" "}
            {formatCredit(SEARCH_COST_CENTS)}.
          </p>
        </div>
      </div>

      {outOfCredit && refusal ? <OutOfCreditPanel message={refusal.message} /> : null}
      {refusal && !outOfCredit ? (
        <OutcomePanel outcome={refusal} onRetry={() => void submit()} />
      ) : null}

      {/* A dropped connection, or a stream that ended with no answer. Its own
          panel, never an empty grid: the search was paid for, and "we lost the
          answer" is a different statement from "this face is nowhere". */}
      {streamError ? (
        <OutcomePanel
          outcome={{ kind: "error", message: streamError }}
          onRetry={() => void submit()}
        />
      ) : null}

      {busy ? (
        <Section title="Searching">
          <EmptyState
            message={
              faces === null
                ? "Detecting faces in that photo."
                : faces === 1
                  ? "One face detected. Searching the web, this can take a minute."
                  : `${faces} faces detected. Searching the web, this can take a minute.`
            }
          />
        </Section>
      ) : null}

      {result ? <FaceResult result={result} /> : null}
    </div>
  )
}
