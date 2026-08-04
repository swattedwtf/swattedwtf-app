import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

import {
  Result,
  ShareResult,
  descriptor,
  emailDescriptor,
  phoneDescriptor,
  shareDescriptor,
} from "./tiktok"

/** What the server sends when every provider answered. */
const full = {
  kind: "username",
  query: "tiktok",
  resolvedFrom: null,
  accountStatus: null,
  username: "tiktok",
  found: true,
  profile: {
    id: "107955",
    username: "tiktok",
    displayName: "TikTok",
    handle: "tiktok",
    bio: "line one\nline two",
    verified: true,
    privateAccount: false,
    region: "US",
    language: "en",
    joined: "2018-06-01",
    avatarUrl: "/api/desktop/image?u=https%3A%2F%2Fcdn.tiktok.com%2Fa.jpeg",
    profileUrl: "https://www.tiktok.com/@tiktok",
    ttseller: false,
    commerce: true,
  },
  stats: { followers: 84200000, following: 8, likes: 620000000, videos: 1204, friends: 3 },
  videos: [
    {
      id: "7300000000000000001",
      caption: "a caption",
      coverUrl: "/api/desktop/image?u=https%3A%2F%2Fcdn.tiktok.com%2Fc.jpeg",
      views: 1234567,
      likes: 8910,
      comments: 42,
      duration: 83,
      createTime: 1700000000,
      pinned: true,
      url: "https://www.tiktok.com/@tiktok/video/7300000000000000001",
    },
    {
      id: "7300000000000000002",
      caption: "",
      coverUrl: null,
      views: 0,
      likes: 0,
      comments: 0,
      duration: 0,
      createTime: 0,
      pinned: false,
      url: null,
    },
  ],
  intel: {
    accountInfo: {
      username: "tiktok",
      platform: "tiktok",
      hasEmail: "true",
      hasMobile: "false",
      hasOauth: "unknown",
      hasPasskey: "false",
      hasPassword: "true",
    },
    registeredRegion: { region: "US", regionName: "United States" },
    currentRegion: { region: "GB", regionName: "United Kingdom" },
    accountInfoAvailable: true,
  },
}

/**
 * The same shape with every optional field absent. A TikTok result is routinely
 * partial (a private account carries stats and no videos, and the enrichment
 * endpoints are best-effort by design), so this is the normal case.
 */
const sparse = {
  kind: "username",
  query: "ghost",
  resolvedFrom: null,
  accountStatus: null,
  username: "ghost",
  found: true,
  profile: {
    id: "",
    username: "ghost",
    displayName: "ghost",
    handle: "ghost",
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
  },
  stats: { followers: 0, following: 0, likes: 0, videos: 0, friends: 0 },
  videos: [],
  intel: {
    accountInfo: null,
    registeredRegion: null,
    currentRegion: null,
    accountInfoAvailable: false,
  },
}

const shareFull = {
  url: "https://vt.tiktok.com/ZS8abcdef/",
  found: true,
  share: {
    userId: "6613622559360516101",
    videoId: "7300000000000000001",
    timestamp: "2024-01-02 03:04:05",
    deviceType: "iPhone14,2",
    sharerLanguage: "en",
    sharerRegion: "US",
    landingUrl: "https://www.tiktok.com/@tiktok/video/7300000000000000001",
  },
}

const shareSparse = {
  url: "https://vm.tiktok.com/ZS8abcdef/",
  found: false,
  share: {
    userId: "",
    videoId: "",
    timestamp: "",
    deviceType: "",
    sharerLanguage: "",
    sharerRegion: "",
    landingUrl: null,
  },
}

const render = (data: unknown, partial: string[] = []) =>
  renderToStaticMarkup(<Result data={data} partial={partial} />)

const renderShare = (data: unknown, partial: string[] = []) =>
  renderToStaticMarkup(<ShareResult data={data} partial={partial} />)

describe("TikTok result", () => {
  it("renders the identity, stats, enrichment and videos", () => {
    const html = render(full)
    expect(html).toContain("TikTok")
    expect(html).toContain("@tiktok")
    expect(html).toContain("107955")
    expect(html).toContain("84,200,000")
    expect(html).toContain("Verified")
    expect(html).toContain("Commerce account")
    expect(html).toContain("United States (US)")
    expect(html).toContain("United Kingdom (GB)")
    expect(html).toContain("Videos (2)")
    expect(html).toContain("a caption")
    expect(html).toContain("1,234,567 views")
    expect(html).toContain("1:23")
    expect(html).toContain("Pinned")
  })

  it("renders a sparse payload without throwing, using empty states", () => {
    const html = render(sparse)
    expect(html).toContain("No videos found for this account.")
    expect(html).toContain("Not reported")
    expect(html).toContain("ghost")
  })

  it("survives a payload with no sections at all", () => {
    expect(() => render({})).not.toThrow()
    expect(() => render({ found: true })).not.toThrow()
    expect(() => render({ found: true, videos: "not an array", intel: 7 })).not.toThrow()
  })

  it("says an account-info block was not answered, never that the account has none", () => {
    // `account_info` hangs upstream and is called with a 12s ceiling, so null is
    // its normal answer. Rendering "no details" would report a provider timeout
    // as a fact about a person's account.
    const html = render(sparse)
    expect(html).toContain("That source frequently times out")
    expect(html).not.toContain("No account details")
    expect(html).not.toContain("This account has no")
    // And it must not silently render the block's fields as unanswered either.
    expect(html).not.toContain("Email on file")
  })

  it("renders the account-info fields when the server says it was answered", () => {
    const html = render(full)
    expect(html).toContain("Email on file")
    expect(html).not.toContain("That source frequently times out")
  })

  it("keeps 'unknown' out of the yes/no fields", () => {
    // The four has_* fields are strings upstream, and "unknown" is not "no".
    const html = render({
      ...full,
      intel: {
        ...full.intel,
        accountInfo: { ...full.intel.accountInfo, hasEmail: "unknown", hasMobile: "unknown" },
      },
    })
    expect(html).toContain("Not reported")
  })

  it("distinguishes an unreachable resolver from a clean not-found", () => {
    const unavailable = render({
      ...sparse,
      kind: "phone",
      found: false,
      resolvedFrom: "+14155550123",
      accountStatus: "unavailable",
    })
    const notFound = render({
      ...sparse,
      kind: "phone",
      found: false,
      resolvedFrom: "+14155550123",
      accountStatus: "not_found",
    })

    expect(unavailable).not.toBe(notFound)
    expect(unavailable).toContain("could not be reached")
    expect(unavailable).toContain("cannot say whether an account is registered")
    // The claim that must never appear when we simply could not ask.
    expect(unavailable).not.toContain("No TikTok account is registered")

    expect(notFound).toContain("No TikTok account is registered to that phone number.")
    expect(notFound).not.toContain("could not be reached")
  })

  it("names the contact kind it was asked about", () => {
    const email = render({ ...sparse, kind: "email", found: false, accountStatus: "not_found" })
    expect(email).toContain("No TikTok account is registered to that email address.")
  })

  it("says what a resolved handle failed to profile", () => {
    const html = render({ ...sparse, kind: "email", found: false, accountStatus: "found", username: "ghost" })
    expect(html).toContain("Resolved to @ghost, but no TikTok profile came back.")
  })

  it("shows what a contact resolved from on a found profile", () => {
    const html = render({ ...full, kind: "phone", resolvedFrom: "+14155550123", accountStatus: "found" })
    expect(html).toContain("Resolved from +14155550123.")
  })

  it("renders a video with no cover as a placeholder, never a broken image", () => {
    const html = render({ ...full, videos: [{ ...full.videos[0], coverUrl: null }] })
    expect(html).not.toContain("<img")
    expect(html).toContain("a caption")
  })

  it("renders a video whose URL was stripped as plain text, not a dead link", () => {
    // The server nulls any link that is not http(s), or that it could not build
    // from a shape-checked handle and id.
    const html = render({
      ...full,
      videos: [{ ...full.videos[0], url: null }],
      profile: { ...full.profile, profileUrl: null },
    })
    expect(html).toContain("a caption")
    expect(html).not.toContain("<button")
  })

  it("says a private account's videos are withheld rather than absent", () => {
    const html = render({
      ...full,
      videos: [],
      profile: { ...full.profile, privateAccount: true },
    })
    expect(html).toContain("This account is private")
    expect(html).not.toContain("No videos found for this account.")
  })

  it("leaves naming the failed sources to ResultView, which renders it once", () => {
    // Two lists meaning "this section is missing", in two vocabularies, was the
    // same fact told twice. ResultView owns the single rendering, so a module
    // that adds its own is the bug.
    const html = render(full, ["oath", "messages"])
    expect(html).not.toContain("Some sources did not answer")
    expect(html).not.toContain("Some sections did not load")
  })

  it("uses no em dashes in its own copy", () => {
    expect(render(full)).not.toContain("—")
    expect(render(sparse)).not.toContain("—")
    expect(render({ ...sparse, found: false, accountStatus: "unavailable" })).not.toContain("—")
  })
})

describe("TikTok share result", () => {
  it("renders the resolved user, video and device hints", () => {
    const html = renderShare(shareFull)
    expect(html).toContain("6613622559360516101")
    expect(html).toContain("7300000000000000001")
    expect(html).toContain("iPhone14,2")
    expect(html).toContain("This link points to a video.")
    expect(html).toContain("Open landing page")
  })

  it("says a profile when there is no video id", () => {
    const html = renderShare({ ...shareFull, share: { ...shareFull.share, videoId: "" } })
    expect(html).toContain("This link points to a profile.")
  })

  it("says the link did not resolve rather than rendering an empty card", () => {
    const html = renderShare(shareSparse)
    expect(html).toContain("did not resolve to a TikTok user or video")
    expect(html).not.toContain("User ID")
  })

  it("renders a stripped landing URL as an unanswered field, not a dead link", () => {
    const html = renderShare({ ...shareFull, share: { ...shareFull.share, landingUrl: null } })
    expect(html).toContain("Not reported")
    expect(html).not.toContain("Open landing page")
  })

  it("survives a payload with no share object at all", () => {
    expect(() => renderShare({})).not.toThrow()
    expect(() => renderShare({ found: true })).not.toThrow()
    expect(() => renderShare({ found: true, share: "nope" })).not.toThrow()
  })

  it("uses no em dashes in its own copy", () => {
    expect(renderShare(shareFull)).not.toContain("—")
    expect(renderShare(shareSparse)).not.toContain("—")
  })
})

describe("TikTok descriptors", () => {
  it("answers on the routes the nav declares", () => {
    expect([descriptor.route, shareDescriptor.route, phoneDescriptor.route, emailDescriptor.route])
      .toEqual(["/tiktok", "/tiktok/share-resolver", "/tiktok/phone", "/tiktok/email"])
  })

  it("declares the module ids the server table expects", () => {
    expect([descriptor.id, shareDescriptor.id, phoneDescriptor.id, emailDescriptor.id]).toEqual([
      "tiktok",
      "tiktok-share",
      "tiktok-phone",
      "tiktok-email",
    ])
  })

  it("sends the input key each server module reads", () => {
    expect(descriptor.inputs[0].name).toBe("query")
    expect(shareDescriptor.inputs[0].name).toBe("url")
    expect(phoneDescriptor.inputs[0].name).toBe("query")
    expect(emailDescriptor.inputs[0].name).toBe("query")
  })

  it("accepts a username, including a pasted profile URL, and rejects the rest", () => {
    const check = descriptor.inputs[0].validate
    expect(check("tiktok")).toBeNull()
    expect(check("  @tiktok  ")).toBeNull()
    expect(check("https://www.tiktok.com/@tiktok")).toBeNull()
    for (const bad of ["", "   ", "has space", "a".repeat(81), "bad/handle", "emoji😀"]) {
      expect(check(bad), `${bad} should be rejected`).toBe("Enter a TikTok username.")
    }
  })

  it("accepts only the three share-link shapes the resolver can expand", () => {
    const check = shareDescriptor.inputs[0].validate
    expect(check("https://vt.tiktok.com/ZS8abcdef/")).toBeNull()
    expect(check("https://vm.tiktok.com/ZS8abcdef/")).toBeNull()
    expect(check("https://www.tiktok.com/t/ZS8abcdef/")).toBeNull()
    expect(check("  https://vt.tiktok.com/ZS8abcdef/  ")).toBeNull()
    for (const bad of [
      "",
      "   ",
      "vt.tiktok.com/ZS8abcdef",
      "https://www.tiktok.com/@tiktok",
      // A non-TikTok host must never become a metered request.
      "https://evil.example.com/t/abc",
      "https://vt.tiktok.com.evil.example/abc",
      "javascript:alert(1)",
      `https://vt.tiktok.com/${"a".repeat(300)}`,
    ]) {
      expect(check(bad), `${bad} should be rejected`).toBe(
        "Enter a valid TikTok share link (vt.tiktok.com, vm.tiktok.com, or .../t/...).",
      )
    }
  })

  it("mirrors the server's phone rule", () => {
    const check = phoneDescriptor.inputs[0].validate
    expect(check("+14155550123")).toBeNull()
    expect(check("14155550123")).toBeNull()
    expect(check("(415) 555-0123")).toBeNull()
    for (const bad of ["", "   ", "123456", "+1234567890123456", "not a phone", "+1-415-555-012x"]) {
      expect(check(bad), `${bad} should be rejected`).toBe("Enter a valid phone number.")
    }
  })

  it("mirrors the server's email rule", () => {
    const check = emailDescriptor.inputs[0].validate
    expect(check("name@example.com")).toBeNull()
    expect(check("  NAME@Example.COM  ")).toBeNull()
    for (const bad of ["", "   ", "name@example", "name.example.com", "a@b.c", "two @spaces.com"]) {
      expect(check(bad), `${bad} should be rejected`).toBe("Enter a valid email address.")
    }
  })
})
