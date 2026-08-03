import { useEffect, useRef, useState } from "react"

import { ipc } from "../lib/ipc"
import { formatLoginCode } from "./code"
import { messageOf } from "../lib/errors"

/** How long the "Copied" confirmation stays on the copy button. */
const COPIED_MS = 1600


/**
 * Shown exactly once, right after registration. The code is the ONLY way back
 * into the account, so Continue is gated behind an explicit acknowledgement and
 * the recovery file is opt-in: nothing is written to disk unless the user picks
 * a path in the native save dialog.
 */
export function CodeReveal({ code, onContinue }: { code: string; onContinue: () => void }) {
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const [savedTo, setSavedTo] = useState("")
  const [error, setError] = useState("")
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
    }
  }, [])

  async function copy() {
    setError("")
    try {
      await navigator.clipboard.writeText(formatLoginCode(code))
      setCopied(true)
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopied(false), COPIED_MS)
    } catch {
      // Clipboard access can be denied by the webview. The code is on screen,
      // so this is a nuisance, not a dead end.
      setError("Could not copy. Write the code down instead.")
    }
  }

  async function saveToFile() {
    setError("")
    try {
      // The dialog and the write both happen in Rust. The webview is granted no
      // filesystem permission at all, so the only path ever written is the one
      // the user picked in a native save dialog.
      const path = await ipc.saveRecoveryFile(formatLoginCode(code))
      // Null means the user cancelled the dialog. Nothing is written.
      if (path) setSavedTo(path)
    } catch (err) {
      setError(messageOf(err))
    }
  }

  return (
    <div data-tauri-drag-region className="drag flex h-full flex-col items-center justify-center gap-6 bg-[#0b0b0b] px-10">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]">
        Your login code
      </p>

      <p className="no-drag select-text font-mono text-[30px] tracking-[0.18em] text-[var(--mark-fg)]">
        {formatLoginCode(code)}
      </p>

      <p className="max-w-[340px] text-center text-xs leading-relaxed text-[var(--color-warning)]">
        This is shown once and is the only way to sign in. There is no password reset. Save it now.
      </p>

      <div className="no-drag flex gap-2">
        <button
          type="button"
          onClick={() => void copy()}
          className="h-9 rounded-lg border border-[var(--color-border)] px-4 text-sm transition-colors hover:border-white/40"
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          onClick={() => void saveToFile()}
          className="h-9 rounded-lg border border-[var(--color-border)] px-4 text-sm transition-colors hover:border-white/40"
        >
          Save recovery file...
        </button>
      </div>

      {error ? (
        <p role="alert" className="max-w-[340px] text-center text-xs text-[var(--color-destructive)]">
          {error}
        </p>
      ) : savedTo ? (
        <p className="max-w-[340px] break-all text-center text-xs text-[var(--color-muted-foreground)]">
          Saved to {savedTo}
        </p>
      ) : null}

      <label className="no-drag flex cursor-pointer items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
        <input
          type="checkbox"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
          className="h-3.5 w-3.5 cursor-pointer accent-white"
        />
        I have saved my login code
      </label>

      <button
        type="button"
        disabled={!saved}
        onClick={onContinue}
        className="no-drag h-10 w-[220px] rounded-lg bg-white font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-30"
      >
        Continue
      </button>
    </div>
  )
}

