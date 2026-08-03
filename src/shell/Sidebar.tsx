import { ipc } from "../lib/ipc"
import { NavIcon } from "./nav-icons"
import { Link2 } from "lucide-react"
import { NAV, isEnabled, type NavItem } from "./nav"

/**
 * Full-height sidebar with the wordmark at its top. There is no horizontal
 * title bar, so the sidebar header doubles as a drag region.
 *
 * The entire nav tree renders. Only ENABLED_ROUTES are interactive in v1;
 * everything else is dimmed with a "soon" pill and is genuinely inert (a div,
 * not a disabled button) so it cannot be focused or activated by keyboard.
 */
export function Sidebar({
  route,
  onNavigate,
}: {
  route: string
  onNavigate: (href: string) => void
}) {
  return (
    <nav className="relative z-10 flex h-full w-[224px] shrink-0 flex-col overflow-y-auto border-r border-white/[0.07] bg-black/40 px-2 pb-3 backdrop-blur-xl">
      <div
        data-tauri-drag-region
        className="drag mb-1 border-b border-white/[0.06] px-2 pb-3.5 pt-4 text-[15px] font-semibold tracking-[-0.01em]"
      >
        swatted<span className="text-[var(--mark-tld)]">.wtf</span>
      </div>

      {NAV.map((group) => (
        <div key={group.label} className="mt-2">
          <p className="px-2 pb-1.5 pt-3 text-[9px] font-medium uppercase tracking-[0.16em] text-white/30">
            {group.label}
          </p>
          {group.items.map((item) => (
            <div key={`${group.label}:${item.label}`}>
              <Row item={item} route={route} onNavigate={onNavigate} />
              {item.children?.map((child) => (
                <Row
                  key={`${item.label}:${child.label}`}
                  item={child}
                  route={route}
                  onNavigate={onNavigate}
                  nested
                />
              ))}
            </div>
          ))}
        </div>
      ))}

      <div className="mt-auto border-t border-[var(--color-border)] pt-2">
        <Row item={{ label: "Plans", href: "/plans" }} route={route} onNavigate={onNavigate} />
        <Row item={{ label: "Settings", href: "/settings" }} route={route} onNavigate={onNavigate} />
      </div>
    </nav>
  )
}

function Row({
  item,
  route,
  onNavigate,
  nested = false,
}: {
  item: NavItem
  route: string
  onNavigate: (href: string) => void
  nested?: boolean
}) {
  const indent = nested ? "pl-6" : ""

  if (item.external) {
    return (
      <button
        // openExternal is allowlisted Rust-side; a rejection (for example while
        // the command is not yet registered) must not take the sidebar down.
        onClick={() => void ipc.openExternal(item.href).catch(() => {})}
        className={`no-drag group flex w-full items-center gap-2.5 rounded-lg px-2 py-[7px] text-left text-[13px] text-white/60 transition-colors hover:bg-white/[0.07] hover:text-white ${indent}`}
      >
        <NavIcon href={item.href} className="h-[15px] w-[15px] shrink-0 opacity-70 transition-opacity group-hover:opacity-100" />
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
        className={`group flex w-full cursor-default items-center gap-2.5 rounded-lg px-2 py-[7px] text-[13px] text-white/55 opacity-40 ${indent}`}
      >
        <NavIcon href={item.href} className="h-[15px] w-[15px] shrink-0" />
        <span className="truncate">{item.label}</span>
        <span className="ml-auto shrink-0 rounded-full border border-white/15 px-1.5 py-[1px] text-[9px] uppercase tracking-[0.08em] text-white/40 opacity-0 transition-opacity group-hover:opacity-100">
          soon
        </span>
      </div>
    )
  }

  const active = route === item.href

  return (
    <button
      onClick={() => onNavigate(item.href)}
      aria-current={active ? "page" : undefined}
      className={`no-drag group relative flex w-full items-center gap-2.5 rounded-lg px-2 py-[7px] text-left text-[13px] transition-colors ${
        active
          ? "bg-white/[0.10] text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]"
          : "text-white/60 hover:bg-white/[0.07] hover:text-white"
      } ${indent}`}
    >
      {active && (
        <span className="absolute inset-y-1.5 left-0 w-[2px] rounded-full bg-white shadow-[0_0_8px_0_rgba(255,255,255,0.5)]" />
      )}
      <NavIcon
        href={item.href}
        className={`h-[15px] w-[15px] shrink-0 transition-opacity ${active ? "opacity-100" : "opacity-70 group-hover:opacity-100"}`}
      />
      <span className="truncate">{item.label}</span>
    </button>
  )
}
