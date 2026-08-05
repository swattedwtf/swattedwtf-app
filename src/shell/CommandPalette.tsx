import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Search as SearchIcon } from "lucide-react"

import { NAV, isEnabled } from "./nav"
import { NavIcon } from "./nav-icons"

/**
 * Ctrl/Cmd-K command palette.
 *
 * A desktop-native affordance the web dashboard has no equivalent of: a single
 * keystroke from anywhere in the app opens a fuzzy launcher over every enabled
 * destination, so navigating a tree of twenty-odd routes never means hunting
 * the sidebar. It owns its own open state and global key listener; the parent
 * only hands it the navigate callback.
 */

type Command = { href: string; label: string; group: string; brand: boolean }

/** Every reachable destination, flattened with its section for context. */
export function buildCommands(): Command[] {
  const out: Command[] = []
  for (const group of NAV) {
    for (const item of group.items) {
      if (item.external) continue
      if (item.children) {
        for (const child of item.children) {
          if (isEnabled(child.href)) {
            // "Instagram · Share Resolver" reads better than a bare child label
            // that repeats across five platforms.
            out.push({
              href: child.href,
              label: child.label === item.label ? item.label : `${item.label} · ${child.label}`,
              group: group.label,
              brand: false,
            })
          }
        }
      } else if (isEnabled(item.href)) {
        out.push({ href: item.href, label: item.label, group: group.label, brand: true })
      }
    }
  }
  // Settings lives outside the nav tree (it sits under the rail), but it is a
  // place people want to jump to, so the palette carries it explicitly.
  out.push({ href: "/settings", label: "Settings", group: "App", brand: false })
  return out
}

/**
 * Subsequence match: every character of the query appears in order in the
 * label. Returns a score (lower is better: a tight, early match wins) or null
 * when it does not match at all. A plain substring hit is boosted so "disc"
 * ranks Discord above a scattered subsequence.
 */
export function score(label: string, query: string): number | null {
  if (!query) return 0
  const l = label.toLowerCase()
  const q = query.toLowerCase()
  const sub = l.indexOf(q)
  if (sub !== -1) return sub // contiguous match, ranked by how early it starts
  let qi = 0
  let firstAt = -1
  let gaps = 0
  for (let li = 0; li < l.length && qi < q.length; li++) {
    if (l[li] === q[qi]) {
      if (firstAt === -1) firstAt = li
      qi++
    } else if (firstAt !== -1) {
      gaps++
    }
  }
  if (qi < q.length) return null
  // Subsequence hits rank below every substring hit (offset by 1000).
  return 1000 + firstAt + gaps
}

export function CommandPalette({
  onNavigate,
  initialOpen = false,
}: {
  onNavigate: (href: string) => void
  /** Seeds the open state. Only used by the render harness and tests; the app
   *  always opens the palette via the Ctrl/Cmd-K listener. */
  initialOpen?: boolean
}) {
  const [open, setOpen] = useState(initialOpen)
  const [query, setQuery] = useState("")
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const commands = useMemo(buildCommands, [])

  const results = useMemo(() => {
    const scored = commands
      .map((c) => ({ c, s: score(c.label, query.trim()) }))
      .filter((x): x is { c: Command; s: number } => x.s !== null)
    scored.sort((a, b) => a.s - b.s || a.c.label.localeCompare(b.c.label))
    return scored.slice(0, 8).map((x) => x.c)
  }, [commands, query])

  const close = useCallback(() => {
    setOpen(false)
    setQuery("")
    setCursor(0)
  }, [])

  const run = useCallback(
    (cmd: Command | undefined) => {
      if (!cmd) return
      onNavigate(cmd.href)
      close()
    },
    [onNavigate, close],
  )

  // Global open shortcut. Bound on window so it fires whatever holds focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // Focus the field the moment the palette opens.
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // Keep the cursor in range as the result set shrinks under typing.
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, results.length - 1)))
  }, [results.length])

  if (!open) return null

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault()
      close()
    } else if (e.key === "ArrowDown") {
      e.preventDefault()
      setCursor((c) => Math.min(c + 1, results.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setCursor((c) => Math.max(c - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      run(results[cursor])
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center px-4 pt-[14vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      {/* Scrim. Clicking it closes, like every launcher. */}
      <button
        type="button"
        aria-label="Close command palette"
        onClick={close}
        className="absolute inset-0 cursor-default bg-black/50 backdrop-blur-[2px]"
      />

      <div className="quick-enter relative w-full max-w-xl overflow-hidden rounded-2xl" onKeyDown={onKeyDown}>
        <div className="composer">
          <div className="composer-body !p-0">
            <div className="flex items-center gap-3 px-4 py-3.5">
              <SearchIcon className="h-4 w-4 shrink-0 text-white/50" aria-hidden="true" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setCursor(0)
                }}
                placeholder="Jump to a page…"
                autoComplete="off"
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-white/40"
              />
              <span className="kbd shrink-0">esc</span>
            </div>

            {results.length > 0 ? (
              <div ref={listRef} className="max-h-[46vh] overflow-y-auto border-t border-white/[0.06] p-1.5">
                {results.map((cmd, i) => {
                  const on = i === cursor
                  return (
                    <button
                      key={cmd.href + cmd.label}
                      type="button"
                      onMouseMove={() => setCursor(i)}
                      onClick={() => run(cmd)}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                        on ? "bg-white/[0.08]" : "hover:bg-white/[0.04]"
                      }`}
                    >
                      <NavIcon
                        href={cmd.href}
                        brand={cmd.brand}
                        className="h-4 w-4 shrink-0 text-white opacity-90"
                      />
                      <span className="flex-1 truncate text-[13px] text-white/90">{cmd.label}</span>
                      <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-white/35">
                        {cmd.group}
                      </span>
                      {on ? <span className="kbd shrink-0">↵</span> : null}
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="border-t border-white/[0.06] px-4 py-6 text-center text-[13px] text-white/45">
                No matches for “{query}”.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
