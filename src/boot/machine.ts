/**
 * Boot sequence state machine.
 *
 * Pure and synchronous so every branch, including the failure paths that are
 * painful to reproduce by hand, is unit-testable. The component that hosts it
 * performs the effects (invoking commands) and feeds results back as events.
 *
 * verifying -> updating -> (auth) -> reveal -> ready
 *      |            |
 *      v            v
 *  tampered      offline / update_ready
 */

export type IntegrityReport = {
  ok: boolean
  changed: string[]
  manifest_version: string
}

export type UpdateResult =
  | { status: "current" }
  | { status: "ready"; version: string }
  | { status: "failed"; error: string }

export type BootPhase =
  | "verifying"
  | "tampered"
  | "updating"
  | "update_ready"
  | "offline"
  | "auth"
  | "reveal"
  | "ready"

export type BootState = {
  phase: BootPhase
  changedFiles: string[]
  updateVersion: string | null
  error: string | null
  authenticated: boolean
  integrityOk: boolean
}

export type BootEvent =
  | { type: "integrity_result"; report: IntegrityReport }
  | { type: "ignore_tamper" }
  | { type: "update_result"; result: UpdateResult; authenticated: boolean }
  | { type: "defer_update" }
  | { type: "network_error"; message: string }
  | { type: "retry" }
  | { type: "authenticated" }
  | { type: "reveal_done" }
  | { type: "logged_out" }

export const initialBootState: BootState = {
  phase: "verifying",
  changedFiles: [],
  updateVersion: null,
  error: null,
  authenticated: false,
  integrityOk: true,
}

/** Where to go once boot checks are done: straight in, or via the login screen. */
function afterChecks(authenticated: boolean): BootPhase {
  return authenticated ? "reveal" : "auth"
}

export function bootReducer(state: BootState, event: BootEvent): BootState {
  switch (event.type) {
    case "integrity_result":
      if (state.phase !== "verifying") return state
      return event.report.ok
        ? { ...state, phase: "updating", integrityOk: true }
        : {
            ...state,
            phase: "tampered",
            integrityOk: false,
            changedFiles: event.report.changed,
          }

    case "ignore_tamper":
      if (state.phase !== "tampered") return state
      return { ...state, phase: "updating" }

    case "update_result": {
      if (state.phase !== "updating") return state
      const authenticated = event.authenticated
      if (event.result.status === "ready") {
        return {
          ...state,
          phase: "update_ready",
          updateVersion: event.result.version,
          authenticated,
        }
      }
      // A failed update check is non-blocking: an offline machine hits
      // network_error instead, and a broken release should not lock people out.
      return { ...state, phase: afterChecks(authenticated), authenticated }
    }

    case "defer_update":
      if (state.phase !== "update_ready") return state
      return { ...state, phase: afterChecks(state.authenticated) }

    case "network_error":
      if (state.phase === "ready") return state
      return { ...state, phase: "offline", error: event.message }

    case "retry":
      if (state.phase !== "offline") return state
      return { ...state, phase: "updating", error: null }

    case "authenticated":
      if (state.phase !== "auth") return state
      return { ...state, phase: "reveal", authenticated: true }

    case "reveal_done":
      if (state.phase !== "reveal") return state
      return { ...state, phase: "ready" }

    case "logged_out":
      // Integrity findings survive a logout: they describe the INSTALL, not the
      // session. Dropping changedFiles here made Settings report "0 file(s)
      // modified" on a tampered copy after signing out and back in.
      return {
        ...initialBootState,
        phase: "auth",
        integrityOk: state.integrityOk,
        changedFiles: state.changedFiles,
      }

    default:
      return state
  }
}
