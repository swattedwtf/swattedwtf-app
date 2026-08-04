import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { getVersion } from "@tauri-apps/api/app"
import {
  Check,
  ExternalLink,
  Keyboard,
  Power,
  ShieldCheck,
  Wallet,
} from "lucide-react"
import { ThemeSection } from "./ThemeSection"

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

/** One block of the screen, on the two-element panel material. */
function Panel({
  title,
  icon,
  children,
}: {
  title: string
  icon?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="glass">
      <div className="glass-body">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className={CAPTION}>{title}</h2>
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
    <Panel title="Account">
      <Row label="Handle" value={overview.user.handle} />
      <Row label="User number" value={`#${overview.user.userNumber}`} />
      <Row label="Email" value={overview.user.email ?? "Not set"} />
      <Row label="Member since" value={formatSince(overview.plan.since)} />
      <Row
        label="Telegram"
        value={overview.telegram.username ? `@${overview.telegram.username}` : "Not linked"}
      />

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={() => void openWeb(WEB_SETTINGS_URL)}
          className="btn-secondary btn-compact"
        >
          {overview.telegram.linked ? "Manage on the web" : "Link Telegram"}
          <ExternalLink className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onLogout}
          disabled={busy}
          className="btn-secondary btn-compact"
          style={{ color: "var(--color-destructive)" }}
        >
          Log out
        </button>
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
    <Panel title="Plan and usage" icon={<Wallet className="h-4 w-4 opacity-70" aria-hidden="true" />}>
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

  const active = view?.shortcutActive ?? null
  const stored = view?.shortcut ?? null
  const disabled = view !== null && stored === null

  return (
    <Panel title="Shortcuts" icon={<Keyboard className="h-4 w-4 opacity-70" aria-hidden="true" />}>
      <Row
        label="Quick lookup"
        value={
          <span className="font-mono text-[13px]">
            {active ? formatCombo(active) : disabled ? "Turned off" : "Not bound"}
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
          disabled={busy || disabled}
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
    <Panel title="Startup" icon={<Power className="h-4 w-4 opacity-70" aria-hidden="true" />}>
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
      icon={<ShieldCheck className="h-4 w-4 opacity-70" aria-hidden="true" />}
    >
      <Row
        label="Two-factor authentication"
        value={overview.security.twofaEnabled ? "Enabled" : "Disabled"}
      />
      <Help>
        Your session is stored in the operating system credential store and is never exposed to the
        app's interface code. On Linux systems without a Secret Service provider it falls back to a
        permission-restricted file in the app data directory, which is weaker at rest.
      </Help>
      <div className="pt-1">
        <button
          type="button"
          onClick={() => void openWeb(WEB_SETTINGS_URL)}
          className="btn-secondary btn-compact"
        >
          Manage two-factor on the web
          <ExternalLink className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
        </button>
      </div>
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
                  void navigator.clipboard
                    .writeText(JSON.stringify(diag, null, 2))
                    .then(() => setCopied(true))
                    .catch(() => setCopied(false))
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
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]">
          / Settings
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Settings</h1>
        <p className="mt-1.5 text-sm text-[var(--color-muted-foreground)]">
          Manage your account, how the app behaves, and how it looks.
        </p>
      </header>

      <SettingsTabs tab={tab} onChange={setTab} />

      <div className="mt-6 space-y-5">
        {tab === "account" && (
          <>
            <AccountSection overview={overview} busy={busy} onLogout={logout} />
            <PlanSection overview={overview} />
            <SecuritySection overview={overview} />
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
