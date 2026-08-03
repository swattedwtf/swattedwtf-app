import type { ReactNode } from "react"
import { getCurrentWindow } from "@tauri-apps/api/window"

/**
 * Custom minimize / maximize / close, floating over the content area's top
 * right. The window is frameless (decorations: false), so these are the only
 * way to control it and they must never be inside a drag region.
 *
 * The glyphs are drawn, not typed. They used to be the HTML entities &#8211;,
 * &#9723; and &#10005;, which meant three different fonts' idea of a stroke
 * weight, three different optical centres and three different sizes sitting
 * next to each other. Three 10x10 SVGs on a shared stroke width line up.
 */
function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 10 10"
      width="10"
      height="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="square"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

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

  // No container chip behind the group: a translucent black plate over an
  // already-dark shell reads as a smudge. Each button owns its own hover.
  const btn =
    "grid h-7 w-9 place-items-center rounded-md text-white/55 transition-colors duration-150 hover:bg-white/10 hover:text-white"

  return (
    <div className="no-drag absolute right-2 top-2 z-20 flex gap-0.5">
      <button className={btn} onClick={act((w) => w.minimize())} aria-label="Minimize">
        <Glyph>
          <path d="M1 5h8" />
        </Glyph>
      </button>
      <button className={btn} onClick={act((w) => w.toggleMaximize())} aria-label="Maximize">
        <Glyph>
          <rect x="1.5" y="1.5" width="7" height="7" />
        </Glyph>
      </button>
      <button
        className={`${btn} hover:!bg-[#b3261e] hover:!text-white`}
        onClick={act((w) => w.close())}
        aria-label="Close"
      >
        <Glyph>
          <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" />
        </Glyph>
      </button>
    </div>
  )
}
