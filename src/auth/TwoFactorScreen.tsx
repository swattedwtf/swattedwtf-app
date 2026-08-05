import { useState } from "react"
import { ShieldCheck } from "lucide-react"

import { ipc } from "../lib/ipc"
import { messageOf } from "../lib/errors"

/**
 * Second factor. Reached only when the server answered the login with
 * twofa_required, so `code` here is already known-good and already normalized
 * to 12 digits. Submitting re-sends the login with the OTP attached, which
 * means a second captcha solve in the helper window.
 */
export function TwoFactorScreen({
  code,
  onAuthenticated,
  onCancel,
}: {
  code: string
  onAuthenticated: () => void
  onCancel: () => void
}) {
  const [otp, setOtp] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const complete = /^\d{6}$/.test(otp)

  async function submit() {
    if (!complete || busy) return
    setBusy(true)
    setError("")
    try {
      const result = await ipc.login(code, otp)
      // "ok" is the only success. Anything else, including a repeated
      // twofa_required from a wrong OTP, carries the server's own wording.
      if (result.status === "ok") onAuthenticated()
      else setError(result.message)
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

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
                <ShieldCheck className="h-5 w-5 text-white" aria-hidden="true" />
              </span>
              <h1 className="mt-4 text-lg font-semibold tracking-tight text-white">
                Two-factor authentication
              </h1>
              <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-muted-foreground)]">
                Enter the 6-digit code from your authenticator app.
              </p>
            </div>

            <div className="mt-6">
              <label
                htmlFor="twofa-otp"
                className="block font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]"
              >
                Authenticator code
              </label>
              <input
                id="twofa-otp"
                autoFocus
                autoComplete="one-time-code"
                spellCheck={false}
                inputMode="numeric"
                aria-invalid={error ? true : undefined}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submit()
                }}
                placeholder="000000"
                className="mt-2 h-12 w-full select-text glass-input px-4 text-center font-mono text-lg tabular-nums tracking-[0.3em] outline-none"
              />
            </div>

            {error ? (
              <p role="alert" className="mt-3 text-center text-xs text-[var(--color-destructive)]">
                {error}
              </p>
            ) : null}

            {/* Label held steady while submitting; see LoginScreen. */}
            <button
              type="button"
              disabled={!complete || busy}
              aria-busy={busy || undefined}
              onClick={() => void submit()}
              className="btn-primary mt-5 w-full"
            >
              Continue
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={onCancel}
          className="mt-4 w-full text-xs text-[var(--color-muted-foreground)] transition-colors hover:text-white"
        >
          Back
        </button>
      </div>
    </div>
  )
}

