import { ipc } from "../../lib/ipc"
import { list } from "../safe"
import { EmptyState, FieldGrid, ProfileCard, Section, type Field } from "../ui"
import type { StreamFrame, StreamModuleDescriptor, StreamResultProps } from "../stream-types"

/**
 * Live Intelligence: the Heist email sweep, cards streamed as each source
 * resolves.
 *
 * Drives the server's `live-intelligence` stream module, which runs the exact
 * fan-out the web page runs and emits `{t:"start"}`, `{t:"progress", card}`,
 * `{t:"done"}` frames. A card is a hit; a `card:null` progress frame is a
 * checked-but-no-hit source, which advances the counter but renders nothing.
 * Only hits are drawn, so a source that failed inside the sweep never appears as
 * a source that "found nothing".
 *
 * The server has already rewritten every card's avatar onto our image proxy and
 * every viewUrl through the link sanitiser, so avatars go through RemoteImage
 * (inside ProfileCard) and the "View profile" button opens the link externally.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type IntelField = { label?: unknown; value?: unknown }
type IntelCard = {
  key?: unknown
  provider?: unknown
  title?: unknown
  subtitle?: unknown
  avatar?: unknown
  viewUrl?: unknown
  fields?: unknown
}

function text(value: unknown): string {
  return typeof value === "string" ? value : ""
}

/** Every hit card in arrival order, de-duplicated by its provider key. */
function cards(frames: StreamFrame[]): IntelCard[] {
  const seen = new Set<string>()
  const out: IntelCard[] = []
  for (const frame of frames) {
    if (frame.t !== "progress") continue
    const card = frame.card
    if (!card || typeof card !== "object") continue
    const c = card as IntelCard
    const key = text(c.key) || text(c.provider) || String(out.length)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(c)
  }
  return out
}

/** The most recent counters, coerced. `total` comes from the start frame. */
function progress(frames: StreamFrame[]): { checked: number; total: number; hits: number } {
  let checked = 0
  let total = 0
  let hits = 0
  for (const frame of frames) {
    if (frame.t === "start" && typeof frame.total === "number") total = frame.total
    else if (frame.t === "progress") {
      if (typeof frame.checked === "number") checked = frame.checked
      if (typeof frame.total === "number") total = frame.total
      if (typeof frame.hits === "number") hits = frame.hits
    } else if (frame.t === "done" && frame.stats && typeof frame.stats === "object") {
      const s = frame.stats as Record<string, unknown>
      if (typeof s.checked === "number") checked = s.checked
      if (typeof s.total === "number") total = s.total
      if (typeof s.hits === "number") hits = s.hits
    }
  }
  return { checked, total, hits }
}

function CardView({ card }: { card: IntelCard }) {
  const provider = text(card.provider) || "Account"
  const title = text(card.title) || provider
  const viewUrl = text(card.viewUrl)
  const meta: Field[] = list<IntelField>(card.fields).map((f) => ({
    label: text(f?.label),
    value: text(f?.value),
  }))

  return (
    <ProfileCard
      avatarUrl={text(card.avatar) || null}
      name={title}
      subtitle={text(card.subtitle) || provider}
      meta={meta}
    >
      {viewUrl ? (
        <button
          type="button"
          onClick={() => void ipc.openExternal(viewUrl).catch(() => {})}
          className="btn-secondary btn-compact"
        >
          View profile
        </button>
      ) : null}
    </ProfileCard>
  )
}

function LiveIntelResult({ frames, status }: StreamResultProps) {
  const hitCards = cards(frames)
  const { checked, total, hits } = progress(frames)

  const summary: Field[] = [
    { label: "Sources checked", value: total > 0 ? `${checked} of ${total}` : String(checked) },
    { label: "Accounts found", value: String(hits) },
  ]

  return (
    <div className="space-y-4">
      <Section title={status === "streaming" ? "Enumerating accounts" : "Sweep summary"}>
        <FieldGrid fields={summary} />
      </Section>

      {hitCards.length === 0 ? (
        <EmptyState
          message={
            status === "streaming"
              ? "Checking sources for accounts tied to this email. Results appear as each source answers."
              : status === "cancelled"
                ? "Sweep cancelled before any accounts were surfaced."
                : status === "error"
                  ? "The sweep stopped before finishing. Retry to run it again."
                  : "No accounts surfaced for this email."
          }
        />
      ) : (
        hitCards.map((card, i) => <CardView key={text(card.key) || `card-${i}`} card={card} />)
      )}

      {status === "cancelled" && hitCards.length > 0 ? (
        <p className="text-[12px] text-[var(--color-muted-foreground)]">
          Cancelled. Showing the accounts found before you stopped.
        </p>
      ) : null}
    </div>
  )
}

export const liveIntelligenceDescriptor: StreamModuleDescriptor = {
  id: "live-intelligence",
  route: "/live-intelligence",
  label: "Live Intelligence",
  inputs: [
    {
      name: "email",
      label: "Email",
      placeholder: "target@example.com",
      validate: (v) => (EMAIL_RE.test(v.trim()) ? null : "Enter a valid email address."),
    },
  ],
  resolve: (values) => {
    const email = (values.email ?? "").trim().toLowerCase()
    if (!EMAIL_RE.test(email)) return { error: "Enter a valid email address." }
    return { module: "live-intelligence", input: { email } }
  },
  Result: LiveIntelResult,
}
