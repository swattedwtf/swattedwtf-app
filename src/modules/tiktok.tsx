import { ipc } from "../lib/ipc"
import { RemoteImage } from "./RemoteImage"
import { list, withDefaults } from "./safe"
import type { ModuleDescriptor, ResultProps } from "./types"
import { BadgeRow, EmptyState, FieldGrid, ProfileCard, Section } from "./ui"

/**
 * TikTok, all four leaves.
 *
 * Two render models, not four. The server's phone and email leaves resolve a
 * contact to a handle and then make the SAME three calls the User Info leaf
 * makes, answering with the same normalised payload, so one `Result` serves
 * three sidebar rows the way snapchat.tsx serves three and telegram.tsx serves
 * two. Only the share resolver is genuinely different: it answers with a user
 * or video hint rather than a profile, so it gets its own small Result.
 *
 * Three claims this screen is careful not to make:
 *
 *   1. `intel.accountInfo` is usually null, because the provider behind it hangs
 *      and is called with a 12s ceiling. `intel.accountInfoAvailable` is the
 *      server's flag for "we asked and got nothing", and an absent block is
 *      never rendered as though the account has no details.
 *   2. `accountStatus: "unavailable"` means the contact resolver could not be
 *      reached. That is not "no account exists", and saying so would state
 *      something we do not know about a person.
 *   3. Cover URLs frequently resolve to null. Every image goes through
 *      RemoteImage, which falls back to initials rather than a broken `<img>`.
 *
 * Nothing here styles a container of its own. Everything is `ui/`.
 */

// ---------------------------------------------------------------------------
// Shapes, as the server's normaliser actually returns them
// ---------------------------------------------------------------------------

type TikTokProfile = {
  id: string
  username: string
  displayName: string
  handle: string
  bio: string
  verified: boolean
  privateAccount: boolean
  region: string
  language: string
  joined: string
  avatarUrl: string | null
  profileUrl: string | null
  ttseller: boolean
  commerce: boolean
}

type TikTokStats = {
  followers: number
  following: number
  likes: number
  videos: number
  friends: number
}

type TikTokVideo = {
  id: string
  caption: string
  coverUrl: string | null
  views: number
  likes: number
  comments: number
  duration: number
  createTime: number
  pinned: boolean
  url: string | null
}

/** The four `has_*` fields are strings ("true" / "false" / "unknown"), not
 *  booleans: upstream distinguishes "no" from "we do not know", and the server
 *  deliberately keeps them as sent rather than coercing "unknown" into a
 *  confident "no". */
type TikTokAccountInfo = {
  username: string
  platform: string
  hasEmail: string
  hasMobile: string
  hasOauth: string
  hasPasskey: string
  hasPassword: string
}

type TikTokRegion = { region: string; regionName: string }

type TikTokIntel = {
  accountInfo: TikTokAccountInfo | null
  registeredRegion: TikTokRegion | null
  currentRegion: TikTokRegion | null
  accountInfoAvailable: boolean
}

type TikTokData = {
  kind: string
  query: string
  resolvedFrom: string | null
  accountStatus: "found" | "not_found" | "unavailable" | null
  username: string
  found: boolean
  profile: TikTokProfile
  stats: TikTokStats
  videos: TikTokVideo[]
  intel: TikTokIntel
}

type TikTokShare = {
  userId: string
  videoId: string
  timestamp: string
  deviceType: string
  sharerLanguage: string
  sharerRegion: string
  landingUrl: string | null
}

type TikTokShareData = {
  url: string
  found: boolean
  share: TikTokShare
}

const EMPTY_PROFILE: TikTokProfile = {
  id: "",
  username: "",
  displayName: "",
  handle: "",
  bio: "",
  verified: false,
  privateAccount: false,
  region: "",
  language: "",
  joined: "",
  avatarUrl: null,
  profileUrl: null,
  ttseller: false,
  commerce: false,
}

const EMPTY_STATS: TikTokStats = { followers: 0, following: 0, likes: 0, videos: 0, friends: 0 }

const EMPTY_INTEL: TikTokIntel = {
  accountInfo: null,
  registeredRegion: null,
  currentRegion: null,
  accountInfoAvailable: false,
}

const EMPTY_SHARE: TikTokShare = {
  userId: "",
  videoId: "",
  timestamp: "",
  deviceType: "",
  sharerLanguage: "",
  sharerRegion: "",
  landingUrl: null,
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function count(n: unknown): string {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n.toLocaleString() : ""
}

/** Seconds to m:ss. Zero is "we were not told", not "an empty video". */
function formatDuration(seconds: number): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return ""
  const whole = Math.floor(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`
}

/** Unix seconds to a local date. */
function formatUnix(seconds: number): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return ""
  const at = new Date(seconds * 1000)
  if (Number.isNaN(at.getTime())) return ""
  return at.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

/**
 * One of the provider's tri-state strings, as copy.
 *
 * "unknown" (and anything unrecognised) becomes an empty value, which FieldGrid
 * renders as "Not reported". Turning it into "No" would invent an answer the
 * provider explicitly declined to give.
 */
function triState(value: unknown): string {
  if (value === "true") return "Yes"
  if (value === "false") return "No"
  return ""
}

function regionLine(region: TikTokRegion | null): string {
  if (!region) return ""
  const name = typeof region.regionName === "string" ? region.regionName : ""
  const code = typeof region.region === "string" ? region.region : ""
  if (name && code && name !== code) return `${name} (${code})`
  return name || code
}

/** The noun for whatever the contact leaves resolved from. */
function contactNoun(kind: string): string {
  return kind === "email" ? "email address" : kind === "phone" ? "phone number" : "query"
}

/**
 * A link the server kept. A null url means it was stripped by `toSafeLinkUrl`,
 * and a stripped link renders as nothing rather than as a dead control.
 * Real ones open in the browser, never in the webview.
 */
function OpenButton({ label, url }: { label: string; url: string | null }) {
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

// ---------------------------------------------------------------------------
// User Info, Phone to User and Email to User
// ---------------------------------------------------------------------------

export function Result({ data, partial }: ResultProps) {
  // Coerced once, here. A renderer that reads `data.videos.length` on an absent
  // field throws inside React's render, which in this app is a white window with
  // no console the user can reach.
  const raw = withDefaults(data, {} as Partial<TikTokData>)
  const p = withDefaults(raw.profile, EMPTY_PROFILE)
  const stats = withDefaults(raw.stats, EMPTY_STATS)
  const intel = withDefaults(raw.intel, EMPTY_INTEL)
  const d: TikTokData = {
    ...(raw as TikTokData),
    profile: p,
    stats,
    intel: {
      ...intel,
      accountInfo: intel.accountInfo
        ? withDefaults(intel.accountInfo, {
            username: "",
            platform: "",
            hasEmail: "",
            hasMobile: "",
            hasOauth: "",
            hasPasskey: "",
            hasPassword: "",
          })
        : null,
      accountInfoAvailable: intel.accountInfoAvailable === true,
    },
    videos: list<TikTokVideo>(raw.videos),
    found: raw.found === true,
    kind: typeof raw.kind === "string" ? raw.kind : "username",
    username: typeof raw.username === "string" ? raw.username : "",
    resolvedFrom: typeof raw.resolvedFrom === "string" ? raw.resolvedFrom : null,
    accountStatus:
      raw.accountStatus === "found" ||
      raw.accountStatus === "not_found" ||
      raw.accountStatus === "unavailable"
        ? raw.accountStatus
        : null,
  }

  const noun = contactNoun(d.kind)

  if (!d.found) {
    /**
     * Four different empty answers, and they are not interchangeable.
     *
     * "unavailable" means the contact resolver could not be reached: we do not
     * know whether an account exists, and must not say that none does.
     * "not_found" is an actual answer from a provider that could be asked.
     */
    const message =
      d.accountStatus === "unavailable"
        ? `The TikTok account resolver could not be reached, so we cannot say whether an account is registered to that ${noun}.`
        : d.accountStatus === "not_found"
          ? `No TikTok account is registered to that ${noun}.`
          : d.username
            ? `Resolved to @${d.username}, but no TikTok profile came back.`
            : "No TikTok profile found for that query."

    return (
      <div className="space-y-4">
        <EmptyState message={message} />
        {partial.length > 0 && (
          <p className="px-1 text-[11px] text-[var(--color-muted-foreground)]">
            Some sources did not answer: {partial.join(", ")}.
          </p>
        )}
      </div>
    )
  }

  const badges = [
    p.verified && { label: "Verified" },
    p.privateAccount && { label: "Private" },
    p.ttseller && { label: "TikTok Seller" },
    p.commerce && { label: "Commerce account" },
  ].filter(Boolean) as { label: string }[]

  const info = d.intel.accountInfo

  return (
    <div className="space-y-4">
      <ProfileCard
        avatarUrl={p.avatarUrl}
        name={p.displayName || p.username || "TikTok user"}
        subtitle={p.username ? `@${p.username}` : null}
        meta={[
          { label: "User ID", value: p.id, mono: true },
          { label: "Followers", value: count(stats.followers) },
          { label: "Following", value: count(stats.following) },
          { label: "Likes", value: count(stats.likes) },
        ]}
        badges={badges.length > 0 ? <BadgeRow badges={badges} /> : null}
      >
        {p.bio ? (
          <p className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-white/70">
            {p.bio}
          </p>
        ) : null}
        {/* Only on the contact leaves, so the user can see what their phone
            number or email resolved to. */}
        {d.resolvedFrom ? (
          <p className="mt-3 text-[12px] text-[var(--color-muted-foreground)]">
            Resolved from {d.resolvedFrom}.
          </p>
        ) : null}
      </ProfileCard>

      <Section title="Profile">
        <FieldGrid
          fields={[
            { label: "Handle", value: p.handle ? `@${p.handle}` : "", mono: true },
            { label: "Region", value: p.region },
            { label: "Language", value: p.language },
            { label: "Joined", value: p.joined },
            { label: "Videos", value: count(stats.videos) },
            { label: "Friends", value: count(stats.friends) },
          ]}
        />
        {p.profileUrl ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <OpenButton label="Open profile" url={p.profileUrl} />
          </div>
        ) : null}
      </Section>

      <Section title="Account details">
        {/* Not an empty state. `account_info` hangs upstream and null is its
            normal answer, so rendering "no details" here would report a
            provider timeout as a fact about the account. */}
        {!d.intel.accountInfoAvailable || !info ? (
          <EmptyState message="Account details did not come back for this lookup. That source frequently times out, so this does not mean the account has none." />
        ) : (
          <FieldGrid
            fields={[
              { label: "Platform", value: info.platform },
              { label: "Email on file", value: triState(info.hasEmail) },
              { label: "Mobile on file", value: triState(info.hasMobile) },
              { label: "Linked logins", value: triState(info.hasOauth) },
              { label: "Passkey", value: triState(info.hasPasskey) },
              { label: "Password", value: triState(info.hasPassword) },
            ]}
          />
        )}
      </Section>

      <Section title="Regions">
        <FieldGrid
          fields={[
            { label: "Registered region", value: regionLine(d.intel.registeredRegion) },
            { label: "Current region", value: regionLine(d.intel.currentRegion) },
          ]}
        />
      </Section>

      <Section title={`Videos${d.videos.length ? ` (${d.videos.length})` : ""}`}>
        {d.videos.length === 0 ? (
          <EmptyState
            message={
              p.privateAccount
                ? "This account is private, so its videos are not listed."
                : "No videos found for this account."
            }
          />
        ) : (
          <ul className="space-y-2.5">
            {d.videos.slice(0, 50).map((v, i) => {
              const video = withDefaults(v, {
                id: "",
                caption: "",
                coverUrl: null,
                views: 0,
                likes: 0,
                comments: 0,
                duration: 0,
                createTime: 0,
                pinned: false,
                url: null,
              } as TikTokVideo)
              const caption = video.caption || "No caption"
              const meta = [
                video.pinned ? "Pinned" : "",
                count(video.views) ? `${count(video.views)} views` : "",
                count(video.likes) ? `${count(video.likes)} likes` : "",
                count(video.comments) ? `${count(video.comments)} comments` : "",
                formatDuration(video.duration),
                formatUnix(video.createTime),
              ]
                .filter(Boolean)
                .join("  ·  ")

              return (
                <li key={video.id || `video-${i}`} className="flex items-center gap-3">
                  {/* Covers resolve to null often enough that this is the
                      ordinary case: RemoteImage shows initials instead of a
                      broken image. */}
                  <RemoteImage
                    url={video.coverUrl}
                    alt={caption}
                    className="h-14 w-10 shrink-0 rounded-lg text-[11px]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-white/85">{caption}</span>
                    <span className="block truncate text-[11px] text-[var(--color-muted-foreground)]">
                      {meta || "No stats reported"}
                    </span>
                  </span>
                  {/* A null url is one the server stripped, so it stays text. */}
                  <OpenButton label="Open" url={video.url} />
                </li>
              )
            })}
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

// ---------------------------------------------------------------------------
// Share resolver
// ---------------------------------------------------------------------------

export function ShareResult({ data, partial }: ResultProps) {
  const raw = withDefaults(data, {} as Partial<TikTokShareData>)
  const share = withDefaults(raw.share, EMPTY_SHARE)
  const d: TikTokShareData = {
    ...(raw as TikTokShareData),
    share,
    url: typeof raw.url === "string" ? raw.url : "",
    found: raw.found === true,
  }

  if (!d.found) {
    return (
      <div className="space-y-4">
        <EmptyState message="That share link did not resolve to a TikTok user or video." />
        {partial.length > 0 && (
          <p className="px-1 text-[11px] text-[var(--color-muted-foreground)]">
            Some sources did not answer: {partial.join(", ")}.
          </p>
        )}
      </div>
    )
  }

  const points = share.videoId ? "a video" : share.userId ? "a profile" : "a landing page"

  return (
    <div className="space-y-4">
      <Section title="Share link">
        <p className="text-[13px] text-[var(--color-muted-foreground)]">
          This link points to {points}.
        </p>
        {/* The query as typed. It is not a sanitised link, so it stays text. */}
        {d.url ? (
          <p className="mt-2 break-all font-mono text-[11px] text-white/70">{d.url}</p>
        ) : null}
      </Section>

      <Section title="Resolved">
        <FieldGrid
          fields={[
            { label: "User ID", value: share.userId, mono: true },
            { label: "Video ID", value: share.videoId, mono: true },
            { label: "Timestamp", value: share.timestamp, mono: true },
            // The resolver's hint about the device that created the share.
            { label: "Device type", value: share.deviceType },
            { label: "Sharer language", value: share.sharerLanguage },
            { label: "Sharer region", value: share.sharerRegion },
            // Null means the server stripped it, so there is no text to show
            // and nothing to open.
            { label: "Landing URL", value: share.landingUrl, mono: true },
          ]}
        />
        {share.landingUrl ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <OpenButton label="Open landing page" url={share.landingUrl} />
          </div>
        ) : null}
      </Section>

      {partial.length > 0 && (
        <p className="px-1 text-[11px] text-[var(--color-muted-foreground)]">
          Some sources did not answer: {partial.join(", ")}.
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Descriptors
// ---------------------------------------------------------------------------

/** The server's own bound on `query` for the User Info leaf. */
const QUERY_MAX = 80

/** The server's own bound on `query` for the contact leaves. */
const CONTACT_MAX = 120

/** The server's own bound on `url` for the share resolver. */
const SHARE_URL_MAX = 300

/**
 * Copied from the server, which copied it from app/api/tiktok/resolve/route.ts.
 * Accepts vt.tiktok.com and vm.tiktok.com short links and tiktok.com/t/ share
 * links, and nothing else: the gate meters between validation and the call, so
 * a link the resolver could never expand is refused here for free.
 */
const SHARE_RE =
  /^https?:\/\/(?:[a-z0-9-]+\.)?(?:vt|vm)\.tiktok\.com\/[\w./-]+|^https?:\/\/(?:www\.)?tiktok\.com\/t\/[\w./-]+/i

/** TikTok's own handle rule, the same one the server uses. */
const TIKTOK_HANDLE = /^[A-Za-z0-9._]{1,30}$/

/** The server's EMAIL_RE, from app/api/tiktok/account-lookup/route.ts. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** The server's PHONE_RE, applied to the same normalised form. */
const PHONE_RE = /^\+?\d{7,15}$/

/** The server's `normalizeTikTokHandle`: unwrap a profile URL, drop any @. */
function normalizeHandle(value: string): string {
  const input = value.trim()
  const fromUrl = input.match(/(?:https?:\/\/)?(?:www\.)?tiktok\.com\/@([^/?#]+)/i)?.[1]
  return (fromUrl ?? input).trim().replace(/^@+/, "")
}

/** The server's `normalizeQuery("phone", ...)`. */
function normalizePhone(value: string): string {
  const digits = value.trim().replace(/[\s()\-.]/g, "")
  return digits.startsWith("+") ? digits : `+${digits}`
}

export const descriptor: ModuleDescriptor = {
  id: "tiktok",
  route: "/tiktok",
  label: "TikTok",
  inputs: [
    {
      name: "query",
      label: "TikTok username",
      placeholder: "e.g. tiktok, or https://www.tiktok.com/@tiktok",
      validate: (v) => {
        const trimmed = v.trim()
        // The server's bound first, so a pasted megabyte is refused before any
        // of it reaches a regex.
        if (!trimmed || trimmed.length > QUERY_MAX) return "Enter a TikTok username."
        // Then the handle shape the server itself requires before it will build
        // a profile URL. A value that cannot be a handle cannot succeed, so it
        // must not become a metered request.
        return TIKTOK_HANDLE.test(normalizeHandle(trimmed)) ? null : "Enter a TikTok username."
      },
    },
  ],
  Result,
}

export const shareDescriptor: ModuleDescriptor = {
  id: "tiktok-share",
  route: "/tiktok/share-resolver",
  label: "TikTok share link",
  inputs: [
    {
      // The server reads `url` here, not `query`.
      name: "url",
      label: "Share link",
      placeholder: "e.g. https://vt.tiktok.com/ZS8abcdef/",
      validate: (v) => {
        const trimmed = v.trim()
        if (!trimmed || trimmed.length > SHARE_URL_MAX || !SHARE_RE.test(trimmed)) {
          return "Enter a valid TikTok share link (vt.tiktok.com, vm.tiktok.com, or .../t/...)."
        }
        return null
      },
    },
  ],
  Result: ShareResult,
}

export const phoneDescriptor: ModuleDescriptor = {
  id: "tiktok-phone",
  route: "/tiktok/phone",
  label: "TikTok phone to user",
  inputs: [
    {
      name: "query",
      label: "Phone number",
      placeholder: "e.g. +14155550123",
      validate: (v) => {
        const trimmed = v.trim()
        if (!trimmed || trimmed.length > CONTACT_MAX || !PHONE_RE.test(normalizePhone(trimmed))) {
          return "Enter a valid phone number."
        }
        return null
      },
    },
  ],
  Result,
}

export const emailDescriptor: ModuleDescriptor = {
  id: "tiktok-email",
  route: "/tiktok/email",
  label: "TikTok email to user",
  inputs: [
    {
      name: "query",
      label: "Email address",
      placeholder: "e.g. name@example.com",
      validate: (v) => {
        const trimmed = v.trim()
        if (!trimmed || trimmed.length > CONTACT_MAX || !EMAIL_RE.test(trimmed.toLowerCase())) {
          return "Enter a valid email address."
        }
        return null
      },
    },
  ],
  Result,
}
