import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

import { Result, descriptor } from "./machine"

/** What the server sends when the machine dump was full. */
const full = {
  pcKey: "PC-ABC123",
  pcName: "DESKTOP-9QK",
  ingestedAt: "2024-05-01T00:00:00Z",
  credentialPairs: ["https://site.test | user:pass", "https://x.test | a:b"],
  passwords: ["hunter2", "letmein"],
  emails: ["victim@a.co"],
  files: ["C:/Users/x/wallet.dat"],
  metadata: [
    { key: "country", value: "US" },
    { key: "os", value: "Windows 10" },
  ],
  counts: { credentialPairs: 2, passwords: 2, emails: 1, files: 1 },
}

/** The same shape with everything empty: a machine that resolved by key but
 *  carried nothing, which is an ordinary case, not an error. */
const sparse = {
  pcKey: "PC-EMPTY",
  pcName: "",
  ingestedAt: null,
  credentialPairs: [],
  passwords: [],
  emails: [],
  files: [],
  metadata: [],
  counts: { credentialPairs: 0, passwords: 0, emails: 0, files: 0 },
}

const render = (data: unknown, partial: string[] = []) =>
  renderToStaticMarkup(<Result data={data} partial={partial} />)

describe("Machine result", () => {
  it("renders the machine identity and each populated section", () => {
    const html = render(full)
    expect(html).toContain("DESKTOP-9QK")
    expect(html).toContain("PC-ABC123")
    expect(html).toContain("Credentials (2)")
    expect(html).toContain("https://site.test | user:pass")
    expect(html).toContain("Passwords (2)")
    expect(html).toContain("hunter2")
    expect(html).toContain("Email addresses (1)")
    expect(html).toContain("victim@a.co")
    expect(html).toContain("Files (1)")
    expect(html).toContain("C:/Users/x/wallet.dat")
    expect(html).toContain("Machine details")
    expect(html).toContain("Windows 10")
  })

  it("falls back to the machine key for the name when the PC name is absent", () => {
    const html = render(sparse)
    expect(html).toContain("PC-EMPTY")
  })

  it("renders a sparse payload with empty states rather than throwing", () => {
    const html = render(sparse)
    expect(html).toContain("No saved credentials in this dump.")
    expect(html).toContain("No passwords in this dump.")
    expect(html).toContain("No email addresses in this dump.")
    expect(html).toContain("No files listed in this dump.")
  })

  it("does not throw when whole sections are missing", () => {
    expect(() => render({ pcKey: "PC-X" })).not.toThrow()
    expect(() => render({})).not.toThrow()
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
    expect(render(sparse)).not.toContain("—")
    expect(render(full)).not.toContain("—")
  })
})

describe("Machine descriptor", () => {
  it("accepts a key and rejects blanks and oversized values", () => {
    const check = descriptor.inputs[0].validate
    expect(check("PC-ABC123")).toBeNull()
    expect(check("  PC-ABC123  ")).toBeNull()
    expect(check("x".repeat(200))).toBeNull()
    expect(check("")).toBe("Enter a machine key.")
    expect(check("   ")).toBe("Enter a machine key.")
    expect(check("x".repeat(201))).toBe("Enter a machine key.")
  })

  it("declares the id and route the app expects", () => {
    expect(descriptor.id).toBe("machine")
    expect(descriptor.route).toBe("/machine")
    expect(descriptor.label).toBe("Machine Browser")
  })
})
