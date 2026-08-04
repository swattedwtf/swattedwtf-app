import { liveIntelligenceDescriptor } from "./streams/live-intelligence"
import { searchDescriptor } from "./streams/search"
import type { StreamModuleDescriptor } from "./stream-types"

/**
 * Every STREAMING screen the client can run.
 *
 * Kept separate from the one-shot module registry because these render over a
 * different transport (progressive SSE, not a single payload) and dispatch to
 * StreamScreen rather than ModuleScreen. `nav.ts` folds these routes into
 * `isEnabled` alongside the one-shot modules, so a streaming row goes live
 * exactly when its descriptor exists and cannot drift from a hand-kept list.
 */
export const STREAM_MODULES: StreamModuleDescriptor[] = [searchDescriptor, liveIntelligenceDescriptor]

/**
 * The streaming module owning a route, or undefined.
 *
 * Exact match, never a prefix test: `/search/evil` must not resolve to Search.
 */
export function streamModuleForRoute(route: string): StreamModuleDescriptor | undefined {
  return STREAM_MODULES.find((m) => m.route === route)
}

/** Every route with a streaming screen behind it. */
export function streamRoutes(): string[] {
  return STREAM_MODULES.map((m) => m.route)
}
