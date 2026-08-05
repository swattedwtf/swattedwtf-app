import type { CSSProperties } from "react"
import { Fingerprint } from "lucide-react"

import { ipc } from "../../lib/ipc"
import { list } from "../safe"
import { BadgeRow, EmptyState, ProfileCard, Section, type Badge, type Field } from "../ui"
import type { StreamFrame, StreamModuleDescriptor, StreamResultProps } from "../stream-types"

/**
 * Live Intelligence: the Heist account-enumeration sweep, cards streamed as each
 * source resolves. Two tabs, mirroring the web page:
 *
 *  - Email drives the server's `live-intelligence` stream module (email sweep).
 *  - Phone drives the `phone-intelligence` module (phone sweep).
 *
 * Both emit the identical `{t:"start"}`, `{t:"progress", card}`, `{t:"done"}`
 * frame shape, so one Result renders either. A card is a hit; a `card:null`
 * progress frame is a checked-but-no-hit source, which advances the counter but
 * renders nothing. Only hits are drawn, so a source that FAILED inside the sweep
 * never appears as a source that "found nothing".
 *
 * Existence-only hits (a provider that merely confirmed an account is
 * registered, no profile/recovery/id) collapse into one "Registered services"
 * summary, exactly as the web does; the richer providers each keep their own
 * card. The server has already rewritten every card's avatar onto our image
 * proxy and every viewUrl through the link sanitiser, so avatars go through
 * RemoteImage (inside ProfileCard) and "View profile" opens the link externally.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Advisory only. The server's normalizePhone is the authority; this just keeps
// an obviously-not-a-phone value from becoming a metered request, and produces
// the same E.164 the server would so the sent value matches its metering form.
const E164_RE = /^\+[1-9]\d{6,14}$/

/** Client-side E.164 canonicalisation, mirroring lib/phone-validation on the
 *  server, so the value the client sends is the same one the server meters on. */
function normalizePhone(value: string): string | null {
  let s = value.trim()
  if (!s) return null
  // `00` is the international call prefix in much of the world; treat it as `+`.
  if (s.startsWith("00")) s = "+" + s.slice(2)
  const hadPlus = s.startsWith("+")
  const digits = s.replace(/\D/g, "")
  // Require an explicit international form: without a country code we would be
  // guessing, which produces wrong lookups. Refuse rather than guess.
  if (!digits || !hadPlus) return null
  const e164 = "+" + digits
  return E164_RE.test(e164) ? e164 : null
}

type IntelField = { label?: unknown; value?: unknown }
type IntelCard = {
  key?: unknown
  provider?: unknown
  title?: unknown
  subtitle?: unknown
  avatar?: unknown
  viewUrl?: unknown
  fields?: unknown
  existenceOnly?: unknown
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

/** One rich provider card: avatar/name/handle over its labelled fields, with an
 *  external "View profile" link when the server sanitised one through. */
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

/**
 * The collapsed summary of existence-only hits, mirroring the web's "Registered
 * Services" card: a count and a row of provider-name pills. Built on BadgeRow so
 * it matches every other pill row in the app.
 */
function RegisteredServices({ providers }: { providers: string[] }) {
  const badges: Badge[] = providers
    .map((p) => ({ label: p }))
    .sort((a, b) => a.label.localeCompare(b.label))
  return (
    <Section title={`Registered services · ${providers.length} account${providers.length === 1 ? "" : "s"}`}>
      <BadgeRow badges={badges} />
    </Section>
  )
}

/** Copy for the empty state, keeping a failed sweep distinct from a clean miss. */
function emptyMessage(status: StreamResultProps["status"]): string {
  if (status === "streaming") {
    return "Checking sources for accounts tied to this identifier. Results appear as each source answers."
  }
  if (status === "cancelled") return "Sweep cancelled before any accounts were surfaced."
  if (status === "error") return "The sweep stopped before finishing. Retry to run it again."
  return "No accounts surfaced for this lookup."
}

function LiveIntelResult({ frames, status }: StreamResultProps) {
  const hitCards = cards(frames)
  const { checked, total, hits } = progress(frames)
  const streaming = status === "streaming"

  // Existence-only hits collapse into one summary; richer providers each keep
  // their own card, exactly as the web page splits them.
  const existenceOnly = hitCards.filter((c) => c.existenceOnly === true)
  const richCards = hitCards.filter((c) => c.existenceOnly !== true)
  const providerNames = existenceOnly.map((c) => text(c.provider) || text(c.key) || "Account")

  return (
    <div className="fade-in space-y-4">
      {/* Summary bar: accounts found and sources checked, with a live dot while
          sources are still answering. Matches the web page's summary line. */}
      <div className="glass-tile flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-[13px]">
        <span className="text-white/70">
          <span className="font-semibold text-white">{hits}</span> account
          {hits === 1 ? "" : "s"} found
        </span>
        <span className="text-white/30" aria-hidden="true">
          ·
        </span>
        <span className="text-white/70">
          <span className="tabular-nums text-white">{checked}</span>
          {total > 0 ? ` of ${total}` : ""} sources checked
        </span>
        {streaming ? (
          <span className="ml-auto inline-flex items-center gap-2 text-white/70">
            <span
              className="live-dot h-2 w-2 shrink-0 rounded-full bg-[var(--color-positive)]"
              aria-hidden="true"
            />
            scanning
          </span>
        ) : null}
      </div>

      {existenceOnly.length > 0 ? <RegisteredServices providers={providerNames} /> : null}

      {richCards.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {richCards.map((card, i) => (
            <div
              key={text(card.key) || `card-${i}`}
              className="stagger-item"
              style={{ "--i": i } as CSSProperties}
            >
              <CardView card={card} />
            </div>
          ))}
        </div>
      ) : null}

      {/* Nothing has arrived yet but the sweep is running: skeletons rather than
          an empty panel, so the screen reads as working, not broken. */}
      {streaming && hitCards.length === 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-40" />
          ))}
        </div>
      ) : null}

      {/* Distinct from the skeletons above: an explicit empty/failed/cancelled
          state once the sweep is no longer producing. */}
      {!streaming && hitCards.length === 0 ? <EmptyState message={emptyMessage(status)} /> : null}

      {status === "cancelled" && hitCards.length > 0 ? (
        <p className="text-[12px] text-white/60">
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
  icon: Fingerprint,
  description:
    "Reveal where an email or phone number is registered across 50+ platforms, with recovery hints and account details.",
  // The two tabs, mirroring the web page. The mode toggle picks which sweep the
  // server runs; each is metered as its own web route through its own module.
  modes: [
    { id: "email", label: "Email" },
    { id: "phone", label: "Phone" },
  ],
  inputs: [
    {
      name: "query",
      label: "Email or phone",
      placeholder: "target@example.com or +49 176 84100605",
      // Non-empty only here; the mode-specific check lives in resolve, since a
      // field validator cannot see which tab is selected.
      validate: (v) => (v.trim() ? null : "Enter an email or phone number."),
    },
  ],
  resolve: (values, mode) => {
    const raw = (values.query ?? "").trim()
    if (!raw) return { error: "Enter an email or phone number." }

    if (mode === "phone") {
      const e164 = normalizePhone(raw)
      if (!e164) {
        return {
          error: "Enter a valid phone number in international format (e.g. +49 176 84100605).",
        }
      }
      return { module: "phone-intelligence", input: { phone: e164 } }
    }

    // Email is the default tab.
    const email = raw.toLowerCase()
    if (!EMAIL_RE.test(email)) return { error: "Enter a valid email address." }
    return { module: "live-intelligence", input: { email } }
  },
  Result: LiveIntelResult,
}
