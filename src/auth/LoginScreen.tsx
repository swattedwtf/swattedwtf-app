import { useState } from "react"

import { ipc } from "../lib/ipc"
import { formatLoginCode, isCompleteLoginCode, normalizeLoginCode } from "./code"
import { messageOf } from "../lib/errors"

/**
 * Login: 12-digit code, grouped 4-4-4. Submitting opens the Turnstile helper
 * window on the Rust side, so there is no captcha widget here.
 *
 * The window is frameless, so the backdrop is a drag region and every control
 * lives inside a .no-drag container. Without that the input and the buttons
 * become window-drag handles and stop responding to clicks.
 */
export function LoginScreen({
  onAuthenticated,
  onRegister,
  onTwoFactor,
}: {
  onAuthenticated: () => void
  onRegister: () => void
  onTwoFactor: (code: string) => void
}) {
  const [value, setValue] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const complete = isCompleteLoginCode(value)

  async function submit() {
    if (!complete || busy) return
    setBusy(true)
    setError("")
    try {
      const code = normalizeLoginCode(value)
      const result = await ipc.login(code)
      // Server copy (rate limits, "Invalid login code") is shown verbatim. It is
      // the only place that knows why a sign-in failed, so never restate it.
      if (result.status === "ok") onAuthenticated()
      else if (result.status === "twofa_required") onTwoFactor(code)
      else setError(result.message)
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-tauri-drag-region className="drag flex h-full flex-col items-center justify-center gap-8 boot-surface px-10">
      <p className="text-[26px] font-medium tracking-[-0.02em] text-[var(--mark-fg)]">
        swatted<span className="text-[var(--mark-tld)]">.wtf</span>
      </p>

      <div className="no-drag w-full max-w-[320px]">
        <label
          htmlFor="login-code"
          className="block font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]"
        >
          Login code
        </label>
        <input
          id="login-code"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          inputMode="numeric"
          aria-invalid={error ? true : undefined}
          value={formatLoginCode(value)}
          onChange={(e) => setValue(normalizeLoginCode(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit()
          }}
          placeholder="0000 0000 0000"
          className="mt-2 w-full select-text glass-input px-4 py-3 text-center font-mono text-lg tabular-nums tracking-[0.22em] outline-none"
        />

        {error ? (
          <p role="alert" className="mt-3 text-center text-xs text-[var(--color-destructive)]">
            {error}
          </p>
        ) : null}

        {/* The label does not change while submitting: swapping "Sign in" for
            "Verifying..." resizes the control under the pointer mid-press. The
            busy state is aria-busy plus the ring the .btn-primary rules draw. */}
        <button
          type="button"
          disabled={!complete || busy}
          aria-busy={busy || undefined}
          onClick={() => void submit()}
          className="btn-primary mt-5 w-full"
        >
          Sign in
        </button>

        <button
          type="button"
          onClick={onRegister}
          className="mt-4 w-full text-xs text-[var(--color-muted-foreground)] transition-colors hover:text-white"
        >
          Create an account
        </button>
      </div>
    </div>
  )
}

