import { Blocks } from "lucide-react"
import { ipc } from "../lib/ipc"
import { RemoteImage } from "./RemoteImage"
import { rows, withDefaults } from "./safe"
import type { ModuleDescriptor, ResultProps } from "./types"
import { EmptyState, FieldGrid, ProfileCard, Section } from "./ui"

/**
 * Minecraft.
 *
 * One field, four kinds of answer: the server decides whether the query is a
 * username, a UUID, an email or an IP, so the screen reports which it chose
 * rather than asking the user to say.
 */

type MinecraftData = {
  query: string
  queryType: string
  profile: {
    username: string
    uuid: string
    uuidShort: string
    premium: boolean
    avatarUrl: string | null
    nameHistory: { username: string; changedAt: string | null }[]
  } | null
  avatars: { label: string; url: string | null }[]
  socials: { platform: string; value: string; url: string | null }[]
  discord: { id: string; username: string; avatarUrl: string | null } | null
  breaches: {
    username: string | null
    email: string | null
    ip: string | null
    password: string | null
    source: string | null
  }[]
  breachCount: number
}

const QUERY_TYPE_LABEL: Record<string, string> = {
  username: "username",
  uuid: "UUID",
  email: "email address",
  ip: "IP address",
}

export function Result({ data }: ResultProps) {
  const raw = withDefaults(data, {} as Partial<MinecraftData>)
  const d: MinecraftData = {
    ...(raw as MinecraftData),
    queryType: typeof raw.queryType === "string" ? raw.queryType : "username",
    avatars: rows(raw.avatars),
    socials: rows(raw.socials),
    breaches: rows(raw.breaches),
    breachCount: typeof raw.breachCount === "number" ? raw.breachCount : 0,
    profile: raw.profile
      ? withDefaults(raw.profile, {
          username: "",
          uuid: "",
          uuidShort: "",
          premium: false,
          avatarUrl: null,
          nameHistory: [],
        })
      : null,
    discord: raw.discord ? withDefaults(raw.discord, { id: "", username: "", avatarUrl: null }) : null,
  }
  const p = d.profile
    ? { ...d.profile, nameHistory: rows<{ username: string; changedAt: string | null }>(d.profile.nameHistory) }
    : null

  return (
    <div className="space-y-4">
      {p ? (
        <ProfileCard
          avatarUrl={p.avatarUrl}
          name={p.username}
          subtitle={p.uuid}
          meta={[
            { label: "UUID", value: p.uuid, mono: true },
            { label: "Short UUID", value: p.uuidShort, mono: true },
            { label: "Account", value: p.premium ? "Premium" : "" },
          ]}
        />
      ) : (
        // An email or IP query resolves no profile at all: the answer is the
        // breach list. Saying so beats an empty profile card.
        <EmptyState
          message={`No Minecraft profile resolves from that ${
            QUERY_TYPE_LABEL[d.queryType] ?? "query"
          }.`}
        />
      )}

      {p && p.nameHistory.length > 0 && (
        <Section title="Name history">
          <FieldGrid
            fields={p.nameHistory.map((n) => ({
              label: n.changedAt ?? "Original",
              value: n.username,
              mono: true,
            }))}
          />
        </Section>
      )}

      {d.avatars.length > 0 && (
        <Section title="Renders">
          <div className="flex flex-wrap gap-3">
            {d.avatars.map((a) => (
              <span key={a.label} className="text-center">
                <RemoteImage
                  url={a.url}
                  alt={a.label}
                  name={p?.username ?? a.label}
                  className="h-16 w-16 rounded-lg bg-white/5"
                />
                <span className="mt-1 block text-[10px] text-[var(--color-muted-foreground)]">
                  {a.label}
                </span>
              </span>
            ))}
          </div>
        </Section>
      )}

      {d.discord && (
        <Section title="Linked Discord">
          <div className="flex items-center gap-2.5">
            <RemoteImage
              url={d.discord.avatarUrl}
              alt={d.discord.username}
              className="h-8 w-8 rounded-full"
            />
            <span className="text-[13px] text-white/85">{d.discord.username}</span>
            <span className="font-mono text-[11px] text-[var(--color-muted-foreground)]">
              {d.discord.id}
            </span>
          </div>
        </Section>
      )}

      {d.socials.length > 0 && (
        <Section title="Socials">
          <ul className="space-y-1.5 text-[13px]">
            {d.socials.map((s, i) => (
              <li key={`${s.platform}-${i}`} className="flex items-center gap-2">
                <span className="min-w-[84px] text-[var(--color-muted-foreground)]">
                  {s.platform}
                </span>
                {/* Linked only when the server could sanitise it into an http(s)
                    URL; otherwise the value is a bare handle, not a link. */}
                {s.url ? (
                  <button
                    type="button"
                    onClick={() => void ipc.openExternal(s.url as string).catch(() => {})}
                    className="truncate text-left text-white/85 underline decoration-white/20 underline-offset-2 hover:decoration-white/60"
                  >
                    {s.value}
                  </button>
                ) : (
                  <span className="truncate text-white/85">{s.value}</span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={`Breaches${d.breachCount ? ` (${d.breachCount})` : ""}`}>
        {d.breaches.length === 0 ? (
          <EmptyState message="No breach records found." />
        ) : (
          <ul className="space-y-1 font-mono text-[11px] leading-relaxed text-white/70">
            {d.breaches.slice(0, 50).map((b, i) => (
              <li key={i} className="truncate">
                {[b.username, b.email, b.ip, b.source].filter(Boolean).join("  ") ||
                  "Record with no readable fields"}
              </li>
            ))}
          </ul>
        )}
      </Section>

    </div>
  )
}

export const descriptor: ModuleDescriptor = {
  id: "minecraft",
  route: "/minecraft",
  label: "Minecraft",
  icon: Blocks,
  brandSrc: "/brand/minecraft.svg",
  description: "Search by username, UUID, email or IP to resolve profiles, avatars, and linked intel.",
  inputs: [
    {
      name: "query",
      label: "Username, UUID, email or IP",
      placeholder: "e.g. Notch, 069a79f4-44e9-4726-a5be-fca90e38aaf5",
      validate: (v) =>
        v.trim().length > 0 && v.trim().length <= 100
          ? null
          : "Enter a Minecraft username, UUID, email or IP.",
    },
  ],
  Result,
}
