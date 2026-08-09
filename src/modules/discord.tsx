import { MessageCircle } from "lucide-react"
import { ipc } from "../lib/ipc"
import { RemoteImage } from "./RemoteImage"
import { list, rows, withDefaults } from "./safe"
import type { ModuleDescriptor, ResultProps } from "./types"
import { BadgeRow, EmptyState, FieldGrid, LockedSection, ProfileCard, Section } from "./ui"

/**
 * Discord.
 *
 * The widest module: seven providers behind one server call, two sections the
 * account may not be allowed to see, and the most fields of anything in the
 * Platforms group. It is built first and alone precisely because if the shared
 * primitives can express this, they can express the other fifteen.
 *
 * Nothing here styles a container of its own. Everything is `ui/`.
 */

const DISCORD_ID = /^\d{14,19}$/

type Profile = {
  id: string
  username: string
  displayName: string
  bio: string
  avatarUrl: string | null
  bannerUrl: string | null
  accentColor: string | null
  createdAt: string | null
}

type DiscordData = {
  profile: Profile
  badges: { label: string; iconUrl: string | null }[]
  connections: { type: string; name: string; url: string | null }[]
  servers: { id: string; name: string; iconUrl: string | null; members: number }[]
  usernameHistory: { username: string; date: string }[] | null
  historyUnavailable: boolean
  breaches: Record<string, unknown>[]
  moderation: Record<string, unknown>[]
  stealerLogs: Record<string, unknown>[]
  stealerLocked: boolean
  alts: string[]
  vpnAttempts: number
  messages: { total: number; items: Record<string, unknown>[] }
  /** IP, email and source, when the plan and the provider both allowed it. */
  osint: { ipAddress: string | null; email: string | null; source: string | null } | null
  /** False when the alt-account scan never ran, which is not "no alts". */
  altsChecked: boolean
}

function formatDate(iso: string | null): string {
  if (!iso) return ""
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ""
  return at.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

/** A breach row, whichever of its many optional fields the source filled in. */
function breachLine(row: Record<string, unknown>): string {
  const parts = [row.email, row.username, row.full_name, row.phone_number, row.ip]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
  return parts.join("  ")
}

const EMPTY_PROFILE: Profile = {
  id: "",
  username: "",
  displayName: "",
  bio: "",
  avatarUrl: null,
  bannerUrl: null,
  accentColor: null,
  createdAt: null,
}

/** A small "this section's source failed" note, so a section that could not be
 *  fetched reads as an outage to retry rather than as a clean "nothing found". */
function FailedNote() {
  return (
    <p className="text-[12px] text-[var(--color-muted-foreground)]">
      This source did not respond. Try the lookup again.
    </p>
  )
}

export function Result({ data, partial }: ResultProps) {
  const failed = (name: string) => Array.isArray(partial) && partial.includes(name)
  const raw = withDefaults(data, {} as Partial<DiscordData>)
  const p = withDefaults(raw.profile, EMPTY_PROFILE)
  const d: DiscordData = {
    ...(raw as DiscordData),
    profile: p,
    badges: rows(raw.badges),
    connections: rows(raw.connections),
    servers: rows(raw.servers),
    breaches: rows(raw.breaches),
    moderation: rows(raw.moderation),
    stealerLogs: rows(raw.stealerLogs),
    alts: list(raw.alts),
    usernameHistory: raw.usernameHistory === null ? null : rows(raw.usernameHistory),
    messages: withDefaults(raw.messages, { total: 0, items: [] }),
    vpnAttempts: typeof raw.vpnAttempts === "number" ? raw.vpnAttempts : 0,
    historyUnavailable: raw.historyUnavailable === true,
    stealerLocked: raw.stealerLocked === true,
    altsChecked: raw.altsChecked === true,
    osint: (raw.osint as DiscordData["osint"]) ?? null,
  }

  return (
    <div className="space-y-4">
      <ProfileCard
        avatarUrl={p.avatarUrl}
        name={p.displayName || p.username || "Unknown"}
        subtitle={p.username ? `@${p.username}` : null}
        meta={[
          { label: "User ID", value: p.id, mono: true },
          { label: "Created", value: formatDate(p.createdAt) },
          { label: "Accent", value: p.accentColor, mono: true },
        ]}
        badges={d.badges.length > 0 ? <BadgeRow badges={d.badges} /> : null}
      >
        {p.bio ? (
          <p className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-white/70">
            {p.bio}
          </p>
        ) : null}
      </ProfileCard>

      {d.connections.length > 0 && (
        <Section title="Connections">
          <ul className="space-y-1.5">
            {d.connections.map((c, i) => (
              <li key={`${c.type}-${c.name}-${i}`} className="flex items-center gap-2 text-[13px]">
                <span className="min-w-[84px] text-[var(--color-muted-foreground)]">{c.type}</span>
                {/* Opened in the browser, never in the webview, and only after
                    open_external's own host allowlist agrees. The URL already
                    survived toSafeLinkUrl on the server. */}
                {c.url ? (
                  <button
                    type="button"
                    onClick={() => void ipc.openExternal(c.url as string).catch(() => {})}
                    className="truncate text-left text-white/85 underline decoration-white/20 underline-offset-2 hover:decoration-white/60"
                  >
                    {c.name || c.url}
                  </button>
                ) : (
                  <span className="truncate text-white/85">{c.name}</span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Shown only when it says something: an "unavailable" (the provider is
          frequently down, which is not the same as "none") or actual history.
          A clean "answered and had none" hides, per hide-empty. */}
      {(d.historyUnavailable || (d.usernameHistory && d.usernameHistory.length > 0)) && (
        <Section title="Username history">
          {d.historyUnavailable ? (
            <EmptyState message="Username history is unavailable right now." />
          ) : (
            <FieldGrid
              fields={(d.usernameHistory ?? []).map((h) => ({
                label: h.date || "Unknown date",
                value: h.username,
                mono: true,
              }))}
            />
          )}
        </Section>
      )}

      {d.servers.length > 0 && (
        <Section title={`Servers (${d.servers.length})`}>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {d.servers.map((s) => (
              <li key={s.id} className="flex items-center gap-2.5">
                <RemoteImage
                  url={s.iconUrl}
                  alt={s.name}
                  className="h-8 w-8 shrink-0 rounded-lg text-[11px]"
                />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] text-white/85">{s.name}</span>
                  {s.members > 0 && (
                    <span className="block text-[11px] text-[var(--color-muted-foreground)]">
                      {s.members.toLocaleString()} members
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* The web's highest-value panel, which the desktop dropped entirely. */}
      {d.osint && (
        <Section title="Exposed contact">
          <FieldGrid
            fields={[
              { label: "IP address", value: d.osint.ipAddress, mono: true },
              { label: "Email", value: d.osint.email, mono: true },
              { label: "Source", value: d.osint.source },
            ]}
          />
        </Section>
      )}

      {/* Alt accounts: shown only when the scan actually ran and found alts or
          VPN attempts. A scan that did not run is not "no results", so it stays;
          a clean checked-and-empty hides. */}
      {(!d.altsChecked || d.alts.length > 0 || d.vpnAttempts > 0) && (
        <Section title="Alt accounts">
          {!d.altsChecked ? (
            <EmptyState message="The alt-account scan did not run, so nothing can be said about linked accounts." />
          ) : (
            <FieldGrid
              fields={[
                { label: "Linked alts", value: d.alts.length > 0 ? d.alts.join(", ") : "", mono: true },
                { label: "VPN attempts", value: d.vpnAttempts > 0 ? String(d.vpnAttempts) : "" },
              ]}
            />
          )}
        </Section>
      )}

      {/* Breaches: has-data shows; a failed source shows a retry note (so a
          capped upstream is not misread as "none"); a genuine empty hides. */}
      {(d.breaches.length > 0 || failed("breachSearch")) && (
        <Section title={`Breaches${d.breaches.length ? ` (${d.breaches.length})` : ""}`}>
          {d.breaches.length === 0 ? (
            <FailedNote />
          ) : (
            <ul className="space-y-1 font-mono text-[11px] leading-relaxed text-white/70">
              {d.breaches.slice(0, 50).map((b, i) => (
                <li key={i} className="truncate">
                  {breachLine(b) || "Record with no readable fields"}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {/* Compromised devices: locked (a real state) stays; has-data shows; a
          failed source shows a retry note; a genuine empty hides. */}
      {(d.stealerLocked || d.stealerLogs.length > 0 || failed("stealerLogs")) && (
        <Section title="Compromised devices">
          {d.stealerLocked ? (
            <LockedSection
              title="Compromised devices"
              message="Swatted Heist unlocks compromised-device records for this account."
            />
          ) : d.stealerLogs.length === 0 ? (
            <FailedNote />
          ) : (
            <FieldGrid
              fields={d.stealerLogs.slice(0, 25).map((s, i) => ({
                label: String(s.pwned_at ?? s.indexed_at ?? `Record ${i + 1}`),
                value: String(s.log_id ?? ""),
                mono: true,
              }))}
            />
          )}
        </Section>
      )}

      {d.messages.total > 0 && (
        <Section title={`Indexed messages (${d.messages.total})`}>
          <p className="text-[13px] text-[var(--color-muted-foreground)]">
            {d.messages.total.toLocaleString()} messages are indexed for this account.
          </p>
        </Section>
      )}

    </div>
  )
}

export const descriptor: ModuleDescriptor = {
  id: "discord",
  route: "/discord",
  label: "Discord",
  icon: MessageCircle,
  brandSrc: "/brand/discord.svg",
  description: "Resolve Discord users into profiles, servers, and connected intel.",
  inputs: [
    {
      name: "userId",
      label: "Discord user ID",
      placeholder: "e.g. 175928847299117063",
      // Mirrors the server's own bound so an input that cannot succeed never
      // becomes a metered request. The server is still the authority.
      validate: (v) =>
        DISCORD_ID.test(v.trim()) ? null : "Enter a Discord user ID (14 to 19 digits).",
    },
  ],
  Result,
}
