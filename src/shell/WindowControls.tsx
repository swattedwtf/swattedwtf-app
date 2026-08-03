import { getCurrentWindow } from "@tauri-apps/api/window"

/**
 * Custom minimize / maximize / close, floating over the content area's top
 * right. The window is frameless (decorations: false), so these are the only
 * way to control it and they must never be inside a drag region.
 */
export function WindowControls() {
  // Resolved per click, not during render: getCurrentWindow() throws outside a
  // Tauri host (a plain browser during development) and would take the whole
  // tree down with it.
  const act = (fn: (w: ReturnType<typeof getCurrentWindow>) => Promise<unknown>) => () => {
    try {
      void fn(getCurrentWindow()).catch(() => {})
    } catch {
      // Not running inside a Tauri window.
    }
  }
  const btn =
    "grid h-7 w-9 place-items-center rounded-md text-white/45 transition-colors hover:bg-white/10 hover:text-white"

  return (
    <div className="no-drag absolute right-2 top-2 z-20 flex gap-0.5 rounded-lg bg-black/35 p-0.5">
      <button className={btn} onClick={act((w) => w.minimize())} aria-label="Minimize">
        &#8211;
      </button>
      <button className={btn} onClick={act((w) => w.toggleMaximize())} aria-label="Maximize">
        &#9723;
      </button>
      <button
        className={`${btn} hover:!bg-[#b3261e] hover:!text-white`}
        onClick={act((w) => w.close())}
        aria-label="Close"
      >
        &#10005;
      </button>
    </div>
  )
}
