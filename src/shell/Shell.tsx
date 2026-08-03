import { useEffect, type ReactNode } from "react"
import { resizeTo } from "./window"
import { Sidebar } from "./Sidebar"
import { WindowControls } from "./WindowControls"

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
    void resizeTo("shell")
  }, [])

  return (
    <div className="relative flex h-full bg-[#0b0b0b]">
      {/* Shared with the web dashboard so the two read as one product. */}
      <div className="app-backdrop">
        <div className="app-backdrop-wash" />
      </div>

      <Sidebar route={route} onNavigate={onNavigate} />

      <div className="relative z-10 flex-1 overflow-hidden">
        <div data-tauri-drag-region className="drag absolute inset-x-0 top-0 h-10" />
        <WindowControls />
        <main className="h-full overflow-y-auto px-9 pb-12 pt-12">
          <div key={route} className="screen-in">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
