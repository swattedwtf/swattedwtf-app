import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

import { Result, ShareResult, descriptor, shareDescriptor } from "./instagram"

/**
 * The claims this screen must never make.
 *
 * Instagram is the module where a provider outage is easiest to mistake for an
 * answer: the server names a failed section in `partial` and returns the section
 * empty, so every "nothing found" here is one missing branch away from being a
 * false statement about a real person's account.
 */

/** A post as the server's `normalizePost` actually returns it. */
const post = {
  id: "3100000000000000001",
  code: "Cabcdef1234",
  url: "https://www.instagram.com/p/Cabcdef1234/",
  takenAt: "2024-05-01",
  mediaType: 2,
  isVideo: true,
  thumbnailUrl: "/api/instagram/image?u=thumb.jpg",
  caption: "a caption about a cat",
  likeCount: 1234,
  commentCount: 56,
  viewCount: 78910,
  location: "Brooklyn, New York",
}

/** What the server sends when every section answered. */
const full = {
  query: "instagram",
  found: true,
  profile: {
    id: "25025320",
    username: "instagram",
    fullName: "Instagram",
    bio: "line one\nline two",
    avatarUrl: "/api/instagram/image?u=avatar.jpg",
    externalUrl: "https://about.instagram.com/",
    isPrivate: false,
    isVerified: true,
    isBusiness: true,
    category: "Internet company",
    publicEmail: "press@instagram.com",
    publicPhone: "+15550000000",
    profileUrl: "https://www.instagram.com/instagram/",
  },
  stats: { followers: 672000000, following: 178, posts: 7600 },
  about: {
    country: "United States",
    dateJoined: "2010-10-06",
    formerUsernames: ["burbn"],
    formerUsernameCount: 1,
    retrieved: true,
  },
  posts: [post],
  taggedPosts: [{ ...post, id: "3100000000000000002", caption: "", url: null }],
  stories: [{ id: "s1", thumbnailUrl: "/api/instagram/image?u=story.jpg" }],
  highlights: [
    { id: "h1", title: "Travel", mediaCount: 12, coverUrl: "/api/instagram/image?u=cover.jpg" },
  ],
}

/** The same shape with nothing resolved. */
const sparse = {
  query: "nobodyatall",
  found: false,
  profile: {
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
  },
  stats: { followers: 0, following: 0, posts: 0 },
  about: {
    country: "",
    dateJoined: "",
    formerUsernames: [],
    formerUsernameCount: 0,
    retrieved: false,
  },
  posts: [],
  taggedPosts: [],
  stories: [],
  highlights: [],
}

const render = (data: unknown, partial: string[] = []) =>
  renderToStaticMarkup(<Result data={data} partial={partial} />)

describe("Instagram profile result", () => {
  it("renders the identity, stats, contact and about panels", () => {
    const html = render(full)
    expect(html).toContain("Instagram")
    expect(html).toContain("@instagram")
    expect(html).toContain("672,000,000")
    expect(html).toContain("Verified")
    expect(html).toContain("Internet company")
    expect(html).toContain("press@instagram.com")
    expect(html).toContain("United States")
    expect(html).toContain("burbn")
    expect(html).toContain("Open profile")
  })

  // -------------------------------------------------------------------------
  // A failed lookup is not an absent account
  // -------------------------------------------------------------------------

  it("says the lookup failed, not that the person has no Instagram, on a failure", () => {
    // The server pushes "lookup" into `partial` for every non-2xx that is not a
    // 404. Without that branch a 502 rendered as "No Instagram profile found",
    // which asserts something about a real person that we never checked.
    const html = render(sparse, ["lookup"])
    expect(html).toContain("did not complete")
    expect(html).toContain("cannot say whether that account exists")
    expect(html).not.toContain("No Instagram profile found")
  })

  it("still says not found when the lookup succeeded and found nothing", () => {
    // A 404 IS a complete answer, and the server deliberately keeps it out of
    // `partial`, so this branch is allowed to say the account does not exist.
    const html = render(sparse, [])
    expect(html).toContain("No Instagram profile found for nobodyatall.")
    expect(html).not.toContain("did not complete")
  })

  // -------------------------------------------------------------------------
  // A failed section is not an empty section
  // -------------------------------------------------------------------------

  it("says posts did not load rather than reporting an account with no posts", () => {
    const html = render({ ...full, posts: [] }, ["posts"])
    expect(html).toContain("Posts did not load for this account")
    expect(html).not.toContain("No posts found.")
  })

  it("keeps 'No posts found.' for an account whose posts really were fetched", () => {
    const html = render({ ...full, posts: [] }, [])
    expect(html).toContain("No posts found.")
    expect(html).not.toContain("did not load")
  })

  it("prefers 'did not load' over 'private' when the posts section failed", () => {
    // Privacy is a guess at the cause; the named failure is the fact.
    const html = render(
      { ...full, posts: [], profile: { ...full.profile, isPrivate: true } },
      ["posts"],
    )
    expect(html).toContain("Posts did not load for this account")
    expect(html).not.toContain("This account is private, so its posts are not visible.")
  })

  it("still explains a private account's empty grid when nothing failed", () => {
    const html = render({ ...full, posts: [], profile: { ...full.profile, isPrivate: true } }, [])
    expect(html).toContain("This account is private, so its posts are not visible.")
  })

  it("says the About panel failed whether the flag or the section name says so", () => {
    const viaFlag = render({ ...full, about: { ...full.about, retrieved: false } }, [])
    expect(viaFlag).toContain("About panel could not be retrieved")
    expect(viaFlag).not.toContain("Former usernames")

    const viaPartial = render(full, ["about"])
    expect(viaPartial).toContain("About panel could not be retrieved")
    expect(viaPartial).not.toContain("Former usernames")
  })

  it("renders a failed tagged, highlights or stories section instead of hiding it", () => {
    // These three used to disappear on a length check, which took the failure
    // with them: the screen silently omitted three sections the user paid for.
    const html = render({ ...full, taggedPosts: [], highlights: [], stories: [] }, [
      "tagged",
      "highlights",
      "stories",
    ])
    expect(html).toContain("Tagged posts did not load")
    expect(html).toContain("Highlights did not load")
    expect(html).toContain("Stories did not load")
  })

  it("omits tagged, highlights and stories when they are genuinely empty", () => {
    const html = render({ ...full, taggedPosts: [], highlights: [], stories: [] }, [])
    expect(html).not.toContain("Tagged")
    expect(html).not.toContain("Highlights")
    expect(html).not.toContain("Active stories")
    expect(html).not.toContain("did not load")
  })

  // -------------------------------------------------------------------------
  // The rest of a post
  // -------------------------------------------------------------------------

  it("renders the caption, comments, view count, video marker and location of a post", () => {
    // normalizePost produces all of these and the grid used to render a
    // thumbnail and a like count, discarding everything the user paid for.
    const html = render(full)
    expect(html).toContain("a caption about a cat")
    expect(html).toContain("1,234 likes")
    expect(html).toContain("56 comments")
    expect(html).toContain("78,910 views")
    expect(html).toContain("Video")
    expect(html).toContain("Brooklyn, New York")
  })

  it("makes a post with a sanitised url openable, and one without it plain", () => {
    // `url` has already been through the server's toSafeLinkUrl, so a null
    // there means it was stripped and the cell must not become a dead control.
    const html = render(full)
    expect(html).toContain('aria-label="Open post: a caption about a cat"')

    const stripped = render({ ...full, posts: [{ ...post, url: null, caption: "no link" }] })
    expect(stripped).toContain("no link")
    expect(stripped).not.toContain("Open post")
  })

  it("renders each highlight's media count", () => {
    const html = render(full)
    expect(html).toContain("Travel")
    expect(html).toContain("12 items")
  })

  it("does not invent a media count the provider did not send", () => {
    const html = render({ ...full, highlights: [{ id: "h1", title: "Travel", coverUrl: null }] })
    expect(html).toContain("Count not reported")
    expect(html).not.toContain("0 items")
  })

  // -------------------------------------------------------------------------
  // One rendering of `partial`, not two
  // -------------------------------------------------------------------------

  it("does not render partial a second time, since ResultView already names it", () => {
    const html = render(full, ["stories"])
    expect(html).not.toContain("Some sections did not load")
    expect(html).not.toContain("Some sources did not answer")
  })

  it("uses no em dashes in its own copy", () => {
    expect(render(full)).not.toContain("—")
    expect(render(sparse)).not.toContain("—")
    expect(render(sparse, ["lookup"])).not.toContain("—")
    expect(render(full, ["about", "posts", "tagged", "highlights", "stories"])).not.toContain("—")
  })
})

// ---------------------------------------------------------------------------
// Share resolver
// ---------------------------------------------------------------------------

const share = {
  url: "https://www.instagram.com/share/abc123",
  found: true,
  canonicalUrl: "https://www.instagram.com/p/Cabcdef1234/",
  author: { username: "instagram", id: "25025320" },
  media: {
    kind: "post",
    shortcode: "Cabcdef1234",
    mediaId: "3100000000000000001_25025320",
    createdAt: "2024-05-01",
    caption: "a caption",
    likeCount: 12,
    commentCount: -1,
    thumbnailUrl: null,
  },
  share: { token: "abc123", decoded: "opaque" },
  provider: "instagram",
}

const renderShare = (data: unknown, partial: string[] = []) =>
  renderToStaticMarkup(<ShareResult data={data} partial={partial} />)

describe("Instagram share result", () => {
  it("renders the author, the media and the token disclaimer", () => {
    const html = renderShare(share)
    expect(html).toContain("@instagram")
    expect(html).toContain("Cabcdef1234")
    expect(html).toContain("3100000000000000001_25025320")
    expect(html).toContain("not the person who sent it")
  })

  it("does not claim the post never existed when the link would not resolve", () => {
    const html = renderShare({ ...share, found: false }, ["resolve"])
    expect(html).toContain("could not be resolved")
    expect(html).not.toContain("does not exist")
  })

  it("does not render partial a second time, since ResultView already names it", () => {
    expect(renderShare(share, ["resolve"])).not.toContain("Some sections did not load")
  })

  it("uses no em dashes in its own copy", () => {
    expect(renderShare(share)).not.toContain("—")
    expect(renderShare({ ...share, found: false }, ["resolve"])).not.toContain("—")
  })
})

// ---------------------------------------------------------------------------
// Descriptors
// ---------------------------------------------------------------------------

describe("Instagram descriptors", () => {
  it("declare the ids and routes the server and nav expect", () => {
    expect(descriptor.id).toBe("instagram")
    expect(descriptor.route).toBe("/instagram")
    expect(shareDescriptor.id).toBe("instagram-share")
    expect(shareDescriptor.route).toBe("/instagram/share-resolver")
  })

  it("accepts a username and rejects blank and over-long queries", () => {
    const check = descriptor.inputs[0].validate
    expect(check("instagram")).toBeNull()
    expect(check("")).toBeTruthy()
    expect(check("   ")).toBeTruthy()
    expect(check("x".repeat(81))).toBeTruthy()
  })

  it("accepts the link shapes the server's parser accepts, and nothing else", () => {
    const check = shareDescriptor.inputs[0].validate
    expect(check("https://www.instagram.com/share/abc123")).toBeNull()
    expect(check("https://www.instagram.com/p/Cabcdef1234/")).toBeNull()
    expect(check("https://www.instagram.com/reel/Cabcdef1234/")).toBeNull()
    expect(check("")).toBeTruthy()
    expect(check("https://www.instagram.com/instagram/")).toBeTruthy()
  })
})
