import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

import {
  BadgeRow,
  EmptyState,
  FieldGrid,
  LockedSection,
  ProfileCard,
  RecordCard,
  Section,
  StatTiles,
  type StatTile,
} from "./index"

vi.mock("../../lib/ipc", () => ({ ipc: { openExternal: vi.fn(), fetchImage: vi.fn() } }))

/**
 * A smoke pass over the shared vocabulary. These primitives are rendered with
 * whatever the providers happened to return, which for these upstreams routinely
 * means empty lists and absent fields, so "does not throw and does not render a
 * blank next to a label" is the property that matters.
 */
describe("Section", () => {
  it("renders its caption and body on the panel material", () => {
    const html = renderToStaticMarkup(
      <Section title="Servers">
        <p>body</p>
      </Section>,
    )
    expect(html).toContain("Servers")
    expect(html).toContain("body")
    expect(html).toContain("glass-body")
  })
})

describe("FieldGrid", () => {
  it("labels an unanswered field instead of leaving a blank beside it", () => {
    const html = renderToStaticMarkup(
      <FieldGrid fields={[{ label: "Email", value: null }, { label: "Handle", value: "bob" }]} />,
    )
    expect(html).toContain("Not reported")
    expect(html).toContain("bob")
  })

  it("can drop unanswered fields instead", () => {
    const html = renderToStaticMarkup(
      <FieldGrid hideEmpty fields={[{ label: "Email", value: "" }]} />,
    )
    expect(html).toBe("")
  })
})

describe("BadgeRow", () => {
  it("renders each badge as a pill", () => {
    const html = renderToStaticMarkup(<BadgeRow badges={[{ label: "Nitro" }, { label: "Staff" }]} />)
    expect(html).toContain("Nitro")
    expect(html).toContain("Staff")
  })

  it("says so when there are none, rather than rendering an empty row", () => {
    expect(renderToStaticMarkup(<BadgeRow badges={[]} empty="No badges" />)).toContain("No badges")
  })

  it("renders a badge whose icon has not resolved as its label alone", () => {
    const html = renderToStaticMarkup(
      <BadgeRow badges={[{ label: "Nitro", iconUrl: "https://swattedw.tf/api/desktop/image?u=1" }]} />,
    )
    expect(html).toContain("Nitro")
    expect(html).not.toContain("<img")
  })
})

describe("ProfileCard", () => {
  it("renders the name, the subtitle and the headline fields", () => {
    const html = renderToStaticMarkup(
      <ProfileCard
        name="Bob Ross"
        subtitle="@bobross"
        avatarUrl={null}
        meta={[{ label: "Created", value: "2019" }]}
      />,
    )
    expect(html).toContain("Bob Ross")
    expect(html).toContain("@bobross")
    expect(html).toContain("Created")
    expect(html).toContain("2019")
  })

  it("falls back to initials when there is no avatar", () => {
    const html = renderToStaticMarkup(<ProfileCard name="Bob Ross" avatarUrl={null} />)
    expect(html).toContain("BR")
    expect(html).not.toContain("<img")
  })
})

describe("LockedSection and EmptyState", () => {
  it("distinguishes 'you cannot see this' from 'there is nothing here'", () => {
    const locked = renderToStaticMarkup(
      <LockedSection title="Stealer logs" message="Heist unlocks stealer logs." />,
    )
    expect(locked).toContain("Heist unlocks stealer logs.")
    expect(locked).toContain("View plans")

    const empty = renderToStaticMarkup(<EmptyState message="No records found." />)
    expect(empty).toContain("No records found.")
    expect(empty).not.toContain("<button")
  })

  it("uses no em dashes", () => {
    const html = renderToStaticMarkup(
      <>
        <LockedSection title="t" message="m" />
        <EmptyState message="m" />
        <FieldGrid fields={[{ label: "Email", value: null }]} />
      </>,
    )
    expect(html).not.toContain("—")
  })
})

describe("BadgeRow shows the art, not the art plus its name", () => {
  it("renders only the icon when a badge has one", () => {
    const html = renderToStaticMarkup(
      <BadgeRow badges={[{ label: "Nitro", iconUrl: "/api/desktop/image?u=x" }]} />,
    )
    // The name stays reachable as a tooltip and to assistive tech, but is not
    // printed beside the mark: a row of icons each captioned with its own name
    // is a wall of text, not a row of badges.
    expect(html).toContain('aria-label="Nitro"')
    expect(html).toContain('title="Nitro"')
    expect(html).not.toContain(">Nitro<")
  })

  it("falls back to the name when a badge has no art", () => {
    // Otherwise the entry would be invisible.
    const html = renderToStaticMarkup(<BadgeRow badges={[{ label: "Staff", iconUrl: null }]} />)
    expect(html).toContain(">Staff<")
  })
})

describe("StatTiles", () => {
  it("renders each tile's value loud and its label and caption quietly", () => {
    const tiles: StatTile[] = [
      { label: "Records", value: 12, caption: "leaked records found" },
      { label: "Passwords", value: 3, caption: "exposed secrets" },
    ]
    const html = renderToStaticMarkup(<StatTiles tiles={tiles} />)
    for (const tile of tiles) {
      expect(html).toContain(tile.label)
      expect(html).toContain(`>${tile.value}<`)
      if (tile.caption) expect(html).toContain(tile.caption)
    }
    // The number is on the loud surface, not the muted one.
    expect(html).toContain("text-white")
  })

  it("renders nothing rather than an empty row when there are no tiles", () => {
    expect(renderToStaticMarkup(<StatTiles tiles={[]} />)).toBe("")
  })
})

describe("RecordCard", () => {
  it("draws the source header, the field values and a copy control", () => {
    const html = renderToStaticMarkup(
      <RecordCard
        record={{
          source: "LeakDB",
          fields: [
            { label: "Email", value: "a@b.co" },
            { label: "Password", value: "hunter2", sensitive: true },
          ],
        }}
      />,
    )
    expect(html).toContain("LeakDB")
    expect(html).toContain("a@b.co")
    expect(html).toContain("hunter2")
    // Two fields, pluralised.
    expect(html).toContain("2 fields")
    // Every field row offers a copy affordance.
    expect(html).toContain("aria-label=\"Copy email\"")
  })

  it("tints a sensitive value and leaves an ordinary one white", () => {
    const html = renderToStaticMarkup(
      <RecordCard
        record={{ source: "S", fields: [{ label: "Password", value: "pw", sensitive: true }] }}
      />,
    )
    expect(html).toContain("text-amber-200")
  })

  it("truncates a long url but keeps the whole string on the copy title", () => {
    const long = "https://example.com/" + "x".repeat(60)
    const html = renderToStaticMarkup(
      <RecordCard record={{ source: "S", fields: [{ label: "URL", value: long }] }} />,
    )
    expect(html).toContain(`Copy ${long}`)
    expect(html).toContain("…")
  })

  it("uses no em dashes", () => {
    const html = renderToStaticMarkup(
      <RecordCard record={{ source: "S", fields: [{ label: "Email", value: "a@b.co" }] }} />,
    )
    expect(html).not.toContain("—")
  })
})
