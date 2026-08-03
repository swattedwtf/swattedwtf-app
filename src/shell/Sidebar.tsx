import { useCallback, useEffect, useState, type ReactNode } from "react"
import { ipc } from "../lib/ipc"
import { NavIcon } from "./nav-icons"
import { ChevronDown, Link2 } from "lucide-react"
import { NAV, isEnabled, type NavItem } from "./nav"

/**
 * Full-height sidebar with the wordmark at its top. There is no horizontal
 * title bar, so the sidebar header doubles as a drag region.
 *
 * The entire nav tree renders. Only ENABLED_ROUTES are interactive in v1;
 * everything else is dimmed with a "soon" pill and is genuinely inert (a div,
 * not a disabled button) so it cannot be focused or activated by keyboard.
 *
 * The one exception is a platform row that owns children (Instagram, Roblox,
 * TikTok, Snapchat, Telegram). Those rows are disclosure toggles, not
 * destinations: their href duplicates their first child's, so there is nothing
 * to navigate to. They render with the same disabled treatment and the same
 * "soon" pill, and clicking one only expands or collapses the group. A
 * disclosure has to be a real <button> for `aria-expanded` to mean anything.
 *
 * Layout mirrors components/dashboard/sidebar.tsx in the Parallax repo: the
 * same 13px rows, 16px icons, monospaced group captions and left active
 * stripe, so the app and the site read as one product.
 */

/**
 * Which sections and platform groups the user has left open. Persisted so the
 * sidebar comes back the way it was left rather than snapping back to defaults
 * on every launch.
 *
 * Keys are namespaced (`group:Platforms` vs `item:Roblox`) because a section
 * and a platform could otherwise collide on the same label.
 */
const STORAGE_KEY = "swatted.sidebar.expanded"

type ExpandedMap = Record<string, boolean>

function loadExpanded(): ExpandedMap {
  // Storage can throw outright in a hardened WebView (disabled DOM storage,
  // or a partitioned context). A sidebar must never fail to render over it.
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    const out: ExpandedMap = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "boolean") out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

export function Sidebar({
  route,
  onNavigate,
}: {
  route: string
  onNavigate: (href: string) => void
}) {
  const [expanded, setExpanded] = useState<ExpandedMap>(loadExpanded)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(expanded))
    } catch {
      // Not being able to remember the state is not worth surfacing.
    }
  }, [expanded])

  const toggle = useCallback((key: string, current: boolean) => {
    setExpanded((e) => ({ ...e, [key]: !current }))
  }, [])

  return (
    <nav className="relative z-10 flex h-full w-[224px] shrink-0 flex-col overflow-y-auto border-r border-white/[0.07] bg-black/40 pb-3 backdrop-blur-xl">
      <div
        data-tauri-drag-region
        className="drag mb-1 border-b border-white/[0.06] px-5 pb-3.5 pt-4 text-[15px] font-semibold tracking-[-0.01em]"
      >
        swatted<span className="text-[var(--mark-tld)]">.wtf</span>
      </div>

      {/* Everything below the header is interactive chrome, so it opts out of
          the window drag region wholesale rather than row by row. */}
      <div className="no-drag flex min-h-0 flex-1 flex-col px-2.5">
        {NAV.map((group) => {
          const key = `group:${group.label}`
          // Sections default to open, like the web dashboard.
          const open = expanded[key] ?? true
          return (
            <div key={group.label} className="mt-4 first:mt-1">
              <button
                type="button"
                onClick={() => toggle(key, open)}
                aria-expanded={open}
                className="group flex w-full items-center gap-1.5 px-2.5 pb-1 pt-1 font-mono text-[10px] uppercase tracking-[0.22em] text-white/35 transition-colors hover:text-white/70"
              >
                <ChevronDown
                  className={`h-3 w-3 shrink-0 transition-transform duration-200 ${open ? "rotate-0" : "-rotate-90"}`}
                  aria-hidden="true"
                />
                <span>{group.label}</span>
              </button>

              <Collapse open={open}>
                <ul>
                  {group.items.map((item) =>
                    item.children?.length ? (
                      <PlatformGroup
                        key={`${group.label}:${item.label}`}
                        item={item}
                        route={route}
                        onNavigate={onNavigate}
                        expanded={expanded}
                        toggle={toggle}
                      />
                    ) : (
                      <li key={`${group.label}:${item.label}`}>
                        <Row item={item} route={route} onNavigate={onNavigate} brand />
                      </li>
                    ),
                  )}
                </ul>
              </Collapse>
            </div>
          )
        })}

        <div className="mt-auto border-t border-[var(--color-border)] pt-2">
          <Row item={{ label: "Plans", href: "/plans" }} route={route} onNavigate={onNavigate} />
          <Row item={{ label: "Settings", href: "/settings" }} route={route} onNavigate={onNavigate} />
        </div>
      </div>
    </nav>
  )
}

/**
 * Height animation without measuring anything: a grid whose single row goes
 * from 0fr to 1fr. `overflow-hidden` on the child is what actually clips it.
 * Same trick the web sidebar uses, and it survives content of any height.
 */
function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div
      className={`grid transition-[grid-template-rows] duration-200 ease-out ${
        open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
      }`}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  )
}

/** A platform with sub-pages: a disclosure row plus its indented children. */
function PlatformGroup({
  item,
  route,
  onNavigate,
  expanded,
  toggle,
}: {
  item: NavItem
  route: string
  onNavigate: (href: string) => void
  expanded: ExpandedMap
  toggle: (key: string, current: boolean) => void
}) {
  const key = `item:${item.label}`
  const holdsActive = item.href === route || !!item.children?.some((c) => c.href === route)
  // Collapsed by default so the Platforms section stays scannable; a group
  // holding the current route opens itself. An explicit choice always wins.
  const open = expanded[key] ?? holdsActive

  return (
    <li>
      <button
        type="button"
        // A group header, never a destination: its href is its first child's.
        onClick={() => toggle(key, open)}
        aria-expanded={open}
        title="Coming in a future update"
        className="group flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] text-white/55 opacity-45 transition-colors hover:bg-white/[0.05] hover:opacity-70"
      >
        <NavIcon href={item.href} brand className="h-4 w-4 shrink-0" />
        <span className="truncate">{item.label}</span>
        <SoonPill className="ml-auto" />
        <ChevronDown
          className={`ml-1 h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${open ? "rotate-0" : "-rotate-90"}`}
          aria-hidden="true"
        />
      </button>

      <Collapse open={open}>
        <ul className="pt-0.5">
          {item.children?.map((child) => (
            <li key={`${item.label}:${child.label}`}>
              <Row item={child} route={route} onNavigate={onNavigate} nested />
            </li>
          ))}
        </ul>
      </Collapse>
    </li>
  )
}

function SoonPill({ className = "" }: { className?: string }) {
  return (
    <span
      className={`shrink-0 rounded-full border border-white/15 px-1.5 py-[1px] font-mono text-[9px] uppercase tracking-[0.08em] text-white/40 opacity-0 transition-opacity group-hover:opacity-100 ${className}`}
    >
      soon
    </span>
  )
}

function Row({
  item,
  route,
  onNavigate,
  nested = false,
  brand = false,
}: {
  item: NavItem
  route: string
  onNavigate: (href: string) => void
  nested?: boolean
  brand?: boolean
}) {
  // Children sit under a 16px icon plus a 10px gap, so 34px of leading space
  // lines their labels up under the parent's label rather than its icon.
  const pad = nested ? "pl-[34px] pr-2.5" : "px-2.5"

  if (item.external) {
    return (
      <button
        // openExternal is allowlisted Rust-side; a rejection (for example while
        // the command is not yet registered) must not take the sidebar down.
        onClick={() => void ipc.openExternal(item.href).catch(() => {})}
        className={`group flex w-full items-center gap-2.5 rounded-md py-1.5 text-left text-[13px] text-white/60 transition-colors hover:bg-white/[0.05] hover:text-white ${pad}`}
      >
        <NavIcon href={item.href} brand={brand} className="h-4 w-4 shrink-0 opacity-70 transition-opacity group-hover:opacity-100" />
        <span className="truncate">{item.label}</span>
        <Link2 className="ml-auto h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-40" aria-hidden="true" />
      </button>
    )
  }

  if (!isEnabled(item.href)) {
    return (
      <div
        title="Coming in a future update"
        aria-disabled="true"
        className={`group flex w-full cursor-default items-center gap-2.5 rounded-md py-1.5 text-[13px] text-white/55 opacity-45 ${pad}`}
      >
        <NavIcon href={item.href} brand={brand} className="h-4 w-4 shrink-0" />
        <span className="truncate">{item.label}</span>
        <SoonPill className="ml-auto" />
      </div>
    )
  }

  const active = route === item.href

  return (
    <button
      onClick={() => onNavigate(item.href)}
      aria-current={active ? "page" : undefined}
      className={`group relative flex w-full items-center gap-2.5 rounded-md py-1.5 text-left text-[13px] transition-colors ${
        active
          ? "bg-gradient-to-r from-white/[0.10] to-white/[0.02] text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]"
          : "text-white/60 hover:bg-white/[0.05] hover:text-white"
      } ${pad}`}
    >
      {active && (
        <span className="absolute inset-y-1.5 left-0 w-[2px] rounded-full bg-white shadow-[0_0_8px_0_rgba(255,255,255,0.5)]" />
      )}
      <NavIcon
        href={item.href}
        brand={brand}
        className={`h-4 w-4 shrink-0 transition-opacity ${active ? "opacity-100" : "opacity-70 group-hover:opacity-100"}`}
      />
      <span className="truncate">{item.label}</span>
    </button>
  )
}
