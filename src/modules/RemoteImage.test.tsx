import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

import { RemoteImage, __setClock, cachedImage, initialsFor, loadImage } from "./RemoteImage"
import { ipc } from "../lib/ipc"

vi.mock("../lib/ipc", () => ({ ipc: { fetchImage: vi.fn() } }))

const fetchImage = vi.mocked(ipc.fetchImage)

// The cache is module-level and deliberately has no reset hook, so every test
// uses a URL of its own rather than reaching into it.
let n = 0
const url = () => `https://swattedw.tf/api/desktop/image?u=${n++}`

const DATA = "data:image/png;base64,iVBORw0KGgo="

beforeEach(() => {
  fetchImage.mockReset()
})

describe("initialsFor", () => {
  it("takes one letter from each of the first two words", () => {
    expect(initialsFor("Bob Ross")).toBe("BR")
    expect(initialsFor("ada lovelace jones")).toBe("AL")
  })

  it("takes a single letter from a single word", () => {
    expect(initialsFor("swatted")).toBe("S")
  })

  it("never returns nothing to render", () => {
    expect(initialsFor("")).toBe("?")
    expect(initialsFor("   ")).toBe("?")
    expect(initialsFor("!!!")).toBe("?")
  })

  it("survives names that are not latin letters", () => {
    // Usernames from these providers are routinely emoji or CJK. Splitting on
    // code units rather than code points would slice a surrogate pair in half
    // and render a replacement character.
    expect(initialsFor("東京 太郎")).toBe("東太")
    expect(initialsFor("9lives")).toBe("9")
  })
})

describe("loadImage", () => {
  it("resolves a URL through the Rust command", async () => {
    const u = url()
    fetchImage.mockResolvedValue(DATA)
    await expect(loadImage(u)).resolves.toBe(DATA)
    expect(fetchImage).toHaveBeenCalledWith(u)
  })

  it("caches by URL, so a re-render never refetches", async () => {
    const u = url()
    fetchImage.mockResolvedValue(DATA)
    await loadImage(u)
    await loadImage(u)
    expect(fetchImage).toHaveBeenCalledTimes(1)
    expect(cachedImage(u)).toBe(DATA)
  })

  it("collapses concurrent requests for the same URL onto one fetch", async () => {
    const u = url()
    fetchImage.mockResolvedValue(DATA)
    const [a, b] = await Promise.all([loadImage(u), loadImage(u)])
    expect(a).toBe(DATA)
    expect(b).toBe(DATA)
    expect(fetchImage).toHaveBeenCalledTimes(1)
  })

  it("answers null instead of throwing when the fetch fails", async () => {
    // An expired CDN URL is normal for these providers, not an exception.
    const u = url()
    fetchImage.mockRejectedValue({ kind: "Api", detail: { status: 404, message: "Gone" } })
    await expect(loadImage(u)).resolves.toBeNull()
  })

  it("does not retry a URL that already failed", async () => {
    const u = url()
    fetchImage.mockRejectedValue(new Error("boom"))
    await loadImage(u)
    await loadImage(u)
    expect(fetchImage).toHaveBeenCalledTimes(1)
    expect(cachedImage(u)).toBeNull()
  })

  it("rejects anything that is not a data URL", async () => {
    // The CSP is img-src 'self' data:, so a remote URL would render as a broken
    // image rather than as a picture.
    const u = url()
    fetchImage.mockResolvedValue("https://cdn.discordapp.com/avatars/1/a.png")
    await expect(loadImage(u)).resolves.toBeNull()
  })
})

describe("RemoteImage", () => {
  it("renders initials while nothing is resolved yet", () => {
    const html = renderToStaticMarkup(<RemoteImage url={url()} alt="Bob Ross" name="Bob Ross" />)
    expect(html).toContain("BR")
    expect(html).not.toContain("<img")
  })

  it("renders initials, not a broken image, when there is no URL at all", () => {
    const html = renderToStaticMarkup(<RemoteImage url={null} alt="Bob Ross" />)
    expect(html).toContain("BR")
    expect(html).not.toContain("<img")
  })

  it("renders the image straight away when the URL is already cached", async () => {
    const u = url()
    fetchImage.mockResolvedValue(DATA)
    await loadImage(u)
    const html = renderToStaticMarkup(<RemoteImage url={u} alt="Bob Ross" name="Bob Ross" />)
    expect(html).toContain(`src="${DATA}"`)
    expect(html).toContain('alt="Bob Ross"')
  })

  it("falls back to initials for a URL that is known to have failed", async () => {
    const u = url()
    fetchImage.mockRejectedValue(new Error("gone"))
    await loadImage(u)
    const html = renderToStaticMarkup(<RemoteImage url={u} alt="Ada Lovelace" />)
    expect(html).toContain("AL")
    expect(html).not.toContain("<img")
  })

  it("labels the placeholder so it is not read as decoration", () => {
    const html = renderToStaticMarkup(<RemoteImage url={null} alt="Bob Ross" />)
    expect(html).toContain('aria-label="Bob Ross"')
  })
})

describe("failure caching has a TTL", () => {
  it("stops hammering a dead URL, then lets it recover", async () => {
    const url = "https://swattedw.tf/api/desktop/image?u=ttl"
    let clock = 1_000_000
    __setClock(() => clock)

    fetchImage.mockRejectedValue(new Error("proxy blip"))
    expect(await loadImage(url)).toBe(null)
    expect(await loadImage(url)).toBe(null)
    // Second call was served from the negative cache, not the network.
    expect(fetchImage).toHaveBeenCalledTimes(1)

    // A transient blip must not blind the app until it restarts, which is what
    // a permanent negative cache did.
    clock += 31_000
    fetchImage.mockResolvedValue("data:image/png;base64,AAA")
    expect(await loadImage(url)).toBe("data:image/png;base64,AAA")
    expect(fetchImage).toHaveBeenCalledTimes(2)

    __setClock(() => Date.now())
  })
})
