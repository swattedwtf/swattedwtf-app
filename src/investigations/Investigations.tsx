import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Eye,
  FolderSearch,
  Loader2,
  NotebookPen,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react"

import { classifyError, type ClassifiedError } from "../lib/errors"
import { ipc } from "../lib/ipc"
import { OutcomePanel } from "../modules/ModuleScreen"
import {
  NOTES_MAX,
  createCase,
  listCases,
  openCase,
  patchCase,
  relativeTime,
  removeCase,
  validateName,
  type Case,
  type CaseSummary,
} from "./api"

/**
 * Investigations: the case manager, laid out the way /dashboard/investigations
 * is laid out on the web.
 *
 * NOT a lookup module, and deliberately not routed through ModuleScreen. There
 * is no target to search for, no provider fan-out and no metered call: a case
 * is a name, a status and a notepad that the account owns. It is a built-in
 * route beside /api and /settings for exactly that reason.
 *
 * The screen is two views over one route rather than two routes, because the
 * app has no router: the list opens a case, the case goes back to the list, and
 * the shell's own `key={route}` remount is not involved in either.
 *
 * The web's structure is reproduced section for section: an icon header over a
 * create row, then "Your cases" as a two-up grid of cards; and inside a case, a
 * toolbar of back / name / status / saved / delete over a two-column body with
 * the notepad on the left and the assistant panel on the right.
 *
 * WHAT IS NOT HERE: the AI chat itself. On the web, that right-hand panel is a
 * live conversation, gated on an active QUEMLY plan, which is a separate
 * subscription from Swatted. The only streaming path this client can reach runs
 * `requireLookupAccess`, so reproducing the chat would meter an assistant turn
 * as a Heist lookup and refuse a Quemly subscriber on a lower Swatted plan.
 * Instead the panel keeps the web's exact anatomy, header bar, assistant bubble
 * and footer, and says plainly where the assistant lives and, critically, that a
 * plan that does not include it is not a broken plan. A customer who had bought
 * Heist plus API Access read the web's bare "Quemly plan required" as their
 * purchase having failed, and that misreading is what this copy exists to
 * prevent.
 */

/**
 * The assistant's own product page.
 *
 * This spelling is correct and resolves. "quemly.swattedw.tf", which is what
 * the product name suggests, does not exist, and sending someone there would be
 * a dead end at the exact moment they have been told where to go. Exported so
 * that is checkable rather than a string nobody ever reads again.
 */
export const QUEMLY_URL = "https://qemuly.swattedw.tf"

/** The same case on the web dashboard, where the assistant lives. */
export function caseWebUrl(id: string): string {
  return `https://swattedw.tf/dashboard/investigations/${encodeURIComponent(id)}`
}

function openWeb(url: string) {
  // Never in the webview: a link opens in the user's own browser, with an
  // address bar and none of our state.
  void ipc.openExternal(url).catch(() => {})
}

/** How long a pause in typing means "save it now". Matches the web notepad. */
const AUTOSAVE_MS = 700

/**
 * The copy the list shows when the account genuinely has no cases.
 *
 * Exported because "there are none" and "we have not looked yet" are different
 * claims, and a test has to be able to prove the first one is absent from a
 * screen that has not loaded rather than matching a sentence typed twice.
 */
export const NO_CASES_TITLE = "No cases yet"

type SaveState = "idle" | "saving" | "saved" | "error"

/** Where the screen is. Two views, one route. */
type View = { kind: "list" } | { kind: "case"; id: string }

export function Investigations() {
  const [view, setView] = useState<View>({ kind: "list" })

  return view.kind === "list" ? (
    <CaseList onOpen={(id) => setView({ kind: "case", id })} />
  ) : (
    <CaseWorkspace id={view.id} onBack={() => setView({ kind: "list" })} />
  )
}

/**
 * The page heading: the web's icon tile, title and one-line description, with
 * the route eyebrow every other desktop screen wears above it.
 */
function Header({ subtitle }: { subtitle: string }) {
  return (
    <div className="fade-in flex flex-wrap items-start gap-4">
      <span className="glass-tile grid h-11 w-11 shrink-0 place-items-center rounded-2xl">
        <FolderSearch className="h-5 w-5 text-white" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]">
          / Investigations
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">Investigations</h1>
        <p className="mt-1 max-w-[70ch] text-sm text-white/70">{subtitle}</p>
      </div>
    </div>
  )
}

/** The small mono caption the web sets above a list. */
function ListCaption({ title, detail }: { title: string; detail?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]">
        {title}
      </h2>
      {detail ? <span className="font-mono text-[11px] text-white/70">{detail}</span> : null}
    </div>
  )
}

/**
 * "There is nothing here yet", drawn the way the web draws it: a ringed icon
 * over a headline and one line of what to do about it. Distinct on purpose from
 * a loading state, which shimmers, and from a refusal, which gets a panel.
 */
function EmptyPanel({
  icon: Icon,
  title,
  detail,
}: {
  icon: typeof FolderSearch
  title: string
  detail: string
}) {
  return (
    <div className="glass-tile flex flex-col items-center justify-center px-6 py-12 text-center">
      <span className="glass-tile grid h-12 w-12 place-items-center rounded-2xl">
        <Icon className="h-5 w-5 text-white/70" aria-hidden="true" />
      </span>
      <p className="mt-4 text-sm font-medium text-white">{title}</p>
      <p className="mt-1 max-w-[46ch] text-xs text-white/70">{detail}</p>
    </div>
  )
}

/** Loading, said as the shape of what is coming rather than as a spinner. */
function CardSkeletons({ count }: { count: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton h-[74px]" />
      ))}
    </div>
  )
}

/** Saving state, said in as few words as it takes. Absent while idle. */
function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null
  const label =
    state === "saving" ? "Saving" : state === "saved" ? "Saved" : "Not saved, retrying on next edit"
  return (
    <span
      role="status"
      className={`inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] ${
        state === "error" ? "text-[var(--color-destructive)]" : "text-white/70"
      }`}
    >
      {state === "saving" ? (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
      ) : state === "saved" ? (
        <Check className="h-3 w-3 text-emerald-400" aria-hidden="true" />
      ) : null}
      {label}
    </span>
  )
}

/** The open/closed dot the web puts beside a case name. */
function StatusDot({ open }: { open: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
        open ? "bg-emerald-400" : "bg-white/30"
      }`}
    />
  )
}

/**
 * One case in the list: the web's card, with its status dot, its name, the line
 * of metadata beneath and the two-step delete.
 *
 * Exported so a row can be rendered against a fixture and checked for the fields
 * it is supposed to carry, rather than by matching a sentence.
 */
export function CaseCard({
  summary,
  confirming,
  onOpen,
  onAskDelete,
  onCancelDelete,
  onDelete,
}: {
  summary: CaseSummary
  confirming: boolean
  onOpen: () => void
  onAskDelete: () => void
  onCancelDelete: () => void
  onDelete: () => void
}) {
  return (
    // Full height, so two cards side by side in the grid have the same box
    // whether one name wraps to a second line or not.
    <div className="glass-tile glass-tile-hover flex h-full items-start justify-between gap-3 p-4">
      <button type="button" onClick={onOpen} className="group min-w-0 flex-1 text-left">
        <span className="flex min-w-0 items-center gap-2">
          <StatusDot open={summary.status === "open"} />
          <span className="truncate text-sm font-semibold tracking-tight text-white">
            {summary.name}
          </span>
          <ArrowUpRight
            className="h-3.5 w-3.5 shrink-0 text-white/40 transition-colors group-hover:text-white"
            aria-hidden="true"
          />
        </span>
        <span className="mt-1.5 block font-mono text-[11px] text-white/70">
          {summary.status === "open" ? "Open" : "Closed"} · updated{" "}
          {relativeTime(summary.updatedAt)} ·{" "}
          {summary.notesChars > 0
            ? `${summary.notesChars.toLocaleString("en-US")} characters of notes`
            : "no notes yet"}
        </span>
      </button>

      {/* Two steps, because there is no undo and no trash to fish a case back
          out of. */}
      {confirming ? (
        <span className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={onDelete} className="btn-secondary btn-compact">
            Delete for good
          </button>
          <button type="button" onClick={onCancelDelete} className="btn-secondary btn-compact">
            Keep
          </button>
        </span>
      ) : (
        <button
          type="button"
          aria-label={`Delete ${summary.name}`}
          onClick={onAskDelete}
          className="btn-secondary btn-compact shrink-0"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

/**
 * The case list, plus the create row.
 *
 * Loads once on mount. A refusal renders the shared OutcomePanel, so a dead
 * session, a suspension or a rate limit reads here exactly as it does on every
 * lookup screen rather than as a bespoke error box.
 */
export function CaseList({ onOpen }: { onOpen: (id: string) => void }) {
  const [cases, setCases] = useState<CaseSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [failure, setFailure] = useState<ClassifiedError | null>(null)
  const [name, setName] = useState("")
  const [nameError, setNameError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const payload = await listCases()
      setCases(payload.cases)
      setFailure(null)
    } catch (err) {
      setFailure(classifyError(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function create() {
    if (creating) return
    const complaint = validateName(name)
    if (complaint) {
      setNameError(complaint)
      return
    }
    setNameError(null)
    setCreating(true)
    try {
      const created = await createCase(name)
      setName("")
      // Straight into the new case: creating one is how a user starts writing,
      // and dropping them back on a list to find it again is a step for nothing.
      onOpen(created.id)
    } catch (err) {
      setFailure(classifyError(err))
    } finally {
      setCreating(false)
    }
  }

  async function destroy(id: string) {
    const previous = cases
    setConfirmId(null)
    setCases((rows) => rows.filter((row) => row.id !== id))
    try {
      await removeCase(id)
    } catch (err) {
      // Put it back. A row that vanished from the screen while still existing on
      // the server is worse than the failure itself.
      setCases(previous)
      setFailure(classifyError(err))
    }
  }

  const openCount = cases.filter((c) => c.status === "open").length

  return (
    <div className="mx-auto w-full max-w-5xl space-y-7">
      <Header subtitle="Open a case, keep your findings in one place, and pick it up later. Cases and notes are the same ones on the web dashboard." />

      {/* Create case. One row, the way the web opens the page: the field is the
          first thing on the screen after the heading. */}
      <div className="fade-in">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="investigation-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void create()
            }}
            placeholder="New case name, for example John Doe fraud lead"
            aria-label="New case name"
            autoComplete="off"
            spellCheck={false}
            maxLength={200}
            aria-invalid={nameError ? true : undefined}
            className="glass-input h-11 min-w-0 flex-1 select-text px-4 text-sm outline-none"
          />
          <button
            type="button"
            disabled={creating}
            aria-busy={creating || undefined}
            onClick={() => void create()}
            className="btn-primary shrink-0"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Create case
          </button>
        </div>
        {nameError ? (
          <p role="alert" className="mt-2 text-xs text-[var(--color-destructive)]">
            {nameError}
          </p>
        ) : null}
      </div>

      {failure ? <OutcomePanel outcome={failure} onRetry={() => void load()} /> : null}

      <div className="space-y-3">
        <ListCaption
          title="Your cases"
          detail={
            !loading && cases.length > 0
              ? `${cases.length.toLocaleString("en-US")} total · ${openCount.toLocaleString("en-US")} open`
              : undefined
          }
        />

        {loading ? (
          <CardSkeletons count={2} />
        ) : cases.length === 0 ? (
          <EmptyPanel
            icon={FolderSearch}
            title={NO_CASES_TITLE}
            detail="Create your first investigation above to get started."
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {cases.map((c, index) => (
              <li
                key={c.id}
                className="stagger-item"
                style={{ "--i": index } as CSSProperties}
              >
                <CaseCard
                  summary={c}
                  confirming={confirmId === c.id}
                  onOpen={() => onOpen(c.id)}
                  onAskDelete={() => setConfirmId(c.id)}
                  onCancelDelete={() => setConfirmId(null)}
                  onDelete={() => void destroy(c.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/**
 * One open case: rename it, open or close it, write notes, delete it.
 *
 * Both text fields autosave on a pause rather than behind a Save button, which
 * is what the web does and what a notepad has to do to be trusted. Two things
 * the web does not do are done here: the pending edit is flushed when the screen
 * goes away, so navigating within 700ms of the last keystroke cannot lose it,
 * and a failed save says so and keeps the text on screen rather than silently
 * dropping it.
 */
export function CaseWorkspace({ id, onBack }: { id: string; onBack: () => void }) {
  const [record, setRecord] = useState<Case | null>(null)
  const [assistant, setAssistant] = useState(false)
  const [loading, setLoading] = useState(true)
  const [failure, setFailure] = useState<ClassifiedError | null>(null)
  const [saveState, setSaveState] = useState<SaveState>("idle")
  const [confirming, setConfirming] = useState(false)
  const [notesView, setNotesView] = useState<"edit" | "preview">("edit")

  const [name, setName] = useState("")
  const [notes, setNotes] = useState("")

  // Which fields the user has touched. Refs rather than state: they must not
  // cause a render, and an autosave effect that fired on mount would write the
  // record straight back to the server on every open.
  const nameDirty = useRef(false)
  const notesDirty = useRef(false)
  // The latest text, readable from the unmount cleanup, which closes over the
  // values it was created with and would otherwise flush a stale notepad.
  const latest = useRef({ name: "", notes: "" })
  latest.current = { name, notes }

  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const payload = await openCase(id)
      setRecord(payload.investigation)
      setAssistant(payload.assistant.active)
      setName(payload.investigation.name)
      setNotes(payload.investigation.notes)
      nameDirty.current = false
      notesDirty.current = false
      setFailure(null)
    } catch (err) {
      setFailure(classifyError(err))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const save = useCallback(
    async (patch: { name?: string; status?: "open" | "closed"; notes?: string }) => {
      setSaveState("saving")
      try {
        const updated = await patchCase(id, patch)
        setRecord(updated)
        // The field is clean again ONLY if the text has not moved on while the
        // request was in flight. Clearing it unconditionally would drop
        // keystrokes typed during the save; never clearing it would make the
        // unmount flush write the same notes a second time on every visit.
        if (patch.notes !== undefined && latest.current.notes === patch.notes) {
          notesDirty.current = false
        }
        if (patch.name !== undefined && latest.current.name.trim() === patch.name) {
          nameDirty.current = false
        }
        setSaveState("saved")
        if (savedTimer.current) clearTimeout(savedTimer.current)
        savedTimer.current = setTimeout(() => setSaveState("idle"), 1500)
      } catch (err) {
        // Deliberately NOT reverting the textarea. The user's words are the
        // thing worth keeping; the indicator says the copy on the server is
        // behind, and the next pause tries again.
        setSaveState("error")
        const classified = classifyError(err)
        // Only the refusals there is nothing to retype past. A transient save
        // failure stays as the indicator rather than replacing the case with a
        // panel while someone is mid-sentence.
        if (classified.kind === "auth" || classified.kind === "suspended") setFailure(classified)
      }
    },
    [id],
  )

  // Debounced autosave for the notepad.
  useEffect(() => {
    if (!notesDirty.current) return
    const timer = setTimeout(() => void save({ notes }), AUTOSAVE_MS)
    return () => clearTimeout(timer)
  }, [notes, save])

  // Debounced autosave for the name. Blank is never sent: it is a legitimate
  // half-typed state, and the server refuses it.
  useEffect(() => {
    if (!nameDirty.current) return
    const trimmed = name.trim()
    if (!trimmed) return
    const timer = setTimeout(() => void save({ name: trimmed }), AUTOSAVE_MS)
    return () => clearTimeout(timer)
  }, [name, save])

  // The flush. Leaving the screen inside the debounce window (Back, or a click
  // in the sidebar) would otherwise drop the last few keystrokes, which is the
  // one thing a notepad may never do. Fire and forget: the screen is going away,
  // so there is nobody left to tell.
  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current)
      const patch: { name?: string; notes?: string } = {}
      if (notesDirty.current) patch.notes = latest.current.notes
      if (nameDirty.current && latest.current.name.trim()) patch.name = latest.current.name.trim()
      if (Object.keys(patch).length > 0) void patchCase(id, patch).catch(() => {})
    },
    [id],
  )

  function toggleStatus() {
    if (!record) return
    const next = record.status === "open" ? "closed" : "open"
    setRecord({ ...record, status: next })
    void save({ status: next })
  }

  async function destroy() {
    try {
      await removeCase(id)
      // Nothing left to flush: the case is gone.
      notesDirty.current = false
      nameDirty.current = false
      onBack()
    } catch (err) {
      setConfirming(false)
      setFailure(classifyError(err))
    }
  }

  const status = record?.status ?? "open"

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      {/* Toolbar: back, the case name, its status, whether it is saved, and the
          one destructive action, in the web's order. */}
      <div className="fade-in flex flex-wrap items-center gap-3">
        <button type="button" onClick={onBack} className="btn-secondary btn-compact shrink-0">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          All cases
        </button>

        <input
          id="investigation-case-name"
          value={name}
          onChange={(e) => {
            nameDirty.current = true
            setName(e.target.value)
          }}
          disabled={loading || !record}
          aria-label="Case name"
          autoComplete="off"
          spellCheck={false}
          maxLength={200}
          className="glass-input h-11 min-w-0 flex-1 select-text px-3.5 text-xl font-semibold tracking-tight outline-none"
        />

        <button
          type="button"
          onClick={toggleStatus}
          disabled={!record}
          aria-pressed={status === "open"}
          className="btn-secondary btn-compact shrink-0"
        >
          <StatusDot open={status === "open"} />
          {status === "open" ? "Open" : "Closed"}
        </button>

        <SaveIndicator state={saveState} />

        {confirming ? (
          <span className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void destroy()}
              className="btn-secondary btn-compact"
            >
              Delete for good
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="btn-secondary btn-compact"
            >
              Keep
            </button>
          </span>
        ) : (
          <button
            type="button"
            aria-label="Delete this case"
            disabled={!record}
            onClick={() => setConfirming(true)}
            className="btn-secondary btn-compact shrink-0"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      {failure ? <OutcomePanel outcome={failure} onRetry={() => void load()} /> : null}

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]" aria-hidden="true">
          <div className="skeleton h-[26rem]" />
          <div className="skeleton h-[26rem]" />
        </div>
      ) : !record ? (
        <EmptyPanel
          icon={FolderSearch}
          title="This case could not be opened"
          detail="It may have been deleted. Go back to the list and pick another one."
        />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
            <NotesPanel
              notes={notes}
              view={notesView}
              onView={setNotesView}
              onChange={(next) => {
                notesDirty.current = true
                setNotes(next)
              }}
            />
            <AssistantPanel active={assistant} caseId={record.id} />
          </div>

          <p className="font-mono text-[11px] text-white/70">
            Opened {relativeTime(record.createdAt)} · updated {relativeTime(record.updatedAt)}
          </p>
        </>
      )}
    </div>
  )
}

/**
 * The notepad, with the web's edit/preview pair.
 *
 * The preview exists because the assistant writes markdown into these notes on
 * the web, so a case opened here can already contain headings, bullets and bold
 * runs. Rendering only the raw source would make the desktop look like it had
 * lost the formatting rather than like it had never applied it.
 */
export function NotesPanel({
  notes,
  view,
  onView,
  onChange,
}: {
  notes: string
  view: "edit" | "preview"
  onView: (next: "edit" | "preview") => void
  onChange: (next: string) => void
}) {
  return (
    <section className="glass fade-in overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.08] px-4 py-2.5">
        <NotebookPen className="h-4 w-4 text-[var(--color-muted-foreground)]" aria-hidden="true" />
        <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]">
          Case notes
        </h2>
        <span className="ml-auto font-mono text-[10px] text-white/50">
          {notes.length.toLocaleString("en-US")} / {NOTES_MAX.toLocaleString("en-US")}
        </span>
        <span className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onView("edit")}
            aria-pressed={view === "edit"}
            className={view === "edit" ? "btn-primary btn-compact" : "btn-secondary btn-compact"}
          >
            <Pencil className="h-3 w-3" aria-hidden="true" />
            Edit
          </button>
          <button
            type="button"
            onClick={() => onView("preview")}
            aria-pressed={view === "preview"}
            className={view === "preview" ? "btn-primary btn-compact" : "btn-secondary btn-compact"}
          >
            <Eye className="h-3 w-3" aria-hidden="true" />
            Preview
          </button>
        </span>
      </div>

      {view === "edit" ? (
        <textarea
          value={notes}
          maxLength={NOTES_MAX}
          onChange={(e) => onChange(e.target.value)}
          aria-label="Case notes"
          placeholder="Findings, timeline, leads and conclusions. Saves on its own as you type, and markdown is supported."
          className="min-h-[24rem] w-full select-text resize-y border-0 bg-transparent p-4 text-sm leading-relaxed text-white outline-none placeholder:text-[var(--color-muted-foreground)]"
        />
      ) : notes.trim() ? (
        <div className="min-h-[24rem] select-text p-4 text-sm leading-relaxed text-white">
          <NotesMarkdown text={notes} />
        </div>
      ) : (
        <p className="min-h-[24rem] p-4 text-sm text-white/70">Nothing to preview yet.</p>
      )}
    </section>
  )
}

/**
 * The small subset of markdown the case notes actually contain: headings,
 * bullets, bold runs and inline code.
 *
 * Deliberately a renderer and not an HTML string. These notes hold whatever a
 * lookup returned, up to and including markup pasted out of a breach record, and
 * nothing on this screen may put that into the DOM as HTML.
 */
export function NotesMarkdown({ text }: { text: string }) {
  return (
    <div className="space-y-1">
      {text.split("\n").map((line, i) => {
        const trimmed = line.replace(/^\s+/, "")
        if (trimmed === "") return <div key={i} className="h-2" aria-hidden="true" />
        const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed)
        if (heading) {
          return (
            <p key={i} className="pt-1 text-[15px] font-semibold tracking-tight text-white">
              {inlineMarkdown(heading[2], `h${i}`)}
            </p>
          )
        }
        if (/^[-*]\s+/.test(trimmed)) {
          return (
            <div key={i} className="flex gap-2 pl-1">
              <span aria-hidden="true" className="select-none text-white/50">
                •
              </span>
              <span className="min-w-0 flex-1">
                {inlineMarkdown(trimmed.replace(/^[-*]\s+/, ""), `b${i}`)}
              </span>
            </div>
          )
        }
        return <div key={i}>{inlineMarkdown(line, `p${i}`)}</div>
      })}
    </div>
  )
}

function inlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    .filter((part) => part !== "")
    .map((part, i) => {
      const key = `${keyPrefix}-${i}`
      if (part.startsWith("**") && part.endsWith("**")) {
        return (
          <strong key={key} className="font-semibold text-white">
            {part.slice(2, -2)}
          </strong>
        )
      }
      if (part.startsWith("`") && part.endsWith("`")) {
        return (
          <code key={key} className="glass-tile rounded px-1 py-0.5 font-mono text-[0.85em]">
            {part.slice(1, -1)}
          </code>
        )
      }
      return <span key={key}>{part}</span>
    })
}

/**
 * The assistant panel: the web's chat aside, in the one state this client can
 * honestly offer.
 *
 * Same anatomy as the web, header bar with the assistant's name, a message from
 * the assistant, then a footer where the composer sits, so it reads as the same
 * panel rather than as a hole where a feature should be.
 *
 * Two states, and the difference between them is the whole point. `active` says
 * the account holds a Quemly subscription, so the assistant exists and simply
 * runs elsewhere. Inactive says the assistant is sold separately, and says it in
 * the same breath as "your plan is fine", because the failure this replaces was
 * a customer concluding a working purchase had broken.
 *
 * Exported so the copy and the destinations can be asserted directly. A wrong
 * URL here is a dead end for someone who has just been told where to go, and it
 * would be invisible in a render that only checked the panel appeared.
 */
export function AssistantPanel({ active, caseId }: { active: boolean; caseId: string }) {
  return (
    <aside className="glass fade-in flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-white/[0.08] px-4 py-3">
        <span className="glass-tile grid h-7 w-7 shrink-0 place-items-center rounded-lg">
          <Sparkles className="h-3.5 w-3.5 text-white" aria-hidden="true" />
        </span>
        <p className="min-w-0 truncate text-sm font-semibold tracking-tight text-white">
          OSINT Assistant
        </p>
        <span className="ml-auto shrink-0 font-mono text-[10px] uppercase tracking-[0.18em] text-white/50">
          {active ? "On the web" : "Add-on"}
        </span>
      </div>

      <div className="flex-1 space-y-3 p-4">
        <div className="glass-tile p-3.5 text-[13px] leading-relaxed text-white/80">
          {active ? (
            <div className="space-y-2">
              <p className="font-medium text-white">Your Quemly subscription is active.</p>
              <p>
                The assistant reads this case, formats your notes, runs lookups and writes what it
                finds straight back into the notepad.
              </p>
              <p>
                It runs on the web dashboard rather than in the desktop app. These are the same notes
                there, so open the case on the web to talk it through.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="font-medium text-white">The assistant is a separate subscription.</p>
              <p>
                The AI that reads a case and talks it through with you is Quemly. It is not part of a
                Swatted plan and it is not part of API Access.
              </p>
              <p>
                Nothing on your account is broken or missing. Your plan, your lookups and any add-on
                you bought all work normally. This one panel is the only thing Quemly covers.
              </p>
              <p>Cases and notes are yours either way, on the desktop and on the web.</p>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-white/[0.08] p-3">
        <div className="flex flex-wrap gap-2">
          {!active ? (
            <button
              type="button"
              onClick={() => openWeb(QUEMLY_URL)}
              className="btn-secondary btn-compact"
            >
              About Quemly
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
          {caseId ? (
            <button
              type="button"
              onClick={() => openWeb(caseWebUrl(caseId))}
              className="btn-secondary btn-compact"
            >
              Open this case on the web
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <p className="mt-2 font-mono text-[10px] text-white/50">Opens in your browser.</p>
      </div>
    </aside>
  )
}
