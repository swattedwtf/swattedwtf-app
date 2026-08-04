import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

import { Result, descriptor } from "./snapchat"

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
