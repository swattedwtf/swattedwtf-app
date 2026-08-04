import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

import {
  AddressInsightsResult,
  CobraResult,
  FalconResult,
  IntelxResult,
  SamsungResult,
  SkiptracerResult,
  addressInsightsDescriptor,
  cobraDescriptor,
  falconDescriptor,
  fmtPhone,
  intelxDescriptor,
  plural,
  prettyLabel,
  samsungDescriptor,
  skiptracerDescriptor,
} from "./tools"
import type { ModuleDescriptor, ResultProps } from "./types"
import type { ReactElement } from "react"

type Screen = (props: ResultProps) => ReactElement | null

/**
 * The Tools group.
 *
 * Every test here is about one of two failures, because they are the two that
 * matter in an OSINT product: rendering a provider outage as a finding about a
 * person, and rendering a provider's explicit "we cannot say" as a confirmation.
 */

const render = (Result: Screen, data: unknown, partial: string[] = []) =>
  renderToStaticMarkup(<Result data={data} partial={partial} />)

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const samsung = {
  mode: "direct",
  firstName: "John",
  lastName: "Smith",
  countryCode: "us",
  birthDate: "1990-01-01",
  startYear: null,
  endYear: null,
  found: true,
  status: "found",
  records: [{ fields: [{ label: "email", value: "j****@example.com" }] }],
  recordCount: 1,
  answered: true,
}

const skiptracer = {
  count: 1,
  answered: true,
  records: [
    {
      address: "1600 Pennsylvania Ave",
      city: "Washington",
      state: "DC",
      zip: "20500",
      county: "District of Columbia",
      propertyType: "SFR",
      owner: {
        name: "Jane Owner",
        address: "1600 Pennsylvania Ave",
        city: "Washington",
        state: "DC",
        zip: "20500",
      },
      persons: [
        {
          name: "John Resident",
          age: "42",
          gender: "M",
          ownershipRole: "Owner",
          occupation: "Analyst",
          deceased: false,
        },
      ],
    },
  ],
}

const address = {
  answered: true,
  found: true,
  streetLine1: "1600 Pennsylvania Ave",
  streetLine2: null,
  city: "Washington",
  stateCode: "DC",
  postalCode: "20500",
  zip4: "0003",
  countryCode: "US",
  deliveryPoint: "99",
  isCommercial: false,
  isForwarder: false,
  isValid: true,
  totalValue: "398000000",
  lastSaleDate: "1800-11-01",
  latLong: { latitude: 38.8977, longitude: -77.0365, accuracy: "RoofTop" },
  // What the server emits once it has coordinates and a map token: a Mapbox
  // static render, already rewritten onto our own image proxy. The token is not
  // in it, and must never be.
  mapImageUrl:
    "/api/desktop/image?u=" +
    encodeURIComponent(
      "https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/pin-l+ffffff(-77.0365,38.8977)/-77.0365,38.8977,16,0/640x360@2x",
    ),
  currentResidents: [
    {
      name: "Jane Resident",
      firstName: "Jane",
      middleName: null,
      lastName: "Resident",
      type: "Person",
      ageRange: "40-44",
      industry: "Government",
      linkedSince: "2021-01-20",
      alternateNames: ["J. Resident"],
      phones: [{ phoneNumber: "+12025550123", lineType: "Mobile" }],
      associatedPeople: [{ name: "Sam Associate", relation: "Household", since: "2021-01-20" }],
      historicalAddresses: [
        {
          streetLine1: "5 Old Road",
          streetLine2: null,
          city: "Chicago",
          stateCode: "IL",
          postalCode: "60601",
          locationType: "Residential",
          latLong: null,
          since: "2015-01-01",
          until: "2021-01-01",
        },
      ],
    },
  ],
  owners: [],
}

const falcon = {
  answered: true,
  query: "name@example.com",
  queryType: "email",
  groups: [
    {
      title: "Phones",
      // The group's real size, which the server carries because it is the one
      // number a cut list cannot be asked for.
      entryTotal: 1,
      entries: [{ value: "+14155550123", quantity: 3 }],
    },
  ],
  truncated: false,
  profiles: [
    {
      network: "spotify",
      name: "Real Name",
      alias: "handle",
      url: "https://open.spotify.com/user/handle",
      imageUrl: null,
    },
  ],
  discoveryCount: 12,
  incomplete: false,
}

const intelx = {
  answered: true,
  found: true,
  filename: "combo.txt",
  mimeType: "text/plain",
  size: 2048,
  content: "user@example.com:hunter2",
  truncated: false,
  totalLines: 1,
}

const cobra = {
  answered: true,
  query: "name@example.com",
  exists: true,
  handle: "namey",
  primaryProvider: "google",
  risk: { score: 12, max: 100, label: "low" },
  firstSeen: "2015-01-01",
  lastSeen: "2026-01-01",
  timesSeen: 9,
  linkedAccounts: [
    {
      platform: "spotify",
      status: "registered",
      displayName: "Namey",
      accountId: "a1",
      fullName: null,
      parsedEmail: null,
      profileImgUrl: null,
    },
  ],
  domain: {
    domain: "example.com",
    provider: "google",
    free: false,
    disposable: false,
    registrar: "MarkMonitor",
    registered: "1995-08-14",
    expires: "2027-08-13",
    suffix: "com",
    description: "Reserved for documentation",
  },
  badActivity: { blacklisted: false, reports: 0, reports24h: 0, disposable: false },
  breaches: [
    {
      name: "ExampleBreach",
      domain: "example.com",
      date: "2019-04-01",
      exposedData: ["emails", "passwords"],
      recordCount: 1000,
      description: "A breach.",
    },
  ],
  totalBreaches: 1,
}

/** Every screen, with the fixture that exercises it and the name of its provider. */
const SCREENS: { name: string; Result: Screen; full: Record<string, unknown> }[] = [
  { name: "Samsung", Result: SamsungResult, full: samsung },
  { name: "Skiptracer", Result: SkiptracerResult, full: skiptracer },
  { name: "Address Insights", Result: AddressInsightsResult, full: address },
  { name: "Falcon", Result: FalconResult, full: falcon },
  { name: "IntelX", Result: IntelxResult, full: intelx },
  { name: "Cobra", Result: CobraResult, full: cobra },
]

// ---------------------------------------------------------------------------
// The property that matters on all six
// ---------------------------------------------------------------------------

describe("every Tools screen", () => {
  for (const screen of SCREENS) {
    it(`${screen.name} renders its full payload`, () => {
      const html = render(screen.Result, screen.full)
      expect(typeof html).toBe("string")
      expect(html.length).toBeGreaterThan(0)
      expect(html).not.toContain("could not be reached")
    })

    it(`${screen.name} renders a sparse payload without throwing`, () => {
      // Sparse but ANSWERED: the provider spoke and had nothing, which is the
      // one case where a plain negative is a true statement.
      expect(() => render(screen.Result, { answered: true })).not.toThrow()
      expect(() => render(screen.Result, {})).not.toThrow()
      expect(() => render(screen.Result, null)).not.toThrow()
      expect(() => render(screen.Result, [])).not.toThrow()
    })

    it(`${screen.name} says the provider could not be reached rather than reporting a negative`, () => {
      // The server's normalisers are total, so a DEAD provider produces exactly
      // this: the full payload's shape, with found/exists false and empty lists.
      // Without the marker it is indistinguishable from a real empty answer.
      const html = render(
        screen.Result,
        { ...screen.full, answered: false, found: false, exists: false },
        ["provider"],
      )
      expect(html).toContain("could not be reached")
      expect(html).not.toContain("no records")
      expect(html).not.toContain("found nothing")
    })

    it(`${screen.name} treats an absent answered marker as unanswered`, () => {
      const { answered: _answered, ...rest } = screen.full
      expect(render(screen.Result, rest)).toContain("could not be reached")
    })

    it(`${screen.name} leaves the partial list to ResultView`, () => {
      // ResultView renders `partial` once for every module. A second copy here
      // was removed from nine files already.
      const html = render(screen.Result, screen.full, ["one", "two"])
      expect(html).not.toContain("Some sections did not load")
      expect(html).not.toContain("one, two")
    })

    it(`${screen.name} uses no em dashes`, () => {
      expect(render(screen.Result, screen.full)).not.toContain("—")
      expect(render(screen.Result, { answered: true })).not.toContain("—")
      expect(render(screen.Result, {})).not.toContain("—")
    })
  }
})

// ---------------------------------------------------------------------------
// Per-screen markers
// ---------------------------------------------------------------------------

describe("Samsung result", () => {
  it("shows the record fields and the searched identity", () => {
    const html = render(SamsungResult, samsung)
    expect(html).toContain("John Smith")
    expect(html).toContain("j****@example.com")
    expect(html).toContain("1990-01-01")
  })

  it("reports a sweep by its year range", () => {
    const html = render(SamsungResult, {
      ...samsung,
      mode: "enumerate",
      birthDate: "",
      startYear: 1980,
      endYear: 1990,
    })
    expect(html).toContain("1980 to 1990")
    expect(html).toContain("Birth date sweep")
  })

  it("states plainly that nothing matched once the provider has answered", () => {
    const html = render(SamsungResult, { ...samsung, found: false, records: [], recordCount: 0 })
    expect(html).toContain("No matching Samsung account record was found.")
  })

  it("turns the provider's own keys into readable labels", () => {
    // Samsung's records are whatever fields the upstream sent, so the label IS
    // the raw key. A column of "birth_date" reads as a database dump.
    const key = "birth_date"
    const html = render(SamsungResult, {
      ...samsung,
      records: [{ fields: [{ label: key, value: "1990-01-01" }] }],
      recordCount: 1,
    })
    expect(html).toContain(prettyLabel(key))
    expect(prettyLabel(key)).not.toBe(key)
    expect(html).not.toContain(`>${key}<`)
  })
})

describe("Skiptracer result", () => {
  it("shows the address, the owner and the people on the record", () => {
    const html = render(SkiptracerResult, skiptracer)
    expect(html).toContain("1600 Pennsylvania Ave")
    expect(html).toContain("Jane Owner")
    expect(html).toContain("John Resident")
    expect(html).toContain("Reported living")
  })

  it("never renders a null deceased flag as alive", () => {
    // `deceased` is boolean | null and null means the provider said NOTHING.
    // Rendering that as living asserts something nobody checked, about a person
    // who may well be dead.
    const html = render(SkiptracerResult, {
      ...skiptracer,
      records: [
        {
          ...skiptracer.records[0],
          persons: [{ ...skiptracer.records[0].persons[0], deceased: null }],
        },
      ],
    })
    expect(html).not.toContain("Reported living")
    expect(html).not.toContain("Reported deceased")
    expect(html).toContain("Not reported")
  })

  it("says so when the provider reports a death", () => {
    const html = render(SkiptracerResult, {
      ...skiptracer,
      records: [
        {
          ...skiptracer.records[0],
          persons: [{ ...skiptracer.records[0].persons[0], deceased: true }],
        },
      ],
    })
    expect(html).toContain("Reported deceased")
  })

  it("distinguishes an answered empty search from a dead provider", () => {
    const answered = render(SkiptracerResult, { records: [], count: 0, answered: true })
    expect(answered).toContain("Skiptracer searched and returned no records")
    const dead = render(SkiptracerResult, { records: [], count: 0, answered: false })
    expect(dead).toContain("could not be reached")
    expect(dead).not.toContain("searched and returned no records")
  })

  it("counts its records, its people and its owned properties from the rows themselves", () => {
    const html = render(SkiptracerResult, skiptracer)
    const people = skiptracer.records.reduce((n, r) => n + r.persons.length, 0)
    const owned = skiptracer.records.filter((r) => r.owner.name).length
    for (const [label, value] of [
      ["Records", skiptracer.records.length],
      ["People", people],
      ["With an owner", owned],
    ] as const) {
      expect(html).toContain(label)
      expect(html).toContain(`>${value.toLocaleString()}</div>`)
    }
  })

  it("labels a record with the property type the provider classified it as", () => {
    const html = render(SkiptracerResult, skiptracer)
    expect(html).toContain(skiptracer.records[0].propertyType)
  })
})

describe("Address Insights result", () => {
  const resident = address.currentResidents[0]

  it("shows the address, its flags and its residents", () => {
    const html = render(AddressInsightsResult, address)
    expect(html).toContain(address.streetLine1)
    expect(html).toContain(resident.name)
    expect(html).toContain(resident.associatedPeople[0].name)
    expect(html).toContain(resident.historicalAddresses[0].streetLine1)
    expect(html).toContain(`${address.latLong.latitude}, ${address.latLong.longitude}`)
  })

  it("prints a phone number the way a person would dial it", () => {
    // The raw provider string is an E.164 blob. The web's panel formats it, and
    // an OSINT result is something someone actually dials.
    const raw = resident.phones[0].phoneNumber
    const html = render(AddressInsightsResult, address)
    expect(html).toContain(fmtPhone(raw))
    expect(fmtPhone(raw)).not.toBe(raw)
    expect(html).toContain(resident.phones[0].lineType)
  })

  it("counts residents, owners, phones and past addresses from the payload itself", () => {
    const html = render(AddressInsightsResult, address)
    const people = [...address.currentResidents, ...address.owners]
    const phones = people.reduce((n, p) => n + p.phones.length, 0)
    const past = people.reduce(
      (n, p) => n + p.historicalAddresses.filter((h) => h.streetLine1).length,
      0,
    )
    for (const [label, value] of [
      ["Residents", address.currentResidents.length],
      ["Owners", address.owners.length],
      ["Phones", phones],
      ["Past addresses", past],
    ] as const) {
      expect(html).toContain(label)
      expect(html).toContain(`>${value.toLocaleString()}</div>`)
    }
  })

  it("draws the map the server rendered, labelled with the address", () => {
    const html = render(AddressInsightsResult, address)
    // The image itself resolves through the IPC bridge at runtime, so what is in
    // the markup is its label. That label has to name the place, or a map that
    // fails to load says nothing at all.
    expect(html).toContain(`Map of ${address.streetLine1}`)
    expect(html).not.toContain("No map is available")
    // Six decimals, as the web's panel prints them.
    expect(html).toContain(address.latLong.latitude.toFixed(6))
    expect(html).toContain(address.latLong.longitude.toFixed(6))
  })

  it("never puts a Mapbox token in the markup", () => {
    // The server attaches the credential at fetch time. A payload that carried
    // one would put it in the DOM of a screen anyone can screenshot.
    const html = render(AddressInsightsResult, address)
    expect(html).not.toContain("access_token")
  })

  it("says a map is unavailable rather than drawing a broken one", () => {
    // Coordinates but no render: no map token on the server. Not a fact about
    // the address, and not a reason to hide the coordinates.
    const html = render(AddressInsightsResult, { ...address, mapImageUrl: null })
    expect(html).toContain("No map is available")
    expect(html).toContain(address.latLong.latitude.toFixed(6))
  })

  it("shows no map section at all when the provider placed no coordinates", () => {
    const html = render(AddressInsightsResult, { ...address, latLong: null, mapImageUrl: null })
    expect(html).not.toContain("No map is available")
    expect(html).not.toContain("Open in a map")
    // The rest of the record is unaffected.
    expect(html).toContain(resident.name)
  })

  it("separates an unresolvable address from an unreachable provider", () => {
    expect(render(AddressInsightsResult, { answered: true, found: false })).toContain(
      "could not resolve that address",
    )
    expect(render(AddressInsightsResult, { answered: false, found: false })).toContain(
      "could not be reached",
    )
  })
})

describe("Falcon result", () => {
  it("shows groups, entry counts and profiles", () => {
    const html = render(FalconResult, falcon)
    expect(html).toContain("Phones")
    expect(html).toContain("+14155550123")
    expect(html).toContain("Real Name")
  })

  it("says the list is incomplete when entries were cut", () => {
    const html = render(FalconResult, { ...falcon, truncated: true })
    expect(html).toContain("the lists below are incomplete")
  })

  it("says the sweep is partial when it hit its deadline", () => {
    const html = render(FalconResult, { ...falcon, incomplete: true })
    expect(html).toContain("hit its time limit")
    expect(html).toContain("has not been ruled out")
  })

  it("does not claim nothing was found when the sweep timed out empty", () => {
    const html = render(FalconResult, {
      ...falcon,
      groups: [],
      profiles: [],
      discoveryCount: 0,
      incomplete: true,
    })
    expect(html).not.toContain("swept and found nothing")
    expect(html).toContain("nothing can be concluded")
  })

  it("states a clean empty sweep plainly", () => {
    const html = render(FalconResult, { ...falcon, groups: [], profiles: [], discoveryCount: 0 })
    expect(html).toContain("swept and found nothing")
  })

  it("heads a group with the size the server reported, not the size it shipped", () => {
    // The server cuts a runaway group at its own ceiling and carries the real
    // count separately. Counting the delivered rows instead would report the
    // ceiling as the total for every oversized group.
    const entries = falcon.groups[0].entries
    const entryTotal = entries.length + 3_800
    const html = render(FalconResult, {
      ...falcon,
      groups: [{ ...falcon.groups[0], entryTotal, entries }],
    })
    expect(html).toContain(entryTotal.toLocaleString())
    expect(html).toContain(`${entries.length.toLocaleString()} were carried`)
  })

  it("does not claim a complete group was cut", () => {
    const group = falcon.groups[0]
    const html = render(FalconResult, {
      ...falcon,
      groups: [{ ...group, entryTotal: group.entries.length }],
    })
    expect(html).not.toContain("were carried")
  })

  it("shows a multiplier only for a value seen more than once", () => {
    const group = falcon.groups[0]
    const once = render(FalconResult, {
      ...falcon,
      groups: [{ ...group, entries: [{ value: "solo@example.com", quantity: 1 }] }],
    })
    expect(once).toContain("solo@example.com")
    expect(once).not.toContain(">x1</span>")

    const many = render(FalconResult, falcon)
    expect(many).toContain(`>x${group.entries[0].quantity}</span>`)
  })
})

describe("IntelX result", () => {
  it("shows the file and its contents", () => {
    const html = render(IntelxResult, intelx)
    expect(html).toContain("combo.txt")
    expect(html).toContain("user@example.com:hunter2")
    expect(html).toContain("2.0 KB")
  })

  it("says when the file was cut at the download limit", () => {
    const html = render(IntelxResult, { ...intelx, truncated: true })
    expect(html).toContain("cut this file at the download limit")
  })

  it("clips a huge file and says that it did", () => {
    const html = render(IntelxResult, { ...intelx, content: "a".repeat(120_000) })
    expect(html).toContain("Showing the first 100,000 characters")
  })

  it("separates a missing file from an unreachable provider", () => {
    expect(render(IntelxResult, { answered: true, found: false })).toContain(
      "holds no file for that system ID",
    )
    expect(render(IntelxResult, { answered: false, found: false })).toContain(
      "could not be reached",
    )
  })

  it("offers the whole file to the clipboard, since the webview cannot download", () => {
    expect(render(IntelxResult, intelx)).toContain("Copy file")
    // Nothing to copy is no button, rather than a button that copies "".
    expect(render(IntelxResult, { ...intelx, content: "" })).not.toContain("Copy file")
  })
})

// ---------------------------------------------------------------------------
// The formatting helpers, on their own
// ---------------------------------------------------------------------------

describe("Tools formatting", () => {
  it("humanises a provider key without inventing words", () => {
    expect(prettyLabel("birth_date")).toBe("Birth Date")
    expect(prettyLabel("first-name")).toBe("First Name")
    expect(prettyLabel("lineType")).toBe("Line Type")
    expect(prettyLabel("email")).toBe("Email")
    // A key with nothing to humanise is still a key, never an empty label.
    expect(prettyLabel("_")).toBe("_")
  })

  it("formats a North American number and leaves every other one alone", () => {
    expect(fmtPhone("+12025550123")).toBe("(202) 555-0123")
    expect(fmtPhone("2025550123")).toBe("(202) 555-0123")
    // Reshaping an international number by a North American rule produces a
    // wrong number, and these get dialled.
    for (const raw of ["+442071234567", "+81312345678", "555", ""]) {
      expect(fmtPhone(raw)).toBe(raw)
    }
  })

  it("pluralises the nouns this file actually uses", () => {
    expect(plural(1, "record")).toBe("1 record")
    expect(plural(2, "record")).toBe("2 records")
    expect(plural(1, "address")).toBe("1 address")
    expect(plural(2, "address")).toBe("2 addresses")
    expect(plural(1, "person")).toBe("1 person")
    expect(plural(3, "person")).toBe("3 people")
  })
})

describe("Cobra result", () => {
  it("shows the identity, risk, accounts, domain and breaches", () => {
    const html = render(CobraResult, cobra)
    expect(html).toContain("namey")
    expect(html).toContain("12 of 100")
    expect(html).toContain("12%")
    expect(html).toContain("spotify")
    expect(html).toContain("Registered")
    expect(html).toContain("ExampleBreach")
    expect(html).toContain("MarkMonitor")
  })

  it("never renders an unknown linked-account status as a confirmed account", () => {
    // The provider says "unknown" deliberately: it could not confirm whether an
    // account exists on that platform. A bare status under a platform name reads
    // as a confirmation of exactly the thing it refused to confirm.
    const html = render(CobraResult, {
      ...cobra,
      linkedAccounts: [{ ...cobra.linkedAccounts[0], status: "unknown" }],
    })
    expect(html).toContain("did not confirm this account")
    // The account row itself, not the domain block's "Registered" date label.
    expect(html).not.toContain(">Registered</span>")
    expect(html).toContain("(0 confirmed of 1)")
  })

  it("treats a blank status the same way as an explicit unknown", () => {
    const html = render(CobraResult, {
      ...cobra,
      linkedAccounts: [{ ...cobra.linkedAccounts[0], status: "" }],
    })
    expect(html).toContain("did not confirm this account")
  })

  it("shows a risk score without inventing a denominator", () => {
    const html = render(CobraResult, { ...cobra, risk: { score: 12, max: null, label: "low" } })
    expect(html).toContain("12")
    expect(html).not.toContain("12 of 0")
    expect(html).not.toContain("12 of 100")
    // No max means no percentage: dividing by a number nobody sent is how
    // "12 / 0" and a NaN bar got on screen on the web.
    expect(html).not.toContain("%")
  })

  it("does not divide by a zero maximum", () => {
    const html = render(CobraResult, { ...cobra, risk: { score: 12, max: 0, label: "low" } })
    expect(html).not.toContain("12 of 0")
    expect(html).not.toContain("Infinity")
    expect(html).not.toContain("NaN")
  })

  it("omits the domain and reputation sections the provider did not send", () => {
    const html = render(CobraResult, { ...cobra, domain: null, badActivity: null })
    expect(html).not.toContain("MarkMonitor")
    expect(html).not.toContain("Blacklisted")
  })

  it("draws a risk meter whose width is the reported proportion", () => {
    const html = render(CobraResult, cobra)
    const pct = Math.round((cobra.risk.score / cobra.risk.max) * 100)
    expect(html).toContain(`width:${pct}%`)
    expect(html).toContain(`aria-valuenow="${cobra.risk.score}"`)
    expect(html).toContain(`aria-valuemax="${cobra.risk.max}"`)
  })

  it("draws no meter when nobody sent a denominator", () => {
    // A bar needs a proportion. Inventing the denominator is how a NaN width
    // and a "12 / 0" got on screen on the web.
    const html = render(CobraResult, { ...cobra, risk: { score: 12, max: null, label: "low" } })
    expect(html).not.toContain("aria-valuenow")
    expect(html).not.toContain("width:")
    expect(html).toContain("12")
  })

  it("lists every exposed data class of a breach as its own tag", () => {
    const html = render(CobraResult, cobra)
    for (const exposed of cobra.breaches[0].exposedData) {
      expect(html).toContain(`>${exposed}</span>`)
    }
  })

  it("keeps a linked account's extra fields behind a disclosure", () => {
    const account = cobra.linkedAccounts[0]
    const html = render(CobraResult, cobra)
    // The row itself is always readable.
    expect(html).toContain(account.platform)
    expect(html).toContain(account.displayName)
    // The account id only exists on a minority of rows, so it opens on demand
    // rather than padding every row with blanks.
    expect(html).toContain(">More</span>")
    expect(html).not.toContain(`>${account.accountId}</dd>`)
  })

  it("offers no disclosure on a row that has nothing behind it", () => {
    const html = render(CobraResult, {
      ...cobra,
      linkedAccounts: [
        {
          ...cobra.linkedAccounts[0],
          accountId: null,
          fullName: null,
          parsedEmail: null,
          profileImgUrl: null,
        },
      ],
    })
    expect(html).not.toContain(">More<")
  })
})

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/** A descriptor's field, by name. */
function field(d: ModuleDescriptor, name: string) {
  const found = d.inputs.find((i) => i.name === name)
  if (!found) throw new Error(`${d.id} has no ${name} field`)
  return found
}

describe("Tools validators", () => {
  it("rejects blank on every required field and accepts it on every optional one", () => {
    for (const d of [
      samsungDescriptor,
      skiptracerDescriptor,
      addressInsightsDescriptor,
      falconDescriptor,
      intelxDescriptor,
      cobraDescriptor,
    ]) {
      for (const input of d.inputs) {
        if (input.optional) expect(input.validate(""), `${d.id}.${input.name}`).toBeNull()
        else expect(input.validate(""), `${d.id}.${input.name}`).toBeTruthy()
      }
    }
  })

  it("routes every Tools module at the nav href the sidebar uses", () => {
    expect(samsungDescriptor.route).toBe("/tools/samsung")
    expect(skiptracerDescriptor.route).toBe("/tools/skiptracer")
    expect(addressInsightsDescriptor.route).toBe("/tools/address-insights")
    expect(falconDescriptor.route).toBe("/tools/falcon")
    expect(intelxDescriptor.route).toBe("/tools/intelx")
    expect(cobraDescriptor.route).toBe("/tools/cobra")
  })

  it("Samsung mirrors the server's name, country, date and year rules", () => {
    expect(field(samsungDescriptor, "first_name").validate("John")).toBeNull()
    expect(field(samsungDescriptor, "first_name").validate("x".repeat(101))).toBeTruthy()
    expect(field(samsungDescriptor, "last_name").validate("Smith")).toBeNull()
    expect(field(samsungDescriptor, "country_code").validate("us")).toBeNull()
    expect(field(samsungDescriptor, "country_code").validate("USA")).toBeTruthy()
    expect(field(samsungDescriptor, "mode").validate("enumerate")).toBeNull()
    expect(field(samsungDescriptor, "mode").validate("sweep")).toBeTruthy()
    expect(field(samsungDescriptor, "birth_date").validate("1990-01-01")).toBeNull()
    expect(field(samsungDescriptor, "birth_date").validate("01/01/1990")).toBeTruthy()
    expect(field(samsungDescriptor, "start_year").validate("1980")).toBeNull()
    expect(field(samsungDescriptor, "start_year").validate("1949")).toBeTruthy()
    // The server refuses "1990junk" where its own web route's parseInt accepted it.
    expect(field(samsungDescriptor, "end_year").validate("1990junk")).toBeTruthy()
    expect(field(samsungDescriptor, "end_year").validate(String(new Date().getUTCFullYear() + 1))).toBeTruthy()
  })

  it("Skiptracer accepts any one field and validates each one's shape", () => {
    expect(field(skiptracerDescriptor, "phone").validate("+1 415 555 0123")).toBeNull()
    expect(field(skiptracerDescriptor, "phone").validate("12345")).toBeTruthy()
    expect(field(skiptracerDescriptor, "email").validate("a@b.co")).toBeNull()
    expect(field(skiptracerDescriptor, "email").validate("not-an-email")).toBeTruthy()
    expect(field(skiptracerDescriptor, "name").validate("J")).toBeTruthy()
    expect(field(skiptracerDescriptor, "name").validate("John Smith")).toBeNull()
    expect(field(skiptracerDescriptor, "street").validate("x".repeat(201))).toBeTruthy()
    expect(field(skiptracerDescriptor, "where").validate("Washington, DC")).toBeNull()
  })

  it("Address Insights demands both halves of an address", () => {
    expect(field(addressInsightsDescriptor, "street").validate("1600 Pennsylvania Ave")).toBeNull()
    expect(field(addressInsightsDescriptor, "street").validate("")).toBeTruthy()
    expect(field(addressInsightsDescriptor, "where").validate("20500")).toBeNull()
    expect(field(addressInsightsDescriptor, "where").validate("")).toBeTruthy()
  })

  it("Falcon accepts either kind of query, since the type field picks the branch", () => {
    expect(field(falconDescriptor, "query").validate("name@example.com")).toBeNull()
    expect(field(falconDescriptor, "query").validate("+14155550123")).toBeNull()
    expect(field(falconDescriptor, "query").validate("nonsense")).toBeTruthy()
    expect(field(falconDescriptor, "query").validate("a".repeat(255))).toBeTruthy()
    expect(field(falconDescriptor, "query_type").validate("phone")).toBeNull()
    expect(field(falconDescriptor, "query_type").validate("fax")).toBeTruthy()
  })

  it("IntelX takes a UUID and nothing else", () => {
    expect(
      field(intelxDescriptor, "systemId").validate("7d2f1e0a-4c3b-4a5d-9e8f-0b1c2d3e4f50"),
    ).toBeNull()
    expect(field(intelxDescriptor, "systemId").validate("7d2f1e0a4c3b4a5d9e8f0b1c2d3e4f50")).toBeTruthy()
    expect(field(intelxDescriptor, "systemId").validate("not-a-uuid")).toBeTruthy()
  })

  it("Cobra validates each identifier it will actually send", () => {
    expect(field(cobraDescriptor, "email").validate("name@example.com")).toBeNull()
    expect(field(cobraDescriptor, "email").validate("name@example")).toBeTruthy()
    expect(field(cobraDescriptor, "phone").validate("+14155550123")).toBeNull()
    expect(field(cobraDescriptor, "ip").validate("8.8.8.8")).toBeNull()
    expect(field(cobraDescriptor, "ip").validate("2001:4860:4860::8888")).toBeNull()
    expect(field(cobraDescriptor, "ip").validate("not an ip")).toBeTruthy()
    // The server truncates a country to two characters in silence, which turns
    // "United States" into "UN". Refused here instead of searched.
    expect(field(cobraDescriptor, "country").validate("US")).toBeNull()
    expect(field(cobraDescriptor, "country").validate("United States")).toBeTruthy()
    expect(field(cobraDescriptor, "postal").validate("94103")).toBeNull()
    expect(field(cobraDescriptor, "postal").validate("1".repeat(13))).toBeTruthy()
  })
})
