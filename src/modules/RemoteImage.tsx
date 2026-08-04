import { useEffect, useState } from "react"

import { ipc } from "../lib/ipc"

/**
 * Every image in a lookup result.
 *
 * Nothing remote renders directly: the webview's CSP is `img-src 'self' data:`,
 * and our image proxy needs a session cookie only Rust holds. So a URL from a
 * payload is resolved through `ipc.fetchImage`, which accepts our own origin
 * and nothing else and answers with a `data:` URL.
 *
 * It must never throw and never leave a broken `<img>` on screen. Expiring CDN
 * URLs are normal for these providers, so a failure is an initials placeholder,
 * not an error.
 */

/**
 * url -> data URL, for successes only.
 *
 * Module-level and deliberately unbounded: a result screen holds a few dozen
 * avatars at most, a data URL never expires, and the cache dies with the window.
 */
const cache = new Map<string, string>()

/**
 * url -> when it last failed.
 *
 * Failures are remembered so a dead avatar is not refetched once per render,
 * but only for FAILURE_TTL_MS. A permanent negative cache was the first
 * version, and it was wrong for this app: the usual cause of a failure here is
 * a transient proxy or network blip, and remembering it forever meant one bad
 * moment left the placeholder stuck until the user restarted the app. A short
 * window stops the retry storm without making the failure permanent.
 */
const failures = new Map<string, number>()

const FAILURE_TTL_MS = 30_000

/** Requests in flight, so two components sharing a URL make one call. */
const inflight = new Map<string, Promise<string | null>>()

/** Injected in tests so the TTL can be exercised without waiting. */
let now = () => Date.now()

export function __setClock(fn: () => number) {
  now = fn
}

function failedRecently(url: string): boolean {
  const at = failures.get(url)
  if (at === undefined) return false
  if (now() - at < FAILURE_TTL_MS) return true
  failures.delete(url)
  return false
}

/** The resolved data URL for a URL already fetched, or null. Never fetches. */
export function cachedImage(url: string): string | null {
  return cache.get(url) || null
}

/**
 * Resolves a URL to a `data:` URL, or null.
 *
 * Rejections are swallowed on purpose: the caller's only reasonable response is
 * the placeholder, and an unhandled rejection in a render effect would surface
 * as a console error on a perfectly normal expired avatar.
 */
export function loadImage(url: string): Promise<string | null> {
  // Already inline. Telegram's resolver downloads avatars itself and embeds
  // them, so there is nothing to fetch and nothing for Rust to validate: the
  // bytes ARE the payload, and the server has already shape-checked them.
  // Sending these through fetch_image only produced "blocked image url".
  if (url.startsWith("data:image/")) return Promise.resolve(url)

  const hit = cache.get(url)
  if (hit !== undefined) return Promise.resolve(hit)
  if (failedRecently(url)) return Promise.resolve(null)

  const pending = inflight.get(url)
  if (pending) return pending

  const request = ipc
    .fetchImage(url)
    .then((data) => {
      // Rust should only ever answer with a data URL, but anything else would
      // render as a broken image under the CSP, so treat it as a failure here
      // rather than putting it in the DOM.
      if (typeof data === "string" && data.startsWith("data:")) {
        cache.set(url, data)
        return data
      }
      failures.set(url, now())
      return null
    })
    .catch(() => {
      failures.set(url, now())
      return null
    })
    .finally(() => {
      inflight.delete(url)
    })

  inflight.set(url, request)
  return request
}

/**
 * Up to two initials for a placeholder.
 *
 * Split by code point, not code unit: usernames here are routinely emoji or
 * CJK, and slicing a surrogate pair in half renders a replacement character.
 */
export function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const letters: string[] = []
  for (const word of words) {
    const first = Array.from(word)[0]
    if (first && /[\p{L}\p{N}]/u.test(first)) letters.push(first.toUpperCase())
    if (letters.length === 2) break
  }
  return letters.length ? letters.join("") : "?"
}

export function RemoteImage({
  url,
  alt,
  name,
  className = "",
}: {
  /** Absolute URL on our own origin, or null when the payload had none. */
  url: string | null | undefined
  /** What the image is of. Also the placeholder's label. */
  alt: string
  /** Name the initials come from. Defaults to `alt`. */
  name?: string
  /** Sizing and shape. Applied to the image and the placeholder alike, so the
   *  layout does not move when one becomes the other. */
  className?: string
}) {
  // Seeded from the cache so a screen that has already loaded an avatar does
  // not flash the placeholder on every remount.
  const [src, setSrc] = useState<string | null>(() => (url ? cachedImage(url) : null))

  useEffect(() => {
    if (!url) {
      setSrc(null)
      return
    }
    const hit = cachedImage(url)
    if (hit) {
      setSrc(hit)
      return
    }
    let cancelled = false
    void loadImage(url).then((data) => {
      if (!cancelled) setSrc(data)
    })
    return () => {
      cancelled = true
    }
  }, [url])

  if (src) {
    return (
      <img
        src={src}
        alt={alt}
        // A malformed data URL is the one failure the fetch cannot catch, so
        // the element removes itself rather than sitting there broken.
        onError={() => setSrc(null)}
        className={`object-cover ${className}`}
      />
    )
  }

  return (
    <span
      role="img"
      aria-label={alt}
      className={`inline-flex select-none items-center justify-center bg-white/[0.06] text-[var(--color-muted-foreground)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] ${className}`}
    >
      {initialsFor(name ?? alt)}
    </span>
  )
}
