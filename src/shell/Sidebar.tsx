import { useCallback, useEffect, useState, type ReactNode } from "react"
import { ipc } from "../lib/ipc"
import { NavIcon } from "./nav-icons"
import { ChevronDown, PanelLeftClose, Link2 } from "lucide-react"
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

/** Rail width preference. Its own key, so clearing one never clears the other. */
const COLLAPSED_KEY = "swatted.sidebar.collapsed"

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1"
  } catch {
    return false
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
  const [collapsed, setCollapsed] = useState<boolean>(loadCollapsed)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(expanded))
    } catch {
      // Not being able to remember the state is not worth surfacing.
    }
  }, [expanded])

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0")
    } catch {
      // Same: a forgotten preference is not worth an error surface.
    }
  }, [collapsed])

  const toggle = useCallback((key: string, current: boolean) => {
    setExpanded((e) => ({ ...e, [key]: !current }))
  }, [])

  /**
   * Opening a platform group while collapsed has to widen the rail first, or
   * the disclosure would animate open into 60px of width where no child label
   * can be read. Collapsing is a view preference, not a reason to make a group
   * unreachable.
   */
  const openGroup = useCallback((key: string, current: boolean) => {
    setCollapsed(false)
    setExpanded((e) => ({ ...e, [key]: !current }))
  }, [])

  return (
    <nav
      className={`glass-rail relative z-10 flex h-full shrink-0 flex-col overflow-hidden transition-[width] duration-200 ease-out ${
        collapsed ? "w-[60px]" : "w-[224px]"
      }`}
    >
      <div
        data-tauri-drag-region
        className={`drag shrink-0 overflow-hidden whitespace-nowrap border-b border-white/[0.06] pb-3.5 pt-4 text-[15px] font-semibold tracking-[-0.01em] ${
          collapsed ? "px-0 text-center" : "px-4"
        }`}
      >
        {collapsed ? (
          // The mark alone. Rendered as its own glyph rather than by truncating
          // the wordmark, so it stays centred instead of clipping mid-letter.
          <span aria-label="swatted.wtf">s</span>
        ) : (
          <>
            swatted<span className="text-[var(--mark-tld)]">.wtf</span>
          </>
        )}
      </div>

      {/* Everything below the header is interactive chrome, so it opts out of
          the window drag region wholesale rather than row by row.

          `min-h-0` is what makes the scroll work: a flex child defaults to
          min-height:auto and would grow to fit all 30-odd rows, pushing the
          footer off the bottom of a short window instead of scrolling. */}
      {/* The mask fades the last few pixels of the scroll area so a half-visible
          row dissolves into the footer rule instead of being guillotined by it.
          Purely cosmetic: where mask-image is unsupported the list simply
          clips, exactly as it did before. */}
      <div className="no-drag min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3 pt-1 [-webkit-mask-image:linear-gradient(to_bottom,#000_calc(100%-20px),transparent)] [mask-image:linear-gradient(to_bottom,#000_calc(100%-20px),transparent)]">
        {NAV.map((group) => {
          const key = `group:${group.label}`
          // Sections default to open, like the web dashboard.
          const open = expanded[key] ?? true
          return (
            <div key={group.label} className="mt-4 first:mt-1">
              {/* A 60px rail has no room for a 0.22em-tracked caps label, and a
                  truncated one reads as damage. Collapsed, the group becomes a
                  hairline: the same separation, none of the text. */}
              {collapsed ? (
                <div className="mx-2 mb-1.5 h-px bg-white/[0.07]" aria-hidden="true" />
              ) : (
                <button
                  type="button"
                  onClick={() => toggle(key, open)}
                  aria-expanded={open}
                  className="group flex w-full items-center gap-1.5 px-2 pb-1 pt-1 font-mono text-[10px] uppercase tracking-[0.22em] text-white/35 transition-colors hover:text-white/70"
                >
                  <ChevronDown
                    className={`h-3 w-3 shrink-0 transition-transform duration-200 ${open ? "rotate-0" : "-rotate-90"}`}
                    aria-hidden="true"
                  />
                  <span>{group.label}</span>
                </button>
              )}

              {/* Collapsed, sections are always shown: a collapsed section
                  inside a collapsed rail is two levels of hidden and leaves the
                  user staring at an empty strip. */}
              <Collapse open={collapsed || open}>
                <ul>
                  {group.items.map((item) =>
                    item.children?.length ? (
                      <PlatformGroup
                        key={`${group.label}:${item.label}`}
                        item={item}
                        route={route}
                        onNavigate={onNavigate}
                        expanded={expanded}
                        toggle={collapsed ? openGroup : toggle}
                        collapsed={collapsed}
                      />
                    ) : (
                      <li key={`${group.label}:${item.label}`}>
                        <Row
                          item={item}
                          route={route}
                          onNavigate={onNavigate}
                          brand
                          collapsed={collapsed}
                        />
                      </li>
                    ),
                  )}
                </ul>
              </Collapse>
            </div>
          )
        })}
      </div>

      {/* Pinned, outside the scroll area: Settings must never scroll out of
          reach, and neither must the control that gives the rail its width
          back. Collapsed, the toggle sits under Settings rather than beside it,
          because 60px cannot hold a row and a button side by side. */}
      <div className="no-drag shrink-0 border-t border-[var(--color-border)] px-2 pb-3 pt-2">
        <Row
          item={{ label: "Plans", href: "/plans" }}
          route={route}
          onNavigate={onNavigate}
          collapsed={collapsed}
        />
        <div className={collapsed ? "" : "flex items-center gap-1"}>
          <div className={collapsed ? "" : "min-w-0 flex-1"}>
            <Row
              item={{ label: "Settings", href: "/settings" }}
              route={route}
              onNavigate={onNavigate}
              collapsed={collapsed}
            />
          </div>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`flex shrink-0 items-center justify-center rounded-md text-white/45 transition-colors hover:bg-white/[0.06] hover:text-white ${
              collapsed ? "mt-0.5 h-8 w-full" : "h-7 w-7"
            }`}
          >
            <PanelLeftClose
              className={`h-4 w-4 transition-transform duration-200 ${collapsed ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </button>
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
  collapsed = false,
}: {
  item: NavItem
  route: string
  onNavigate: (href: string) => void
  expanded: ExpandedMap
  toggle: (key: string, current: boolean) => void
  collapsed?: boolean
}) {
  const key = `item:${item.label}`
  const holdsActive = item.href === route || !!item.children?.some((c) => c.href === route)
  // Collapsed by default so the Platforms section stays scannable; a group
  // holding the current route opens itself. An explicit choice always wins.
  const open = expanded[key] ?? holdsActive

  /**
   * A group is only "soon" when NOTHING inside it is built.
   *
   * This row used to be dimmed and pilled unconditionally, written when every
   * platform below it was unbuilt. The children shipped and this never
   * followed, so Roblox, Instagram, TikTok, Snapchat and Telegram sat greyed
   * out and labelled "soon" while every page under them worked. Derived from
   * the children now, so it cannot go stale again.
   */
  const anyLive = !!item.children?.some((c) => isEnabled(c.href))

  return (
    <li>
      <button
        type="button"
        // A group header, never a destination: its href is its first child's.
        onClick={() => toggle(key, open)}
        aria-expanded={open}
        title={
          collapsed
            ? anyLive
              ? item.label
              : `${item.label} (coming in a future update)`
            : anyLive
              ? undefined
              : "Coming in a future update"
        }
        className={`group flex w-full items-center gap-2.5 rounded-md py-1.5 text-left text-[13px] transition-colors hover:bg-white/[0.05] ${
          collapsed ? "justify-center px-0" : "px-2"
        } ${
          anyLive
            ? `text-white/70 hover:text-white ${holdsActive ? "text-white" : ""}`
            : "text-white/55 opacity-45 hover:opacity-70"
        }`}
      >
        <NavIcon
          href={item.href}
          brand
          className={`h-4 w-4 shrink-0 ${anyLive ? "opacity-80 transition-opacity group-hover:opacity-100" : ""}`}
        />
        {collapsed ? null : (
          <>
            <span className="truncate">{item.label}</span>
            {anyLive ? null : <SoonPill className="ml-auto" />}
            <ChevronDown
              className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${anyLive ? "ml-auto" : "ml-1"} ${open ? "rotate-0" : "-rotate-90"}`}
              aria-hidden="true"
            />
          </>
        )}
      </button>

      {/* Collapsed, the children stay hidden and the header is the only control:
          clicking it widens the rail and opens the group in one go, via
          `openGroup`. Rendering indented children into 60px would ellipsise
          every one of them to a couple of letters. */}
      <Collapse open={!collapsed && open}>
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
  collapsed = false,
}: {
  item: NavItem
  route: string
  onNavigate: (href: string) => void
  nested?: boolean
  brand?: boolean
  /** Icon-only mode. The label moves to `title`, so nothing becomes unnameable. */
  collapsed?: boolean
}) {
  // Children are indented 14px from their parent. The web dashboard indents a
  // full 36px so child labels line up under the parent's label, but this
  // sidebar is a fixed 224px and that much indent left "Share Resolver" with
  // roughly 85px of label, i.e. permanently ellipsised. 14px still reads as a
  // clear step down while keeping every child label whole.
  // Collapsed there is no room to indent, and nothing to indent under: the
  // group labels are gone, so a nested row would just look misaligned.
  const pad = collapsed ? "justify-center px-0" : nested ? "pl-[22px] pr-2" : "px-2"

  if (item.external) {
    return (
      <button
        title={collapsed ? item.label : undefined}
        // openExternal is allowlisted Rust-side; a rejection (for example while
        // the command is not yet registered) must not take the sidebar down.
        onClick={() => void ipc.openExternal(item.href).catch(() => {})}
        className={`group flex w-full items-center gap-2.5 rounded-md py-1.5 text-left text-[13px] text-white/60 transition-colors hover:bg-white/[0.05] hover:text-white ${pad}`}
      >
        <NavIcon href={item.href} brand={brand} className="h-4 w-4 shrink-0 opacity-70 transition-opacity group-hover:opacity-100" />
        {collapsed ? null : (
          <>
            <span className="truncate">{item.label}</span>
            <Link2 className="ml-auto h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-40" aria-hidden="true" />
          </>
        )}
      </button>
    )
  }

  if (!isEnabled(item.href)) {
    return (
      <div
        title={collapsed ? `${item.label} (coming in a future update)` : "Coming in a future update"}
        aria-disabled="true"
        className={`group flex w-full cursor-default items-center gap-2.5 rounded-md py-1.5 text-[13px] text-white/55 opacity-45 ${pad}`}
      >
        <NavIcon href={item.href} brand={brand} className="h-4 w-4 shrink-0" />
        {collapsed ? null : (
          <>
            <span className="truncate">{item.label}</span>
            <SoonPill className="ml-auto" />
          </>
        )}
      </div>
    )
  }

  const active = route === item.href

  return (
    <button
      onClick={() => onNavigate(item.href)}
      title={collapsed ? item.label : undefined}
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
      {collapsed ? null : <span className="truncate">{item.label}</span>}
    </button>
  )
}
