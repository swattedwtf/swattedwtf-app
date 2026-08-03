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
  shell: { width: 1320, height: 840, resizable: true },
} as const

export async function resizeTo(which: keyof typeof SIZES): Promise<void> {
  const size = SIZES[which]
  try {
    const win = getCurrentWindow()
    await win.setResizable(size.resizable)
    if (size.resizable) {
      await win.setMinSize(new LogicalSize(1040, 680))
    } else {
      await win.setMinSize(new LogicalSize(size.width, size.height))
    }
    await win.setSize(new LogicalSize(size.width, size.height))
    await win.center()
  } catch {
    // Not running inside a Tauri window. Layout still renders.
  }
}

/**
 * Tracks whether the window is maximized.
 *
 * Drives the square-vs-rounded corner switch: a rounded maximized window leaves
 * four notches of visible desktop at the screen corners. Polling on resize
 * rather than on a maximize event because a window can also be maximized by
 * dragging it to the top edge, which emits no maximize event of its own.
 */
export function watchMaximized(onChange: (maximized: boolean) => void): () => void {
  let stop: (() => void) | undefined
  let cancelled = false

  void (async () => {
    try {
      const win = getCurrentWindow()
      const push = async () => onChange(await win.isMaximized())
      await push()
      const unlisten = await win.onResized(() => void push())
      if (cancelled) unlisten()
      else stop = unlisten
    } catch {
      // Not inside a Tauri window; stay rounded.
    }
  })()

  return () => {
    cancelled = true
    stop?.()
  }
}
