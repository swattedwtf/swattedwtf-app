import { descriptor as discord } from "./discord"
import { descriptor as instagram, shareDescriptor as instagramShare } from "./instagram"
import { descriptor as machine } from "./machine"
import { descriptor as minecraft } from "./minecraft"
import { descriptor as roblox, scraperDescriptor as robloxScraper } from "./roblox"
import {
  descriptor as snapchat,
  emailDescriptor as snapchatEmail,
  phoneDescriptor as snapchatPhone,
} from "./snapchat"
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
  snapchatEmail,
  snapchatPhone,
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
 *
 * `/monitor` is here for the same reason and a stronger one. Monitor is a
 * subscription: the user registers an email and the server's scanner reports
 * back later. There is no query, no result to cache and nothing to meter, so it
 * talks to its own unmetered endpoint rather than the lookup one. It is still
 * Heist-gated server-side, exactly as the web's monitor routes are.
 *
 * `/investigations` is here for the same reason again: it is a case manager, not
 * a search. There is no target to look up, its server route is gated on the
 * ordinary signed-in mutation gate rather than the metered lookup gate, and its
 * screen is a list and a notepad rather than a form and a result.
 *
 * `/face` is here for a different reason: it IS a metered lookup, and a
 * credit-billed one, but its input is an image. ModuleScreen renders text
 * fields, and a descriptor whose only input is a file has no field to declare,
 * so it would have to lie about its inputs to be registered. It calls the same
 * `ipc.lookup` and reuses the same refusal panels; only the form is its own.
 *
 * `/roblox/server-intel` is the third Roblox leaf and the least module-like
 * screen in the app. It is a pairing SESSION: the operator mints a one-time
 * connector, runs it in their Roblox executor, and the screen then polls the
 * roster that connector reports. There is no text input to declare and nothing
 * metered to charge, so it talks to its own unmetered endpoint rather than the
 * lookup one. Minting a connector is still Heist-gated and rate-limited
 * server-side, exactly as the web's pair route is.
 */
export const BUILT_IN_ROUTES = [
  "/dashboard",
  "/settings",
  "/api",
  "/monitor",
  "/investigations",
  "/face",
  "/roblox/server-intel",
]

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
