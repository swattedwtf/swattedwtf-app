import { useEffect, useState, type ReactNode } from "react"
import { getVersion } from "@tauri-apps/api/app"
import type { IntegrityReport } from "../boot/machine"
import { ipc, type Overview } from "../lib/ipc"
import { messageOf } from "../lib/errors"
import { formatSince } from "../lib/format"

const REPO_URL = "https://github.com/swattedwtf/swattedwtf-app"
const WEB_SETTINGS_URL = "https://swattedw.tf/dashboard/settings"

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="glass p-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]">
        {title}
      </p>
      <div className="mt-4 space-y-2 text-sm">{children}</div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[var(--color-muted-foreground)]">{label}</span>
      <span className="min-w-0 truncate text-right">{value}</span>
    </div>
  )
}

const buttonClass =
  "h-9 rounded-lg border border-[var(--color-border)] px-4 text-sm hover:bg-white/5 disabled:opacity-40"

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
  const [updateMsg, setUpdateMsg] = useState("")
  const [busy, setBusy] = useState(false)

  // In an effect, not the render body: setting state during render re-triggers
  // the render and loops forever.
  useEffect(() => {
    void getVersion()
      .then(setVersion)
      .catch(() => setVersion("unknown"))
  }, [])

  async function checkUpdates() {
    setBusy(true)
    setUpdateMsg("Checking...")
    try {
      const r = await ipc.checkUpdate()
      setUpdateMsg(
        r.status === "ready"
          ? `Update ${r.version} downloaded. Restart to apply.`
          : r.status === "current"
            ? "You are on the latest version."
            : `Update check failed: ${r.error}`,
      )
    } catch (e) {
      setUpdateMsg(`Update check failed: ${messageOf(e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function logout() {
    setBusy(true)
    try {
      await ipc.logout()
    } catch {
      // The Rust side clears the local session even when the server call fails,
      // and staying signed in on a failed logout would be the worse outcome.
    } finally {
      setBusy(false)
      onLoggedOut()
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <Section title="Account">
        <Row label="Handle" value={overview.user.handle} />
        <Row label="User number" value={`#${overview.user.userNumber}`} />
        <Row label="Email" value={overview.user.email ?? "Not set"} />
        <Row label="Plan" value={overview.plan.label} />
        <Row label="Member since" value={formatSince(overview.plan.since)} />
      </Section>

      <Section title="Telegram">
        <Row
          label="Linked account"
          value={overview.telegram.username ? `@${overview.telegram.username}` : "Not linked"}
        />
        <button
          onClick={() => void ipc.openExternal(WEB_SETTINGS_URL).catch(() => {})}
          className={`${buttonClass} mt-2`}
        >
          {overview.telegram.linked ? "Manage on the web" : "Link Telegram"}
        </button>
      </Section>

      <Section title="Security">
        <Row
          label="Two-factor authentication"
          value={overview.security.twofaEnabled ? "Enabled" : "Disabled"}
        />
        <p className="pt-2 text-xs leading-relaxed text-[var(--color-muted-foreground)]">
          Your session is stored in the operating system credential store and is never exposed to
          the app's interface code. On Linux systems without a Secret Service provider it falls back
          to a permission-restricted file in the app data directory, which is weaker at rest.
        </p>
      </Section>

      <Section title="Application">
        <Row label="Version" value={version || "..."} />
        <Row
          label="Integrity"
          value={integrity.ok ? "Verified" : `${integrity.changed.length} file(s) modified`}
        />

        {!integrity.ok && (
          <ul className="max-h-24 overflow-y-auto pt-1 font-mono text-[11px] text-[var(--color-warning)]">
            {integrity.changed.slice(0, 10).map((f) => (
              <li key={f} className="truncate">
                {f}
              </li>
            ))}
          </ul>
        )}

        <p className="pt-1 text-xs leading-relaxed text-[var(--color-muted-foreground)]">
          Integrity checking detects corrupted or modified installs. It is not a security control:
          this app is open source, so the check can be removed from a modified copy.
        </p>

        <div className="flex flex-wrap gap-2 pt-3">
          <button onClick={checkUpdates} disabled={busy} className={buttonClass}>
            Check for updates now
          </button>
          <button
            onClick={() => void ipc.openExternal(REPO_URL).catch(() => {})}
            className={buttonClass}
          >
            View source
          </button>
          <button
            onClick={logout}
            disabled={busy}
            className="h-9 rounded-lg border border-[var(--color-destructive)] px-4 text-sm text-[var(--color-destructive)] hover:bg-[var(--color-destructive)]/10 disabled:opacity-40"
          >
            Log out
          </button>
        </div>

        {updateMsg && (
          <p className="pt-2 text-xs text-[var(--color-muted-foreground)]">{updateMsg}</p>
        )}
      </Section>
    </div>
  )
}

