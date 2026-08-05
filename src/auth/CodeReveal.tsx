import { useEffect, useRef, useState } from "react"
import { Check, CircleCheck, Copy, Download, KeyRound, TriangleAlert } from "lucide-react"

import { ipc } from "../lib/ipc"
import { formatLoginCode } from "./code"
import { messageOf } from "../lib/errors"
import { copyText } from "../lib/clipboard"

/** How long the "Copied" confirmation stays on the copy button. */
const COPIED_MS = 1600
/** How long a toast stays before it retires. */
const TOAST_MS = 2000

type Toast = { kind: "ok" | "err"; text: string } | null

/**
 * Shown exactly once, right after registration. The code is the ONLY way back
 * into the account, so Continue is gated behind an explicit acknowledgement and
 * the recovery file is opt-in: nothing is written to disk unless the user picks
 * a path in the native save dialog.
 *
 * Presented as a proper glass card with the code in its own well, a warning
 * callout, and toast confirmations, so the single most important screen in the
 * app does not read as a loose stack of text on the boot artwork.
 */
export function CodeReveal({ code, onContinue }: { code: string; onContinue: () => void }) {
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const [savedTo, setSavedTo] = useState("")
  const [error, setError] = useState("")
  const [toast, setToast] = useState<Toast>(null)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
      if (toastTimer.current) clearTimeout(toastTimer.current)
    }
  }, [])

  function popToast(next: NonNullable<Toast>) {
    setToast(next)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS)
  }

  async function copy() {
    setError("")
    // Through the shared helper, which falls back to execCommand when
    // navigator.clipboard is absent or rejects. This is the recovery-code
    // screen shown once, so the WebKitGTK-without-a-clipboard-owner case that
    // the fallback exists for is exactly the case that must not fail here.
    if (await copyText(formatLoginCode(code))) {
      setCopied(true)
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopied(false), COPIED_MS)
      popToast({ kind: "ok", text: "Login code copied to clipboard" })
    } else {
      // The code is on screen, so a genuine failure is a nuisance, not a dead end.
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
      if (path) {
        setSavedTo(path)
        popToast({ kind: "ok", text: "Recovery file saved" })
      }
    } catch (err) {
      setError(messageOf(err))
    }
  }

  return (
    <div
      data-tauri-drag-region
      className="drag boot-surface flex h-full flex-col items-center justify-center px-8"
    >
      <div className="no-drag w-full max-w-md">
        <div className="glass">
          <div className="glass-body">
            <div className="flex flex-col items-center text-center">
              <span className="glass-tile grid h-12 w-12 place-items-center rounded-2xl">
                <KeyRound className="h-5 w-5 text-white" aria-hidden="true" />
              </span>
              <h1 className="mt-4 text-lg font-semibold tracking-tight text-white">
                Your login code
              </h1>
              <p className="mt-1 max-w-[20rem] text-[13px] leading-relaxed text-[var(--color-muted-foreground)]">
                This is how you sign in. There is no password and no reset, so keep it somewhere safe.
              </p>
            </div>

            {/* The code in its own well, with an inline copy. */}
            <div className="glass-tile mt-6 flex items-center justify-between gap-3 px-4 py-3.5">
              <span className="select-text font-mono text-[22px] tracking-[0.16em] text-white">
                {formatLoginCode(code)}
              </span>
              <button
                type="button"
                onClick={() => void copy()}
                className="btn-secondary btn-compact shrink-0"
                aria-label="Copy login code"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    Copy
                  </>
                )}
              </button>
            </div>

            {/* Warning callout: the one irreversible fact on the screen. */}
            <div className="mt-3 flex items-start gap-2.5 rounded-[var(--glass-radius-tile)] border border-[var(--color-warning)]/25 bg-[var(--color-warning)]/[0.06] px-3.5 py-3">
              <TriangleAlert
                className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-warning)]"
                aria-hidden="true"
              />
              <p className="text-[12.5px] leading-relaxed text-[var(--color-warning)]">
                Shown once. If you lose this code the account cannot be recovered.
              </p>
            </div>

            <button
              type="button"
              onClick={() => void saveToFile()}
              className="btn-secondary mt-4 w-full"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Save recovery file
            </button>

            {error ? (
              <p role="alert" className="mt-3 text-center text-xs text-[var(--color-destructive)]">
                {error}
              </p>
            ) : savedTo ? (
              <p className="mt-3 break-all text-center text-[11px] text-[var(--color-muted-foreground)]">
                Saved to {savedTo}
              </p>
            ) : null}

            <div className="my-5 h-px bg-white/[0.06]" />

            <label className="flex cursor-pointer items-center justify-center gap-2.5 text-[13px] text-white/80">
              <input
                type="checkbox"
                checked={saved}
                onChange={(e) => setSaved(e.target.checked)}
                className="h-4 w-4 cursor-pointer accent-white"
              />
              I have saved my login code
            </label>

            <button
              type="button"
              disabled={!saved}
              onClick={onContinue}
              className="btn-primary mt-4 w-full"
            >
              Continue
            </button>
          </div>
        </div>
      </div>

      {toast ? (
        <div className="toast" role="status">
          {toast.kind === "ok" ? (
            <CircleCheck className="h-4 w-4 text-[var(--color-positive)]" aria-hidden="true" />
          ) : (
            <TriangleAlert className="h-4 w-4 text-[var(--color-destructive)]" aria-hidden="true" />
          )}
          {toast.text}
        </div>
      ) : null}
    </div>
  )
}
