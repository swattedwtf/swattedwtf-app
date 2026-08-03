import { useState } from "react"
import { BookText, Check, Code2, Copy, Eye, EyeOff, ExternalLink, KeyRound } from "lucide-react"
import type { Overview } from "../lib/ipc"
import { formatCount, formatSince } from "../lib/format"
import { openWeb } from "./QuickActions"

const API_URL = "https://swattedw.tf/dashboard/api"
const DOCS_URL = "https://swattedw.tf/dashboard/api/docs"

const pillClass =
  "inline-flex h-9 items-center gap-2 rounded-md border border-white/10 bg-black/30 px-3 text-sm font-medium transition-colors hover:border-white/20 hover:bg-white/[0.05]"

const fieldClass =
  "flex-1 select-text truncate rounded-md border border-white/10 bg-black/30 px-3 py-2.5 font-mono text-sm"

const iconBtnClass =
  "flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-white/10 bg-black/30 text-[var(--muted-foreground)] transition-colors hover:border-white/20 hover:bg-white/[0.05] hover:text-white"

const labelClass =
  "font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted-foreground)]"

/**
 * Clipboard write that degrades instead of throwing. The Tauri webview is a
 * secure context so navigator.clipboard is normally there, but WebKitGTK
 * without a running clipboard owner can still reject, and the whole card must
 * not die over a copy button.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement("textarea")
    ta.value = text
    ta.setAttribute("readonly", "")
    ta.style.position = "fixed"
    ta.style.opacity = "0"
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand("copy")
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

/** The add-on card. Rendered only while API access is actually active. */
function ApiAccessCard({ api }: { api: Overview["api"] }) {
  const { dailyLimit, usedToday, expiresAt, tierLabel } = api
  const pct = dailyLimit && dailyLimit > 0 ? Math.min(100, (usedToday / dailyLimit) * 100) : 0

  return (
    <div className="glass p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Code2 className="h-4 w-4 text-[var(--muted-foreground)]" aria-hidden="true" />
          <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--muted-foreground)]">
            API Access
          </h2>
          <span className="rounded-full border border-white/10 bg-black/30 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em]">
            {tierLabel ?? "API Access"}
          </span>
        </div>
        {expiresAt && (
          <span className="font-mono text-[10px] text-[var(--muted-foreground)]">
            Renews {formatSince(expiresAt)}
          </span>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-2xl font-semibold tabular-nums tracking-tight">
            {formatCount(usedToday)}
          </p>
          <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
            {dailyLimit === null
              ? "requests today, unlimited"
              : `requests today, of ${formatCount(dailyLimit)}/day`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void openWeb(API_URL)} className={pillClass}>
            <KeyRound className="h-4 w-4" aria-hidden="true" /> Keys
            <ExternalLink className="h-3 w-3 opacity-60" aria-hidden="true" />
          </button>
          <button type="button" onClick={() => void openWeb(DOCS_URL)} className={pillClass}>
            <BookText className="h-4 w-4" aria-hidden="true" /> Docs
            <ExternalLink className="h-3 w-3 opacity-60" aria-hidden="true" />
          </button>
        </div>
      </div>

      {dailyLimit !== null && (
        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-white/80 transition-[width]"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  )
}

/**
 * Credentials. The key is masked by default: a dashboard is the thing people
 * screen-share, and an API key on screen is a leaked API key.
 */
function ApiCredentialsCard({ apiKey, userNumber }: { apiKey: string | null; userNumber: number }) {
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState<"key" | "id" | null>(null)

  const userId = String(userNumber)
  const masked = apiKey ? "•".repeat(Math.max(16, Math.min(apiKey.length, 32))) : ""

  async function copy(text: string, which: "key" | "id") {
    if (!(await copyText(text))) return
    setCopied(which)
    setTimeout(() => setCopied((c) => (c === which ? null : c)), 1600)
  }

  return (
    <div className="glass p-5">
      <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-[var(--muted-foreground)]" aria-hidden="true" />
        <h3 className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--muted-foreground)]">
          API Credentials
        </h3>
      </div>

      <div className="mt-5">
        <p className={labelClass}>API Key</p>
        {apiKey ? (
          <div className="mt-2 flex items-center gap-2">
            <code className={fieldClass}>{revealed ? apiKey : masked}</code>
            <button
              type="button"
              onClick={() => setRevealed((v) => !v)}
              aria-label={revealed ? "Hide API key" : "Show API key"}
              className={iconBtnClass}
            >
              {revealed ? (
                <EyeOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Eye className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              onClick={() => void copy(apiKey, "key")}
              aria-label="Copy API key"
              className={iconBtnClass}
            >
              {copied === "key" ? (
                <Check className="h-4 w-4 text-[var(--positive)]" aria-hidden="true" />
              ) : (
                <Copy className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
        ) : (
          <p className="mt-2 text-xs text-[var(--muted-foreground)]">
            No key provisioned on this account yet.
          </p>
        )}
      </div>

      <div className="mt-5">
        <p className={labelClass}>User ID</p>
        <div className="mt-2 flex items-center gap-2">
          <code className={fieldClass}>{userId}</code>
          <button
            type="button"
            onClick={() => void copy(userId, "id")}
            aria-label="Copy user ID"
            className={iconBtnClass}
          >
            {copied === "id" ? (
              <Check className="h-4 w-4 text-[var(--positive)]" aria-hidden="true" />
            ) : (
              <Copy className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      <div className="mt-5 border-t border-white/10 pt-5">
        {/* Rotation is a write, and this app has no command for it. Rather than
            fake a button that cannot work, hand the job to the web dashboard. */}
        <button type="button" onClick={() => void openWeb(API_URL)} className={pillClass}>
          Manage keys
          <ExternalLink className="h-3 w-3 opacity-60" aria-hidden="true" />
        </button>
        <p className="mt-2 text-[11px] text-[var(--muted-foreground)]">
          Rotating a key opens in your browser.
        </p>
      </div>
    </div>
  )
}

export function ApiCards({ overview }: { overview: Overview }) {
  return (
    <>
      {overview.api.active && <ApiAccessCard api={overview.api} />}
      <ApiCredentialsCard apiKey={overview.api.key} userNumber={overview.user.userNumber} />
    </>
  )
}
