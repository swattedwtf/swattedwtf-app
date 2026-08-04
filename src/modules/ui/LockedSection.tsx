import { ipc } from "../../lib/ipc"

export const PLANS_URL = "https://swattedw.tf/dashboard/plans"

/**
 * A section the account cannot see.
 *
 * Some gating is silent: Discord's stealer data and Roblox's whole stealer
 * block come back empty with a 200 for accounts below Heist. An empty state
 * there would read as "nothing found", which is a different and much worse
 * claim than "you cannot see this", so those sections render this instead.
 */
export function LockedSection({
  title,
  message,
  actionLabel = "View plans",
}: {
  title: string
  /** The server's copy where there is any, ours where the gate was silent. */
  message: string
  actionLabel?: string
}) {
  return (
    <div className="rounded-lg bg-white/[0.02] px-4 py-6 text-center">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]">
        {title}
      </p>
      <p className="mx-auto mt-2 max-w-[46ch] text-[13px] text-white/75">{message}</p>
      <button
        type="button"
        onClick={() => void ipc.openExternal(PLANS_URL).catch(() => {})}
        className="btn-secondary btn-compact mt-4"
      >
        {actionLabel}
      </button>
    </div>
  )
}
