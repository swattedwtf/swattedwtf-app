import { useEffect, type ReactNode } from "react"
import { LogicalSize, getCurrentWindow } from "@tauri-apps/api/window"
import { Sidebar } from "./Sidebar"
import { WindowControls } from "./WindowControls"

/** Shell dimensions. The window boots at splash size and grows on arrival here. */
const SHELL_WIDTH = 1180
const SHELL_HEIGHT = 760
const MIN_WIDTH = 900
const MIN_HEIGHT = 600

/**
 * App shell.
 *
 * No horizontal title bar: the sidebar runs the full window height and the
 * window controls float over the content's top-right corner. A drag strip runs
 * along the top of the content area, since without decorations there would
 * otherwise be nowhere to grab on that side.
 */
export function Shell({
  route,
  onNavigate,
  children,
}: {
  route: string
  onNavigate: (href: string) => void
  children: ReactNode
}) {
  useEffect(() => {
    const win = getCurrentWindow()
    // The boot window is fixed at 520x620; entering the shell is where it
    // becomes a real resizable app window. Guarded because these reject outside
    // a Tauri host (for example in a browser during development).
    void (async () => {
      try {
        await win.setResizable(true)
        await win.setMinSize(new LogicalSize(MIN_WIDTH, MIN_HEIGHT))
        await win.setSize(new LogicalSize(SHELL_WIDTH, SHELL_HEIGHT))
        await win.center()
      } catch {
        // Not running inside a Tauri window. Layout still renders.
      }
    })()
  }, [])

  return (
    <div className="flex h-full bg-[#0b0b0b]">
      <Sidebar route={route} onNavigate={onNavigate} />
      <div className="relative flex-1 overflow-hidden">
        <div className="drag absolute inset-x-0 top-0 h-10" />
        <WindowControls />
        <main className="h-full overflow-y-auto px-8 pb-10 pt-12">{children}</main>
      </div>
    </div>
  )
}
