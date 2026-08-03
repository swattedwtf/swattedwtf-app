/** Display formatting shared across the dashboard cards. */

export function formatCount(n: number): string {
  return n.toLocaleString("en-US")
}

/**
 * Countdown to the monthly reset. Days while more than 24h remain, then hours
 * and minutes, then minutes. Never negative.
 */
export function formatResetIn(targetMs: number, nowMs: number = Date.now()): string {
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
export function formatSince(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
}
