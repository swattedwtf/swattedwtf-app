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
 * Fades the window out before it actually closes.
 *
 * The custom close button, Alt+F4 and the taskbar all funnel through
 * `onCloseRequested`. The first request is intercepted: the shell is given a
 * fade class and the real close fires once the animation has run. A `closing`
 * latch lets that second close through untouched, so there is no loop and no
 * dependency on an allow-destroy permission the app deliberately does not grant.
 *
 * Guarded like everything else here: outside a Tauri host it does nothing and
 * the window (if any) closes instantly.
 */
export function fadeOnClose(durationMs = 190): () => void {
  let stop: (() => void) | undefined
  let cancelled = false
  let closing = false

  void (async () => {
    try {
      const win = getCurrentWindow()
      const unlisten = await win.onCloseRequested((event) => {
        if (closing) return // second pass: let the real close proceed
        closing = true
        event.preventDefault()
        document.documentElement.classList.add("app-closing")
        setTimeout(() => void win.close().catch(() => {}), durationMs)
      })
      if (cancelled) unlisten()
      else stop = unlisten
    } catch {
      // Not inside a Tauri window; closing stays instant.
    }
  })()

  return () => {
    cancelled = true
    stop?.()
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
