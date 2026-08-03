import { useEffect } from "react"
import type { Overview } from "../lib/ipc"
import { resolveWelcomeName, shouldPromptTelegram } from "../lib/welcome"

/**
 * The signature moment: black screen, the wordmark resolves out of a blur, a
 * hairline draws under it, then the welcome line.
 *
 * Plays every launch and is deliberately not skippable. The timings live in
 * theme.css as animation-delays; TOTAL_MS is just when we hand control to the
 * shell, and must stay at or above the last animation's end (2.2s + 0.7s).
 */
const TOTAL_MS = 3000

export function RevealScreen({ overview, onDone }: { overview: Overview; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, TOTAL_MS)
    return () => clearTimeout(t)
  }, [onDone])

  return (
    <div className="drag flex h-full flex-col items-center justify-center bg-[#0b0b0b]">
      <p className="mark-in text-[34px] font-medium tracking-[-0.02em] text-[var(--mark-fg)]">
        swatted<span className="text-[var(--mark-tld)]">.wtf</span>
      </p>

      <div className="rule-in mt-4" />

      <p className="welcome-in mt-5 text-sm text-white/50">
        Welcome, <span className="font-medium text-white/90">{resolveWelcomeName(overview)}</span>
      </p>

      {shouldPromptTelegram(overview) && (
        <p className="hint-in mt-2 text-[11px] text-white/30">
          Link Telegram to show your username here
        </p>
      )}
    </div>
  )
}
