import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

import type { LookupResult, Overview } from "../lib/ipc"
import { BUILT_IN_ROUTES } from "./registry"
import { isEnabled, flattenNav } from "../shell/nav"
import {
  coerce,
  FaceResult,
  FaceScreen,
  formatCredit,
  OutOfCreditPanel,
  readFrame,
} from "./face"

/**
 * Reverse Face spends real money on every press, so the tests that matter are
 * about the two things that would cost a user something they cannot see: a
 * failed search reading as "nothing found", and an empty wallet being answered
 * with "buy a bigger plan".
 */

function overviewWith(balanceCents: number): Overview {
  return {
    user: { id: "1", userNumber: 1, email: null, handle: "u" },
    telegram: { username: null, linked: false },
    security: { twofaEnabled: false },
    plan: {
      id: "pro",
      label: "Premium",
      monthlyLimit: 0,
      since: "",
      balanceCents,
      status: "",
      dailyLimit: null,
    },
    usage: { todayCount: 0, monthCount: 0, allTimeCount: 0, nextResetMs: 0, series: [] },
    api: {
      active: false,
      tierLabel: null,
      usedToday: 0,
      dailyLimit: null,
      expiresAt: null,
      key: null,
    },
  }
}

const result = (data: unknown, partial: string[] = [], schema = 1): LookupResult => ({
  schema,
  data: data as Record<string, unknown>,
  partial,
})

const match = (over: Record<string, unknown> = {}) => ({
  id: "abc",
  quality: 91.4,
  sourceUrl: "https://example.org/page",
  sourceHost: "example.org",
  thumbnailUrl: "/api/desktop/image?u=https%3A%2F%2Fjsc1.pimeyes.com%2Fp",
  crawledAt: "2025-07-03T00:00:00.000Z",
  ...over,
})

/** Deep-empty stand-in: every read yields an empty value rather than a throw. */
function hollow(): unknown {
  return new Proxy(
    {},
    {
      get(_t, key) {
        if (key === Symbol.toPrimitive || key === "toString") return () => ""
        if (key === "length") return 0
        if (key === Symbol.iterator) return [][Symbol.iterator].bind([])
        if (key === "map" || key === "filter" || key === "slice") return () => []
        if (key === "then") return undefined
        return hollow()
      },
    },
  )
}

describe("the route", () => {
  it("answers on /face, exactly as the nav row names it", () => {
    expect(BUILT_IN_ROUTES).toContain("/face")
    expect(isEnabled("/face")).toBe(true)
    expect(flattenNav().map((i) => i.href)).toContain("/face")
  })

  it("stays an exact match, so a child route is not this screen", () => {
    expect(isEnabled("/face/evil")).toBe(false)
  })
})

describe("the stream contract", () => {
  it("reads the face count as progress", () => {
    expect(readFrame({ t: "faces", faces: 2 })).toEqual({ kind: "faces", faces: 2 })
    expect(readFrame({ t: "faces" })).toEqual({ kind: "faces", faces: 0 })
  })

  it("reads the one result frame as the lookup envelope it is", () => {
    const read = readFrame({ t: "result", schema: 1, data: { status: "empty" }, partial: [] })
    expect(read).toEqual({
      kind: "result",
      result: { schema: 1, data: { status: "empty" }, partial: [] },
    })
  })

  it("survives a result frame missing every field, rather than throwing in render", () => {
    const read = readFrame({ t: "result" })
    expect(read).toEqual({ kind: "result", result: { schema: 0, data: {}, partial: [] } })
  })

  it("treats the route's own error backstop as a failure, never as a result", () => {
    expect(readFrame({ t: "error", error: "Lookup failed" })).toEqual({
      kind: "error",
      error: "Lookup failed",
    })
    // Even with no copy at all, it must not become an empty answer.
    expect(readFrame({ t: "error" })).toEqual({ kind: "error", error: "The search failed." })
  })

  it("ignores a frame this build does not know", () => {
    // A server newer than this client. Ignoring is right: the `result` frame is
    // what the screen waits for, and inventing meaning for an unknown one is
    // how a half-understood answer gets rendered as fact.
    expect(readFrame({ t: "activity", id: "x" })).toBeNull()
    expect(readFrame({})).toBeNull()
  })
})

describe("a failed search", () => {
  it("never renders as no matches found", () => {
    // The whole point of the `status` marker. A failed search and a search that
    // matched nothing arrive as identical empty arrays, and saying "no matches"
    // about a search that never ran is a claim about a person's face.
    const html = renderToStaticMarkup(
      <FaceResult
        result={result(
          {
            status: "failed",
            error: "The facial-search provider is out of credits.",
            faces: 0,
            webCount: 0,
            socialCount: 0,
            matches: [],
            socialMatches: [],
          },
          ["matches"],
        )}
      />,
    )
    expect(html).toContain("Search failed")
    expect(html).toContain("The facial-search provider is out of credits.")
    expect(html).not.toContain("not found anywhere")
    expect(html).not.toContain("No face was detected")
  })

  it("still says something when the server named no reason", () => {
    const html = renderToStaticMarkup(
      <FaceResult result={result({ status: "failed", matches: [], socialMatches: [] })} />,
    )
    expect(html).toContain("did not complete")
  })

  it("treats a status this build does not know as a failure, not as empty", () => {
    // A server newer than this client. "I do not understand the answer" must
    // never be read as "nothing was found".
    for (const status of ["partial", "", undefined, 5, null]) {
      expect(coerce({ status, matches: [], socialMatches: [] }).status).toBe("failed")
    }
  })
})

describe("a search that ran", () => {
  it("distinguishes a face nobody has seen from a photo with no face in it", () => {
    const found = renderToStaticMarkup(
      <FaceResult result={result({ status: "empty", faces: 1, matches: [], socialMatches: [] })} />,
    )
    expect(found).toContain("not found anywhere")

    const noFace = renderToStaticMarkup(
      <FaceResult result={result({ status: "empty", faces: 0, matches: [], socialMatches: [] })} />,
    )
    expect(noFace).toContain("No face was detected")
  })

  it("renders both buckets with their real totals", () => {
    const html = renderToStaticMarkup(
      <FaceResult
        result={result({
          status: "matched",
          faces: 1,
          webCount: 500,
          socialCount: 3,
          matches: [match(), match({ id: "def", sourceHost: "studyflix.de" })],
          socialMatches: [match({ id: "soc", sourceHost: "x.com" })],
        })}
      />,
    )
    expect(html).toContain("Web matches (500)")
    expect(html).toContain("Social matches (3)")
    expect(html).toContain("example.org")
    expect(html).toContain("studyflix.de")
    // The cap is real and has to be admitted, or the screen claims 500 results
    // while showing two.
    expect(html).toContain("Showing the 2 strongest of 500")
  })

  it("hides a bucket the provider had nothing for, rather than showing an empty grid", () => {
    const html = renderToStaticMarkup(
      <FaceResult
        result={result({
          status: "matched",
          webCount: 1,
          socialCount: 0,
          matches: [match()],
          socialMatches: [],
        })}
      />,
    )
    expect(html).toContain("Web matches (1)")
    expect(html).not.toContain("Social matches")
  })

  it("shows the quality as a whole percent and the crawl date in words", () => {
    const html = renderToStaticMarkup(
      <FaceResult
        result={result({ status: "matched", webCount: 1, matches: [match()], socialMatches: [] })}
      />,
    )
    expect(html).toContain("91%")
    expect(html).toContain("Crawled Jul 3, 2025")
  })

  it("says to update the app rather than drawing half a screen from a newer schema", () => {
    const html = renderToStaticMarkup(
      <FaceResult result={result({ status: "matched" }, [], 99)} />,
    )
    expect(html).toContain("Update the app")
  })
})

describe("payload coercion", () => {
  it("survives a payload where every field is missing", () => {
    expect(() =>
      renderToStaticMarkup(<FaceResult result={result(hollow())} />),
    ).not.toThrow()
  })

  it("survives a payload that is not an object at all", () => {
    for (const data of [null, "results", 5, []]) {
      expect(() => renderToStaticMarkup(<FaceResult result={result(data)} />)).not.toThrow()
    }
  })

  it("never throws on a match list holding the wrong shapes", () => {
    const data = { status: "matched", webCount: 2, matches: "nope", socialMatches: [null, 5] }
    expect(coerce(data).matches).toEqual([])
    expect(() => renderToStaticMarkup(<FaceResult result={result(data)} />)).not.toThrow()
  })
})

describe("out of credit", () => {
  it("is its own state, with a top up rather than an upgrade", () => {
    // `credits_required` classifies as `upgrade`, and the shared panel answers
    // that with "Upgrade" and the plans page. The account's plan is fine here;
    // its wallet is empty, and the two are bought in different places.
    const html = renderToStaticMarkup(
      <OutOfCreditPanel message="You're out of search credit. Top up to run a Reverse Face search." />,
    )
    expect(html).toContain("Out of credit")
    expect(html).toContain("You&#x27;re out of search credit.")
    expect(html).toContain("Top up")
    expect(html).not.toContain("Upgrade")
    expect(html).toContain("$0.60")
  })
})

describe("the screen at rest", () => {
  const render = (balance: number) =>
    renderToStaticMarkup(<FaceScreen overview={overviewWith(balance)} />)

  it("names itself as the nav row does and asks for a photo", () => {
    const html = render(600)
    expect(html).toContain("Reverse Face")
    expect(html).toContain("Choose photo")
    expect(html).toContain("Choose a photo to search.")
  })

  it("states the price and the balance before anything is spent", () => {
    // This is the one screen where pressing Search spends money outright, so a
    // balance nobody was shown is a support ticket.
    const html = render(600)
    expect(html).toContain("$6.00 credit left")
    expect(html).toContain("about 10 searches")
    expect(html).toContain("Each search costs $0.60")
  })

  it("offers no Search button until a photo has been chosen", () => {
    expect(render(600)).not.toContain("Search this face")
  })

  it("reads an absent or negative balance as zero rather than as $NaN", () => {
    expect(formatCredit(undefined)).toBe("$0.00")
    expect(formatCredit(null)).toBe("$0.00")
    expect(formatCredit(-100)).toBe("$0.00")
    expect(formatCredit(60)).toBe("$0.60")
  })

  it("uses no em dashes in any copy", () => {
    const screens = [
      render(0),
      renderToStaticMarkup(<OutOfCreditPanel message="x" />),
      renderToStaticMarkup(<FaceResult result={result({ status: "failed", error: "x" })} />),
      renderToStaticMarkup(<FaceResult result={result({ status: "empty", faces: 1 })} />),
      renderToStaticMarkup(
        <FaceResult
          result={result({ status: "matched", webCount: 9, matches: [match()], socialMatches: [] })}
        />,
      ),
    ]
    for (const html of screens) expect(html).not.toContain("—")
  })
})
