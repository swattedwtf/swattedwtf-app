import { describe, expect, it } from "vitest"

import { captureCombo, formatCombo, isMacPlatform, NO_MODIFIER_REASON } from "./combo"

const press = (code: string, held: Partial<Record<"ctrl" | "alt" | "shift" | "meta", true>> = {}) => ({
  code,
  ctrlKey: held.ctrl ?? false,
  altKey: held.alt ?? false,
  shiftKey: held.shift ?? false,
  metaKey: held.meta ?? false,
})

describe("captureCombo", () => {
  it("builds a combo from the modifiers held and the physical key", () => {
    expect(captureCombo(press("KeyK", { ctrl: true, shift: true }))).toEqual({
      kind: "combo",
      combo: "Control+Shift+KeyK",
    })
  })

  it("names Ctrl and Cmd separately rather than collapsing them", () => {
    expect(captureCombo(press("Space", { meta: true, alt: true }))).toEqual({
      kind: "combo",
      combo: "Alt+Super+Space",
    })
  })

  /**
   * The one the parser would have let through. A system-wide grab on a bare key
   * takes that key away from every other application on the machine, so the
   * recorder refuses it rather than letting Rust refuse it a round trip later.
   */
  it("refuses a key with no modifier and says why", () => {
    const result = captureCombo(press("F5"))
    expect(result).toEqual({ kind: "rejected", reason: NO_MODIFIER_REASON })
    expect(NO_MODIFIER_REASON).toContain("Ctrl")
  })

  it("refuses a bare letter too", () => {
    expect(captureCombo(press("KeyK")).kind).toBe("rejected")
  })

  /** Holding Ctrl before pressing the real key is not a failed attempt. */
  it("keeps listening while only a modifier is down", () => {
    for (const code of ["ControlLeft", "ShiftRight", "AltLeft", "MetaLeft", "OSLeft"]) {
      expect(captureCombo(press(code, { ctrl: true })), code).toEqual({ kind: "pending" })
    }
  })

  it("treats a bare Escape as backing out, not as a rejected combo", () => {
    expect(captureCombo(press("Escape"))).toEqual({ kind: "cancel" })
  })

  /** Escape with a modifier is a real, bindable combination. */
  it("still records Escape when a modifier is held", () => {
    expect(captureCombo(press("Escape", { ctrl: true, alt: true }))).toEqual({
      kind: "combo",
      combo: "Control+Alt+Escape",
    })
  })

  it("refuses a key the Rust parser has no name for", () => {
    expect(captureCombo(press("Lang1", { ctrl: true })).kind).toBe("rejected")
    expect(captureCombo(press("BrowserBack", { ctrl: true })).kind).toBe("rejected")
  })

  it("accepts the keys the Rust parser does know", () => {
    for (const code of ["Numpad7", "ArrowUp", "Backquote", "F12", "Digit4", "MediaPlayPause"]) {
      expect(captureCombo(press(code, { ctrl: true })).kind, code).toBe("combo")
    }
  })
})

describe("formatCombo", () => {
  it("reads out the shipped default", () => {
    expect(formatCombo("CmdOrCtrl+Shift+Space", false)).toBe("Ctrl + Shift + Space")
    expect(formatCombo("CmdOrCtrl+Shift+Space", true)).toBe("Cmd + Shift + Space")
  })

  it("uses each platform's own name for the modifiers", () => {
    expect(formatCombo("Alt+Super+KeyK", false)).toBe("Alt + Win + K")
    expect(formatCombo("Alt+Super+KeyK", true)).toBe("Option + Cmd + K")
  })

  it("strips the DOM's prefixes off the key name", () => {
    expect(formatCombo("Control+Digit4", false)).toBe("Ctrl + 4")
    expect(formatCombo("Control+Numpad7", false)).toBe("Ctrl + Num 7")
    expect(formatCombo("Control+ArrowUp", false)).toBe("Ctrl + Up")
    expect(formatCombo("Control+Backquote", false)).toBe("Ctrl + `")
  })

  it("passes through a key it has no nicer name for", () => {
    expect(formatCombo("Control+F9", false)).toBe("Ctrl + F9")
  })
})

describe("isMacPlatform", () => {
  it("reads the platform string when there is one", () => {
    expect(isMacPlatform({ platform: "MacIntel" })).toBe(true)
    expect(isMacPlatform({ platform: "Win32" })).toBe(false)
  })

  it("falls back to the user agent", () => {
    expect(isMacPlatform({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" })).toBe(
      true,
    )
    expect(isMacPlatform({ userAgent: "Mozilla/5.0 (X11; Linux x86_64)" })).toBe(false)
  })

  it("answers false rather than throwing when it can read neither", () => {
    expect(isMacPlatform({})).toBe(false)
  })
})
