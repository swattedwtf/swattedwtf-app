import { useCallback, useEffect, useReducer, useState } from "react"

import { BootScreen } from "./boot/BootScreen"
import { OfflineScreen } from "./boot/OfflineScreen"
import { RevealScreen } from "./boot/RevealScreen"
import { TamperedScreen } from "./boot/TamperedScreen"
import { UpdateReadyScreen } from "./boot/UpdateReadyScreen"
import { bootReducer, initialBootState, type IntegrityReport } from "./boot/machine"
import { CodeReveal } from "./auth/CodeReveal"
import { LoginScreen } from "./auth/LoginScreen"
import { RegisterScreen } from "./auth/RegisterScreen"
import { TwoFactorScreen } from "./auth/TwoFactorScreen"
import { Home } from "./dashboard/Home"
import { Settings } from "./settings/Settings"
import { Shell } from "./shell/Shell"
import { WindowControls } from "./shell/WindowControls"
import { resizeTo } from "./shell/window"
import { isUnauthorized, messageOf } from "./lib/errors"
import { ipc, type Overview } from "./lib/ipc"
import "./theme.css"

/** Minimum time the verifying stage stays on screen, so it never flashes. */
const VERIFY_DWELL_MS = 900

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Which auth screen is showing. Local to the auth phase, not the boot machine. */
type AuthView = { view: "login" } | { view: "twofa"; code: string } | { view: "register" }

export default function App() {
  const [state, dispatch] = useReducer(bootReducer, initialBootState)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [auth, setAuth] = useState<AuthView>({ view: "login" })
  const [route, setRoute] = useState("/dashboard")
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

  // The account payload the reveal and the whole shell are built from. Fetched
  // on entering the reveal, which is also the first point at which the session
  // is proven good server-side: a locally stored cookie can still be expired,
  // and a 401 here correctly sends the user back to the login screen.
  useEffect(() => {
    if (phase !== "reveal" || overview) return
    let cancelled = false
    void (async () => {
      try {
        const data = await ipc.getOverview()
        if (!cancelled) setOverview(data)
      } catch (err) {
        if (cancelled) return
        if (isUnauthorized(err)) {
          // The stored cookie is present but dead server-side. It must be
          // cleared, or session_status keeps reporting "authenticated" from the
          // local jar and every retry loops straight back to this same 401.
          await ipc.logout().catch(() => {})
          if (!cancelled) dispatch({ type: "logged_out" })
        } else {
          dispatch({ type: "network_error", message: messageOf(err) })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [phase, overview])

  const handleAuthenticated = useCallback(() => {
    // Drop any stale payload so the reveal fetches for the account that just
    // signed in rather than greeting the previous one.
    setOverview(null)
    setAuth({ view: "login" })
    dispatch({ type: "authenticated" })
  }, [])

  const handleLoggedOut = useCallback(() => {
    // Back to splash size: the login form is 320px wide and would otherwise sit
    // marooned in a 1180x760 field of black.
    void resizeTo("boot")
    setOverview(null)
    setRoute("/dashboard")
    setAuth({ view: "login" })
    dispatch({ type: "logged_out" })
  }, [])

  // Rendered on every screen. The window is frameless, so without this there is
  // no way to close or minimise the app during boot, login, or an error state,
  // and the offline screen in particular would be a dead end.
  const chrome = phase === "ready" ? null : <WindowControls />

  const screen = (() => {
  switch (phase) {
    case "verifying":
      return <BootScreen label="Verifying" />

    case "updating":
      return <BootScreen label="Checking for updates" />

    case "tampered":
      return (
        <TamperedScreen
          changedFiles={state.changedFiles}
          onContinue={() => dispatch({ type: "ignore_tamper" })}
        />
      )

    case "update_ready":
      return (
        <UpdateReadyScreen
          version={state.updateVersion}
          onLater={() => dispatch({ type: "defer_update" })}
        />
      )

    case "offline":
      return <OfflineScreen error={state.error} onRetry={() => dispatch({ type: "retry" })} />

    case "auth":
      if (auth.view === "register") {
        return (
          <RegisterScreen
            onAuthenticated={handleAuthenticated}
            onBack={() => setAuth({ view: "login" })}
          />
        )
      }
      if (auth.view === "twofa") {
        return (
          <TwoFactorScreen
            code={auth.code}
            onAuthenticated={handleAuthenticated}
            onCancel={() => setAuth({ view: "login" })}
          />
        )
      }
      return (
        <LoginScreen
          onAuthenticated={handleAuthenticated}
          onRegister={() => setAuth({ view: "register" })}
          onTwoFactor={(code) => setAuth({ view: "twofa", code })}
        />
      )

    case "reveal":
      // The fetch is bounded by a 30s HTTP timeout, and a featureless black
      // window for that long is indistinguishable from a hang, so keep the ring
      // on screen rather than showing nothing.
      if (!overview) return <BootScreen label="Loading your account" />
      return <RevealScreen overview={overview} onDone={() => dispatch({ type: "reveal_done" })} />

    case "ready": {
      if (!overview) return <BootScreen label="Loading your account" />
      const integrity: IntegrityReport = {
        ok: state.integrityOk,
        changed: state.changedFiles,
        manifest_version: "",
      }
      return (
        <Shell route={route} onNavigate={setRoute}>
          {route === "/settings" ? (
            <Settings overview={overview} integrity={integrity} onLoggedOut={handleLoggedOut} />
          ) : (
            <Home overview={overview} />
          )}
        </Shell>
      )
    }
  }
  })()

  return (
    <>
      {chrome}
      {screen}
    </>
  )
}

// Re-exported so the one-time code reveal stays reachable from the auth flow
// even though App renders it via RegisterScreen.
export { CodeReveal }
