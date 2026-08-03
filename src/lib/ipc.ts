/**
 * The single place the frontend talks to Rust. Every command is wrapped in a
 * typed function so no component ever calls invoke() with a raw string.
 */
import { invoke } from "@tauri-apps/api/core"
import type { IntegrityReport, UpdateResult } from "../boot/machine"

export type Overview = {
  user: { id: string; userNumber: number; email: string | null; handle: string }
  telegram: { username: string | null; linked: boolean }
  security: { twofaEnabled: boolean }
  plan: { id: string; label: string; monthlyLimit: number; since: string }
  usage: {
    todayCount: number
    monthCount: number
    allTimeCount: number
    nextResetMs: number
    series: { date: string; count: number }[]
  }
  api: {
    active: boolean
    tierLabel: string | null
    usedToday: number
    dailyLimit: number | null
    expiresAt: string | null
    key: string | null
  }
}

export type LoginOutcome =
  | { status: "ok" }
  | { status: "twofa_required"; message: string }
  | { status: "error"; message: string }

export type RegisterOutcome = { status: "ok"; code: string } | { status: "error"; message: string }

export const ipc = {
  verifyIntegrity: () => invoke<IntegrityReport>("verify_integrity"),
  checkUpdate: () => invoke<UpdateResult>("check_update"),
  installUpdateAndRestart: () => invoke<void>("install_update_and_restart"),
  sessionStatus: () => invoke<{ authenticated: boolean }>("session_status"),
  login: (code: string, otp?: string) => invoke<LoginOutcome>("login", { code, otp }),
  register: (email?: string) => invoke<RegisterOutcome>("register", { email }),
  saveRecoveryFile: (code: string) => invoke<string | null>("save_recovery_file", { code }),
  logout: () => invoke<void>("logout"),
  getOverview: () => invoke<Overview>("get_overview"),
  openExternal: (url: string) => invoke<void>("open_external", { url }),
}
