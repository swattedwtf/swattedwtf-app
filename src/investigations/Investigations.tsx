import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowLeft, ArrowUpRight, MessageSquare, Plus, Trash2 } from "lucide-react"

import { classifyError, type ClassifiedError } from "../lib/errors"
import { ipc } from "../lib/ipc"
import { OutcomePanel } from "../modules/ModuleScreen"
import { EmptyState, Section } from "../modules/ui"
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
 * Investigations: the case manager.
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
 * WHAT IS NOT HERE: the AI assistant. On the web, a case has a chat panel beside
 * the notepad, and that assistant is gated on an active QUEMLY plan, which is a
 * separate subscription from Swatted. Rather than reproduce the chat here over a
 * transport that would have to be metered as a lookup to exist at all, the panel
 * says plainly where the assistant lives and, critically, that a plan that does
 * not include it is not a broken plan. A customer who had bought Heist plus API
 * Access read the web's bare "Quemly plan required" as their purchase having
 * failed, and that misreading is the thing this copy exists to prevent.
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

/** The heading every view of this screen wears. */
function Header({ subtitle }: { subtitle: string }) {
  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]">
        / Investigations
      </p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">Investigations</h1>
      <p className="mt-1 max-w-[70ch] text-sm text-[var(--color-muted-foreground)]">{subtitle}</p>
    </div>
  )
}

/**
 * The assistant panel.
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
    <Section title="Case assistant">
      <div className="glass-tile p-5">
        <div className="flex items-center gap-2 text-sm font-medium text-white">
          <MessageSquare className="h-4 w-4" aria-hidden="true" />
          {active ? "Available on the web" : "A separate subscription"}
        </div>

        {active ? (
          <div className="mt-2 space-y-2 text-[13px] text-white/75">
            <p>
              Your Quemly subscription is active, so the assistant can read this case and talk it
              through with you.
            </p>
            <p>
              It runs on the web dashboard rather than in the desktop app. Your notes are the same
              notes there, so open the case on the web to chat about it.
            </p>
          </div>
        ) : (
          <div className="mt-2 space-y-2 text-[13px] text-white/75">
            <p>
              The AI assistant that reads a case and talks it through with you is Quemly, a separate
              subscription. It is not part of a Swatted plan and it is not part of API Access.
            </p>
            <p>
              Nothing on your account is broken or missing. Your plan, your lookups and any add-on
              you bought all work normally. This one panel is the only thing Quemly covers.
            </p>
            <p>Cases and notes are yours either way, on the desktop and on the web.</p>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
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
      </div>
    </Section>
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
      className={`font-mono text-[10px] uppercase tracking-[0.18em] ${
        state === "error" ? "text-[var(--color-destructive)]" : "text-[var(--color-muted-foreground)]"
      }`}
    >
      {label}
    </span>
  )
}

/**
 * The case list, plus the create form.
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

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <Header subtitle="Open a case, keep your findings in one place, and pick it up later. Cases and notes are the same ones on the web dashboard." />

      <div className="glass">
        <div className="glass-body">
          <label
            htmlFor="investigation-name"
            className="block font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]"
          >
            New case
          </label>
          <div className="mt-2 flex items-center gap-3">
            <input
              id="investigation-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void create()
              }}
              placeholder="Case name, for example John Doe fraud lead"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={nameError ? true : undefined}
              className="h-10 min-w-0 flex-1 select-text glass-input px-3.5 text-sm outline-none"
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
      </div>

      {failure ? <OutcomePanel outcome={failure} onRetry={() => void load()} /> : null}

      <Section title="Your cases">
        {loading ? (
          <EmptyState message="Loading your cases." />
        ) : cases.length === 0 ? (
          <EmptyState message="No cases yet. Create one above to start keeping notes." />
        ) : (
          <ul className="space-y-2">
            {cases.map((c) => (
              <li key={c.id} className="glass-tile flex items-center gap-3 p-4">
                <button
                  type="button"
                  onClick={() => onOpen(c.id)}
                  className="group min-w-0 flex-1 text-left"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                        c.status === "open" ? "bg-emerald-400" : "bg-white/30"
                      }`}
                    />
                    <span className="truncate text-sm font-medium text-white">{c.name}</span>
                    <ArrowUpRight
                      className="h-3.5 w-3.5 shrink-0 text-white/30 transition-colors group-hover:text-white"
                      aria-hidden="true"
                    />
                  </span>
                  <span className="mt-1 block font-mono text-[11px] text-[var(--color-muted-foreground)]">
                    {c.status === "open" ? "Open" : "Closed"} · updated {relativeTime(c.updatedAt)} ·{" "}
                    {c.notesChars > 0 ? `${c.notesChars.toLocaleString("en-US")} characters of notes` : "no notes yet"}
                  </span>
                </button>

                {/* Two steps, because there is no undo and no trash to fish a
                    case back out of. */}
                {confirmId === c.id ? (
                  <span className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void destroy(c.id)}
                      className="btn-secondary btn-compact"
                    >
                      Delete for good
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmId(null)}
                      className="btn-secondary btn-compact"
                    >
                      Keep
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    aria-label={`Delete ${c.name}`}
                    onClick={() => setConfirmId(c.id)}
                    className="btn-secondary btn-compact shrink-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
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
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onBack} className="btn-secondary btn-compact">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          All cases
        </button>
        <SaveIndicator state={saveState} />
      </div>

      {failure ? <OutcomePanel outcome={failure} onRetry={() => void load()} /> : null}

      {loading ? (
        <Section title="Case">
          <EmptyState message="Loading this case." />
        </Section>
      ) : !record ? (
        <Section title="Case">
          <EmptyState message="This case could not be opened. It may have been deleted." />
        </Section>
      ) : (
        <>
          <Section
            title="Case"
            action={
              <span className="flex items-center gap-2">
                <button type="button" onClick={toggleStatus} className="btn-secondary btn-compact">
                  <span
                    aria-hidden="true"
                    className={`inline-block h-1.5 w-1.5 rounded-full ${
                      status === "open" ? "bg-emerald-400" : "bg-white/30"
                    }`}
                  />
                  {status === "open" ? "Open" : "Closed"}
                </button>
                {confirming ? (
                  <>
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
                  </>
                ) : (
                  <button
                    type="button"
                    aria-label="Delete this case"
                    onClick={() => setConfirming(true)}
                    className="btn-secondary btn-compact"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </span>
            }
          >
            <label
              htmlFor="investigation-case-name"
              className="block font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted-foreground)]"
            >
              Name
            </label>
            <input
              id="investigation-case-name"
              value={name}
              onChange={(e) => {
                nameDirty.current = true
                setName(e.target.value)
              }}
              autoComplete="off"
              spellCheck={false}
              className="mt-2 h-10 w-full select-text glass-input px-3.5 text-sm outline-none"
            />
            <p className="mt-2 font-mono text-[11px] text-[var(--color-muted-foreground)]">
              Opened {relativeTime(record.createdAt)} · updated {relativeTime(record.updatedAt)}
            </p>
          </Section>

          <Section
            title="Case notes"
            action={
              // The save indicator is deliberately NOT repeated here. It lives
              // in the header, where it covers the name and the notepad at once;
              // two of them saying "Saved" a beat apart reads as two saves.
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted-foreground)]">
                {notes.length.toLocaleString("en-US")} / {NOTES_MAX.toLocaleString("en-US")}
              </span>
            }
          >
            <textarea
              value={notes}
              maxLength={NOTES_MAX}
              onChange={(e) => {
                notesDirty.current = true
                setNotes(e.target.value)
              }}
              aria-label="Case notes"
              placeholder="Findings, timeline, leads, conclusions. Saves on its own as you type."
              className="min-h-[18rem] w-full select-text resize-y glass-input p-3.5 text-sm leading-relaxed outline-none"
            />
          </Section>

          <AssistantPanel active={assistant} caseId={record.id} />
        </>
      )}
    </div>
  )
}
