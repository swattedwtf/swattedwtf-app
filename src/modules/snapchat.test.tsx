import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

import { Result, descriptor, emailDescriptor, phoneDescriptor } from "./snapchat"

const found = {
  kind: "username",
  query: "teamsnapchat",
  resolvedFrom: null,
  resolutionError: null,
  contactStatus: null,
  username: "teamsnapchat",
  found: true,
  profile: {
    username: "teamsnapchat",
    displayName: "Team Snapchat",
    verified: true,
    accountType: "OFFICIAL",
    userId: "u1",
    subscriberCount: 1234,
    createdAt: "2011-09-16",
    accountAgeDays: 5000,
    storyAvailable: true,
    avatarUrl: null,
    heroUrl: null,
    snapcodePngUrl: null,
    profileUrl: "https://www.snapchat.com/add/teamsnapchat",
    addUrl: null,
    storyUrl: null,
    website: null,
  },
  usernameHistory: ["oldname"],
}

const render = (data: unknown, partial: string[] = []) =>
  renderToStaticMarkup(<Result data={data} partial={partial} />)

describe("Snapchat result", () => {
  it("renders the profile when one was found", () => {
    const html = render(found)
    expect(html).toContain("Team Snapchat")
    expect(html).toContain("@teamsnapchat")
    expect(html).toContain("1,234")
    expect(html).toContain("oldname")
  })

  it("does not claim there is no account when the resolver was unreachable", () => {
    // The resolver failing and nobody being linked to a contact used to render
    // the same sentence, which asserts something we never established about a
    // real person's contact details.
    const html = render({ ...found, found: false, contactStatus: "unavailable" })
    expect(html).toContain("could not be reached")
    expect(html).not.toContain("No Snapchat account is linked")
    expect(html).not.toContain("No Snapchat account found for that query.")
  })

  it("says plainly that nothing is linked when the resolver answered", () => {
    const html = render({ ...found, found: false, contactStatus: "not_found" })
    expect(html).toContain("No Snapchat account is linked to that contact.")
    expect(html).not.toContain("could not be reached")
  })

  it("names the resolved username, not the contact, when a profile is missing", () => {
    const html = render({
      ...found,
      found: false,
      contactStatus: "found",
      resolvedFrom: "someone@example.com",
      username: "realhandle",
    })
    expect(html).toContain("@realhandle")
    expect(html).not.toContain("@someone@example.com")
  })

  it("renders a sparse payload without throwing", () => {
    expect(() => render({ profile: {} })).not.toThrow()
  })

  it("uses no em dashes in its copy", () => {
    expect(render(found)).not.toContain("—")
  })
})

describe("Snapchat descriptor", () => {
  it("accepts a handle, an email or a phone number and rejects blank", () => {
    const check = descriptor.inputs[0].validate
    expect(check("teamsnapchat")).toBeNull()
    expect(check("a@b.co")).toBeNull()
    expect(check("+14155550123")).toBeNull()
    expect(check("")).toBeTruthy()
    expect(check("x".repeat(121))).toBeTruthy()
  })
})

describe("Snapchat email to user", () => {
  const check = emailDescriptor.inputs[0].validate

  it("accepts an email address", () => {
    expect(check("someone@example.com")).toBeNull()
    expect(check("  someone@example.com  ")).toBeNull()
  })

  it("refuses anything that is not an email", () => {
    // The page's heading promises an email lookup. Letting a username through
    // would run a different lookup than the one asked for, and bill for it.
    expect(check("teamsnapchat")).toBeTruthy()
    expect(check("+14155550123")).toBeTruthy()
    expect(check("someone@example")).toBeTruthy()
    expect(check("")).toBeTruthy()
    // 121 characters: one past the server's QUERY_MAX.
    expect(check(`${"a".repeat(116)}@b.co`)).toBeTruthy()
  })
})

describe("Snapchat phone to user", () => {
  const check = phoneDescriptor.inputs[0].validate

  it("accepts a full international number", () => {
    expect(check("+14155550123")).toBeNull()
    expect(check("+1 (415) 555-0123")).toBeNull()
    expect(check("0014155550123")).toBeNull()
  })

  it("refuses a number with no country code", () => {
    // lib/phone-validation.ts refuses to guess a country, so a bare national
    // number is rejected here rather than metered and then refused server-side.
    expect(check("4155550123")).toBeTruthy()
    expect(check("(415) 555-0123")).toBeTruthy()
  })

  it("refuses anything that is not a phone number", () => {
    expect(check("teamsnapchat")).toBeTruthy()
    expect(check("someone@example.com")).toBeTruthy()
    expect(check("")).toBeTruthy()
    expect(check("+1")).toBeTruthy()
  })
})
