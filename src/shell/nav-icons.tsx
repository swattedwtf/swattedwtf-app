import {
  AtSign,
  Blocks,
  Bot,
  Code2,
  Fingerprint,
  FolderSearch,
  Footprints,
  HardDrive,
  IdCard,
  LayoutDashboard,
  LayoutGrid,
  LifeBuoy,
  Link2,
  Mail,
  MapPinHouse,
  MessageCircle,
  Phone,
  Radar,
  ScanFace,
  Search,
  Settings,
  ShieldAlert,
  Database,
  User,
  Users,
  Layers,
  BellRing,
  type LucideIcon,
} from "lucide-react"

/**
 * One icon per destination, mirroring components/dashboard/sidebar.tsx on the
 * web so the two products look like the same tool.
 *
 * Keyed by href rather than label: hrefs are unique across the tree (a test
 * pins that), while labels like "Profile Lookup" repeat under several
 * platforms.
 */
const ICONS: Record<string, LucideIcon> = {
  "/dashboard": LayoutDashboard,
  "/search": Search,
  "/live-intelligence": Fingerprint,
  "/investigations": FolderSearch,
  "/machine": HardDrive,
  "/face": ScanFace,
  "/agent": Bot,
  "/monitor": BellRing,

  // The platform rows normally render a brand mark (see BRAND below); these
  // entries are the lucide stand-ins used for their child rows, which share the
  // parent href, and as a safety net if a brand asset ever goes missing.
  "/discord": MessageCircle,
  "/minecraft": Blocks,
  "/instagram": User,
  "/instagram/share-resolver": Link2,
  "/roblox": User,
  "/roblox/scraper": Layers,
  "/roblox/server-intel": Radar,
  "/tiktok": User,
  "/tiktok/share-resolver": Link2,
  "/tiktok/phone": Phone,
  "/tiktok/email": Mail,
  "/snapchat": User,
  "/snapchat/email": Mail,
  "/snapchat/phone": Phone,
  "/telegram": User,
  "/telegram/phone": Phone,

  "/tools/samsung": IdCard,
  "/tools/skiptracer": Footprints,
  "/tools/address-insights": MapPinHouse,
  "/tools/falcon": Radar,
  "/tools/intelx": Database,
  "/tools/cobra": ShieldAlert,

  "/api": Code2,
  "https://t.me/swatted_bot": LifeBuoy,

  "/plans": LayoutGrid,
  "/settings": Settings,
}

/**
 * Real brand marks for the platform rows, exactly like the web dashboard,
 * which uses the Simple Icons set (SiDiscord, SiRoblox, ...) plus a hand-drawn
 * Minecraft block.
 *
 * They are files under public/brand rather than inline React components so the
 * bundle stays small, and they are local files rather than a CDN because the
 * app's CSP is `img-src 'self' data:` and would block anything remote.
 *
 * Each file is authored with an explicit `fill="#ffffff"`. Simple Icons ship
 * with no fill at all, which means an <img> (where our CSS cannot reach inside
 * the document) paints them with the SVG default of solid black, i.e. they
 * disappear against a near-black sidebar. Baking the fill in avoids needing a
 * `filter: invert()` hack and keeps opacity-based hover states working.
 */
const BRAND: Record<string, string> = {
  "/discord": "/brand/discord.svg",
  "/instagram": "/brand/instagram.svg",
  "/roblox": "/brand/roblox.svg",
  "/tiktok": "/brand/tiktok.svg",
  "/snapchat": "/brand/snapchat.svg",
  "/telegram": "/brand/telegram.svg",
  "/minecraft": "/brand/minecraft.svg",
}

/** Fallbacks so a new nav entry never renders without an icon. */
const FALLBACK: LucideIcon = AtSign

export function NavIcon({
  href,
  brand = false,
  className,
}: {
  href: string
  /**
   * Prefer the brand mark. Only the top-level platform rows opt in: a child
   * row such as Instagram's "Profile Lookup" shares its parent's href, and it
   * wants the generic lucide icon the web gives it (User / Mail / Phone),
   * not a second copy of the brand mark.
   */
  brand?: boolean
  className?: string
}) {
  const src = brand ? BRAND[href] : undefined
  if (src) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden="true"
        draggable={false}
        className={className}
      />
    )
  }
  const Icon = ICONS[href] ?? (href.includes("user") ? Users : FALLBACK)
  return <Icon className={className} aria-hidden="true" />
}
