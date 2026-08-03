import { describe, expect, it } from "vitest"
import { resolveWelcomeName, shouldPromptTelegram } from "./welcome"

const base = {
  user: { email: "cried2@proton.me", userNumber: 1234 },
  telegram: { username: "cried", linked: true },
}

describe("resolveWelcomeName", () => {
  it("prefers the linked telegram username", () => {
    expect(resolveWelcomeName(base)).toBe("cried")
  })

  it("falls back to the email local part", () => {
    expect(resolveWelcomeName({ ...base, telegram: { username: null, linked: false } })).toBe(
      "cried2",
    )
  })

  it("falls back to the user number when there is no email", () => {
    expect(
      resolveWelcomeName({
        user: { email: null, userNumber: 1234 },
        telegram: { username: null, linked: false },
      }),
    ).toBe("User #1234")
  })

  it("ignores a blank telegram username", () => {
    expect(resolveWelcomeName({ ...base, telegram: { username: "   ", linked: true } })).toBe(
      "cried2",
    )
  })

  it("ignores an email that is only an at sign", () => {
    expect(
      resolveWelcomeName({
        user: { email: "@example.com", userNumber: 77 },
        telegram: { username: null, linked: false },
      }),
    ).toBe("User #77")
  })

  it("strips a leading at sign from the telegram username", () => {
    expect(resolveWelcomeName({ ...base, telegram: { username: "@cried", linked: true } })).toBe(
      "cried",
    )
  })
})

describe("shouldPromptTelegram", () => {
  it("prompts when telegram is not linked", () => {
    expect(shouldPromptTelegram({ ...base, telegram: { username: null, linked: false } })).toBe(true)
  })

  it("stays quiet when telegram is linked", () => {
    expect(shouldPromptTelegram(base)).toBe(false)
  })

  it("prompts when the username is present but blank", () => {
    expect(shouldPromptTelegram({ ...base, telegram: { username: "  ", linked: true } })).toBe(true)
  })
})
