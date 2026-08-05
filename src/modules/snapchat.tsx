import { Ghost, Mail, Phone } from "lucide-react"
import { ipc } from "../lib/ipc"
import { RemoteImage } from "./RemoteImage"
import { list, withDefaults } from "./safe"
import type { ModuleDescriptor, ResultProps } from "./types"
import { EmptyState, FieldGrid, ProfileCard, Section } from "./ui"

/**
 * Snapchat.
 *
 * One module for three sidebar leaves, because one route serves all three: the
 * server sniffs an email from a phone number from a username itself. The screen
 * therefore takes one field and says what it resolved from, rather than making
 * the user pick which kind of thing they are pasting.
 */

type SnapchatData = {
  kind: string
  query: string
  resolvedFrom: string | null
  resolutionError: string | null
  username: string
  found: boolean
  profile: {
    username: string
    displayName: string
    verified: boolean
    accountType: string
    userId: string
    subscriberCount: number
    createdAt: string
    accountAgeDays: number
    storyAvailable: boolean
    avatarUrl: string | null
    heroUrl: string | null
    snapcodePngUrl: string | null
    profileUrl: string | null
    addUrl: string | null
    storyUrl: string | null
    website: string | null
  }
  usernameHistory: string[]
  /**
   * Whether the email or phone could be resolved at all.
   *
   * "unavailable" means the resolver itself failed, which is NOT "no account is
   * linked to this contact". The screen must not turn the first into the second.
   */
  contactStatus: "found" | "not_found" | "unavailable" | null
}

function LinkRow({ label, url }: { label: string; url: string | null }) {
  if (!url) return null
  return (
    <button
      type="button"
      onClick={() => void ipc.openExternal(url).catch(() => {})}
      className="btn-secondary btn-compact"
    >
      {label}
    </button>
  )
}

const EMPTY_SC_PROFILE: SnapchatData["profile"] = {
  username: "",
  displayName: "",
  verified: false,
  accountType: "",
  userId: "",
  subscriberCount: 0,
  createdAt: "",
  accountAgeDays: 0,
  storyAvailable: false,
  avatarUrl: null,
  heroUrl: null,
  snapcodePngUrl: null,
  profileUrl: null,
  addUrl: null,
  storyUrl: null,
  website: null,
}

export function Result({ data }: ResultProps) {
  const raw = withDefaults(data, {} as Partial<SnapchatData>)
  const p = withDefaults(raw.profile, EMPTY_SC_PROFILE)
  const d: SnapchatData = {
    ...(raw as SnapchatData),
    profile: p,
    usernameHistory: list<string>(raw.usernameHistory),
    found: raw.found === true,
    contactStatus: (raw.contactStatus as SnapchatData["contactStatus"]) ?? null,
  }

  if (!d.found) {
    // Three different answers, and only one of them is "there is no account".
    // The resolver failing, and nobody being linked to a contact, were rendered
    // with the same sentence, which asserts something we never established.
    const message =
      d.contactStatus === "unavailable"
        ? "The Snapchat resolver could not be reached, so we cannot say whether an account is linked to that contact."
        : d.contactStatus === "not_found"
          ? "No Snapchat account is linked to that contact."
          : d.resolvedFrom
            ? `Resolved to @${d.username}, but no Snapchat profile came back.`
            : d.resolutionError || "No Snapchat account found for that query."

    return (
      <div className="space-y-4">
        <EmptyState message={message} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <ProfileCard
        avatarUrl={p.avatarUrl}
        name={p.displayName || p.username}
        subtitle={p.username ? `@${p.username}` : null}
        meta={[
          { label: "User ID", value: p.userId, mono: true },
          { label: "Account type", value: p.accountType },
          { label: "Verified", value: p.verified ? "Yes" : "" },
          {
            label: "Subscribers",
            value: p.subscriberCount > 0 ? p.subscriberCount.toLocaleString() : "",
          },
        ]}
      >
        {/* Only shown when the input was not already the username, so the user
            can see what their email or phone number resolved to. */}
        {d.resolvedFrom && (
          <p className="mt-3 text-[12px] text-[var(--color-muted-foreground)]">
            Resolved from {d.resolvedFrom}.
          </p>
        )}
      </ProfileCard>

      <Section title="Account">
        <FieldGrid
          fields={[
            { label: "Created", value: p.createdAt },
            {
              label: "Account age",
              value: p.accountAgeDays > 0 ? `${p.accountAgeDays.toLocaleString()} days` : "",
            },
            { label: "Story available", value: p.storyAvailable ? "Yes" : "No" },
          ]}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <LinkRow label="Open profile" url={p.profileUrl} />
          <LinkRow label="Add on Snapchat" url={p.addUrl} />
          <LinkRow label="Open story" url={p.storyUrl} />
          <LinkRow label="Website" url={p.website} />
        </div>
      </Section>

      {p.snapcodePngUrl && (
        <Section title="Snapcode">
          <RemoteImage
            url={p.snapcodePngUrl}
            alt={`Snapcode for ${p.username}`}
            className="h-40 w-40 rounded-xl bg-white/5"
          />
        </Section>
      )}

      <Section title="Username history">
        {d.usernameHistory.length === 0 ? (
          <EmptyState message="No previous usernames recorded." />
        ) : (
          <ul className="space-y-1 font-mono text-[12px] text-white/75">
            {d.usernameHistory.map((u) => (
              <li key={u}>@{u}</li>
            ))}
          </ul>
        )}
      </Section>

    </div>
  )
}

/** The server's QUERY_MAX, the same bound /api/snapchat/lookup enforces. */
const QUERY_MAX = 120

/** The server's EMAIL_RE, from lib/desktop/modules/snapchat.ts. */
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/**
 * `normalizePhone` from lib/phone-validation.ts, mirrored.
 *
 * Deliberately NOT the looser rule the TikTok module carries: that one accepts
 * a bare national number, and this server path refuses anything without an
 * explicit international prefix because it cannot guess a country code. Copying
 * the wrong sibling would let the client wave through a number the server then
 * rejects, after the gate has already metered the call.
 */
function normalizeSnapPhone(value: string): string | null {
  let s = value.trim()
  if (!s) return null
  if (s.startsWith("00")) s = "+" + s.slice(2)
  const hadPlus = s.startsWith("+")
  const digits = s.replace(/\D/g, "")
  if (!digits || !hadPlus) return null
  const e164 = "+" + digits
  return /^\+[1-9]\d{6,14}$/.test(e164) ? e164 : null
}

export const descriptor: ModuleDescriptor = {
  id: "snapchat",
  route: "/snapchat",
  label: "Snapchat",
  icon: Ghost,
  brandSrc: "/brand/snapchat.svg",
  description: "Look up a Snapchat profile by username.",
  inputs: [
    {
      name: "query",
      label: "Username, email or phone",
      placeholder: "e.g. teamsnapchat, name@example.com, +14155550123",
      validate: (v) =>
        v.trim().length > 0 && v.trim().length <= QUERY_MAX
          ? null
          : "Enter a Snapchat username, email or phone number.",
    },
  ],
  Result,
}

/**
 * Email to User and Phone to User.
 *
 * The same server module and the same `id`, because one route answers all three
 * categories: `detectSnapchatKind` sniffs the query itself. Giving these their
 * own module ids would split one lookup into three cache keys and three dedup
 * members, so a user who checked a number here and then on the web would pay
 * twice for one answer.
 *
 * What differs is the field. The web splits these into their own pages, and a
 * page that asks for an email should refuse a username rather than quietly run
 * a different lookup than the one its heading promised, so each validates for
 * its own kind instead of reusing the permissive combined rule above.
 */
export const emailDescriptor: ModuleDescriptor = {
  id: "snapchat",
  route: "/snapchat/email",
  label: "Snapchat email to user",
  icon: Mail,
  brandSrc: "/brand/snapchat.svg",
  description: "Resolve an email address to the linked Snapchat account.",
  inputs: [
    {
      name: "query",
      label: "Email address",
      placeholder: "e.g. name@example.com",
      validate: (v) => {
        const trimmed = v.trim()
        if (!trimmed || trimmed.length > QUERY_MAX || !EMAIL_RE.test(trimmed)) {
          return "Enter a valid email address."
        }
        return null
      },
    },
  ],
  Result,
}

export const phoneDescriptor: ModuleDescriptor = {
  id: "snapchat",
  route: "/snapchat/phone",
  label: "Snapchat phone to user",
  icon: Phone,
  brandSrc: "/brand/snapchat.svg",
  description: "Resolve a phone number to the linked Snapchat account.",
  inputs: [
    {
      name: "query",
      label: "Phone number",
      placeholder: "e.g. +14155550123",
      validate: (v) => {
        const trimmed = v.trim()
        if (!trimmed || trimmed.length > QUERY_MAX || normalizeSnapPhone(trimmed) === null) {
          return "Enter a phone number in full international format, starting with + and a country code."
        }
        return null
      },
    },
  ],
  Result,
}
