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
 * `onCloseRequested`. The first request is intercepted: the shell gets a fade
 * class, and once the animation has run the window is DESTROYED.
 *
 * `destroy()`, not a second `close()`. A prevented close followed by another
 * `close()` re-enters this very handler and, on Windows/WebView2, leaves the
 * window prevented-but-never-torn-down: it fades to a blank frame and can only
 * be killed from Task Manager. `destroy()` tears the window down directly and
 * never re-emits onCloseRequested, so there is no loop and no hang. It needs
 * `core:window:allow-destroy`, which the capability now grants. A `closing`
 * latch still guards against any second request arriving before teardown, and
 * a hard fallback timer guarantees the window leaves even if destroy is refused.
 */
export function fadeOnClose(durationMs = 190): () => void {
  let stop: (() => void) | undefined
  let cancelled = false
  let closing = false

  void (async () => {
    try {
      const win = getCurrentWindow()
      const unlisten = await win.onCloseRequested((event) => {
        if (closing) return
        closing = true
        event.preventDefault()
        document.documentElement.classList.add("app-closing")
        setTimeout(() => {
          // destroy() is the one that actually closes. If it is somehow
          // refused, fall back to close() so the window still leaves rather
          // than stranding the user on a blank frame.
          void win.destroy().catch(() => void win.close().catch(() => {}))
        }, durationMs)
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
