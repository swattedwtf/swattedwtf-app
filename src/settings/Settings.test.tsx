import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

vi.mock("../lib/ipc", () => ({
  ipc: {
    openExternal: vi.fn(),
    windowDiagnostics: vi.fn(),
    getSettings: vi.fn(),
    setShortcut: vi.fn(),
    setLaunchAtLogin: vi.fn(),
    checkUpdate: vi.fn(),
    logout: vi.fn(),
  },
}))

import type { Overview, SettingsView } from "../lib/ipc"
import {
  AccountSection,
  AdvancedSection,
  PlanSection,
  SecuritySection,
  ShortcutSection,
  StartupSection,
  formatCents,
} from "./Settings"

const overview: Overview = {
  user: { id: "u1", userNumber: 42, email: "a@b.c", handle: "sujrb" },
  telegram: { username: "sujrb", linked: true },
  security: { twofaEnabled: true },
  plan: {
    id: "heist",
    label: "Heist",
    monthlyLimit: 5000,
    since: "2025-01-04T00:00:00.000Z",
    balanceCents: 1250,
    status: "active",
    dailyLimit: 250,
  },
  usage: {
    todayCount: 12,
    monthCount: 1200,
    allTimeCount: 45678,
    // Fixed, so the countdown is not a moving target. formatResetIn clamps at
    // zero, so a past date simply reads "0m".
    nextResetMs: 0,
    series: [],
  },
  api: {
    active: false,
    tierLabel: null,
    usedToday: 0,
    dailyLimit: null,
    expiresAt: null,
    key: null,
  },
}

const view: SettingsView = {
  shortcut: "CmdOrCtrl+Shift+Space",
  shortcutActive: "CmdOrCtrl+Shift+Space",
  shortcutError: null,
  launchAtLogin: false,
  launchAtLoginError: null,
  appDataDir: "/home/u/.local/share/tf.swattedw.desktop",
}

const render = (node: React.ReactElement) => renderToStaticMarkup(node)

describe("formatCents", () => {
  it("renders a wallet balance in dollars", () => {
    expect(formatCents(1250)).toBe("$12.50")
    expect(formatCents(0)).toBe("$0.00")
    expect(formatCents(123456)).toBe("$1,234.56")
  })
})

describe("Account", () => {
  it("shows who is signed in and how to leave", () => {
    const html = render(<AccountSection overview={overview} busy={false} onLogout={() => {}} />)
    expect(html).toContain("sujrb")
    expect(html).toContain("#42")
    expect(html).toContain("a@b.c")
    expect(html).toContain("Log out")
  })

  it("says so when no email is set rather than leaving a blank", () => {
    const anon = { ...overview, user: { ...overview.user, email: null } }
    expect(render(<AccountSection overview={anon} busy={false} onLogout={() => {}} />)).toContain(
      "Not set",
    )
  })
})

describe("Plan and usage", () => {
  it("renders the plan, its status and the wallet balance", () => {
    const html = render(<PlanSection overview={overview} />)
    expect(html).toContain("Heist")
    expect(html).toContain("active")
    expect(html).toContain("$12.50")
    expect(html).toContain("1,200")
    expect(html).toContain("5,000")
  })

  /**
   * The reset in the payload is the start of the next UTC MONTH, while the web
   * account page counts down to a DAILY reset. Two different windows, and
   * labelling this one "resets in" without saying which would put a number on
   * screen that disagrees with the web for reasons the user cannot see.
   */
  it("labels the countdown as the monthly window and says the daily one is separate", () => {
    const html = render(<PlanSection overview={overview} />)
    expect(html).toContain("Monthly reset")
    expect(html).toContain("next month")
    expect(html).toContain("daily allowance resets on its own separate schedule")
  })

  it("shows the daily limit beside today's count when there is one", () => {
    expect(render(<PlanSection overview={overview} />)).toContain("12 / 250")
  })

  /** Null is "no limit configured", which is not the same number as zero. */
  it("says there is no daily limit rather than rendering one of zero", () => {
    const unlimited = { ...overview, plan: { ...overview.plan, dailyLimit: null } }
    const html = render(<PlanSection overview={unlimited} />)
    expect(html).toContain("No daily limit")
    expect(html).not.toContain("/ 0")
  })

  /** An empty status is "the server did not report one", not a status. */
  it("omits the status row when the server reported none", () => {
    const blank = { ...overview, plan: { ...overview.plan, status: "" } }
    expect(render(<PlanSection overview={blank} />)).not.toContain("Status")
  })
})

describe("Shortcuts", () => {
  it("shows the live binding in readable form", () => {
    const html = render(<ShortcutSection view={view} busy={false} onApply={() => {}} />)
    expect(html).toMatch(/Ctrl \+ Shift \+ Space|Cmd \+ Shift \+ Space/)
    expect(html).toContain("Record a new shortcut")
    expect(html).toContain("Disable")
  })

  /** Success is not proof on macOS, so the screen offers a way to check. */
  it("offers a press-it-now test rather than claiming the binding works", () => {
    const html = render(<ShortcutSection view={view} busy={false} onApply={() => {}} />)
    expect(html).toContain("now to check it")
    expect(html).toContain("not by itself proof")
  })

  it("says the shortcut is off when the user turned it off", () => {
    const off: SettingsView = { ...view, shortcut: null, shortcutActive: null }
    const html = render(<ShortcutSection view={off} busy={false} onApply={() => {}} />)
    expect(html).toContain("Turned off")
    expect(html).not.toContain("now to check it")
  })

  /**
   * The stored combo and the live one can differ, and when they do the whole
   * point is that the saved one is not working. Both are shown, and the
   * system's own message is quoted rather than paraphrased, because on Windows
   * the underlying library reports every failure as "already registered"
   * whatever went wrong.
   */
  it("reports the OS message verbatim when the stored combo is not bound", () => {
    const failed: SettingsView = {
      ...view,
      shortcut: "Control+Alt+KeyK",
      shortcutActive: null,
      shortcutError: "HotKey already registered",
    }
    const html = render(<ShortcutSection view={failed} busy={false} onApply={() => {}} />)
    expect(html).toContain("HotKey already registered")
    expect(html).toContain("not currently bound")
  })

  /** Before the settings arrive we do not know, and unknown is not "off". */
  it("does not claim the shortcut is off before the settings have loaded", () => {
    const html = render(<ShortcutSection view={null} busy={false} onApply={() => {}} />)
    expect(html).toContain("Not bound")
    expect(html).not.toContain("Turned off")
  })
})

describe("Startup", () => {
  it("renders launch at login as an off switch", () => {
    const html = render(<StartupSection view={view} busy={false} onToggle={() => {}} />)
    expect(html).toContain("Launch at login")
    expect(html).toContain('aria-checked="false"')
    expect(html).toContain("no administrator rights")
  })

  it("renders it on when the OS says it is on", () => {
    const on: SettingsView = { ...view, launchAtLogin: true }
    expect(render(<StartupSection view={on} busy={false} onToggle={() => {}} />)).toContain(
      'aria-checked="true"',
    )
  })

  it("shows why it could not be read, so unknown does not read as off", () => {
    const broken: SettingsView = { ...view, launchAtLoginError: "permission denied" }
    expect(render(<StartupSection view={broken} busy={false} onToggle={() => {}} />)).toContain(
      "permission denied",
    )
  })
})

describe("Security", () => {
  it("reports two-factor and how the session is stored", () => {
    const html = render(<SecuritySection overview={overview} />)
    expect(html).toContain("Two-factor authentication")
    expect(html).toContain("Enabled")
    expect(html).toContain("credential store")
  })
})

describe("Advanced", () => {
  const advanced = (props: Partial<Parameters<typeof AdvancedSection>[0]> = {}) =>
    render(
      <AdvancedSection
        version="0.1.9"
        integrity={{ ok: true, changed: [], manifest_version: "1" }}
        appDataDir={view.appDataDir}
        updateMessage=""
        busy={false}
        onCheckUpdates={() => {}}
        {...props}
      />,
    )

  /**
   * The developer diagnostic used to sit in the middle of the page. This is
   * what Advanced is for, and it stays shut until it is asked for.
   */
  it("is collapsed", () => {
    const html = advanced()
    expect(html).toContain("<details>")
    expect(html).not.toContain("<details open")
  })

  it("holds the version, the integrity result, the diagnostics and the data path", () => {
    const html = advanced()
    expect(html).toContain("0.1.9")
    expect(html).toContain("Verified")
    expect(html).toContain("Window diagnostics")
    expect(html).toContain("/home/u/.local/share/tf.swattedw.desktop")
  })

  it("names the modified files when the integrity check failed", () => {
    const html = advanced({
      integrity: { ok: false, changed: ["assets/index.js"], manifest_version: "1" },
    })
    expect(html).toContain("1 file(s) modified")
    expect(html).toContain("assets/index.js")
  })
})

/**
 * User-facing copy uses commas, periods and parentheses. An em dash in a string
 * literal here would ship straight to the screen.
 */
describe("copy", () => {
  it("has no em dashes anywhere on the screen", () => {
    const html = [
      render(<AccountSection overview={overview} busy={false} onLogout={() => {}} />),
      render(<PlanSection overview={overview} />),
      render(<ShortcutSection view={view} busy={false} onApply={() => {}} />),
      render(<StartupSection view={view} busy={false} onToggle={() => {}} />),
      render(<SecuritySection overview={overview} />),
    ].join("")
    expect(html).not.toMatch(/[—–]/)
  })
})
