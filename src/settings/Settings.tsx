import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { getVersion } from "@tauri-apps/api/app"
import {
  Check,
  ExternalLink,
  Keyboard,
  KeyRound,
  Loader2,
  LogOut,
  Mail,
  Power,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
  User,
  Wallet,
} from "lucide-react"
import { ThemeSection } from "./ThemeSection"
import { copyText } from "../lib/clipboard"

import type { IntegrityReport } from "../boot/machine"
import { ipc, type Overview, type SettingsView, type WindowDiagnostics } from "../lib/ipc"
import { messageOf } from "../lib/errors"
import { formatCount, formatResetIn, formatSince } from "../lib/format"
import { captureCombo, formatCombo } from "./combo"

const REPO_URL = "https://github.com/swattedwtf/swattedwtf-app"
const WEB_SETTINGS_URL = "https://swattedw.tf/dashboard/settings"
const PLANS_URL = "https://swattedw.tf/dashboard/plans"

const CAPTION =
  "font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]"
const MUTED = "text-[var(--color-muted-foreground)]"

/** One block of the screen, on the two-element panel material.
 *
 * Header matches the web's settings cards: an icon in a soft tile, the title,
 * and a one-line description, rather than the bare mono-caption the app used,
 * which is what made the two sets of cards read as different products. */
function Panel({
  title,
  description,
  icon,
  children,
}: {
  title: string
  description?: string
  icon?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="glass">
      <div className="glass-body">
        <div className="flex items-start gap-3">
          {icon ? (
            <span className="glass-tile grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white">
              {icon}
            </span>
          ) : null}
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold tracking-tight text-white">{title}</h2>
            {description ? (
              <p className={`mt-0.5 text-xs leading-relaxed ${MUTED}`}>{description}</p>
            ) : null}
          </div>
        </div>
        <div className="mt-4 space-y-3 text-sm">{children}</div>
      </div>
    </section>
  )
}

function Row({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <span className={MUTED}>{label}</span>
        {hint && <p className={`text-xs leading-relaxed ${MUTED} opacity-70`}>{hint}</p>}
      </div>
      <span className="min-w-0 shrink-0 truncate text-right">{value}</span>
    </div>
  )
}

/** Explanatory copy under a control. Never an error; see Note for that. */
function Help({ children }: { children: ReactNode }) {
  return <p className={`text-xs leading-relaxed ${MUTED}`}>{children}</p>
}

/**
 * Something the user has to read. Rendered in the warning colour and never
 * paraphrased: where the text came from the operating system it is shown
 * exactly as the operating system wrote it.
 */
function Note({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs leading-relaxed text-[var(--color-warning)]">{children}</p>
  )
}

/** Balance, in the currency the server bills in. */
export function formatCents(cents: number | null | undefined): string {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return ""
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

async function openWeb(url: string): Promise<boolean> {
  try {
    await ipc.openExternal(url)
    return true
  } catch {
    return false
  }
}

/** Defaults for a plan the server described only partly. */
const EMPTY_PLAN = {
  id: "",
  label: "",
  monthlyLimit: 0,
  since: "",
  balanceCents: 0,
  status: "",
  dailyLimit: null as number | null,
}

/** Defaults for usage the server described only partly. */
const EMPTY_USAGE = {
  todayCount: 0,
  monthCount: 0,
  allTimeCount: 0,
  nextResetMs: 0,
  series: [] as { date: string; count: number }[],
}

/* ---- Account ---------------------------------------------------------- */

export function AccountSection({
  overview,
  busy,
  onLogout,
}: {
  overview: Overview
  busy: boolean
  onLogout: () => void
}) {
  return (
    <Panel
      title="Account"
      description="Who you are, and the ways back into this account."
      icon={<User className="h-4 w-4" aria-hidden="true" />}
    >
      <Row label="Handle" value={overview.user.handle} />
      <Row label="User number" value={`#${overview.user.userNumber}`} />
      <Row label="Member since" value={formatSince(overview.plan.since)} />

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={onLogout}
          disabled={busy}
          className="btn-secondary btn-compact"
          style={{ color: "var(--color-destructive)" }}
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden />
          Log out
        </button>
      </div>
    </Panel>
  )
}

/* ---- Sign-in (login code) --------------------------------------------- */

export function SignInSection() {
  const [code, setCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function regenerate() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = (await ipc.account("regenerateLoginCode")) as { ok?: boolean; code?: string; error?: string }
      if (res.ok && typeof res.code === "string") setCode(res.code)
      else setError(res.error || "Could not regenerate your login code.")
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel
      title="Sign-in"
      description="Your login code is how you sign in. Regenerating it signs out other sessions."
      icon={<KeyRound className="h-4 w-4" aria-hidden="true" />}
    >
      {code ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-white/[0.02] px-3 py-2.5">
          <span className="truncate font-mono text-[13px] tracking-[0.2em] text-white">{code}</span>
          <button
            type="button"
            onClick={() => {
              void copyText(code).then((ok) => {
                if (!ok) return
                setCopied(true)
                window.setTimeout(() => setCopied(false), 1500)
              })
            }}
            className="btn-secondary btn-compact shrink-0"
          >
            {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : "Copy"}
          </button>
        </div>
      ) : (
        <Help>Regenerate your 12-digit login code. Keep it secret; it is the key to your account.</Help>
      )}
      {error && <Note>{error}</Note>}
      <div className="pt-1">
        <button type="button" onClick={() => void regenerate()} disabled={busy} className="btn-secondary btn-compact">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
          Regenerate login code
        </button>
      </div>
    </Panel>
  )
}

/* ---- Email ------------------------------------------------------------ */

export function EmailSection({ overview }: { overview: Overview }) {
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy || !email.trim()) return
    setBusy(true)
    setError(null)
    setDone(false)
    try {
      const res = (await ipc.account("updateEmail", { email: email.trim() })) as { ok?: boolean; error?: string }
      if (res.ok) {
        setDone(true)
        setEmail("")
      } else setError(res.error || "Could not update your email.")
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel
      title="Email"
      description="Used for sign-in and security notifications."
      icon={<Mail className="h-4 w-4" aria-hidden="true" />}
    >
      <Row label="Current" value={overview.user.email ?? "Not set"} />
      <form onSubmit={submit} className="space-y-2 pt-1">
        <input
          type="email"
          value={email}
          onChange={(ev) => setEmail(ev.target.value)}
          placeholder="you@example.com"
          className="h-10 w-full rounded-lg border border-[var(--color-border)] bg-white/[0.02] px-3 text-[13px] text-white placeholder:text-[var(--color-muted-foreground)] focus:outline-none"
        />
        {error && <Note>{error}</Note>}
        {done && <Help>Email updated.</Help>}
        <button type="submit" disabled={busy || !email.trim()} className="btn-secondary btn-compact">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
          Update email
        </button>
      </form>
    </Panel>
  )
}

/* ---- Danger zone ------------------------------------------------------- */

export function DangerZoneSection({ onLoggedOut }: { onLoggedOut: () => void }) {
  const [signOutBusy, setSignOutBusy] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function signOutEverywhere() {
    if (signOutBusy) return
    setSignOutBusy(true)
    setError(null)
    try {
      const res = (await ipc.account("signOutEverywhere")) as { ok?: boolean; error?: string }
      if (res.ok) {
        await ipc.logout().catch(() => {})
        onLoggedOut()
      } else setError(res.error || "Could not sign out everywhere.")
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setSignOutBusy(false)
    }
  }

  async function deleteAccount() {
    if (deleteBusy) return
    setDeleteBusy(true)
    setError(null)
    try {
      const res = (await ipc.account("deleteAccount")) as { ok?: boolean; error?: string }
      if (res.ok) {
        await ipc.logout().catch(() => {})
        onLoggedOut()
      } else setError(res.error || "Could not delete your account.")
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setDeleteBusy(false)
      setConfirming(false)
    }
  }

  return (
    <Panel
      title="Danger zone"
      description="Irreversible actions. Be sure before continuing."
      icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
    >
      <Row label="Sign out everywhere" hint="Revokes every active session across all devices, including this one." value={null} />
      <div>
        <button
          type="button"
          onClick={() => void signOutEverywhere()}
          disabled={signOutBusy || deleteBusy}
          className="btn-secondary btn-compact"
        >
          {signOutBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <LogOut className="h-3.5 w-3.5" aria-hidden />}
          Sign out everywhere
        </button>
      </div>

      <div className="pt-2">
        <Row label="Delete account" hint="Permanently removes your account, profile, and usage history. This cannot be undone." value={null} />
        {error && <Note>{error}</Note>}
        {confirming ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs text-[var(--color-destructive)]">This cannot be undone. Delete anyway?</span>
            <button
              type="button"
              onClick={() => void deleteAccount()}
              disabled={deleteBusy}
              className="btn-secondary btn-compact"
              style={{ color: "var(--color-destructive)" }}
            >
              {deleteBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Trash2 className="h-3.5 w-3.5" aria-hidden />}
              Yes, delete my account
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={deleteBusy} className="btn-secondary btn-compact">
              Cancel
            </button>
          </div>
        ) : (
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="btn-secondary btn-compact"
              style={{ color: "var(--color-destructive)" }}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              Delete account
            </button>
          </div>
        )}
      </div>
    </Panel>
  )
}

/* ---- Plan and usage --------------------------------------------------- */

export function PlanSection({ overview }: { overview: Overview }) {
  // Coerced, not destructured raw. A field the server has not sent yet, or a
  // client newer than its server, must not be able to blank the window: a throw
  // inside React's render leaves a desktop app with no reachable console and no
  // fix short of a release. This screen crashed exactly that way.
  const plan = { ...EMPTY_PLAN, ...(overview.plan ?? {}) }
  const usage = { ...EMPTY_USAGE, ...(overview.usage ?? {}) }
  const pct =
    plan.monthlyLimit > 0 ? Math.min(100, (usage.monthCount / plan.monthlyLimit) * 100) : 0

  return (
    <Panel
      title="Plan and usage"
      description="Your current tier, wallet balance and lookup limits."
      icon={<Wallet className="h-4 w-4" aria-hidden="true" />}
    >
      <Row label="Plan" value={plan.label} />
      {/* Shown verbatim, and only when the server reported one. An empty string
          is "the server did not say", which is not a status of its own. */}
      {plan.status && <Row label="Status" value={plan.status} />}
      <Row label="Wallet balance" value={formatCents(plan.balanceCents)} />

      <div className="pt-1">
        <div className="flex items-baseline justify-between gap-4">
          <span className={MUTED}>Lookups this month</span>
          <span className="font-mono text-[13px]">
            {formatCount(usage.monthCount)} / {formatCount(plan.monthlyLimit)}
          </span>
        </div>
        <div className="meter mt-2 h-1.5 overflow-hidden rounded-full">
          <div className="meter-fill h-full rounded-full" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <Row
        label="Today"
        value={
          <span className="font-mono text-[13px]">
            {formatCount(usage.todayCount)}
            {/* Null is "no daily limit set", which is emphatically not zero. */}
            {plan.dailyLimit == null ? "" : ` / ${formatCount(plan.dailyLimit)}`}
          </span>
        }
        hint={plan.dailyLimit == null ? "No daily limit on this plan." : undefined}
      />
      <Row label="All time" value={formatCount(usage.allTimeCount)} />
      <Row label="Monthly reset" value={`in ${formatResetIn(usage.nextResetMs)}`} />

      <Help>
        The countdown above is to the start of the next month (UTC), which is the window your
        monthly allowance runs on. Your daily allowance resets on its own separate schedule, shown
        on the account page on the web.
      </Help>

      <div className="pt-1">
        <button
          type="button"
          onClick={() => void openWeb(PLANS_URL)}
          className="btn-secondary btn-compact"
        >
          View plans
          <ExternalLink className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
        </button>
      </div>
    </Panel>
  )
}

/* ---- Shortcuts -------------------------------------------------------- */

/**
 * The quick-lookup hotkey.
 *
 * Three things this deliberately does not do. It does not claim a combo is
 * bound because the call returned without an error: on macOS the Carbon API
 * does not report a hotkey another application already owns, so success is not
 * proof and the copy offers a way to check instead. It does not name a culprit
 * when registration fails, because on Windows the underlying library reports
 * every error as "already registered" whatever actually went wrong, so the
 * system's own message is quoted and nothing is added to it. And it does not
 * accept a combo without a modifier, which the parser would allow: grabbing a
 * bare key system-wide takes it away from every other application.
 */
export function ShortcutSection({
  view,
  busy,
  onApply,
}: {
  view: SettingsView | null
  busy: boolean
  onApply: (combo: string | null) => void
}) {
  const [recording, setRecording] = useState(false)
  const [captured, setCaptured] = useState<string | null>(null)
  const [rejected, setRejected] = useState<string | null>(null)

  // The listener has to be on the window: the point of a recorder is that it
  // catches the combo whether or not the button still has focus, and several of
  // the interesting combinations move focus on their own.
  useEffect(() => {
    if (!recording) return

    const onKeyDown = (event: KeyboardEvent) => {
      // Or the app's own shortcuts, the webview's find bar and the browser's
      // reload all fire while the user is trying to record them.
      event.preventDefault()
      event.stopPropagation()

      const result = captureCombo(event)
      if (result.kind === "pending") return
      if (result.kind === "cancel") {
        setRecording(false)
        setCaptured(null)
        setRejected(null)
        return
      }
      if (result.kind === "rejected") {
        setCaptured(null)
        setRejected(result.reason)
        return
      }
      setCaptured(result.combo)
      setRejected(null)
      setRecording(false)
    }

    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [recording])

  // Whether settings have loaded at all. Before they do (and permanently if the
  // read threw, which `refresh` swallows) `view` is null, and reporting "Not
  // bound" over a hotkey that is actually working, with an enabled Disable
  // button, is a lie the user could act on. Unknown is its own state.
  const loaded = view !== null
  const active = view?.shortcutActive ?? null
  const stored = view?.shortcut ?? null
  const disabled = loaded && stored === null

  return (
    <Panel
      title="Shortcuts"
      description="The global hotkey that summons the quick-lookup bar."
      icon={<Keyboard className="h-4 w-4" aria-hidden="true" />}
    >
      <Row
        label="Quick lookup"
        value={
          <span className="font-mono text-[13px]">
            {!loaded
              ? "Checking..."
              : active
                ? formatCombo(active)
                : disabled
                  ? "Turned off"
                  : "Not bound"}
          </span>
        }
      />

      {/* The two can differ, and when they do the difference is the whole
          story: the stored combo is not the one that works. */}
      {stored && active !== stored && (
        <Note>
          Saved as {formatCombo(stored)}, but that combination is not currently bound.
        </Note>
      )}
      {view?.shortcutError && <Note>{view.shortcutError}</Note>}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          onClick={() => {
            setCaptured(null)
            setRejected(null)
            setRecording((r) => !r)
          }}
          disabled={busy}
          className="btn-secondary btn-compact"
          aria-pressed={recording}
        >
          {recording ? "Listening, press a combination" : "Record a new shortcut"}
        </button>

        {captured && (
          <>
            <span className="glass-tile rounded-lg px-3 py-1.5 font-mono text-[13px]">
              {formatCombo(captured)}
            </span>
            <button
              type="button"
              onClick={() => {
                onApply(captured)
                setCaptured(null)
              }}
              disabled={busy}
              aria-busy={busy}
              className="btn-primary btn-compact"
            >
              Save
            </button>
          </>
        )}

        <button
          type="button"
          onClick={() => {
            setCaptured(null)
            setRejected(null)
            onApply(null)
          }}
          // Also disabled before settings load: turning off a hotkey whose state
          // we have not read yet would be acting on a guess.
          disabled={busy || disabled || !loaded}
          className="btn-secondary btn-compact"
        >
          Disable
        </button>
      </div>

      {rejected && <Note>{rejected}</Note>}

      {active && (
        <Help>
          Press {formatCombo(active)} now to check it. The quick lookup bar should appear over
          whatever you are doing. On macOS the system does not tell an application when another one
          already owns a combination, so saving without an error is not by itself proof that the
          shortcut works.
        </Help>
      )}
      {!active && !disabled && view !== null && (
        <Help>
          No shortcut is bound. Another application may already own the combination, in which case
          picking a different one is the fix.
        </Help>
      )}
      {disabled && <Help>The quick lookup bar can still be opened from the app window.</Help>}
    </Panel>
  )
}

/* ---- Startup ---------------------------------------------------------- */

export function StartupSection({
  view,
  busy,
  onToggle,
}: {
  view: SettingsView | null
  busy: boolean
  onToggle: (enabled: boolean) => void
}) {
  const enabled = view?.launchAtLogin ?? false

  return (
    <Panel
      title="Startup"
      description="How the app behaves when your computer starts."
      icon={<Power className="h-4 w-4" aria-hidden="true" />}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p>Launch at login</p>
          <Help>
            Starts swatted.wtf when you sign in to this computer. It is registered for your user
            account only and needs no administrator rights.
          </Help>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          disabled={busy || view === null}
          aria-busy={busy}
          onClick={() => onToggle(!enabled)}
          className="btn-secondary btn-compact shrink-0"
        >
          {enabled ? (
            <>
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              On
            </>
          ) : (
            "Off"
          )}
        </button>
      </div>

      {view?.launchAtLoginError && <Note>{view.launchAtLoginError}</Note>}
    </Panel>
  )
}

/* ---- Security --------------------------------------------------------- */

export function SecuritySection({ overview }: { overview: Overview }) {
  return (
    <Panel
      title="Security"
      description="Two-factor authentication and account recovery."
      icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
    >
      <Row
        label="Two-factor authentication"
        hint="Require a 6-digit authenticator code when you sign in."
        value={overview.security.twofaEnabled ? "Enabled" : "Disabled"}
      />
      <div>
        <button
          type="button"
          onClick={() => void openWeb(WEB_SETTINGS_URL)}
          className="btn-secondary btn-compact"
        >
          {overview.security.twofaEnabled ? "Manage two-factor" : "Start setup"}
          <ExternalLink className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
        </button>
      </div>

      <div className="pt-2">
        <Row
          label="Telegram recovery"
          hint="Link your Telegram for account recovery and bot access."
          value={overview.telegram.linked ? (overview.telegram.username ? `@${overview.telegram.username}` : "Linked") : "Not linked"}
        />
        <div className="pt-1">
          <button
            type="button"
            onClick={() => void openWeb(WEB_SETTINGS_URL)}
            className="btn-secondary btn-compact"
          >
            <Send className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
            {overview.telegram.linked ? "Manage Telegram" : "Generate a code"}
            <ExternalLink className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
          </button>
        </div>
      </div>

      <Help>
        Two-factor setup and Telegram linking run on the web dashboard, where the QR code and the
        recovery bot handshake live. Your session is stored in the operating system credential store
        and is never exposed to the app's interface code.
      </Help>
    </Panel>
  )
}

/* ---- Advanced --------------------------------------------------------- */

/**
 * Collapsed by default, and holding everything that is a diagnostic rather than
 * a setting. The window-transparency dump in particular used to sit in the
 * middle of the page, where it was the largest thing on a screen most users
 * have no use for.
 */
export function AdvancedSection({
  version,
  integrity,
  appDataDir,
  updateMessage,
  busy,
  onCheckUpdates,
}: {
  version: string
  integrity: IntegrityReport
  appDataDir: string
  updateMessage: string
  busy: boolean
  onCheckUpdates: () => void
}) {
  const [diag, setDiag] = useState<WindowDiagnostics | null>(null)
  const [copied, setCopied] = useState(false)

  return (
    // <summary> has to be the first child of <details>, so the disclosure sits
    // INSIDE the panel material rather than being it.
    <section className="glass">
      <div className="glass-body">
        <details>
          <summary className={`${CAPTION} cursor-pointer list-none`}>Advanced</summary>

          <div className="mt-4 space-y-3 text-sm">
          <Row label="Version" value={version || "..."} />
          <Row
            label="Integrity"
            value={integrity.ok ? "Verified" : `${integrity.changed.length} file(s) modified`}
          />

          {!integrity.ok && (
            <ul className="max-h-24 overflow-y-auto font-mono text-[11px] text-[var(--color-warning)]">
              {integrity.changed.slice(0, 10).map((f) => (
                <li key={f} className="truncate">
                  {f}
                </li>
              ))}
            </ul>
          )}

          <Help>
            Integrity checking detects corrupted or modified installs. It is not a security control:
            this app is open source, so the check can be removed from a modified copy.
          </Help>

          <div>
            <p className={MUTED}>App data directory</p>
            <p className="no-drag mt-1 select-text break-all font-mono text-[11px] text-white/70">
              {appDataDir || "Unknown"}
            </p>
            <Help>Holds your stored session and settings.json.</Help>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={onCheckUpdates}
              disabled={busy}
              aria-busy={busy}
              className="btn-secondary btn-compact"
            >
              Check for updates now
            </button>
            <button
              type="button"
              onClick={() => void openWeb(REPO_URL)}
              className="btn-secondary btn-compact"
            >
              View source
              <ExternalLink className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
            </button>
            {/* Reports what the window actually resolved to at runtime. The
                rounded corners are configured correctly and the page is
                verifiably transparent, yet they render square on some Windows
                machines, so the machine with the problem can report the
                answer. */}
            <button
              type="button"
              onClick={() => void ipc.windowDiagnostics().then(setDiag).catch(() => setDiag(null))}
              className="btn-secondary btn-compact"
            >
              Window diagnostics
            </button>
            {diag && (
              <button
                type="button"
                onClick={() => {
                  // Through the shared helper: reading navigator.clipboard
                  // directly threw synchronously past this .catch on a webview
                  // where the property is absent.
                  void copyText(JSON.stringify(diag, null, 2)).then(setCopied)
                }}
                className="btn-secondary btn-compact"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            )}
          </div>

          {updateMessage && <Help>{updateMessage}</Help>}

          {diag && (
            <pre className="glass-input no-drag max-h-40 select-text overflow-auto p-3 font-mono text-[10px] leading-relaxed text-white/70">
              {JSON.stringify(diag, null, 2)}
            </pre>
          )}
          </div>
        </details>
      </div>
    </section>
  )
}

/* ---- The screen ------------------------------------------------------- */

/**
 * The three groups the page is split into.
 *
 * Settings was one long column of six panels, which meant scrolling past the
 * plan and the security panel to reach a keyboard shortcut. Account is who you
 * are and what you pay for, App is how the program behaves on this machine,
 * Theme is how it looks.
 */
export type SettingsTab = "account" | "app" | "theme"

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "account", label: "Account" },
  { id: "app", label: "App" },
  { id: "theme", label: "Theme" },
]

export function SettingsTabs({
  tab,
  onChange,
}: {
  tab: SettingsTab
  onChange: (t: SettingsTab) => void
}) {
  return (
    <div role="tablist" aria-label="Settings sections" className="-mb-px flex gap-6 border-b border-white/[0.08]">
      {TABS.map((t) => {
        const active = t.id === tab
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={`relative -mb-px border-b-2 px-0.5 pb-2.5 pt-3 text-[13px] font-medium transition-colors ${
              active
                ? "border-white text-white"
                : "border-transparent text-white/50 hover:border-white/20 hover:text-white/80"
            }`}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

export function Settings({
  overview,
  integrity,
  onLoggedOut,
}: {
  overview: Overview
  integrity: IntegrityReport
  onLoggedOut: () => void
}) {
  const [version, setVersion] = useState("")
  const [tab, setTab] = useState<SettingsTab>("account")
  const [view, setView] = useState<SettingsView | null>(null)
  const [updateMessage, setUpdateMessage] = useState("")
  const [busy, setBusy] = useState(false)
  // Survives the component being unmounted mid-request, which logging out does.
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // In an effect, not the render body: setting state during render re-triggers
  // the render and loops forever.
  useEffect(() => {
    void getVersion()
      .then(setVersion)
      .catch(() => setVersion("unknown"))
  }, [])

  const refresh = useCallback(async () => {
    try {
      const next = await ipc.getSettings()
      if (alive.current) setView(next)
    } catch {
      // Leaves the panels in their "not loaded" state, which reads as unknown
      // rather than as off. Claiming a hotkey is unbound because we could not
      // ask would be the worse lie.
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const applyShortcut = useCallback((combo: string | null) => {
    setBusy(true)
    void (async () => {
      try {
        const outcome = await ipc.setShortcut(combo)
        if (!alive.current) return
        // The outcome already says what is live, so this is not a re-read for
        // the shortcut's sake. It is for everything else on the view.
        setView((prev) =>
          prev
            ? {
                ...prev,
                shortcut: outcome.applied ? combo : prev.shortcut,
                shortcutActive: outcome.active,
                shortcutError: outcome.error,
              }
            : prev,
        )
      } catch (e) {
        if (alive.current) {
          setView((prev) => (prev ? { ...prev, shortcutError: messageOf(e) } : prev))
        }
      } finally {
        if (alive.current) setBusy(false)
      }
    })()
  }, [])

  const toggleStartup = useCallback((enabled: boolean) => {
    setBusy(true)
    void (async () => {
      try {
        const actual = await ipc.setLaunchAtLogin(enabled)
        if (alive.current) {
          setView((prev) =>
            prev ? { ...prev, launchAtLogin: actual, launchAtLoginError: null } : prev,
          )
        }
      } catch (e) {
        if (alive.current) {
          setView((prev) => (prev ? { ...prev, launchAtLoginError: messageOf(e) } : prev))
        }
      } finally {
        if (alive.current) setBusy(false)
      }
    })()
  }, [])

  const checkUpdates = useCallback(() => {
    setBusy(true)
    setUpdateMessage("Checking...")
    void (async () => {
      try {
        const r = await ipc.checkUpdate()
        if (!alive.current) return
        setUpdateMessage(
          r.status === "ready"
            ? `Update ${r.version} downloaded. Restart to apply.`
            : r.status === "current"
              ? "You are on the latest version."
              : `Update check failed: ${r.error}`,
        )
      } catch (e) {
        if (alive.current) setUpdateMessage(`Update check failed: ${messageOf(e)}`)
      } finally {
        if (alive.current) setBusy(false)
      }
    })()
  }, [])

  const logout = useCallback(() => {
    setBusy(true)
    void (async () => {
      try {
        await ipc.logout()
      } catch {
        // The Rust side clears the local session even when the server call
        // fails, and staying signed in on a failed logout would be worse.
      } finally {
        onLoggedOut()
      }
    })()
  }, [onLoggedOut])

  return (
    <div className="mx-auto w-full max-w-3xl pb-8">
      <header className="border-b border-white/[0.08] pb-5">
        <h1 className="text-3xl font-semibold tracking-tight text-white">Settings</h1>
        <p className="mt-1.5 text-sm text-[var(--color-muted-foreground)]">
          Manage your account, how the app behaves, and how it looks.
        </p>
      </header>

      <SettingsTabs tab={tab} onChange={setTab} />

      <div className="mt-6 space-y-5">
        {tab === "account" && (
          <>
            <SignInSection />
            <EmailSection overview={overview} />
            <SecuritySection overview={overview} />
            <AccountSection overview={overview} busy={busy} onLogout={logout} />
            <PlanSection overview={overview} />
            <DangerZoneSection onLoggedOut={onLoggedOut} />
          </>
        )}

        {tab === "app" && (
          <>
            <ShortcutSection view={view} busy={busy} onApply={applyShortcut} />
            <StartupSection view={view} busy={busy} onToggle={toggleStartup} />
            <AdvancedSection
              version={version}
              integrity={integrity}
              appDataDir={view?.appDataDir ?? ""}
              updateMessage={updateMessage}
              busy={busy}
              onCheckUpdates={checkUpdates}
            />
          </>
        )}

        {tab === "theme" && <ThemeSection />}
      </div>
    </div>
  )
}
