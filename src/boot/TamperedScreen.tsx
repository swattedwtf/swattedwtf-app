import { ipc } from "../lib/ipc"

const RELEASES_URL = "https://github.com/swattedwtf/swattedwtf-app/releases"
const MAX_LISTED = 10

/**
 * Shown when the bundled files do not match the signed manifest.
 *
 * "Continue anyway" exists on purpose. The check is a hint, not an enforcement
 * mechanism: this app is open source, so a hostile build would simply delete
 * the check rather than trip it. Blocking here would inconvenience honest users
 * with a corrupted download while stopping nobody, and dressing it up as
 * protection would be a lie.
 */
export function TamperedScreen({
  changedFiles,
  onContinue,
}: {
  changedFiles: string[]
  onContinue: () => void
}) {
  const shown = changedFiles.slice(0, MAX_LISTED)
  const rest = changedFiles.length - shown.length

  return (
    <div data-tauri-drag-region className="drag flex h-full flex-col items-center justify-center gap-5 boot-surface px-10">
      <div className="grid h-11 w-11 place-items-center rounded-2xl border border-[var(--color-warning)]/40 text-lg text-[var(--color-warning)]">
        !
      </div>

      <h1 className="text-lg font-semibold tracking-tight">This copy has been modified</h1>

      <p className="max-w-[420px] text-center text-xs leading-relaxed text-[var(--color-muted-foreground)]">
        These files do not match the signed manifest. That can mean a corrupted download, or a copy
        modified by someone else. This check is not a security control, it can be removed from a
        modified build, so treat it as a hint rather than a guarantee.
      </p>

      <ul className="no-drag max-h-[140px] w-full max-w-[420px] overflow-y-auto rounded-lg border border-[var(--color-border)] bg-white/[0.03] p-3 font-mono text-[11px] text-[var(--color-warning)]">
        {shown.map((f) => (
          <li key={f} className="truncate">
            {f}
          </li>
        ))}
        {rest > 0 && <li className="text-white/30">+{rest} more</li>}
      </ul>

      <div className="no-drag flex gap-2">
        <button
          onClick={() => void ipc.openExternal(RELEASES_URL).catch(() => {})}
          className="btn-primary"
        >
          Download the official build
        </button>
        <button
          onClick={onContinue}
          className="btn-secondary"
        >
          Continue anyway
        </button>
      </div>
    </div>
  )
}
