import { useState } from "react"
import { ExternalLink, FileText } from "lucide-react"

import { ipc } from "../lib/ipc"
import { messageOf } from "../lib/errors"

/** The updated documents, opened in the user's own browser (never the webview). */
const BASE = "https://swattedw.tf"
const DOCS: { path: string; label: string }[] = [
  { path: "/terms", label: "Terms of Service" },
  { path: "/eula", label: "End User License Agreement" },
  { path: "/privacy", label: "Privacy Policy" },
  { path: "/cookies", label: "Cookies Policy" },
  { path: "/acceptable-use", label: "Acceptable Use Policy" },
]

/**
 * The updated-legal consent gate, mirroring the web's legal-consent modal.
 *
 * Shown on entry when the desktop overview reports `legalAccepted: false`.
 * Non-dismissable by design: the server blocks every search until acceptance is
 * recorded, so a user who closed this would just meet a wall of refusals with no
 * way back. Accepting POSTs to /api/legal/accept through a Rust command, exactly
 * the endpoint the web calls.
 */
export function LegalConsent({ onAccepted }: { onAccepted: () => void }) {
  const [agreed, setAgreed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  async function accept() {
    if (!agreed || saving) return
    setSaving(true)
    setError("")
    try {
      await ipc.acceptLegal()
      onAccepted()
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center px-6"
      role="dialog"
      aria-modal="true"
      aria-label="Updated legal terms"
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-[2px]" />
      <div className="relative w-full max-w-md">
        <div className="glass">
          <div className="glass-body">
            <div className="flex flex-col items-center text-center">
              <span className="glass-tile grid h-12 w-12 place-items-center rounded-2xl">
                <FileText className="h-5 w-5 text-white" aria-hidden="true" />
              </span>
              <h1 className="mt-4 text-lg font-semibold tracking-tight text-white">
                We&apos;ve updated our terms
              </h1>
              <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-muted-foreground)]">
                Please review the updated documents and accept to keep using Swatted.wtf. You cannot
                run searches until you accept.
              </p>
            </div>

            <ul className="mt-5 space-y-1">
              {DOCS.map((d) => (
                <li key={d.path}>
                  <button
                    type="button"
                    onClick={() => void ipc.openExternal(BASE + d.path).catch(() => {})}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-white/85 transition-colors hover:bg-white/[0.05]"
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0 text-white/40" aria-hidden="true" />
                    <span className="flex-1 truncate">{d.label}</span>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-40" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>

            <label className="mt-5 flex cursor-pointer items-start gap-2.5 text-[13px] text-white/80">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 h-4 w-4 cursor-pointer accent-white"
              />
              I have read and agree to the documents above.
            </label>

            {error ? (
              <p role="alert" className="mt-3 text-center text-xs text-[var(--color-destructive)]">
                {error}
              </p>
            ) : null}

            <button
              type="button"
              disabled={!agreed || saving}
              aria-busy={saving || undefined}
              onClick={() => void accept()}
              className="btn-primary mt-4 w-full"
            >
              Accept and continue
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
