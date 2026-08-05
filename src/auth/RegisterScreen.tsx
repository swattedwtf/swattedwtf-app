import { useState } from "react"
import { UserPlus } from "lucide-react"

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
    <div
      data-tauri-drag-region
      className="drag boot-surface flex h-full flex-col items-center justify-center px-8"
    >
      <div className="no-drag w-full max-w-[380px]">
        <p className="mb-6 text-center text-[22px] font-medium tracking-[-0.02em] text-[var(--mark-fg)]">
          swatted<span className="text-[var(--mark-tld)]">.wtf</span>
        </p>

        <div className="glass">
          <div className="glass-body">
            <div className="flex flex-col items-center text-center">
              <span className="glass-tile grid h-12 w-12 place-items-center rounded-2xl">
                <UserPlus className="h-5 w-5 text-white" aria-hidden="true" />
              </span>
              <h1 className="mt-4 text-lg font-semibold tracking-tight text-white">
                Create your account
              </h1>
              <p className="mt-1 max-w-[22rem] text-[13px] leading-relaxed text-[var(--color-muted-foreground)]">
                No password. You will get a one-time login code that is the only way back in.
              </p>
            </div>

            <div className="mt-6">
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
                className="mt-2 h-11 w-full select-text glass-input px-4 text-sm outline-none"
              />
              <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">
                Used only for account recovery. You can leave it blank.
              </p>
            </div>

            {error ? (
              <p role="alert" className="mt-3 text-center text-xs text-[var(--color-destructive)]">
                {error}
              </p>
            ) : null}

            {/* Label held steady while submitting; see LoginScreen. */}
            <button
              type="button"
              disabled={busy}
              aria-busy={busy || undefined}
              onClick={() => void submit()}
              className="btn-primary mt-5 w-full"
            >
              Create account
            </button>
          </div>
        </div>

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

