/**
 * Works out what kind of identifier the user just pasted into the quick bar.
 *
 * The whole point of the overlay is that you paste something and it knows what
 * to do with it, so the detection has to be decisive rather than asking. Order
 * matters: the checks run most-specific first, because several patterns overlap
 * (a Discord snowflake is also a run of digits, a URL contains a domain).
 */

export type IdentifierKind =
  | "discord"
  | "telegram"
  | "email"
  | "phone"
  | "ip"
  | "domain"
  | "username"

export type Identified = { kind: IdentifierKind; value: string }

const EMAIL = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/
/** Discord snowflakes are 17 to 20 digits. Shorter digit runs are not ids. */
const SNOWFLAKE = /^\d{17,20}$/
/** Only the international form, so a bare digit run is never guessed as a phone. */
const PHONE = /^\+[\d\s().-]{7,20}$/
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
const DOMAIN = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i
/** Handles as the major platforms allow them, plus a leading @ we strip. */
const USERNAME = /^@?[a-z0-9](?:[a-z0-9._-]{1,30})$/i

function isIpv4(value: string): boolean {
  const m = IPV4.exec(value)
  if (!m) return false
  return m.slice(1).every((octet) => {
    const n = Number(octet)
    // Reject "01" style octets as well as anything above 255.
    return n <= 255 && String(n) === octet.replace(/^0+(?=\d)/, "")
  })
}

/** Pulls the host out of anything that parses as a URL. */
function hostOf(value: string): string | null {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return null
  try {
    return new URL(value).hostname || null
  } catch {
    return null
  }
}

export function identify(raw: string): Identified | null {
  const value = raw.trim()
  if (!value) return null

  const host = hostOf(value)
  if (host) return { kind: "domain", value: host }

  if (EMAIL.test(value)) return { kind: "email", value }
  if (SNOWFLAKE.test(value)) return { kind: "discord", value }
  if (PHONE.test(value)) return { kind: "phone", value: value.replace(/[\s().-]/g, "") }
  if (isIpv4(value)) return { kind: "ip", value }
  if (DOMAIN.test(value)) return { kind: "domain", value }

  if (USERNAME.test(value)) return { kind: "username", value: value.replace(/^@/, "") }

  return null
}

/** Human label for each kind, shown next to the input. */
export const KIND_LABEL: Record<IdentifierKind, string> = {
  discord: "Discord ID",
  telegram: "Telegram",
  email: "Email",
  phone: "Phone",
  ip: "IP address",
  domain: "Domain",
  username: "Username",
}

const ORIGIN = "https://swattedw.tf"

/**
 * Where a given identifier should be looked up.
 *
 * These open the WEB dashboard rather than resolving in the app: the lookup
 * modules are not ported to the desktop client yet, and sending someone to a
 * working page beats showing them a native screen that cannot answer. When a
 * module does land natively, only this function changes.
 */
export function targetUrl({ kind, value }: Identified): string {
  const q = encodeURIComponent(value)
  switch (kind) {
    case "discord":
      return `${ORIGIN}/dashboard/discord?q=${q}`
    case "telegram":
      return `${ORIGIN}/dashboard/telegram?q=${q}`
    case "ip":
      return `${ORIGIN}/dashboard/network?q=${q}`
    case "domain":
      return `${ORIGIN}/dashboard/domain?q=${q}`
    case "phone":
    case "email":
    case "username":
    default:
      return `${ORIGIN}/dashboard/search?q=${q}`
  }
}
