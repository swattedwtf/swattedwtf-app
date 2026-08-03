import { getCurrentWindow } from "@tauri-apps/api/window"

/**
 * Custom minimize / maximize / close, floating over the content area's top
 * right. The window is frameless (decorations: false), so these are the only
 * way to control it and they must never be inside a drag region.
 */
export function WindowControls() {
  const win = getCurrentWindow()
  const btn =
    "grid h-7 w-9 place-items-center rounded-md text-white/45 transition-colors hover:bg-white/10 hover:text-white"

  return (
    <div className="no-drag absolute right-2 top-2 z-20 flex gap-0.5 rounded-lg bg-black/35 p-0.5">
      <button className={btn} onClick={() => void win.minimize()} aria-label="Minimize">
        &#8211;
      </button>
      <button className={btn} onClick={() => void win.toggleMaximize()} aria-label="Maximize">
        &#9723;
      </button>
      <button
        className={`${btn} hover:!bg-[#b3261e] hover:!text-white`}
        onClick={() => void win.close()}
        aria-label="Close"
      >
        &#10005;
      </button>
    </div>
  )
}
