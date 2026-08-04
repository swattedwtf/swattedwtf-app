import { describe, expect, it } from "vitest"

import {
  DEFAULT_THEME,
  FONT_STACKS,
  PRESETS,
  PRESET_IDS,
  THEME_STORAGE_KEY,
  applyTheme,
  matchPreset,
  parseTheme,
  readStoredTheme,
  sanitizeTheme,
  serializeTheme,
  themeToVars,
  writeStoredTheme,
  type ThemeConfig,
  type ThemeStore,
  type ThemeTarget,
} from "./theme"

/** An in-memory stand-in for localStorage. No jsdom in this project. */
function fakeStore(seed?: string): ThemeStore & { read(): string | null } {
  let value = seed ?? null
  return {
    getItem: () => value,
    setItem: (_key, v) => {
      value = v
    },
    read: () => value,
  }
}

/** A stand-in for `<html>`, recording what was written to it. */
function fakeTarget(): ThemeTarget & { vars: Record<string, string> } {
  const vars: Record<string, string> = {}
  return {
    vars,
    style: {
      setProperty: (name, value) => {
        vars[name] = value
      },
    },
    dataset: {},
  }
}

describe("themeToVars", () => {
  it("maps the default config onto the variables theme.css declares", () => {
    const vars = themeToVars(DEFAULT_THEME)
    // Every property the stylesheet reads has to be present, or the missing one
    // silently falls back to the :root default and the theme is half-applied.
    expect(Object.keys(vars).sort()).toEqual(
      [
        "--accent",
        "--background",
        "--border",
        "--card",
        "--font-sans",
        "--foreground",
        "--input",
        "--muted",
        "--muted-foreground",
        "--popover",
        "--primary",
        "--primary-foreground",
        "--radius",
        "--ring",
        "--secondary",
      ].sort(),
    )
    expect(vars["--radius"]).toBe("0.5rem")
    expect(vars["--font-sans"]).toBe(FONT_STACKS.system)
    expect(vars["--primary"]).toBe("#ffffff")
    expect(vars["--ring"]).toBe("#ffffff")
  })

  it("gives an explicitly light config the dark variables anyway", () => {
    // The invariant, not a snapshot: asking for light must produce exactly what
    // asking for dark produces. Light mode is gated off in sanitizeTheme until
    // the ~174 `text-white` classes are token-driven, and the gate is what this
    // asserts. When light is re-enabled this test is the one that should fail,
    // loudly and on purpose.
    const dark = themeToVars({ ...DEFAULT_THEME, mode: "dark" })
    const asked = themeToVars({ ...DEFAULT_THEME, mode: "light" })
    expect(asked).toEqual(dark)
    expect(asked["--background"]).toBe("oklch(0.04 0 0)")
    expect(asked["--foreground"]).toBe("oklch(0.985 0 0)")
  })

  it("keeps a grey accent perfectly neutral and tints surfaces for a coloured one", () => {
    // The whole point of the isColored check: #ffffff must not put a color-mix
    // into every surface, or the black-and-white palette stops being neutral.
    const neutral = themeToVars({ ...DEFAULT_THEME, accent: "#ffffff" })
    expect(neutral["--card"]).toBe("oklch(0.08 0 0)")

    const tinted = themeToVars({ ...DEFAULT_THEME, accent: "#5b8def" })
    expect(tinted["--card"]).toBe("color-mix(in oklab, oklch(0.08 0 0) 96%, #5b8def 4%)")
  })

  it("picks a readable foreground for text sitting on the accent", () => {
    expect(themeToVars({ ...DEFAULT_THEME, accent: "#ffffff" })["--primary-foreground"]).toBe(
      "oklch(0.04 0 0)",
    )
    expect(themeToVars({ ...DEFAULT_THEME, accent: "#1d1d55" })["--primary-foreground"]).toBe(
      "oklch(0.985 0 0)",
    )
  })

  it("carries the chosen font stack through", () => {
    expect(themeToVars({ ...DEFAULT_THEME, font: "mono" })["--font-sans"]).toBe(FONT_STACKS.mono)
    expect(themeToVars({ ...DEFAULT_THEME, font: "serif" })["--font-sans"]).toBe(FONT_STACKS.serif)
  })

  it("sanitizes before mapping, so an out-of-range config still yields valid CSS", () => {
    const vars = themeToVars({
      preset: "custom",
      mode: "dark",
      accent: "not a colour",
      depth: 9999,
      radius: -4,
      font: "system",
    })
    expect(vars["--radius"]).toBe("0rem")
    expect(vars["--primary"]).toBe(DEFAULT_THEME.accent)
    expect(vars["--background"]).toBe("oklch(0.2 0 0)")
  })

  it("produces usable variables for every preset", () => {
    for (const id of PRESET_IDS) {
      const vars = themeToVars(PRESETS[id])
      for (const [name, value] of Object.entries(vars)) {
        expect(value, `${id} ${name}`).toBeTruthy()
        expect(value, `${id} ${name}`).not.toContain("NaN")
        expect(value, `${id} ${name}`).not.toContain("undefined")
      }
    }
  })
})

describe("light mode is off", () => {
  // The gate itself. What it looks like from the DOM's side is asserted in the
  // applyTheme block below.

  it("coerces a light mode asked for directly", () => {
    expect(sanitizeTheme({ ...DEFAULT_THEME, mode: "light" }).mode).toBe("dark")
  })

  it("coerces a light mode already sitting in storage", () => {
    // The realistic route in: a build that offered the control wrote this, and
    // the user then updated. Nothing re-writes storage until they touch a
    // control, so the read is what has to be safe.
    const stored = JSON.stringify({
      config: { preset: "custom", mode: "light", accent: "#4f46e5", depth: 22, radius: 0.5, font: "system" },
    })
    expect(readStoredTheme(fakeStore(stored)).mode).toBe("dark")
  })

  it("never even writes a light mode into storage", () => {
    // Defence on the way out as well as on the way in, so storage cannot hold a
    // light config for a later build to find and trust.
    const store = fakeStore()
    writeStoredTheme({ ...DEFAULT_THEME, mode: "light" }, store)
    const written = JSON.parse(store.read() as string)
    expect(written.config.mode).toBe("dark")
    expect(written.vars["--foreground"]).toBe("oklch(0.985 0 0)")
  })
})

describe("sanitizeTheme", () => {
  it("accepts a valid config unchanged", () => {
    const cfg: ThemeConfig = {
      preset: "midnight",
      mode: "dark",
      accent: "#5b8def",
      depth: 26,
      radius: 0.65,
      font: "system",
    }
    expect(sanitizeTheme(cfg)).toEqual(cfg)
  })

  it("normalizes a three-digit, uppercase or unprefixed hex", () => {
    expect(sanitizeTheme({ accent: "#ABC" }).accent).toBe("#aabbcc")
    expect(sanitizeTheme({ accent: "34D399" }).accent).toBe("#34d399")
    expect(sanitizeTheme({ accent: "  #F43F5E  " }).accent).toBe("#f43f5e")
  })

  it("clamps the numeric controls into range", () => {
    expect(sanitizeTheme({ depth: -20 }).depth).toBe(0)
    expect(sanitizeTheme({ depth: 1e9 }).depth).toBe(100)
    expect(sanitizeTheme({ radius: 99 }).radius).toBe(1.25)
  })

  it("falls back rather than throwing on any shape at all", () => {
    for (const bad of [null, undefined, 0, "dark", [1, 2, 3], true, () => {}]) {
      const cfg = sanitizeTheme(bad)
      expect(cfg.mode).toBe("dark")
      expect(cfg.accent).toBe(DEFAULT_THEME.accent)
      expect(cfg.font).toBe("system")
      expect(cfg.depth).toBe(DEFAULT_THEME.depth)
      expect(cfg.radius).toBe(DEFAULT_THEME.radius)
    }
  })

  it("rejects values that are the right type but not one of ours", () => {
    // A newer client's theme opened by an older one, which is exactly what a
    // staged rollout produces.
    const cfg = sanitizeTheme({
      preset: "vaporwave",
      mode: "sepia",
      font: "comic",
      accent: "#zzzzzz",
      depth: "quite dark",
      radius: null,
    })
    expect(cfg.preset).toBe("custom")
    expect(cfg.mode).toBe("dark")
    expect(cfg.font).toBe("system")
    expect(cfg.accent).toBe(DEFAULT_THEME.accent)
    expect(cfg.depth).toBe(DEFAULT_THEME.depth)
    expect(cfg.radius).toBe(DEFAULT_THEME.radius)
  })

  it("drops a field the desktop client does not have", () => {
    // The web config carries `effect`; this client does not render one and must
    // not carry it forward into storage either.
    const cfg = sanitizeTheme({ ...DEFAULT_THEME, effect: "storm" })
    expect(cfg).not.toHaveProperty("effect")
  })
})

describe("matchPreset", () => {
  it("recognises every preset by its values", () => {
    for (const id of PRESET_IDS) expect(matchPreset(PRESETS[id])).toBe(id)
  })

  it("calls a tweaked preset custom", () => {
    expect(matchPreset({ ...PRESETS.midnight, accent: "#ec4899" })).toBe("custom")
  })
})

describe("storage round-trip", () => {
  it("returns exactly what was written", () => {
    const store = fakeStore()
    const cfg: ThemeConfig = {
      preset: "custom",
      mode: "dark",
      accent: "#22d3ee",
      depth: 37,
      radius: 1.1,
      font: "serif",
    }
    writeStoredTheme(cfg, store)
    expect(readStoredTheme(store)).toEqual(cfg)
  })

  it("coerces a stored light mode back to dark on read", () => {
    // A config written by an older build, or hand-edited in devtools, must not
    // be able to select a light theme the stylesheet cannot render.
    const store = fakeStore()
    writeStoredTheme({ ...DEFAULT_THEME, mode: "light" }, store)
    expect(readStoredTheme(store).mode).toBe("dark")
  })

  it("writes under the documented key, with the vars alongside the config", () => {
    const store = fakeStore()
    writeStoredTheme(PRESETS.emerald, store)
    const raw = store.read()
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw as string)
    expect(parsed.config).toEqual(PRESETS.emerald)
    expect(parsed.vars["--primary"]).toBe("#34d399")
    expect(THEME_STORAGE_KEY).toBe("swattedwtf-theme")
  })

  it("survives every preset", () => {
    for (const id of PRESET_IDS) {
      const store = fakeStore()
      writeStoredTheme(PRESETS[id], store)
      expect(readStoredTheme(store)).toEqual(PRESETS[id])
    }
  })
})

describe("reading corrupt or unknown storage", () => {
  it("falls back to the default instead of throwing", () => {
    const cases = [
      null,
      "",
      "{",
      "not json at all",
      "null",
      '"dark"',
      "[1,2,3]",
      "123",
      '{"config":null}',
      '{"config":"midnight"}',
      '{"mode":"neon","depth":"abc","radius":"round","font":"papyrus","accent":42}',
      // A half-written value, which is what a crash mid-write leaves behind.
      '{"config":{"mode":"light","accent":"#5b8d',
    ]
    for (const raw of cases) {
      const cfg = readStoredTheme(fakeStore(raw as string))
      expect(() => themeToVars(cfg)).not.toThrow()
      expect(cfg.mode, raw ?? "null").toBe("dark")
      expect(cfg.accent, raw ?? "null").toBe(DEFAULT_THEME.accent)
      expect(cfg.font, raw ?? "null").toBe("system")
    }
  })

  it("accepts a bare config as well as the { config, vars } envelope", () => {
    expect(readStoredTheme(fakeStore(JSON.stringify(PRESETS.crimson)))).toEqual(PRESETS.crimson)
    expect(readStoredTheme(fakeStore(serializeTheme(PRESETS.crimson)))).toEqual(PRESETS.crimson)
  })

  it("falls back when storage itself is missing or throws", () => {
    expect(readStoredTheme(null)).toEqual(DEFAULT_THEME)
    const hostile: ThemeStore = {
      getItem: () => {
        throw new Error("SecurityError: access is denied for this document")
      },
      setItem: () => {
        throw new Error("QuotaExceededError")
      },
    }
    expect(readStoredTheme(hostile)).toEqual(DEFAULT_THEME)
    // And a failed write is swallowed: the theme still applies for this run.
    expect(() => writeStoredTheme(DEFAULT_THEME, hostile)).not.toThrow()
    expect(() => writeStoredTheme(DEFAULT_THEME, null)).not.toThrow()
  })

  it("parseTheme never throws, whatever it is handed", () => {
    for (const raw of [undefined, null, "", "}{", " "]) {
      expect(parseTheme(raw)).toEqual(DEFAULT_THEME)
    }
  })
})

describe("applyTheme", () => {
  it("writes every variable and the mode attribute onto the target", () => {
    const target = fakeTarget()
    applyTheme(PRESETS.amethyst, target)
    expect(target.dataset.theme).toBe("dark")
    expect(target.vars).toEqual(themeToVars(PRESETS.amethyst))
  })

  it("never stamps a light theme onto the document", () => {
    // theme.css has no [data-theme="light"] block, so stamping light would put
    // dark text on near-black glass. Every preset must therefore be dark, and
    // an explicitly light config must still come out dark.
    for (const id of PRESET_IDS) {
      const target = fakeTarget()
      applyTheme(PRESETS[id], target)
      expect(target.dataset.theme, `${id} is not dark`).toBe("dark")
    }
    const forced = fakeTarget()
    applyTheme({ ...DEFAULT_THEME, mode: "light" }, forced)
    expect(forced.dataset.theme).toBe("dark")
  })

  it("overwrites the previous theme completely, leaving nothing stale behind", () => {
    const target = fakeTarget()
    applyTheme(PRESETS.crimson, target)
    applyTheme(PRESETS.emerald, target)
    expect(target.vars).toEqual(themeToVars(PRESETS.emerald))
  })
})
