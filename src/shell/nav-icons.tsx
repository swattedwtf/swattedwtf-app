import {
  AtSign,
  Bot,
  Code2,
  Fingerprint,
  FolderSearch,
  Footprints,
  Ghost,
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
  Send,
  Settings,
  ShieldAlert,
  Database,
  Blocks,
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

  "/discord": MessageCircle,
  "/instagram": User,
  "/instagram/share-resolver": Link2,
  "/roblox": User,
  "/roblox/scraper": Layers,
  "/roblox/server-intel": Radar,
  "/tiktok": User,
  "/tiktok/share-resolver": Link2,
  "/tiktok/phone": Phone,
  "/tiktok/email": Mail,
  "/snapchat": Ghost,
  "/snapchat/email": Mail,
  "/snapchat/phone": Phone,
  "/telegram": Send,
  "/telegram/phone": Phone,
  "/minecraft": Blocks,

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

/** Fallbacks so a new nav entry never renders without an icon. */
const FALLBACK: LucideIcon = AtSign

export function NavIcon({ href, className }: { href: string; className?: string }) {
  const Icon = ICONS[href] ?? (href.includes("user") ? Users : FALLBACK)
  return <Icon className={className} aria-hidden="true" />
}
