import { ipc } from "../lib/ipc"
import { RemoteImage } from "./RemoteImage"
import { list, withDefaults } from "./safe"
import type { ModuleDescriptor, ResultProps } from "./types"
import { BadgeRow, EmptyState, FieldGrid, LockedSection, ProfileCard, Section } from "./ui"

/**
 * Roblox, two of its three leaves.
 *
 * `roblox` is the profile lookup and `roblox-scraper` is the bulk sequential-ID
 * scan. The third leaf, Server Intel, is a pairing session rather than a
 * request/response lookup, so it has no descriptor here and stays on its "soon"
 * pill.
 *
 * Nothing here styles a container of its own. Everything is `ui/`.
 *
 * THE STEALER BLOCK IS HEIST ONLY. The server returns it empty with a 200 for
 * lower plans and sets `stealerLocked`, so an empty section here would read as
 * "we checked and found nothing" rather than "you cannot see this". That is why
 * the whole block renders a LockedSection when the flag is set, exactly as the
 * Discord screen gates its stealer data.
 */

const QUERY_MAX = 80

/** Same ceiling the server enforces on the scan amount. */
const SCRAPER_MAX_AMOUNT = 1_000_000

/** Mirrors the server's readInt: a decimal integer of up to 15 digits. */
const INT_15 = /^-?\d{1,15}$/

const STATUS_LABEL: Record<string, string> = {
  online: "Online",
  "in-game": "In game",
  studio: "In Studio",
  offline: "Offline",
}

// ---------------------------------------------------------------------------
// Profile leaf
// ---------------------------------------------------------------------------

type RobloxProfile = {
  id: string
  username: string
  displayName: string
  avatarUrl: string | null
  profileUrl: string | null
  status: string
  isVerified: boolean
  isPremium: boolean
  joined: string
  description: string
}

type StealerEntry = {
  id: string
  log_id: string
  url: string
  link: string | null
  domain: string[]
  username: string
  password: string
  indexed_at: string
}

type StealerVictim = {
  log_id: string
  machine_grant: string
  device_user_str: string[]
  device_ips: string[]
  device_emails_str: string[]
  discord_ids: string[]
  total_docs: number
  pwned_at: string
  indexed_at: string
}

type StealerBreach = {
  id: string
  email: string
  username: string
  password: string
  password_hash: string
  full_name: string
  phone_number: string
  ip: string
  dbname: string
  indexed_at: string
}

type RobloxData = {
  query: string
  found: boolean
  profile: RobloxProfile
  stats: { friends: number; followers: number; following: number }
  groups: { id: string; name: string; role: string; members: number; rank: number; iconUrl: string | null }[]
  badges: { id: string; name: string; description: string; awarded: string; rare: boolean }[]
  favorites: { id: string; name: string; creator: string; visits: number; thumbnailUrl: string | null }[]
  usernameHistory: { username: string; changedAt: string }[]
  linkedDiscord: { id: string; avatarUrl: string | null } | null
  stealer: {
    stealerEntries: StealerEntry[]
    victims: StealerVictim[]
    breaches: StealerBreach[]
  }
  stealerLocked: boolean
}

const EMPTY_ROBLOX_PROFILE: RobloxProfile = {
  id: "",
  username: "",
  displayName: "",
  avatarUrl: null,
  profileUrl: null,
  status: "offline",
  isVerified: false,
  isPremium: false,
  joined: "",
  description: "",
}

/** A stealer breach row, whichever of its optional fields the source filled. */
function breachLine(row: StealerBreach): string {
  return [row.email, row.username, row.full_name, row.phone_number, row.ip]
    .filter((v) => typeof v === "string" && v.length > 0)
    .join("  ")
}

export function Result({ data, partial }: ResultProps) {
  const raw = withDefaults(data, {} as Partial<RobloxData>)
  const p = withDefaults(raw.profile, EMPTY_ROBLOX_PROFILE)
  const stealerRaw = withDefaults(raw.stealer, {
    stealerEntries: [],
    victims: [],
    breaches: [],
  })
  const d: RobloxData = {
    ...(raw as RobloxData),
    query: typeof raw.query === "string" ? raw.query : "",
    found: raw.found === true,
    profile: p,
    stats: withDefaults(raw.stats, { friends: 0, followers: 0, following: 0 }),
    groups: list(raw.groups),
    badges: list(raw.badges),
    favorites: list(raw.favorites),
    usernameHistory: list(raw.usernameHistory),
    linkedDiscord: raw.linkedDiscord
      ? withDefaults(raw.linkedDiscord, { id: "", avatarUrl: null })
      : null,
    stealer: {
      stealerEntries: list<StealerEntry>(stealerRaw.stealerEntries),
      victims: list<StealerVictim>(stealerRaw.victims),
      breaches: list<StealerBreach>(stealerRaw.breaches),
    },
    stealerLocked: raw.stealerLocked === true,
  }

  if (!d.found) {
    return (
      <div className="space-y-4">
        <EmptyState
          message={
            d.query
              ? `No Roblox account resolves from "${d.query}".`
              : "No Roblox account found for that query."
          }
        />
        {partial.length > 0 && (
          <p className="px-1 text-[11px] text-[var(--color-muted-foreground)]">
            Some sources did not answer: {partial.join(", ")}.
          </p>
        )}
      </div>
    )
  }

  const accountBadges = [
    d.profile.isVerified && "Verified",
    d.profile.isPremium && "Premium",
  ]
    .filter((v): v is string => Boolean(v))
    .map((label) => ({ label }))

  const stealer = d.stealer

  return (
    <div className="space-y-4">
      <ProfileCard
        avatarUrl={p.avatarUrl}
        name={p.displayName || p.username || "Roblox user"}
        subtitle={p.username ? `@${p.username}` : null}
        meta={[
          { label: "User ID", value: p.id, mono: true },
          { label: "Status", value: STATUS_LABEL[p.status] ?? "Offline" },
          { label: "Joined", value: p.joined },
        ]}
        badges={accountBadges.length > 0 ? <BadgeRow badges={accountBadges} /> : null}
      >
        {p.description ? (
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-white/70">
            {p.description}
          </p>
        ) : null}
        {/* Opened in the browser, never in the webview. The server already put
            this through toSafeLinkUrl, so a null here means it was stripped. */}
        {p.profileUrl ? (
          <button
            type="button"
            onClick={() => void ipc.openExternal(p.profileUrl as string).catch(() => {})}
            className={`btn-secondary btn-compact ${p.description ? "mt-3" : ""}`}
          >
            Open profile
          </button>
        ) : null}
      </ProfileCard>

      <Section title="Stats">
        <FieldGrid
          fields={[
            { label: "Friends", value: d.stats.friends > 0 ? d.stats.friends.toLocaleString() : "" },
            { label: "Followers", value: d.stats.followers > 0 ? d.stats.followers.toLocaleString() : "" },
            { label: "Following", value: d.stats.following > 0 ? d.stats.following.toLocaleString() : "" },
          ]}
        />
      </Section>

      {d.linkedDiscord && (
        <Section title="Linked Discord">
          <div className="flex items-center gap-2.5">
            <RemoteImage
              url={d.linkedDiscord.avatarUrl}
              alt="Linked Discord"
              className="h-8 w-8 rounded-full"
            />
            <span className="font-mono text-[11px] text-[var(--color-muted-foreground)]">
              {d.linkedDiscord.id}
            </span>
          </div>
        </Section>
      )}

      <Section title={`Groups${d.groups.length ? ` (${d.groups.length})` : ""}`}>
        {d.groups.length === 0 ? (
          <EmptyState message="No groups found." />
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {d.groups.map((g, i) => (
              <li key={g.id || i} className="flex items-center gap-2.5">
                <RemoteImage
                  url={g.iconUrl}
                  alt={g.name}
                  className="h-8 w-8 shrink-0 rounded-lg text-[11px]"
                />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] text-white/85">
                    {g.name || "Unnamed group"}
                  </span>
                  <span className="block truncate text-[11px] text-[var(--color-muted-foreground)]">
                    {[g.role, g.members > 0 ? `${g.members.toLocaleString()} members` : ""]
                      .filter(Boolean)
                      .join("  ") || "No role recorded"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Badges${d.badges.length ? ` (${d.badges.length})` : ""}`}>
        {d.badges.length === 0 ? (
          <EmptyState message="No badges found." />
        ) : (
          <BadgeRow
            badges={d.badges.map((b) => ({
              label: b.name || "Badge",
              title: b.description || (b.rare ? "Rare badge" : b.name),
            }))}
          />
        )}
      </Section>

      <Section title={`Favorite games${d.favorites.length ? ` (${d.favorites.length})` : ""}`}>
        {d.favorites.length === 0 ? (
          <EmptyState message="No favorite games found." />
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {d.favorites.map((f, i) => (
              <li key={f.id || i} className="flex items-center gap-2.5">
                <RemoteImage
                  url={f.thumbnailUrl}
                  alt={f.name}
                  className="h-8 w-8 shrink-0 rounded-lg text-[11px]"
                />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] text-white/85">
                    {f.name || "Untitled game"}
                  </span>
                  <span className="block truncate text-[11px] text-[var(--color-muted-foreground)]">
                    {[f.creator, f.visits > 0 ? `${f.visits.toLocaleString()} visits` : ""]
                      .filter(Boolean)
                      .join("  ") || "No details"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Username history">
        {d.usernameHistory.length === 0 ? (
          <EmptyState message="No previous usernames recorded." />
        ) : (
          <FieldGrid
            fields={d.usernameHistory.map((h, i) => ({
              label: h.changedAt || `Change ${i + 1}`,
              value: h.username,
              mono: true,
            }))}
          />
        )}
      </Section>

      {/* The whole stealer block is Heist-gated. When it is locked the server
          returns it empty with a 200, so a single LockedSection stands in for
          all three sub-sections rather than three "nothing found" states. */}
      {d.stealerLocked ? (
        <Section title="Stealer intelligence">
          <LockedSection
            title="Stealer intelligence"
            message="Swatted Heist unlocks compromised accounts, device victims and breach records for this user."
          />
        </Section>
      ) : (
        <>
          <Section
            title={`Compromised accounts${
              stealer.stealerEntries.length ? ` (${stealer.stealerEntries.length})` : ""
            }`}
          >
            {stealer.stealerEntries.length === 0 ? (
              <EmptyState message="No compromised accounts found." />
            ) : (
              <ul className="space-y-2 text-[12px]">
                {stealer.stealerEntries.slice(0, 50).map((e, i) => (
                  <li key={e.id || i} className="min-w-0">
                    <div className="flex items-center gap-2">
                      {/* The URL is kept as text beside its sanitised href: a
                          stealer URL is frequently not http at all, and dropping
                          it because it cannot be an anchor loses the answer. A
                          null link means the server stripped it. */}
                      {e.link ? (
                        <button
                          type="button"
                          onClick={() => void ipc.openExternal(e.link as string).catch(() => {})}
                          className="truncate text-left font-mono text-white/85 underline decoration-white/20 underline-offset-2 hover:decoration-white/60"
                        >
                          {e.url || e.link}
                        </button>
                      ) : (
                        <span className="truncate font-mono text-white/70">
                          {e.url || "No URL recorded"}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[11px] text-[var(--color-muted-foreground)]">
                      {[e.username, e.password, e.indexed_at].filter(Boolean).join("  ") ||
                        "No credentials recorded"}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title={`Device victims${stealer.victims.length ? ` (${stealer.victims.length})` : ""}`}
          >
            {stealer.victims.length === 0 ? (
              <EmptyState message="No compromised devices found." />
            ) : (
              <FieldGrid
                fields={stealer.victims.slice(0, 25).map((v, i) => ({
                  label: v.pwned_at || v.indexed_at || `Device ${i + 1}`,
                  value:
                    [
                      v.device_user_str.join(", "),
                      v.device_ips.join(", "),
                      v.total_docs > 0 ? `${v.total_docs.toLocaleString()} docs` : "",
                    ]
                      .filter(Boolean)
                      .join("  ") || v.log_id,
                  mono: true,
                }))}
              />
            )}
          </Section>

          <Section
            title={`Breach records${stealer.breaches.length ? ` (${stealer.breaches.length})` : ""}`}
          >
            {stealer.breaches.length === 0 ? (
              <EmptyState message="No breach records found." />
            ) : (
              <ul className="space-y-1 font-mono text-[11px] leading-relaxed text-white/70">
                {stealer.breaches.slice(0, 50).map((b, i) => (
                  <li key={b.id || i} className="truncate">
                    {breachLine(b) || "Record with no readable fields"}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}

      {partial.length > 0 && (
        <p className="px-1 text-[11px] text-[var(--color-muted-foreground)]">
          Some sources did not answer: {partial.join(", ")}.
        </p>
      )}
    </div>
  )
}

export const descriptor: ModuleDescriptor = {
  id: "roblox",
  route: "/roblox",
  label: "Roblox",
  inputs: [
    {
      name: "query",
      label: "Username or user ID",
      placeholder: "e.g. builderman, or 156",
      // Mirrors the server's bound: non-empty, at most 80 characters. The server
      // makes no further shape check, since a bare digit string is a user ID and
      // anything else is a username.
      validate: (v) =>
        v.trim().length > 0 && v.trim().length <= QUERY_MAX
          ? null
          : "Enter a Roblox username or user ID.",
    },
  ],
  Result,
}

// ---------------------------------------------------------------------------
// Scraper leaf
// ---------------------------------------------------------------------------

type RobloxScrapeData = {
  entries: {
    userId: number
    username: string
    displayName: string
    verified: boolean
    deleted: boolean
    status: string
    profileUrl: string | null
  }[]
  scanned: number
  matched: number
  capped: boolean
}

export function ScraperResult({ data, partial }: ResultProps) {
  const raw = withDefaults(data, {} as Partial<RobloxScrapeData>)
  const d: RobloxScrapeData = {
    entries: list(raw.entries),
    scanned: typeof raw.scanned === "number" ? raw.scanned : 0,
    matched: typeof raw.matched === "number" ? raw.matched : 0,
    capped: raw.capped === true,
  }

  return (
    <div className="space-y-4">
      <Section title="Scan">
        <FieldGrid
          fields={[
            { label: "Scanned", value: d.scanned > 0 ? d.scanned.toLocaleString() : "" },
            { label: "Matched", value: d.matched > 0 ? d.matched.toLocaleString() : "0" },
          ]}
        />
        {/* A truncated scan reads as a complete one unless we say otherwise. */}
        {d.capped && (
          <p className="mt-3 text-[12px] text-[var(--color-muted-foreground)]">
            This scan hit the server's scan cap, so it was truncated. Some accounts in the requested
            range were not visited.
          </p>
        )}
      </Section>

      <Section title={`Matches${d.entries.length ? ` (${d.entries.length})` : ""}`}>
        {d.entries.length === 0 ? (
          <EmptyState message="No accounts matched the filters in the scanned range." />
        ) : (
          <ul className="space-y-2 text-[13px]">
            {d.entries.map((e, i) => (
              <li key={e.userId || i} className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-[var(--color-muted-foreground)]">
                  {e.userId > 0 ? e.userId.toLocaleString() : "?"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-white/85">
                    {e.displayName || e.username || "Unnamed account"}
                    {e.username && e.displayName && e.username !== e.displayName ? (
                      <span className="ml-1.5 text-[var(--color-muted-foreground)]">
                        @{e.username}
                      </span>
                    ) : null}
                  </span>
                  {(e.verified || e.deleted || e.status) && (
                    <span className="block truncate text-[11px] text-[var(--color-muted-foreground)]">
                      {[e.verified ? "Verified" : "", e.deleted ? "Deleted" : "", e.status]
                        .filter(Boolean)
                        .join("  ")}
                    </span>
                  )}
                </span>
                {e.profileUrl ? (
                  <button
                    type="button"
                    onClick={() => void ipc.openExternal(e.profileUrl as string).catch(() => {})}
                    className="btn-secondary btn-compact shrink-0"
                  >
                    Open
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {partial.length > 0 && (
        <p className="px-1 text-[11px] text-[var(--color-muted-foreground)]">
          Some sources did not answer: {partial.join(", ")}.
        </p>
      )}
    </div>
  )
}

/** A required integer field, mirroring the server's readInt plus a lower bound. */
function intField(v: string, min: number, max: number, message: string): string | null {
  const s = v.trim()
  if (!INT_15.test(s)) return message
  const n = Number.parseInt(s, 10)
  if (n < min || n > max) return message
  return null
}

export const scraperDescriptor: ModuleDescriptor = {
  id: "roblox-scraper",
  route: "/roblox/scraper",
  label: "Roblox Profile Scraper",
  // Values are sent as strings, so the two toggles are the literal strings
  // "true" and "false". Every field mirrors the server's own validate() bounds
  // so an input that cannot succeed never becomes a metered scan.
  inputs: [
    {
      name: "startId",
      label: "Starting user ID",
      placeholder: "e.g. 1",
      validate: (v) => intField(v, 1, 999_999_999_999_999, "Enter a valid starting user ID."),
    },
    {
      name: "amount",
      label: "Amount to scan",
      placeholder: "e.g. 1000",
      validate: (v) =>
        intField(v, 1, SCRAPER_MAX_AMOUNT, "Enter an amount between 1 and 1,000,000."),
    },
    {
      name: "keywords",
      label: "Keywords (comma separated, optional)",
      placeholder: "e.g. admin, mod",
      optional: true,
      validate: (v) => {
        const s = v.trim()
        if (s.length === 0) return null
        return s.length <= 512 ? null : "Keywords are too long (512 characters max)."
      },
    },
    {
      name: "startsWith",
      label: "Username starts with (optional)",
      placeholder: "e.g. the",
      optional: true,
      validate: (v) => {
        const s = v.trim()
        if (s.length === 0) return null
        return s.length <= 64 ? null : "Prefix is too long (64 characters max)."
      },
    },
    {
      name: "endsWith",
      label: "Username ends with (optional)",
      placeholder: "e.g. yt",
      optional: true,
      validate: (v) => {
        const s = v.trim()
        if (s.length === 0) return null
        return s.length <= 64 ? null : "Suffix is too long (64 characters max)."
      },
    },
    {
      name: "exactLength",
      label: "Exact username length (optional)",
      placeholder: "leave blank to disable",
      // The server reads blank, 0 or any negative as "disabled"; a positive
      // integer is the exact length.
      optional: true,
      validate: (v) =>
        v.trim().length === 0
          ? null
          : intField(v, -999_999_999_999_999, 999_999_999_999_999, "Enter a number, or leave blank."),
    },
    {
      name: "showDeleted",
      label: 'Include deleted accounts ("true" or "false", optional)',
      placeholder: "false",
      optional: true,
      validate: (v) => {
        const s = v.trim()
        // Blank means the server's own default, which is false.
        if (s.length === 0) return null
        return s === "true" || s === "false" ? null : 'Enter "true" or "false".'
      },
    },
    {
      name: "showStatus",
      label: 'Fetch presence status ("true" or "false", optional)',
      placeholder: "false",
      optional: true,
      validate: (v) => {
        const s = v.trim()
        // Blank means the server's own default, which is false.
        if (s.length === 0) return null
        return s === "true" || s === "false" ? null : 'Enter "true" or "false".'
      },
    },
  ],
  Result: ScraperResult,
}
