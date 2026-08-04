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

export const descriptor: ModuleDescriptor = {
  id: "snapchat",
  route: "/snapchat",
  label: "Snapchat",
  inputs: [
    {
      name: "query",
      label: "Username, email or phone",
      placeholder: "e.g. teamsnapchat, name@example.com, +14155550123",
      validate: (v) =>
        v.trim().length > 0 && v.trim().length <= 120
          ? null
          : "Enter a Snapchat username, email or phone number.",
    },
  ],
  Result,
}
