import { useState } from "react"

import type { Overview } from "../lib/ipc"
import { withDefaults } from "./safe"
import { EmptyState, FieldGrid, Section } from "./ui"

/**
 * API Access.
 *
 * NOT a lookup: there is no server module behind it and no input to submit.
 * Everything it shows already arrived in the boot-time Overview, so this screen
 * reads `overview.api` and renders it. It therefore cannot be a `ModuleDescriptor`
 * on the registry (ModuleScreen only renders a module's output after a metered
 * `ipc.lookup`, and it never receives the Overview) - see the note this ships
 * with. It composes only `ui/` primitives; the only frame it owns is the screen
 * heading, exactly as ModuleScreen provides for the lookup modules.
 *
 * The key is a credential, so it is masked by default with an explicit reveal,
 * and copying goes through `navigator.clipboard` rather than asking the user to
 * select text by hand.
 */

type Api = Overview["api"]

const EMPTY_API: Api = {
  active: false,
  tierLabel: null,
  usedToday: 0,
  dailyLimit: null,
  expiresAt: null,
  key: null,
}

function formatDate(iso: string | null): string {
  if (!iso) return ""
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ""
  return at.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
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

export function ApiAccess({ overview }: { overview: Overview }) {
  // Coerced once, up front: a field read on an absent object throws inside
  // React's render, which in this app is an unrecoverable white window.
  const api = withDefaults(overview?.api, EMPTY_API)

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">API Access</h1>

      <Section title="Overview">
        <FieldGrid
          fields={[
            { label: "Tier", value: api.tierLabel ?? "" },
            { label: "Status", value: api.active ? "Active" : "Inactive" },
            { label: "Requests today", value: String(api.usedToday) },
            {
              label: "Daily limit",
              value: api.dailyLimit === null ? "Unlimited" : String(api.dailyLimit),
            },
            { label: "Renews", value: formatDate(api.expiresAt) },
          ]}
        />
      </Section>

      <Section title="API key">
        {api.key ? (
          <ApiKeyRow apiKey={api.key} />
        ) : (
          <EmptyState
            message={
              api.active
                ? "No key is provisioned on this account yet."
                : "API access is not enabled on this account."
            }
          />
        )}
      </Section>
    </div>
  )
}
