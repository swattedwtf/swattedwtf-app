import { describe, expect, it } from "vitest"
import { bootReducer, initialBootState, type BootState } from "./machine"

const at = (phase: BootState["phase"], extra: Partial<BootState> = {}): BootState =>
  ({ ...initialBootState, phase, ...extra }) as BootState

describe("bootReducer", () => {
  it("starts in the verifying phase", () => {
    expect(initialBootState.phase).toBe("verifying")
  })

  it("moves from verifying to updating when integrity passes", () => {
    const next = bootReducer(at("verifying"), {
      type: "integrity_result",
      report: { ok: true, changed: [], manifest_version: "0.1.0" },
    })
    expect(next.phase).toBe("updating")
  })

  it("moves to the tampered phase when integrity fails, carrying the file list", () => {
    const next = bootReducer(at("verifying"), {
      type: "integrity_result",
      report: { ok: false, changed: ["assets/index.js"], manifest_version: "0.1.0" },
    })
    expect(next.phase).toBe("tampered")
    expect(next.changedFiles).toEqual(["assets/index.js"])
  })

  it("lets the user continue past a tampered install", () => {
    const next = bootReducer(at("tampered", { changedFiles: ["a"] }), { type: "ignore_tamper" })
    expect(next.phase).toBe("updating")
  })

  it("goes to auth when the update check finds nothing and there is no session", () => {
    const next = bootReducer(at("updating"), {
      type: "update_result",
      result: { status: "current" },
      authenticated: false,
    })
    expect(next.phase).toBe("auth")
  })

  it("goes straight to the reveal when a session already exists", () => {
    const next = bootReducer(at("updating"), {
      type: "update_result",
      result: { status: "current" },
      authenticated: true,
    })
    expect(next.phase).toBe("reveal")
  })

  it("shows the restart prompt when an update is ready", () => {
    const next = bootReducer(at("updating"), {
      type: "update_result",
      result: { status: "ready", version: "0.2.0" },
      authenticated: true,
    })
    expect(next.phase).toBe("update_ready")
    expect(next.updateVersion).toBe("0.2.0")
  })

  it("continues past a deferred update", () => {
    const next = bootReducer(at("update_ready", { updateVersion: "0.2.0", authenticated: true }), {
      type: "defer_update",
    })
    expect(next.phase).toBe("reveal")
  })

  it("blocks on the offline screen when the network fails", () => {
    const next = bootReducer(at("updating"), {
      type: "network_error",
      message: "connection refused",
    })
    expect(next.phase).toBe("offline")
    expect(next.error).toBe("connection refused")
  })

  it("retrying from offline restarts the update check", () => {
    const next = bootReducer(at("offline", { error: "x" }), { type: "retry" })
    expect(next.phase).toBe("updating")
    expect(next.error).toBeNull()
  })

  it("moves from auth to reveal after a successful login", () => {
    const next = bootReducer(at("auth"), { type: "authenticated" })
    expect(next.phase).toBe("reveal")
  })

  it("moves from reveal to ready when the animation finishes", () => {
    const next = bootReducer(at("reveal"), { type: "reveal_done" })
    expect(next.phase).toBe("ready")
  })

  it("returns to auth on logout", () => {
    const next = bootReducer(at("ready"), { type: "logged_out" })
    expect(next.phase).toBe("auth")
  })

  it("ignores events that do not apply to the current phase", () => {
    const state = at("verifying")
    expect(bootReducer(state, { type: "reveal_done" })).toBe(state)
  })
})
