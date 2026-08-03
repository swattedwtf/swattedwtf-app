import { useState } from "react"

import { ipc } from "../lib/ipc"
import { CodeReveal } from "./CodeReveal"
import { messageOf } from "../lib/errors"

/**
 * Registration. Email is optional (the server treats it as recovery and contact
 * only). On success the server returns the 12-digit code exactly once, so we go
 * straight to the reveal and never re-request it.
 */
export function RegisterScreen({
  onAuthenticated,
  onBack,
}: {
  onAuthenticated: () => void
  onBack: () => void
}) {
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [code, setCode] = useState<string | null>(null)

  async function submit() {
    if (busy) return
    setBusy(true)
    setError("")
    try {
      const result = await ipc.register(email.trim() || undefined)
      if (result.status === "ok") setCode(result.code)
      else setError(result.message)
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  // The code exists only in this component's state, so the reveal replaces the
  // form in place. Going "back" from here would lose it for good.
  if (code) return <CodeReveal code={code} onContinue={onAuthenticated} />

  return (
    <div data-tauri-drag-region className="drag flex h-full flex-col items-center justify-center gap-8 bg-[#0b0b0b] px-10">
      <p className="text-[26px] font-medium tracking-[-0.02em] text-[var(--mark-fg)]">
        swatted<span className="text-[var(--mark-tld)]">.wtf</span>
      </p>

      <div className="no-drag w-full max-w-[320px]">
        <label
          htmlFor="register-email"
          className="block font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]"
        >
          Email (optional)
        </label>
        <input
          id="register-email"
          autoFocus
          type="email"
          autoComplete="email"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit()
          }}
          placeholder="you@example.com"
          className="mt-2 w-full select-text rounded-lg border border-[var(--color-border)] bg-[var(--secondary)] px-4 py-3 text-sm outline-none placeholder:text-white/20 focus:border-white/40"
        />
        <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">
          Optional, used only for account recovery.
        </p>

        {error ? (
          <p role="alert" className="mt-3 text-center text-xs text-[var(--color-destructive)]">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="mt-5 h-10 w-full rounded-lg bg-white font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-30"
        >
          {busy ? "Creating..." : "Create account"}
        </button>

        <button
          type="button"
          onClick={onBack}
          className="mt-4 w-full text-xs text-[var(--color-muted-foreground)] transition-colors hover:text-white"
        >
          I already have a login code
        </button>
      </div>
    </div>
  )
}

