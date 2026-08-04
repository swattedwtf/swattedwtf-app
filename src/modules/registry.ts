import { descriptor as discord } from "./discord"
import { descriptor as instagram, shareDescriptor as instagramShare } from "./instagram"
import { descriptor as machine } from "./machine"
import { descriptor as minecraft } from "./minecraft"
import { descriptor as roblox, scraperDescriptor as robloxScraper } from "./roblox"
import { descriptor as snapchat } from "./snapchat"
import { phoneDescriptor as telegramPhone, userDescriptor as telegram } from "./telegram"
import {
  descriptor as tiktok,
  emailDescriptor as tiktokEmail,
  phoneDescriptor as tiktokPhone,
  shareDescriptor as tiktokShare,
} from "./tiktok"
import {
  addressInsightsDescriptor,
  cobraDescriptor,
  falconDescriptor,
  intelxDescriptor,
  samsungDescriptor,
  skiptracerDescriptor,
} from "./tools"
import type { ModuleDescriptor } from "./types"

/**
 * Every lookup module the client can run.
 *
 * This list is the single source of truth for which nav rows are live:
 * `nav.ts` derives `isEnabled` from it, so a "soon" pill disappears exactly
 * when a module gains a descriptor and the two cannot drift apart.
 *
 * Discord came first and alone: it is the widest module, so building it before
 * anything else proved the shared primitives could carry the rest.
 */
export const MODULES: ModuleDescriptor[] = [
  discord,
  snapchat,
  telegram,
  telegramPhone,
  minecraft,
  machine,
  instagram,
  instagramShare,
  tiktok,
  tiktokShare,
  tiktokPhone,
  tiktokEmail,
  roblox,
  robloxScraper,
  // The Tools group. Six single-call modules that share a provider family and a
  // Heist-only gate, and one file, exactly as the server keeps them.
  samsungDescriptor,
  skiptracerDescriptor,
  addressInsightsDescriptor,
  falconDescriptor,
  intelxDescriptor,
  cobraDescriptor,
]

/**
 * Screens that exist without a descriptor.
 *
 * `/api` is here rather than in MODULES because API Access is not a lookup: it
 * has no inputs, no server module and no metered call. Everything it renders is
 * already in the Overview the app fetches at boot, so routing it through
 * ModuleScreen would mean inventing a module id the server would reject.
 */
export const BUILT_IN_ROUTES = ["/dashboard", "/settings", "/api"]

/**
 * The module owning a route, or undefined.
 *
 * Exact match, never a prefix test, for the same reason `isEnabled` is exact:
 * `/discord/evil` must not resolve to the Discord module.
 */
export function moduleForRoute(route: string): ModuleDescriptor | undefined {
  return MODULES.find((m) => m.route === route)
}

/** Every route with a real screen behind it: the built-ins plus the registry. */
export function enabledRoutes(): string[] {
  return [...BUILT_IN_ROUTES, ...MODULES.map((m) => m.route)]
}
