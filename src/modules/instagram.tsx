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

function PostGrid({ posts, empty }: { posts: Post[]; empty: string }) {
  if (posts.length === 0) return <EmptyState message={empty} />
  return (
    <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {posts.slice(0, 24).map((p) => (
        <li key={p.id || p.code}>
          <RemoteImage
            url={p.thumbnailUrl}
            alt={p.caption ? p.caption.slice(0, 40) : "Post"}
            name={p.code || "IG"}
            className="aspect-square w-full rounded-lg bg-white/5 text-[11px]"
          />
          <span className="mt-1 block truncate text-[10px] text-[var(--color-muted-foreground)]">
            {p.likeCount > 0 ? `${p.likeCount.toLocaleString()} likes` : p.takenAt}
          </span>
        </li>
      ))}
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
    profile: p,
    stats,
    about: { ...about, formerUsernames: list<string>(about.formerUsernames) },
    posts: list<Post>(raw.posts),
    taggedPosts: list<Post>(raw.taggedPosts),
    stories: list(raw.stories),
    highlights: list(raw.highlights),
    found: raw.found === true,
  }

  if (!d.found) {
    return (
      <div className="space-y-4">
        <EmptyState message={`No Instagram profile found for ${d.query || "that query"}.`} />
      </div>
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
        {/* `retrieved: false` means the About panel could not be fetched at all.
            Reporting that as "no former usernames" states something we did not
            check, which is the same distinction the server is careful about. */}
        {!d.about.retrieved ? (
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

      <Section title={`Posts${d.posts.length ? ` (${d.posts.length})` : ""}`}>
        <PostGrid
          posts={d.posts}
          empty={p.isPrivate ? "This account is private, so its posts are not visible." : "No posts found."}
        />
      </Section>

      {d.taggedPosts.length > 0 && (
        <Section title={`Tagged (${d.taggedPosts.length})`}>
          <PostGrid posts={d.taggedPosts} empty="No tagged posts." />
        </Section>
      )}

      {d.highlights.length > 0 && (
        <Section title="Highlights">
          <div className="flex flex-wrap gap-3">
            {d.highlights.map((h) => (
              <span key={h.id} className="w-20 text-center">
                <RemoteImage
                  url={h.coverUrl}
                  alt={h.title}
                  className="h-20 w-20 rounded-full bg-white/5"
                />
                <span className="mt-1 block truncate text-[10px] text-[var(--color-muted-foreground)]">
                  {h.title}
                </span>
              </span>
            ))}
          </div>
        </Section>
      )}

      {d.stories.length > 0 && (
        <Section title={`Active stories (${d.stories.length})`}>
          <div className="flex flex-wrap gap-2">
            {d.stories.map((s) => (
              <RemoteImage
                key={s.id}
                url={s.thumbnailUrl}
                alt="Story"
                className="h-24 w-16 rounded-lg bg-white/5"
              />
            ))}
          </div>
        </Section>
      )}

      {partial.length > 0 && (
        <p className="px-1 text-[11px] text-[var(--color-muted-foreground)]">
          Some sections did not load: {partial.join(", ")}.
        </p>
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

export function ShareResult({ data, partial }: ResultProps) {
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

      {partial.length > 0 && (
        <p className="px-1 text-[11px] text-[var(--color-muted-foreground)]">
          Some sections did not load: {partial.join(", ")}.
        </p>
      )}
    </div>
  )
}

export const descriptor: ModuleDescriptor = {
  id: "instagram",
  route: "/instagram",
  label: "Instagram",
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
