import { useEffect, useReducer } from "react"

import { BootScreen } from "./boot/BootScreen"
import { bootReducer, initialBootState } from "./boot/machine"
import { ipc } from "./lib/ipc"
import "./theme.css"

/** Minimum time the verifying stage stays on screen, so it never flashes. */
const VERIFY_DWELL_MS = 900

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const messageOf = (err: unknown) =>
  typeof err === "string" ? err : err instanceof Error ? err.message : String(err)

export default function App() {
  const [state, dispatch] = useReducer(bootReducer, initialBootState)
  const { phase } = state

  // Integrity check, held on screen for at least the dwell so the ring is seen.
  useEffect(() => {
    if (phase !== "verifying") return
    let cancelled = false
    // The dwell runs alongside the check and is awaited on both paths, so a
    // fast pass and an instant failure look the same: no flash either way.
    const dwell = sleep(VERIFY_DWELL_MS)
    void (async () => {
      try {
        const report = await ipc.verifyIntegrity()
        await dwell
        if (!cancelled) dispatch({ type: "integrity_result", report })
      } catch (err) {
        // The command is unavailable or the shell failed to answer. Degrade to
        // the offline screen rather than leaving the ring spinning forever.
        await dwell
        if (!cancelled) dispatch({ type: "network_error", message: messageOf(err) })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [phase])

  // Update check plus session probe. Re-runs whenever the machine returns to
  // this phase (continuing past tampering, or retrying from offline).
  useEffect(() => {
    if (phase !== "updating") return
    let cancelled = false
    void (async () => {
      try {
        const [result, session] = await Promise.all([ipc.checkUpdate(), ipc.sessionStatus()])
        if (!cancelled) {
          dispatch({ type: "update_result", result, authenticated: session.authenticated })
        }
      } catch (err) {
        if (!cancelled) dispatch({ type: "network_error", message: messageOf(err) })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [phase])

  if (phase === "verifying") return <BootScreen label="Verifying" />
  if (phase === "updating") return <BootScreen label="Checking for updates" />

  // TEMPORARY: tampered, update_ready, offline, auth, reveal and ready get their
  // real screens in Tasks 9, 10, 14 and 15. Until then the phase is rendered as
  // plain text so the boot sequence stays observable instead of crashing.
  return (
    <div className="drag flex h-full flex-col items-center justify-center gap-3 bg-[#0b0b0b] px-8 text-center">
      <p className="text-[34px] font-medium tracking-[-0.02em] text-[var(--mark-fg)]">
        swatted<span className="text-[var(--mark-tld)]">.wtf</span>
      </p>
      <p className="text-[12px] uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
        placeholder screen: {phase}
      </p>
      {state.error ? (
        <p className="max-w-[400px] text-[12px] text-[var(--muted-foreground)]">{state.error}</p>
      ) : null}
    </div>
  )
}
