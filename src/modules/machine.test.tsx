import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

import { Result, descriptor } from "./machine"

/** The server's search payload when a single machine matched: the dump is
 *  hydrated eagerly, so the screen lands straight on it. */
const singleHit = {
  query: "victim@a.co",
  searchId: "SID-1",
  victims: [
    {
      logId: "LOG-ABC",
      machineGrant: "grant-abc",
      user: "durmu",
      hwid: "4668D48F",
      ip: "31.206.108.223",
      email: "victim@a.co",
      discord: "123456789012345678",
      totalDocs: 21,
      pwnedAt: "2023-12-30T05:28:31Z",
      indexedAt: "2024-01-02T00:00:00Z",
      deviceUsers: ["durmu"],
      hwids: ["4668D48F"],
      ips: ["31.206.108.223"],
      emails: ["victim@a.co"],
      discordIds: ["123456789012345678"],
    },
  ],
  dump: {
    filename: "TR_ABC_2024",
    hash: "0dd2b43926304dca6b8bee29b98d1d8f",
    user: "durmu",
    hardwareId: "4668D48F24AF0C03061F3BFF5EB0EB21",
    stats: { files: 2, folders: 1, creds: 1, emails: 1 },
    ips: ["31.206.108.223"],
    discord: ["123456789012345678"],
    emails: ["victim@a.co"],
    totalCreds: 1101,
    emailCount: 1,
    files: [
      { name: "Cookies/Chrome.txt", danger: false },
      { name: "Passwords.txt", danger: true },
    ],
  },
}

/** Several machines matched: no dump yet, the user must pick one. */
const manyHits = {
  query: "durmu",
  searchId: "SID-2",
  victims: [
    {
      logId: "LOG-1",
      machineGrant: "grant-1",
      user: "durmu",
      hwid: "HW-1",
      ip: "31.206.108.223",
      email: "a@a.co",
      discord: "111",
      totalDocs: 21,
      pwnedAt: "2023-12-30T05:28:31Z",
      indexedAt: null,
      deviceUsers: ["durmu"],
      hwids: ["HW-1"],
      ips: ["31.206.108.223"],
      emails: ["a@a.co"],
      discordIds: ["111"],
    },
    {
      logId: "LOG-2",
      machineGrant: "grant-2",
      user: "ali",
      hwid: "HW-2",
      ip: "10.0.0.9",
      email: "b@b.co",
      discord: "",
      totalDocs: 8,
      pwnedAt: null,
      indexedAt: null,
      deviceUsers: ["ali"],
      hwids: ["HW-2"],
      ips: ["10.0.0.9"],
      emails: ["b@b.co"],
      discordIds: [],
    },
  ],
  dump: null,
}

/** Nothing matched. */
const noHits = { query: "nobody", searchId: "SID-3", victims: [], dump: null }

const render = (data: unknown, partial: string[] = []) =>
  renderToStaticMarkup(<Result data={data} partial={partial} />)

describe("Machine result", () => {
  it("lands on the dump when a single machine matched", () => {
    const html = render(singleHit)
    expect(html).toContain("durmu")
    expect(html).toContain("4668D48F24AF0C03061F3BFF5EB0EB21")
    expect(html).toContain("IP addresses (1)")
    expect(html).toContain("31.206.108.223")
    expect(html).toContain("Email addresses (1)")
    expect(html).toContain("victim@a.co")
    expect(html).toContain("Files (2)")
    expect(html).toContain("Cookies/Chrome.txt")
    expect(html).toContain("Passwords.txt")
  })

  it("lists the matching machines when several matched", () => {
    const html = render(manyHits)
    expect(html).toContain("2 matching machines")
    expect(html).toContain("LOG-1")
    expect(html).toContain("LOG-2")
    expect(html).toContain("durmu")
    expect(html).toContain("ali")
    expect(html).toContain("a@a.co")
    // No dump is loaded yet, so no file section is rendered.
    expect(html).not.toContain("Files (")
  })

  it("says so plainly when nothing matched", () => {
    expect(render(noHits)).toContain("No machines matched that query.")
  })

  it("renders a sparse dump with empty states rather than throwing", () => {
    const sparse = {
      query: "q",
      searchId: null,
      victims: [],
      dump: {
        filename: "",
        hash: "",
        user: "",
        hardwareId: "",
        stats: { files: 0, folders: 0, creds: 0, emails: 0 },
        ips: [],
        discord: [],
        emails: [],
        totalCreds: 0,
        emailCount: 0,
        files: [],
      },
    }
    const html = render(sparse)
    expect(html).toContain("Unknown machine")
    expect(html).toContain("No IP addresses in this dump.")
    expect(html).toContain("No email addresses in this dump.")
    expect(html).toContain("No files listed in this dump.")
  })

  it("does not throw when whole sections are missing", () => {
    expect(() => render({ query: "q" })).not.toThrow()
    expect(() => render({})).not.toThrow()
    expect(() => render({ victims: [{ logId: "L" }], dump: null })).not.toThrow()
  })

  it("leaves naming the failed sources to ResultView, which renders it once", () => {
    const html = render(singleHit, ["machine"])
    expect(html).not.toContain("Some sources did not answer")
    expect(html).not.toContain("Some sections did not load")
  })

  it("uses no em dashes in its own copy", () => {
    expect(render(noHits)).not.toContain("—")
    expect(render(manyHits)).not.toContain("—")
    expect(render(singleHit)).not.toContain("—")
  })
})

describe("Machine descriptor", () => {
  it("accepts a query and rejects blanks and oversized values", () => {
    const check = descriptor.inputs[0].validate
    expect(check("victim@a.co")).toBeNull()
    expect(check("  victim@a.co  ")).toBeNull()
    expect(check("x".repeat(256))).toBeNull()
    expect(check("")).toBe("Enter a machine search query.")
    expect(check("   ")).toBe("Enter a machine search query.")
    expect(check("x".repeat(257))).toBe("Enter a machine search query.")
  })

  it("declares the id, route and query field the app expects", () => {
    expect(descriptor.id).toBe("machine")
    expect(descriptor.route).toBe("/machine")
    expect(descriptor.label).toBe("Machine Browser")
    expect(descriptor.inputs[0].name).toBe("query")
  })
})
