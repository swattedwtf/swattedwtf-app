import { useState } from "react"
import { messageOf } from "../lib/errors"
import { ipc } from "../lib/ipc"

/**
 * An update has been downloaded and signature-verified, but is never installed
 * silently. Software that changes itself without asking is a bad look for a
 * security tool, so the restart is always the user's call.
 */
export function UpdateReadyScreen({
  version,
  onLater,
}: {
  version: string | null
  onLater: () => void
}) {
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function restart() {
    setBusy(true)
    setError("")
    try {
      await ipc.installUpdateAndRestart()
      // Does not return: the app relaunches.
    } catch (e) {
      setBusy(false)
      setError(messageOf(e))
    }
  }

  return (
    <div data-tauri-drag-region className="drag flex h-full flex-col items-center justify-center gap-5 bg-[#0b0b0b] px-10">
      <p className="text-[26px] font-medium tracking-[-0.02em]">
        swatted<span className="text-[var(--mark-tld)]">.wtf</span>
      </p>

      <h1 className="text-sm font-semibold tracking-tight">
        {version ? `Version ${version} is ready` : "An update is ready"}
      </h1>

      <p className="max-w-[360px] text-center text-xs leading-relaxed text-[var(--color-muted-foreground)]">
        The update has been downloaded and its signature verified. Restart to apply it.
      </p>

      {error && (
        <p className="max-w-[380px] text-center text-xs text-[var(--color-destructive)]">{error}</p>
      )}

      <div className="no-drag flex gap-2">
        <button
          onClick={restart}
          disabled={busy}
          className="btn-primary"
        >
          {busy ? "Restarting..." : "Restart now"}
        </button>
        <button
          onClick={onLater}
          disabled={busy}
          className="btn-secondary"
        >
          Later
        </button>
      </div>
    </div>
  )
}
