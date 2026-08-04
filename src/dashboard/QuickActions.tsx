import { useState } from "react"
import {
  Bot,
  ExternalLink,
  FolderSearch,
  LayoutGrid,
  Search,
  Tag,
  Zap,
  type LucideIcon,
} from "lucide-react"
import { ipc } from "../lib/ipc"

/**
 * Opens a URL in the system browser and never throws.
 *
 * `open_external` is a Rust command with a hard allowlist (swattedw.tf, t.me,
 * github.com). It rejects on anything else, and it also rejects outright while
 * the command is unimplemented. A rejected invoke() inside an onClick would
 * otherwise surface as an unhandled rejection, so every caller goes through
 * here and gets a boolean instead. Lives with QuickActions because that is the
 * component whose entire purpose is leaving the app.
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
 * Every module below exists on the web dashboard and not in this app yet, so
 * each one hands off to the browser rather than pretending to be native. The
 * arrow glyph on each tile is the promise that a click leaves the window.
 */
const ACTIONS: { label: string; url: string; icon: LucideIcon }[] = [
  { label: "Search", url: `${BASE}/search`, icon: Search },
  { label: "Modules", url: `${BASE}/modules`, icon: LayoutGrid },
  { label: "Investigations", url: `${BASE}/investigations`, icon: FolderSearch },
  { label: "Agent", url: `${BASE}/agent`, icon: Bot },
  { label: "Plans", url: `${BASE}/plans`, icon: Tag },
  { label: "API docs", url: `${BASE}/api/docs`, icon: Zap },
]

export function QuickActions() {
  const [failed, setFailed] = useState(false)

  async function open(url: string) {
    setFailed(!(await openWeb(url)))
  }

  return (
    <div className="glass p-5">
      <div className="flex items-center gap-2">
        <Zap className="h-4 w-4 text-[var(--muted-foreground)]" aria-hidden="true" />
        <h3 className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--muted-foreground)]">
          Quick Actions
        </h3>
        <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-[var(--muted-foreground)]">
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
          opens in browser
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {ACTIONS.map((a) => {
          const Icon = a.icon
          return (
            <button
              key={a.url}
              type="button"
              onClick={() => void open(a.url)}
              title={`Opens ${a.url} in your browser`}
              className="glass-tile glass-tile-hover group relative flex flex-col items-center justify-center gap-1.5 px-2 py-3.5 text-center"
            >
              <ExternalLink
                className="absolute right-1.5 top-1.5 h-3 w-3 text-[var(--muted-foreground)] opacity-60 transition-opacity group-hover:opacity-100"
                aria-hidden="true"
              />
              <Icon
                className="h-4 w-4 text-[var(--muted-foreground)] transition-colors group-hover:text-white"
                aria-hidden="true"
              />
              <span className="text-xs font-medium">{a.label}</span>
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
