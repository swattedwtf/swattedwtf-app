import { useState } from "react"
import {
  Bot,
  ExternalLink,
  FolderSearch,
  Radar,
  ScanFace,
  Search,
  Tag,
  Zap,
  type LucideIcon,
} from "lucide-react"
import { ipc } from "../lib/ipc"
import { isEnabled } from "../shell/nav"

/**
 * Opens a URL in the system browser and never throws.
 *
 * `open_external` is a Rust command that accepts https and nothing else. A
 * rejected invoke() inside an onClick would otherwise surface as an unhandled
 * rejection, so every caller goes through here and gets a boolean instead.
 * Lives with QuickActions because that is the component whose entire purpose
 * used to be leaving the app.
 */
export async function openWeb(url: string): Promise<boolean> {
  try {
    await ipc.openExternal(url)
    return true
  } catch {
    return false
  }
}

const BASE = "https://swattedw.tf/dashboard"

/**
 * A quick action is a route first and a URL second.
 *
 * This panel used to send all six of its tiles to the browser, because when it
 * was written none of them existed natively. They almost all do now, so a tile
 * navigates in-app when the app owns that route and only hands off when it
 * genuinely does not.
 *
 * `route` is checked against the registry at render time rather than recorded
 * here as a boolean. That is the whole point: when a screen lands, its tile
 * stops opening a browser by itself, with nobody having to remember to come
 * back and flip a flag. The sidebar had exactly that bug, where five platform
 * groups sat greyed out and labelled "soon" long after every page under them
 * worked, and it is not worth repeating in a second place.
 *
 * `web: true` marks the two that are deliberately browser-only. The Agent is
 * not built natively, and the API docs are a documentation site rather than a
 * screen, so neither is waiting on a route.
 */
type Action = {
  label: string
  icon: LucideIcon
  /** In-app route, when the app has one. */
  route?: string
  /** Where to hand off, if the route is missing or this is browser-only. */
  url: string
  /** Always opens in the browser, whatever the registry says. */
  web?: boolean
}

const ACTIONS: Action[] = [
  { label: "Search", route: "/search", url: `${BASE}/search`, icon: Search },
  // Replaces the old "Modules" tile, which pointed at a web index page that the
  // sidebar already is. Live Intelligence is a real screen and a better second
  // stop than a list of links.
  { label: "Live Intelligence", route: "/live-intelligence", url: `${BASE}/live-intelligence`, icon: Radar },
  { label: "Investigations", route: "/investigations", url: `${BASE}/investigations`, icon: FolderSearch },
  { label: "Reverse Face", route: "/face", url: `${BASE}/face`, icon: ScanFace },
  { label: "Plans", route: "/plans", url: `${BASE}/plans`, icon: Tag },
  { label: "Agent", url: `${BASE}/agent`, icon: Bot, web: true },
  { label: "API docs", url: `${BASE}/api/docs`, icon: Zap, web: true },
]

/** True when this tile stays inside the app. */
function isNative(a: Action): boolean {
  return !a.web && !!a.route && isEnabled(a.route)
}

export function QuickActions({ onNavigate }: { onNavigate?: (href: string) => void }) {
  const [failed, setFailed] = useState(false)

  async function activate(a: Action) {
    if (isNative(a) && onNavigate) {
      onNavigate(a.route!)
      return
    }
    setFailed(!(await openWeb(a.url)))
  }

  return (
    <div className="glass p-5">
      <div className="flex items-center gap-2">
        <Zap className="h-4 w-4 text-[var(--muted-foreground)]" aria-hidden="true" />
        <h3 className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--muted-foreground)]">
          Quick Actions
        </h3>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {ACTIONS.map((a) => {
          const Icon = a.icon
          const native = isNative(a)
          return (
            <button
              key={a.label}
              type="button"
              onClick={() => void activate(a)}
              title={native ? a.label : `Opens ${a.url} in your browser`}
              className="glass-tile glass-tile-hover group relative flex flex-col items-center justify-center gap-1.5 px-2 py-3.5 text-center"
            >
              {/* The arrow is the promise that a click leaves the window, so it
                  appears on exactly the tiles that do. */}
              {native ? null : (
                <ExternalLink
                  className="absolute right-1.5 top-1.5 h-3 w-3 text-[var(--muted-foreground)] opacity-60 transition-opacity group-hover:opacity-100"
                  aria-hidden="true"
                />
              )}
              <Icon
                className="h-4 w-4 text-[var(--muted-foreground)] transition-colors group-hover:text-white"
                aria-hidden="true"
              />
              <span className="text-xs font-medium text-white/85 transition-colors group-hover:text-white">
                {a.label}
              </span>
            </button>
          )
        })}
      </div>

      {failed && (
        <p className="mt-3 text-xs text-[var(--warning)]">
          Could not hand off to your browser. Open swattedw.tf manually.
        </p>
      )}
    </div>
  )
}
