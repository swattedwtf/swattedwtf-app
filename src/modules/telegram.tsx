import { Phone, Send } from "lucide-react"
import { ipc } from "../lib/ipc"
import { list, withDefaults } from "./safe"
import type { ModuleDescriptor, ResultProps } from "./types"
import { BadgeRow, EmptyState, FieldGrid, ProfileCard, Section } from "./ui"

/**
 * Telegram, both leaves.
 *
 * The two endpoints answer with different tagged unions and the server
 * normalises them into one model, so a single Result serves both and the two
 * screens cannot drift apart.
 *
 * Both are Heist-only server-side, so a lower plan never reaches this component:
 * ModuleScreen shows the upgrade panel instead.
 */

type TelegramData = {
  found: boolean
  privateAccount: boolean
  userId: number | null
  username: string | null
  name: string
  photoUrl: string | null
  hasPhoto: boolean
  photoHistory: string[]
  bio: string
  phone: string
  usernames: string[]
  lastSeen: string
  birthday: string
  personalChannel: { id: string; username: string; title: string; url: string | null } | null
  profileColor: number | null
  createdApprox: number | null
  flagsKnown: boolean
  flags: { premium: boolean; verified: boolean; scam: boolean; fake: boolean; bot: boolean }
}

function formatApprox(unixSeconds: number | null): string {
  if (!unixSeconds) return ""
  const at = new Date(unixSeconds * 1000)
  if (Number.isNaN(at.getTime())) return ""
  return `around ${at.toLocaleDateString(undefined, { year: "numeric", month: "long" })}`
}

export function Result({ data }: ResultProps) {
  const raw = withDefaults(data, {} as Partial<TelegramData>)
  const d: TelegramData = {
    ...(raw as TelegramData),
    found: raw.found === true,
    privateAccount: raw.privateAccount === true,
    flagsKnown: raw.flagsKnown === true,
    flags: withDefaults(raw.flags, {
      premium: false,
      verified: false,
      scam: false,
      fake: false,
      bot: false,
    }),
    photoHistory: list<string>(raw.photoHistory),
    usernames: list<string>(raw.usernames),
    personalChannel: raw.personalChannel ?? null,
  }

  if (!d.found) {
    return (
      <div className="space-y-4">
        <EmptyState
          message={
            d.privateAccount
              ? "That number is on Telegram, but the account does not expose a profile."
              : "No Telegram account found."
          }
        />
      </div>
    )
  }

  // Only rendered when the leaf actually carries flags. The phone leaf's union
  // arms have none, and showing "not verified" from a field that was never sent
  // states something we did not check.
  const badges = d.flagsKnown
    ? (
        [
          d.flags.premium && "Premium",
          d.flags.verified && "Verified",
          d.flags.scam && "Scam",
          d.flags.fake && "Fake",
          d.flags.bot && "Bot",
        ].filter(Boolean) as string[]
      ).map((label) => ({ label }))
    : []

  return (
    <div className="space-y-4">
      <ProfileCard
        avatarUrl={d.photoUrl}
        name={d.name || d.username || "Telegram user"}
        subtitle={d.username ? `@${d.username}` : null}
        meta={[
          { label: "User ID", value: d.userId ? String(d.userId) : "", mono: true },
          { label: "Phone", value: d.phone, mono: true },
          { label: "Created", value: formatApprox(d.createdApprox) },
        ]}
        badges={d.flagsKnown && badges.length > 0 ? <BadgeRow badges={badges} /> : null}
      >
        {d.bio ? (
          <p className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-white/70">
            {d.bio}
          </p>
        ) : null}
      </ProfileCard>

      <Section title="Profile">
        <FieldGrid
          fields={[
            { label: "Last seen", value: d.lastSeen },
            { label: "Birthday", value: d.birthday },
            { label: "Other usernames", value: d.usernames.map((u) => `@${u}`).join(", ") },
            {
              label: "Profile colour",
              value: d.profileColor === null ? "" : `#${d.profileColor}`,
            },
            // Absent flags are not "false". Say which it is.
            { label: "Account flags", value: d.flagsKnown ? undefined : "Not reported by this lookup" },
          ].filter((f) => f.value !== undefined)}
          hideEmpty
        />
      </Section>

      {d.personalChannel && (
        <Section title="Personal channel">
          <div className="flex items-center gap-2 text-[13px]">
            <span className="text-white/85">{d.personalChannel.title || "Channel"}</span>
            {d.personalChannel.username && (
              <span className="text-[var(--color-muted-foreground)]">
                @{d.personalChannel.username}
              </span>
            )}
            {d.personalChannel.url && (
              <button
                type="button"
                onClick={() => void ipc.openExternal(d.personalChannel!.url as string).catch(() => {})}
                className="btn-secondary btn-compact ml-auto"
              >
                Open
              </button>
            )}
          </div>
        </Section>
      )}

      <Section title="Previous photos">
        {d.photoHistory.length === 0 ? (
          <EmptyState message={d.hasPhoto ? "No older photos found." : "No profile photo."} />
        ) : (
          <p className="text-[13px] text-[var(--color-muted-foreground)]">
            {d.photoHistory.length} older {d.photoHistory.length === 1 ? "photo" : "photos"} on
            record.
          </p>
        )}
      </Section>

    </div>
  )
}

export const userDescriptor: ModuleDescriptor = {
  id: "telegram",
  route: "/telegram",
  label: "Telegram",
  icon: Send,
  brandSrc: "/brand/telegram.svg",
  description: "Look up a Telegram account by @username or numeric ID.",
  inputs: [
    {
      name: "query",
      label: "Username or ID",
      placeholder: "e.g. durov, or 1234567",
      validate: (v) => {
        // Mirrors the server's own normalisation: strip @ and any t.me wrapper,
        // then require an id or a handle.
        const s = v
          .trim()
          .replace(/^@/, "")
          .replace(/^https?:\/\/t\.me\//i, "")
          .replace(/^t\.me\//i, "")
        if (/^\d{1,15}$/.test(s) || /^[A-Za-z0-9_]{3,32}$/.test(s)) return null
        return "Enter a Telegram username or ID."
      },
    },
  ],
  Result,
}

export const phoneDescriptor: ModuleDescriptor = {
  id: "telegram-phone",
  route: "/telegram/phone",
  label: "Telegram phone lookup",
  icon: Phone,
  brandSrc: "/brand/telegram.svg",
  description: "Resolve a phone number to the linked Telegram account.",
  inputs: [
    {
      // The route's body key is `phone`, not `query`.
      name: "phone",
      label: "Phone number",
      placeholder: "e.g. +14155550123",
      validate: (v) => {
        const digits = v.replace(/[^\d]/g, "")
        return digits.length >= 7 && digits.length <= 15 ? null : "Enter a valid phone number."
      },
    },
  ],
  Result,
}
