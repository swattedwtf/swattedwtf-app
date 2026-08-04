import type { ModuleDescriptor } from "./types"

/**
 * Every lookup module the client can run.
 *
 * This list is the single source of truth for which nav rows are live:
 * `nav.ts` derives `isEnabled` from it, so a "soon" pill disappears exactly
 * when a module gains a descriptor and the two cannot drift apart.
 *
 * Empty for now. Discord is added by the next task, alone, because it is the
 * widest module and it proves the shared primitives before anything else is
 * written against them.
 */
export const MODULES: ModuleDescriptor[] = []

/** Screens that exist without a descriptor. */
const BUILT_IN_ROUTES = ["/dashboard", "/settings"]

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
