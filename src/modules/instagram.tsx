import { Camera, Link2 } from "lucide-react"
import { ipc } from "../lib/ipc"
import { RemoteImage } from "./RemoteImage"
import { list, withDefaults } from "./safe"
import type { ModuleDescriptor, ResultProps } from "./types"
import { BadgeRow, EmptyState, FieldGrid, ProfileCard, Section } from "./ui"

/**
 * Instagram: profile lookup, and the share-link resolver.
 *
 * Two leaves, two answers, so two Results. The profile is the widest thing in
 * the group after Discord; the resolver answers one question about one link.
 *
 * TWO claims this screen is careful not to make.
 *
 *   1. `found: false` is not "this person has no Instagram". The server pushes
 *      "lookup" into `partial` for every non-2xx that is not a 404, so a 502
 *      from the provider arrives here looking exactly like a real not-found.
 *      Only the absence of that marker licenses saying no account exists.
 *   2. An empty section is not an empty account. The server names the sections
 *      whose provider failed - about, posts, stories, highlights, tagged - and
 *      each of those is branched on, because "No posts found." about a live
 *      account whose post fetch failed is a false statement about a real
 *      person.
 *
 * `partial` itself is NOT listed here. ResultView renders it once for every
 * module, and a second list in this file's own vocabulary was the same fact
 * told twice in two different words.
 */

type Post = {
  id: string
  code: string
  url: string | null
  takenAt: string
  isVideo: boolean
  thumbnailUrl: string | null
  caption: string
  likeCount: number
  commentCount: number
  viewCount: number
  location: string
  mediaType: number
}

const EMPTY_POST: Post = {
  id: "",
  code: "",
  url: null,
  takenAt: "",
  isVideo: false,
  thumbnailUrl: null,
  caption: "",
  likeCount: 0,
  commentCount: 0,
  viewCount: 0,
  location: "",
  mediaType: 0,
}

type InstagramData = {
  query: string
  found: boolean
  profile: {
    id: string
    username: string
    fullName: string
    bio: string
    avatarUrl: string | null
    externalUrl: string | null
    isPrivate: boolean
    isVerified: boolean
    isBusiness: boolean
    category: string
    publicEmail: string
    publicPhone: string
    profileUrl: string | null
  }
  stats: { followers: number; following: number; posts: number }
  about: {
    country: string
    dateJoined: string
    formerUsernames: string[]
    formerUsernameCount: number
    retrieved: boolean
  }
  posts: Post[]
  taggedPosts: Post[]
  stories: { id: string; thumbnailUrl: string | null }[]
  highlights: { id: string; title: string; mediaCount: number; coverUrl: string | null }[]
}

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

function count(n: number): string {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n.toLocaleString() : ""
}

/**
 * The posts and tagged-posts grid.
 *
 * The server normalises far more of a post than a thumbnail and a like count,
 * and dropping the rest meant the user paid for a caption, a comment count and
 * a location and was shown none of them. `url` has already been through the
 * server's `toSafeLinkUrl`, so a null there means it was stripped and the cell
 * stays a plain image rather than becoming a dead control.
 */
function PostGrid({ posts, empty }: { posts: Post[]; empty: string }) {
  if (posts.length === 0) return <EmptyState message={empty} />
  return (
    <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {posts.slice(0, 24).map((raw, i) => {
        const p = withDefaults(raw, EMPTY_POST)
        const caption = typeof p.caption === "string" ? p.caption.trim() : ""
        const meta = [
          count(p.likeCount) ? `${count(p.likeCount)} likes` : "",
          count(p.commentCount) ? `${count(p.commentCount)} comments` : "",
          p.isVideo && count(p.viewCount) ? `${count(p.viewCount)} views` : "",
          p.isVideo ? "Video" : "",
          p.takenAt,
        ]
          .filter(Boolean)
          .join("  ·  ")

        const thumbnail = (
          <RemoteImage
            url={p.thumbnailUrl}
            alt={caption ? caption.slice(0, 40) : "Post"}
            name={p.code || "IG"}
            className="aspect-square w-full rounded-lg bg-white/5 text-[11px]"
          />
        )

        return (
          <li key={p.id || p.code || `post-${i}`} className="min-w-0">
            {p.url ? (
              <button
                type="button"
                onClick={() => void ipc.openExternal(p.url as string).catch(() => {})}
                title={caption || undefined}
                aria-label={caption ? `Open post: ${caption.slice(0, 80)}` : "Open post"}
                className="block w-full"
              >
                {thumbnail}
              </button>
            ) : (
              thumbnail
            )}
            {caption ? (
              <span className="mt-1 block truncate text-[11px] text-white/75">{caption}</span>
            ) : null}
            <span className="mt-0.5 block truncate text-[10px] text-[var(--color-muted-foreground)]">
              {meta || "No details reported"}
            </span>
            {p.location ? (
              <span className="block truncate text-[10px] text-[var(--color-muted-foreground)]">
                {p.location}
              </span>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

export function Result({ data, partial }: ResultProps) {
  const raw = withDefaults(data, {} as Partial<InstagramData>)
  const p = withDefaults(raw.profile, {
    id: "",
    username: "",
    fullName: "",
    bio: "",
    avatarUrl: null,
    externalUrl: null,
    isPrivate: false,
    isVerified: false,
    isBusiness: false,
    category: "",
    publicEmail: "",
    publicPhone: "",
    profileUrl: null,
  } as InstagramData["profile"])
  const stats = withDefaults(raw.stats, { followers: 0, following: 0, posts: 0 })
  const about = withDefaults(raw.about, {
    country: "",
    dateJoined: "",
    formerUsernames: [] as string[],
    formerUsernameCount: 0,
    retrieved: false,
  })
  const d: InstagramData = {
    ...(raw as InstagramData),
    query: typeof raw.query === "string" ? raw.query : "",
    profile: p,
    stats,
    about: { ...about, formerUsernames: list<string>(about.formerUsernames) },
    posts: list<Post>(raw.posts),
    taggedPosts: list<Post>(raw.taggedPosts),
    stories: list(raw.stories),
    highlights: list(raw.highlights),
    found: raw.found === true,
  }

  const failed = (section: string) => partial.includes(section)
  const subject = d.query ? `"${d.query}"` : "that query"

  if (!d.found) {
    /**
     * Two different empty answers, and they are not interchangeable.
     *
     * The server treats a 404 as a complete answer and everything else that is
     * not a 2xx (429, 502, 503, 504, a timeout) as a failure named "lookup".
     * Without that distinction a provider outage rendered as "this person has
     * no Instagram", which is the sharpest false claim this screen can make.
     */
    return (
      <EmptyState
        message={
          failed("lookup")
            ? `The Instagram lookup for ${subject} did not complete, so we cannot say whether that account exists.`
            : `No Instagram profile found for ${d.query || "that query"}.`
        }
      />
    )
  }

  const badges = [
    d.profile.isVerified && { label: "Verified" },
    d.profile.isPrivate && { label: "Private" },
    d.profile.isBusiness && { label: "Business" },
  ].filter(Boolean) as { label: string }[]

  return (
    <div className="space-y-4">
      <ProfileCard
        avatarUrl={p.avatarUrl}
        name={p.fullName || p.username}
        subtitle={p.username ? `@${p.username}` : null}
        meta={[
          { label: "Followers", value: stats.followers ? stats.followers.toLocaleString() : "" },
          { label: "Following", value: stats.following ? stats.following.toLocaleString() : "" },
          { label: "Posts", value: stats.posts ? stats.posts.toLocaleString() : "" },
          { label: "User ID", value: p.id, mono: true },
        ]}
        badges={badges.length > 0 ? <BadgeRow badges={badges} /> : null}
      >
        {p.bio ? (
          <p className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-white/70">
            {p.bio}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <OpenButton label="Open profile" url={p.profileUrl} />
          <OpenButton label="Link in bio" url={p.externalUrl} />
        </div>
      </ProfileCard>

      <Section title="Contact and category">
        <FieldGrid
          fields={[
            { label: "Category", value: p.category },
            { label: "Public email", value: p.publicEmail },
            { label: "Public phone", value: p.publicPhone, mono: true },
          ]}
        />
      </Section>

      <Section title="About this account">
        {/* `retrieved: false` means the About panel could not be fetched at all,
            and the server ALSO names "about" in `partial` when that section's
            provider failed. Reporting either as "no former usernames" states
            something we did not check. */}
        {!d.about.retrieved || failed("about") ? (
          <EmptyState message="Instagram's About panel could not be retrieved for this account." />
        ) : (
          <FieldGrid
            fields={[
              { label: "Country", value: d.about.country },
              { label: "Date joined", value: d.about.dateJoined },
              {
                label: "Former usernames",
                value:
                  d.about.formerUsernames.length > 0
                    ? d.about.formerUsernames.join(", ")
                    : d.about.formerUsernameCount > 0
                      ? `${d.about.formerUsernameCount} recorded, not disclosed`
                      : "",
              },
            ]}
          />
        )}
      </Section>

      {/* Each of the four media sections is branched on its own name in
          `partial`. A section whose provider failed says so; only a section
          that was actually fetched is allowed to report that it is empty.
          The three below Posts also RENDER when they failed, rather than
          disappearing on a length check and taking the failure with them. */}
      <Section title={`Posts${d.posts.length ? ` (${d.posts.length})` : ""}`}>
        <PostGrid
          posts={d.posts}
          empty={
            failed("posts")
              ? "Posts did not load for this account, so this is not a report that it has none."
              : p.isPrivate
                ? "This account is private, so its posts are not visible."
                : "No posts found."
          }
        />
      </Section>

      {(d.taggedPosts.length > 0 || failed("tagged")) && (
        <Section title={`Tagged${d.taggedPosts.length ? ` (${d.taggedPosts.length})` : ""}`}>
          <PostGrid
            posts={d.taggedPosts}
            empty={
              failed("tagged")
                ? "Tagged posts did not load for this account, so this is not a report that it has none."
                : "No tagged posts."
            }
          />
        </Section>
      )}

      {(d.highlights.length > 0 || failed("highlights")) && (
        <Section title={`Highlights${d.highlights.length ? ` (${d.highlights.length})` : ""}`}>
          {d.highlights.length === 0 ? (
            <EmptyState message="Highlights did not load for this account, so this is not a report that it has none." />
          ) : (
            <div className="flex flex-wrap gap-3">
              {d.highlights.map((h, i) => (
                <span key={h.id || `highlight-${i}`} className="w-20 text-center">
                  <RemoteImage
                    url={h.coverUrl}
                    alt={h.title || "Highlight"}
                    name={h.title || "IG"}
                    className="h-20 w-20 rounded-full bg-white/5 text-[11px]"
                  />
                  <span className="mt-1 block truncate text-[10px] text-white/75">
                    {h.title || "Untitled"}
                  </span>
                  <span className="block truncate text-[10px] text-[var(--color-muted-foreground)]">
                    {count(h.mediaCount) ? `${count(h.mediaCount)} items` : "Count not reported"}
                  </span>
                </span>
              ))}
            </div>
          )}
        </Section>
      )}

      {(d.stories.length > 0 || failed("stories")) && (
        <Section title={`Active stories${d.stories.length ? ` (${d.stories.length})` : ""}`}>
          {d.stories.length === 0 ? (
            <EmptyState message="Stories did not load for this account, so this is not a report that it has none." />
          ) : (
            <div className="flex flex-wrap gap-2">
              {d.stories.map((s, i) => (
                <RemoteImage
                  key={s.id || `story-${i}`}
                  url={s.thumbnailUrl}
                  alt="Story"
                  className="h-24 w-16 rounded-lg bg-white/5"
                />
              ))}
            </div>
          )}
        </Section>
      )}
    </div>
  )
}

type ShareData = {
  url: string
  found: boolean
  canonicalUrl: string | null
  author: { username: string; id: string }
  media: {
    kind: string
    shortcode: string
    mediaId: string
    createdAt: string
    caption: string
    likeCount: number
    commentCount: number
    thumbnailUrl: string | null
  }
  share: { token: string; decoded: string }
  provider: string
}

/** -1 is the provider's "not disclosed", which is not the same as zero. */
function countValue(n: number): string {
  if (n < 0) return ""
  return n.toLocaleString()
}

export function ShareResult({ data }: ResultProps) {
  const raw = withDefaults(data, {} as Partial<ShareData>)
  const d: ShareData = {
    ...(raw as ShareData),
    found: raw.found === true,
    author: withDefaults(raw.author, { username: "", id: "" }),
    media: withDefaults(raw.media, {
      kind: "unknown",
      shortcode: "",
      mediaId: "",
      createdAt: "",
      caption: "",
      likeCount: -1,
      commentCount: -1,
      thumbnailUrl: null,
    }),
    share: withDefaults(raw.share, { token: "", decoded: "" }),
  }

  if (!d.found) {
    return <EmptyState message="That share link could not be resolved." />
  }

  return (
    <div className="space-y-4">
      <ProfileCard
        avatarUrl={d.media.thumbnailUrl}
        name={d.author.username ? `@${d.author.username}` : "Unknown author"}
        subtitle={d.media.kind !== "unknown" ? d.media.kind : null}
        meta={[
          { label: "Author ID", value: d.author.id, mono: true },
          { label: "Shortcode", value: d.media.shortcode, mono: true },
          { label: "Posted", value: d.media.createdAt },
        ]}
      >
        <div className="mt-3 flex flex-wrap gap-2">
          <OpenButton label="Open post" url={d.canonicalUrl} />
        </div>
      </ProfileCard>

      <Section title="Media">
        <FieldGrid
          fields={[
            { label: "Media ID", value: d.media.mediaId, mono: true },
            { label: "Likes", value: countValue(d.media.likeCount) },
            { label: "Comments", value: countValue(d.media.commentCount) },
            { label: "Resolved by", value: d.provider },
          ]}
        />
        {d.media.caption ? (
          <p className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-white/70">
            {d.media.caption}
          </p>
        ) : null}
      </Section>

      <Section title="Share token">
        {/* Deliberately worded. The decoded token is opaque and does NOT
            identify whoever shared the link; only Meta can map it back to a
            share session. Labelling it as the sharer would be a fabrication
            about a real person. */}
        <p className="mb-2 text-[12px] leading-relaxed text-[var(--color-muted-foreground)]">
          This token identifies the share link, not the person who sent it. Instagram does not
          expose the sharer.
        </p>
        <FieldGrid
          fields={[
            { label: "Token", value: d.share.token, mono: true },
            { label: "Decoded", value: d.share.decoded, mono: true },
          ]}
        />
      </Section>
    </div>
  )
}

export const descriptor: ModuleDescriptor = {
  id: "instagram",
  route: "/instagram",
  label: "Instagram",
  icon: Camera,
  description: "Resolve an Instagram username to its profile, past usernames, posts, stories, and highlights.",
  inputs: [
    {
      name: "query",
      label: "Username",
      placeholder: "e.g. instagram, or a profile URL",
      validate: (v) =>
        v.trim().length > 0 && v.trim().length <= 80 ? null : "Enter an Instagram username.",
    },
  ],
  Result,
}

export const shareDescriptor: ModuleDescriptor = {
  id: "instagram-share",
  route: "/instagram/share-resolver",
  label: "Instagram share resolver",
  icon: Link2,
  description: "Expand an Instagram share link to reveal the author, media IDs and exact post time.",
  inputs: [
    {
      name: "url",
      label: "Share link",
      placeholder: "https://www.instagram.com/share/...",
      validate: (v) => {
        const s = v.trim()
        if (!s) return "Paste an Instagram link."
        // Mirrors what the server's parseShareLink accepts, so a bad paste is
        // refused before it can become a metered request.
        return /instagram\.com\/(share|p|reel|reels|tv)\//i.test(s)
          ? null
          : "Enter a valid Instagram link (a /share/ link, or a post, reel or tv URL)."
      },
    },
  ],
  Result: ShareResult,
}
