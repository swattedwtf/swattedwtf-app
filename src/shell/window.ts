import { LogicalSize, getCurrentWindow } from "@tauri-apps/api/window"

/**
 * The two window geometries, in one place so the shell and the logout path
 * cannot drift apart.
 *
 * Every call is guarded: these reject outside a Tauri host (a plain browser
 * during development), and a rejection here must never take the UI down.
 */
const SIZES = {
  boot: { width: 520, height: 620, resizable: false },
  shell: { width: 1180, height: 760, resizable: true },
} as const

export async function resizeTo(which: keyof typeof SIZES): Promise<void> {
  const size = SIZES[which]
  try {
    const win = getCurrentWindow()
    await win.setResizable(size.resizable)
    if (size.resizable) {
      await win.setMinSize(new LogicalSize(900, 600))
    } else {
      await win.setMinSize(new LogicalSize(size.width, size.height))
    }
    await win.setSize(new LogicalSize(size.width, size.height))
    await win.center()
  } catch {
    // Not running inside a Tauri window. Layout still renders.
  }
}
