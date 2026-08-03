import { ipc } from "../lib/ipc"
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
    <nav className="flex h-full w-[220px] shrink-0 flex-col overflow-y-auto border-r border-[var(--color-border)] bg-white/[0.018] px-2 pb-3">
      <div className="drag px-2 pb-3 pt-4 text-[15px] font-semibold tracking-[-0.01em]">
        swatted<span className="text-[var(--mark-tld)]">.wtf</span>
      </div>

      {NAV.map((group) => (
        <div key={group.label} className="mt-2">
          <p className="px-2 pb-1 pt-2 text-[9px] uppercase tracking-[0.12em] text-white/25">
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
        className={`no-drag flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-white/60 hover:bg-white/5 hover:text-white ${indent}`}
      >
        <span className="truncate">{item.label}</span>
      </button>
    )
  }

  if (!isEnabled(item.href)) {
    return (
      <div
        title="Coming in a future update"
        aria-disabled="true"
        className={`flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-white/60 opacity-[0.34] ${indent}`}
      >
        <span className="truncate">{item.label}</span>
        <span className="ml-auto shrink-0 rounded-full border border-white/15 px-1.5 py-[1px] text-[9px] uppercase tracking-[0.08em] text-white/40">
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
      className={`no-drag relative flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] ${
        active ? "bg-white/[0.09] text-white" : "text-white/60 hover:bg-white/5 hover:text-white"
      } ${indent}`}
    >
      {active && <span className="absolute inset-y-1 left-0 w-[2px] rounded-full bg-white" />}
      <span className="truncate">{item.label}</span>
    </button>
  )
}
