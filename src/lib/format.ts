/** Display formatting shared across the dashboard cards. */

/**
 * A count, or "" when there is not one.
 *
 * Total on purpose. This crashed the whole Settings screen with "cannot read
 * properties of undefined reading toLocaleString": a strict `=== null` guard
 * upstream let an UNDEFINED field through to `.toLocaleString()`, and a throw
 * inside React's render is a blank screen in a desktop app with no reachable
 * console. A formatter has no business being the thing that takes the window
 * down, so an absent value formats as nothing rather than as a crash or as a
 * fabricated zero.
 */
export function formatCount(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? n.toLocaleString("en-US") : ""
}

/**
 * Countdown to the monthly reset. Days while more than 24h remain, then hours
 * and minutes, then minutes. Never negative.
 */
export function formatResetIn(
  targetMs: number | null | undefined,
  nowMs: number = Date.now(),
): string {
  if (typeof targetMs !== "number" || !Number.isFinite(targetMs)) return ""
  const ms = Math.max(0, targetMs - nowMs)
  const minutes = Math.floor(ms / 60_000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days >= 1) return `${days}d`
  if (hours >= 1) return `${hours}h ${minutes % 60}m`
  return `${minutes}m`
}

/**
 * "Member since" style date. Pinned to UTC so the same account never reads as
 * two different days on two machines in different time zones.
 */
export function formatSince(iso: string | null | undefined): string {
  if (typeof iso !== "string" || iso.length === 0) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
}
