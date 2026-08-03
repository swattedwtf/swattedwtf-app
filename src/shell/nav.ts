/**
 * Navigation tree, mirroring components/dashboard/sidebar.tsx in the Parallax
 * repo.
 *
 * The whole tree renders so users can see what the platform offers, but only
 * ENABLED_ROUTES are interactive in v1. The rest show a "soon" pill. That is a
 * deliberate product choice: hiding them would make the app look far smaller
 * than the platform actually is.
 */

export type NavItem = {
  label: string
  href: string
  external?: boolean
  children?: NavItem[]
}

export type NavGroup = { label: string; items: NavItem[] }

/** Routes with a real screen behind them. Everything else renders disabled. */
export const ENABLED_ROUTES = ["/dashboard", "/settings"] as const

export const NAV: NavGroup[] = [
  {
    label: "Intelligence",
    items: [
      { label: "Dashboard", href: "/dashboard" },
      { label: "Search", href: "/search" },
      { label: "Live Intelligence", href: "/live-intelligence" },
      { label: "Investigations", href: "/investigations" },
      { label: "Machine Browser", href: "/machine" },
      { label: "Reverse Face", href: "/face" },
      { label: "Agent", href: "/agent" },
      { label: "Monitor", href: "/monitor" },
    ],
  },
  {
    label: "Platforms",
    items: [
      { label: "Discord", href: "/discord" },
      {
        label: "Instagram",
        href: "/instagram",
        children: [
          { label: "Profile Lookup", href: "/instagram" },
          { label: "Share Resolver", href: "/instagram/share-resolver" },
        ],
      },
      {
        label: "Roblox",
        href: "/roblox",
        children: [
          { label: "Profile Lookup", href: "/roblox" },
          { label: "Profile Scraper", href: "/roblox/scraper" },
          { label: "Server Intel", href: "/roblox/server-intel" },
        ],
      },
      {
        label: "TikTok",
        href: "/tiktok",
        children: [
          { label: "User Info", href: "/tiktok" },
          { label: "Share Resolver", href: "/tiktok/share-resolver" },
          { label: "Phone -> User", href: "/tiktok/phone" },
          { label: "Email -> User", href: "/tiktok/email" },
        ],
      },
      {
        label: "Snapchat",
        href: "/snapchat",
        children: [
          { label: "User Info", href: "/snapchat" },
          { label: "Email -> User", href: "/snapchat/email" },
          { label: "Phone -> User", href: "/snapchat/phone" },
        ],
      },
      {
        label: "Telegram",
        href: "/telegram",
        children: [
          { label: "User Lookup", href: "/telegram" },
          { label: "Phone -> User", href: "/telegram/phone" },
        ],
      },
      { label: "Minecraft", href: "/minecraft" },
    ],
  },
  {
    label: "Tools",
    items: [
      { label: "Samsung Lookup", href: "/tools/samsung" },
      { label: "Skiptracer", href: "/tools/skiptracer" },
      { label: "Address Insights", href: "/tools/address-insights" },
      { label: "Falcon", href: "/tools/falcon" },
      { label: "IntelX", href: "/tools/intelx" },
      { label: "Cobra", href: "/tools/cobra" },
    ],
  },
  {
    label: "Resources",
    items: [
      { label: "API Access", href: "/api" },
      { label: "Support", href: "https://t.me/swatted_bot", external: true },
    ],
  },
]

/**
 * Exact match, never a prefix test. `/dashboard/evil` must not inherit
 * `/dashboard`'s enabled state.
 */
export function isEnabled(href: string): boolean {
  return (ENABLED_ROUTES as readonly string[]).includes(href)
}

/** Every leaf in the tree. Parents that exist only to group children are omitted. */
export function flattenNav(): NavItem[] {
  const out: NavItem[] = []
  for (const group of NAV) {
    for (const item of group.items) {
      if (item.children) out.push(...item.children)
      else out.push(item)
    }
  }
  return out
}
