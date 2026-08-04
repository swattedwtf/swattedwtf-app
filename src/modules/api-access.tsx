import { useState } from "react"

import { ipc, type Overview } from "../lib/ipc"
import { formatCount } from "../lib/format"
import { withDefaults } from "./safe"
import { EmptyState, FieldGrid, Section } from "./ui"

/**
 * API Access.
 *
 * A SEPARATE PAID ADD-ON, not something a plan includes, which is the fact this
 * screen exists to make obvious. It previously rendered "Status: Inactive" and
 * an empty key box, which reads as a broken feature rather than as one that has
 * not been bought. The web says plainly what it is, what it costs and what it
 * unlocks, and this now matches.
 *
 * NOT a lookup module: there is no server module behind it and nothing to
 * submit. Everything here already arrived in the boot-time Overview, which is
 * why it is a built-in route beside /dashboard and /settings rather than a
 * ModuleDescriptor.
 *
 * The key is a credential, so it is masked by default behind an explicit reveal
 * and copied through the clipboard rather than left on screen to select by hand.
 */

const PLANS_URL = "https://swattedw.tf/dashboard/plans#api-access"
const DOCS_URL = "https://swattedw.tf/dashboard/api/docs"

type Api = Overview["api"]

const EMPTY_API: Api = {
  active: false,
  tierLabel: null,
  usedToday: 0,
  dailyLimit: null,
  expiresAt: null,
  key: null,
}

/** Mirrors lib/api-tiers.ts on the server. Prices are per 30 days. */
const TIERS: { label: string; priceUsd: number }[] = [
  { label: "1,000 / day", priceUsd: 50 },
  { label: "2,500 / day", priceUsd: 90 },
  { label: "5,000 / day", priceUsd: 150 },
  { label: "10,000 / day", priceUsd: 280 },
  { label: "20,000 / day", priceUsd: 500 },
  { label: "Unlimited", priceUsd: 1500 },
]

/** Mirrors the web's own list, so the two pages promise the same thing. */
const FEATURES = [
  "Every lookup over one REST API",
  "Roblox, Discord, TikTok, Minecraft",
  "Email and username search, machine browser",
  "Investigations, Agent and Monitor endpoints",
  "Multiple API keys, revoke anytime",
]

function formatDate(iso: string | null | undefined): string {
  if (!iso) return ""
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ""
  return at.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

function openWeb(url: string) {
  void ipc.openExternal(url).catch(() => {})
}

function ApiKeyRow({ apiKey }: { apiKey: string }) {
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)

  // Length is hinted, not exact: a fixed band of dots so the mask does not leak
  // how long the key is while still looking like a key.
  const masked = "•".repeat(Math.max(16, Math.min(apiKey.length, 32)))

  function copy() {
    if (typeof navigator === "undefined" || !navigator.clipboard) return
    void navigator.clipboard
      .writeText(apiKey)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1600)
      })
      .catch(() => {})
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-lg border border-[var(--color-border)] bg-[var(--secondary)] px-3 py-2 font-mono text-[12px] text-white/85">
        {revealed ? apiKey : masked}
      </code>
      <button
        type="button"
        onClick={() => setRevealed((v) => !v)}
        className="btn-secondary btn-compact"
      >
        {revealed ? "Hide" : "Reveal"}
      </button>
      <button type="button" onClick={copy} className="btn-secondary btn-compact">
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  )
}

/** What someone without the add-on needs: what it is, what it costs, where to get it. */
function NotSubscribed() {
  return (
    <>
      <Section title="API Access is a separate add-on">
        <p className="text-[13px] leading-relaxed text-white/70">
          It is not part of any plan, so a Premium or Heist subscription does not include it. Adding
          it gives you keys and lets you call every lookup over one REST API, billed per 30 days by
          request volume.
        </p>

        <ul className="mt-4 space-y-1.5">
          {FEATURES.map((f) => (
            <li key={f} className="flex items-start gap-2 text-[13px] text-white/75">
              <span aria-hidden="true" className="mt-[2px] text-white/40">
                +
              </span>
              {f}
            </li>
          ))}
        </ul>

        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" onClick={() => openWeb(PLANS_URL)} className="btn-primary">
            Get API Access
          </button>
          <button type="button" onClick={() => openWeb(DOCS_URL)} className="btn-secondary">
            Read the docs
          </button>
        </div>
      </Section>

      <Section title="Request volumes">
        <FieldGrid
          fields={TIERS.map((t) => ({
            label: t.label,
            value: `$${t.priceUsd.toLocaleString("en-US")} / 30 days`,
          }))}
        />
      </Section>
    </>
  )
}

/** What a subscriber needs: their key, their usage, and when it renews. */
function Subscribed({ api }: { api: Api }) {
  return (
    <>
      <Section title="Your subscription">
        <FieldGrid
          fields={[
            { label: "Tier", value: api.tierLabel ?? "" },
            { label: "Requests today", value: formatCount(api.usedToday) },
            {
              label: "Daily limit",
              // == null, not === null: an undefined field must take the same
              // branch as a null one. The strict form crashed Settings.
              value: api.dailyLimit == null ? "Unlimited" : formatCount(api.dailyLimit),
            },
            { label: "Renews", value: formatDate(api.expiresAt) },
          ]}
        />
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => openWeb(DOCS_URL)} className="btn-secondary btn-compact">
            Read the docs
          </button>
          <button type="button" onClick={() => openWeb(PLANS_URL)} className="btn-secondary btn-compact">
            Change volume
          </button>
        </div>
      </Section>

      <Section title="API key">
        {api.key ? (
          <ApiKeyRow apiKey={api.key} />
        ) : (
          // Subscribed but keyless is a real state: the add-on is paid for and
          // no key has been generated yet. Say that, rather than repeating the
          // not-subscribed message.
          <EmptyState message="No key has been generated on this account yet. Generate one on the web." />
        )}
      </Section>
    </>
  )
}

export function ApiAccess({ overview }: { overview: Overview }) {
  // Coerced once, up front: a field read on an absent object throws inside
  // React's render, which in this app is an unrecoverable white window.
  const api = withDefaults(overview?.api, EMPTY_API)

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">API Access</h1>
        <p className="mt-1 text-[13px] text-[var(--color-muted-foreground)]">
          {api.active
            ? "Active on this account."
            : "A paid add-on, sold separately from your plan."}
        </p>
      </div>

      {api.active ? <Subscribed api={api} /> : <NotSubscribed />}
    </div>
  )
}
