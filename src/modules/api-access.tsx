import { useState } from "react"
import { ArrowRight, BookText, Code2, Gauge, Infinity as InfinityIcon } from "lucide-react"

import { ipc, type Overview } from "../lib/ipc"
import { formatCount } from "../lib/format"
import { copyText } from "../lib/clipboard"
import { withDefaults } from "./safe"

/**
 * API Access, laid out to match the web page at /dashboard/api.
 *
 * A SEPARATE PAID ADD-ON, not something a plan includes. The unsubscribed state
 * is the one that matters: it used to render "Status: Inactive" over an empty
 * key box, which reads as a broken feature rather than as one that has not been
 * bought. The web says it plainly and this now says the same words.
 *
 * NOT a lookup module: there is no server module behind it and nothing to
 * submit. Everything here already arrived in the boot-time Overview, which is
 * why it is a built-in route beside /dashboard and /settings.
 *
 * The key is a credential, so it is masked behind an explicit reveal and copied
 * through the clipboard rather than left on screen to select by hand. That is
 * the one place this deliberately differs from the web, which manages keys on a
 * page the desktop client does not have.
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

function formatRenews(iso: string | null | undefined): string {
  if (!iso) return "Active"
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return "Active"
  return `Renews ${at.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`
}

function openWeb(url: string) {
  void ipc.openExternal(url).catch(() => {})
}

/** One of the three summary tiles, matching the web's grid. */
function Tile({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
}) {
  return (
    <div className="glass-tile p-5">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]">
        {icon} {label}
      </div>
      <p className="mt-2 text-xl font-semibold tabular-nums text-white">{value}</p>
      {hint ? (
        <p className="mt-1 flex items-center gap-1 text-xs text-[var(--color-muted-foreground)]">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

function ApiKeyRow({ apiKey }: { apiKey: string }) {
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)

  // Length is hinted, not exact: a fixed band of dots so the mask does not leak
  // how long the key is while still looking like a key.
  const masked = "•".repeat(Math.max(16, Math.min(apiKey.length, 32)))

  function copy() {
    // Through the shared helper so a webview without navigator.clipboard still
    // copies via the execCommand fallback rather than silently doing nothing.
    void copyText(apiKey).then((ok) => {
      if (!ok) return
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="glass-input min-w-0 flex-1 truncate px-3 py-2 font-mono text-[12px]">
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

export function ApiAccess({ overview }: { overview: Overview }) {
  // Coerced once, up front: a field read on an absent object throws inside
  // React's render, which in this app is an unrecoverable white window.
  const api = withDefaults(overview?.api, EMPTY_API)

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]">
          / API Access
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">API Access</h1>
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
          Programmatic access to every Swatted.wtf lookup over a simple REST API.
        </p>
      </div>

      {!api.active ? (
        <section className="glass-tile p-8 text-center">
          <span className="glass-tile mx-auto flex h-12 w-12 items-center justify-center rounded-full">
            <Code2 className="h-5 w-5 text-[var(--color-muted-foreground)]" aria-hidden="true" />
          </span>
          <h2 className="mt-4 text-lg font-semibold text-white">No active API Access</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-[var(--color-muted-foreground)]">
            Subscribe to API Access to generate keys and call the API. Choose a request volume that
            fits your needs, from 1,000/day up to unlimited.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <button type="button" onClick={() => openWeb(PLANS_URL)} className="btn-primary">
              Get API Access
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => openWeb(DOCS_URL)} className="btn-secondary">
              <BookText className="h-4 w-4" aria-hidden="true" />
              Read the docs
            </button>
          </div>
        </section>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-3">
            <Tile
              icon={<Gauge className="h-3.5 w-3.5" aria-hidden="true" />}
              label="Plan"
              value={api.tierLabel ?? "API Access"}
              hint={formatRenews(api.expiresAt)}
            />
            <Tile
              icon={<Code2 className="h-3.5 w-3.5" aria-hidden="true" />}
              label="Requests today"
              value={formatCount(api.usedToday) || "0"}
              hint={
                // == null, not the strict form that crashed Settings by letting
                // an undefined value through.
                api.dailyLimit == null ? (
                  <>
                    of <InfinityIcon className="h-3 w-3" aria-hidden="true" /> unlimited
                  </>
                ) : (
                  `of ${formatCount(api.dailyLimit)} per day`
                )
              }
            />
            <button
              type="button"
              onClick={() => openWeb(DOCS_URL)}
              className="glass-tile glass-tile-hover group flex flex-col justify-between p-5 text-left"
            >
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]">
                <BookText className="h-3.5 w-3.5" aria-hidden="true" /> Documentation
              </div>
              <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-white">
                API reference
                <ArrowRight
                  className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </p>
            </button>
          </section>

          <section className="glass-tile p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]">
              API key
            </p>
            <div className="mt-3">
              {api.key ? (
                <ApiKeyRow apiKey={api.key} />
              ) : (
                // Subscribed but keyless is a real state: the add-on is paid for
                // and no key has been generated. Say that, rather than repeating
                // the not-subscribed pitch.
                <p className="text-[13px] text-[var(--color-muted-foreground)]">
                  No key has been generated on this account yet. Create one from the API Access page
                  on the web.
                </p>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
