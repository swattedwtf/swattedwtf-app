/**
 * Per-user theme engine, ported from the web's `lib/theme.ts`.
 *
 * The whole client is skinned by CSS custom properties declared in
 * `src/theme.css` (`--background`, `--foreground`, `--card`, `--border`,
 * `--radius`, `--font-sans`, `--muted-foreground`, ...) and every screen reads
 * them through the matching `@theme inline` tokens. Overriding those properties
 * on `<html>` therefore re-skins the entire app instantly, with no re-render
 * and no per-component wiring.
 *
 * A `ThemeConfig` holds the user's control values; `themeToVars()` is the
 * single source of truth that turns one into a flat map of overrides. Nothing
 * else in the app is allowed to compute a colour from the config.
 *
 * Three deliberate differences from the web engine.
 *
 * PERSISTENCE IS LOCAL ONLY. The web debounce-saves the config to the account
 * so a theme follows you between browsers. The desktop client has no endpoint
 * for that and inventing one is a server change, so the config lives in this
 * webview's localStorage and nowhere else. Two machines therefore theme
 * independently, which is the honest behaviour for a per-device setting.
 *
 * NO AMBIENT EFFECTS. The web's rain/snow/storm/stars/embers are canvas layers
 * driven by a requestAnimationFrame loop that never stops. In a browser tab
 * that loop is throttled the moment the tab is backgrounded; a desktop window
 * sitting behind another window is not backgrounded, so the same code would
 * burn a core and a laptop's battery for a decoration nobody is looking at.
 * The field is not in `ThemeConfig` at all rather than present and ignored.
 *
 * STORAGE IS INJECTABLE. `readStoredTheme`/`writeStoredTheme` take the store as
 * an argument so the round-trip is testable without a DOM, and so a webview
 * that throws on `localStorage` access (private mode, a restricted origin)
 * degrades to the default theme instead of taking the settings page down with
 * it. That failure mode is not hypothetical: this screen has already crashed
 * once on an unguarded read.
 */

export type ThemeMode = "dark" | "light"
export type FontKey = "system" | "geometric" | "mono" | "serif"

export type ThemeConfig = {
  /** Preset id (see PRESETS) or "custom" once the user tweaks a control. */
  preset: string
  mode: ThemeMode
  /** Accent colour as a #rrggbb hex string. Drives primary/ring plus a subtle tint. */
  accent: string
  /** Background depth 0-100 (darker to lighter within the chosen mode). */
  depth: number
  /** Corner roundness in rem (0-1.25), drives --radius. */
  radius: number
  font: FontKey
}

export const THEME_STORAGE_KEY = "swattedwtf-theme"

export const FONT_STACKS: Record<FontKey, string> = {
  system: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  geometric:
    "'Futura', 'Century Gothic', 'Avenir Next', 'Segoe UI', system-ui, sans-serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
  serif: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif",
}

export const FONT_LABELS: Record<FontKey, string> = {
  system: "System",
  geometric: "Geometric",
  mono: "Monospace",
  serif: "Serif",
}

export const FONT_KEYS: FontKey[] = ["system", "geometric", "mono", "serif"]

/** Curated presets. Each is just a ThemeConfig; the gallery renders these. */
export const PRESETS: Record<string, ThemeConfig> = {
  swatted: { preset: "swatted", mode: "dark", accent: "#ffffff", depth: 20, radius: 0.5, font: "system" },
  midnight: { preset: "midnight", mode: "dark", accent: "#5b8def", depth: 26, radius: 0.65, font: "system" },
  emerald: { preset: "emerald", mode: "dark", accent: "#34d399", depth: 20, radius: 0.5, font: "system" },
  amethyst: { preset: "amethyst", mode: "dark", accent: "#a78bfa", depth: 24, radius: 0.85, font: "system" },
  crimson: { preset: "crimson", mode: "dark", accent: "#f43f5e", depth: 18, radius: 0.5, font: "system" },
}

export const PRESET_LABELS: Record<string, string> = {
  swatted: "Swatted",
  midnight: "Midnight",
  emerald: "Emerald",
  amethyst: "Amethyst",
  crimson: "Crimson",
}

export const PRESET_IDS: string[] = Object.keys(PRESETS)

export const DEFAULT_THEME: ThemeConfig = PRESETS.swatted

/* ---- helpers ----------------------------------------------------------- */

function clampNum(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.trim().replace(/^#/, "")
  if (h.length === 3) h = h.split("").map((c) => c + c).join("")
  const int = parseInt(h, 16)
  if (h.length !== 6 || Number.isNaN(int)) return { r: 255, g: 255, b: 255 }
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 }
}

/** True when the accent has enough saturation to be worth tinting surfaces with. */
function isColored(hex: string): boolean {
  const { r, g, b } = hexToRgb(hex)
  return Math.max(r, g, b) - Math.min(r, g, b) > 12
}

/** Pick a readable foreground (near-black / near-white) for text ON the accent. */
function contrastOn(hex: string): string {
  const { r, g, b } = hexToRgb(hex)
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  const Y = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  return Y > 0.45 ? "oklch(0.04 0 0)" : "oklch(0.985 0 0)"
}

/**
 * A neutral surface at lightness `L`, optionally tinted toward the accent by
 * `pct`% (via color-mix, so no colour-space conversion is needed in JS). When
 * the accent is effectively grey the mix is skipped entirely so the default
 * pure-black/white palette stays exactly neutral.
 */
function surface(L: number, accent: string, pct: number, colored: boolean): string {
  const base = `oklch(${round(L)} 0 0)`
  if (!colored || pct <= 0) return base
  return `color-mix(in oklab, ${base} ${100 - pct}%, ${accent} ${pct}%)`
}

/** The full set of CSS-variable overrides for a config. Source of truth. */
export function themeToVars(input: ThemeConfig): Record<string, string> {
  const cfg = sanitizeTheme(input)
  const accent = cfg.accent
  const colored = isColored(accent)
  const primaryFg = contrastOn(accent)
  const radius = `${round(cfg.radius)}rem`
  const font = FONT_STACKS[cfg.font] ?? FONT_STACKS.system

  // UNREACHABLE TODAY, AND KEPT ON PURPOSE. `sanitizeTheme` above forces the
  // mode to dark, so nothing gets in here. It is left intact because light mode
  // is not a missing feature, it is a finished one held behind one blocker: the
  // ~174 `text-white` classes that bypass --foreground. The day those become
  // token-driven, this branch and the [data-theme="light"] block in theme.css
  // are already waiting and the gate is a one-line change. Deleting it would
  // mean rediscovering the depth curve and the two foreground lightnesses from
  // scratch. Delete it only if the decision becomes "never", not "not yet".
  if (cfg.mode === "light") {
    const bgL = clampNum(1 - (cfg.depth / 100) * 0.28, 0.9, 1)
    const cardL = Math.min(bgL + 0.03, 1)
    const panelL = bgL - 0.04
    const borderL = bgL - 0.12
    return {
      "--background": surface(bgL, accent, 3, colored),
      "--foreground": "oklch(0.21 0 0)",
      "--card": surface(cardL, accent, 2, colored),
      "--popover": surface(cardL, accent, 2, colored),
      "--primary": accent,
      "--primary-foreground": primaryFg,
      "--secondary": surface(panelL, accent, 4, colored),
      "--muted": surface(panelL, accent, 4, colored),
      "--muted-foreground": "oklch(0.45 0 0)",
      "--accent": surface(panelL, accent, 5, colored),
      "--border": surface(borderL, accent, 6, colored),
      "--input": surface(borderL, accent, 6, colored),
      "--ring": accent,
      "--radius": radius,
      "--font-sans": font,
    }
  }

  // dark
  const bgL = clampNum((cfg.depth / 100) * 0.2, 0, 0.2)
  const cardL = bgL + 0.04
  const panelL = bgL + 0.1
  const borderL = bgL + 0.14
  return {
    "--background": surface(bgL, accent, 4, colored),
    "--foreground": "oklch(0.985 0 0)",
    "--card": surface(cardL, accent, 4, colored),
    "--popover": surface(cardL, accent, 4, colored),
    "--primary": accent,
    "--primary-foreground": primaryFg,
    "--secondary": surface(panelL, accent, 5, colored),
    "--muted": surface(panelL, accent, 5, colored),
    "--muted-foreground": surface(0.62, accent, 6, colored),
    "--accent": surface(panelL, accent, 5, colored),
    "--border": surface(borderL, accent, 7, colored),
    "--input": surface(borderL, accent, 7, colored),
    "--ring": accent,
    "--radius": radius,
    "--font-sans": font,
  }
}

/**
 * Coerce arbitrary or untrusted input into a valid, in-range ThemeConfig.
 *
 * THIS IS ALSO WHERE LIGHT MODE IS SWITCHED OFF. `mode` is forced to "dark"
 * whatever the caller asked for, so a stored config, a hand-edited
 * localStorage entry or a future call site cannot get a light theme onto the
 * DOM by any route. Every read, every write and every call into `themeToVars`
 * passes through here, which is why the gate is here and not in the component.
 *
 * The reason is not that light mode was never built. `themeToVars` has a
 * complete, working light branch (kept deliberately; see the note on it) and
 * `theme.css` has the `[data-theme="light"]` block that swaps the glass
 * material. What is missing is the mechanical part: ~174 occurrences of
 * `text-white` across 37 components bypass `--foreground` entirely and are
 * therefore not steered by any of the above. Turning light on before those are
 * token-driven ships pale text on pale panels in 37 files, so it stays off.
 *
 * To re-enable, once that migration lands: restore the line below to
 * `o.mode === "light" ? "light" : "dark"`, put back the Dark/Light control in
 * ThemeSection and a light preset. Nothing else has to change.
 */
export function sanitizeTheme(input: unknown): ThemeConfig {
  // `typeof null === "object"`, and a stored `[1,2,3]` or `"dark"` is object-ish
  // enough to reach here too. Every field is read defensively rather than
  // destructured, so any of those shapes yields the default rather than a throw.
  const o = (input && typeof input === "object" ? input : {}) as Partial<ThemeConfig>
  const mode: ThemeMode = "dark"
  const font: FontKey = FONT_KEYS.includes(o.font as FontKey) ? (o.font as FontKey) : "system"
  const accent = normalizeHex(o.accent)
  const preset =
    typeof o.preset === "string" && (o.preset === "custom" || o.preset in PRESETS)
      ? o.preset
      : "custom"
  return {
    preset,
    mode,
    accent,
    depth: numberOr(o.depth, DEFAULT_THEME.depth, 0, 100),
    radius: numberOr(o.radius, DEFAULT_THEME.radius, 0, 1.25),
    font,
  }
}

/**
 * A slider value, or the default.
 *
 * Deliberately not `Number(value)`: `Number(null)`, `Number(false)` and
 * `Number("")` are all 0, which is a legal value for both sliders, so a stored
 * `null` would silently read as "flat black, zero corners" rather than as
 * "missing". Only a real number, or a string that is entirely one, counts.
 */
function numberOr(value: unknown, fallback: number, min: number, max: number): number {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN
  return Number.isFinite(n) ? clampNum(n, min, max) : fallback
}

function normalizeHex(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_THEME.accent
  let h = value.trim().toLowerCase()
  if (!h.startsWith("#")) h = `#${h}`
  if (/^#[0-9a-f]{3}$/.test(h)) {
    h = "#" + h.slice(1).split("").map((c) => c + c).join("")
  }
  return /^#[0-9a-f]{6}$/.test(h) ? h : DEFAULT_THEME.accent
}

/** Parse a stored theme string. Defensive: anything unusable becomes the default. */
export function parseTheme(raw: string | null | undefined): ThemeConfig {
  if (!raw) return DEFAULT_THEME
  try {
    const obj: unknown = JSON.parse(raw)
    // Stored as { config, vars } so the pre-paint apply could read the vars
    // straight out; a bare config is accepted too.
    const config =
      obj && typeof obj === "object" && "config" in obj ? (obj as { config: unknown }).config : obj
    return sanitizeTheme(config)
  } catch {
    return DEFAULT_THEME
  }
}

export function serializeTheme(cfg: ThemeConfig): string {
  const config = sanitizeTheme(cfg)
  return JSON.stringify({ config, vars: themeToVars(config) })
}

/** True when two configs describe the same theme (used to detect "custom"). */
export function sameTheme(a: ThemeConfig, b: ThemeConfig): boolean {
  return (
    a.mode === b.mode &&
    a.accent === b.accent &&
    a.font === b.font &&
    Math.abs(a.depth - b.depth) < 0.5 &&
    Math.abs(a.radius - b.radius) < 0.001
  )
}

/** Match a config against the presets, returning the matching id or "custom". */
export function matchPreset(cfg: ThemeConfig): string {
  for (const [id, preset] of Object.entries(PRESETS)) {
    if (sameTheme(cfg, preset)) return id
  }
  return "custom"
}

/* ---- storage ----------------------------------------------------------- */

/** The slice of `Storage` this module uses. Structural, so tests can fake it. */
export type ThemeStore = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * The webview's own localStorage, or null.
 *
 * Reached through a try/catch because merely *touching* the property throws in
 * some embedded webviews, which is not something a settings screen may die on.
 */
export function defaultStore(): ThemeStore | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function readStoredTheme(store: ThemeStore | null = defaultStore()): ThemeConfig {
  if (!store) return DEFAULT_THEME
  try {
    return parseTheme(store.getItem(THEME_STORAGE_KEY))
  } catch {
    return DEFAULT_THEME
  }
}

export function writeStoredTheme(
  cfg: ThemeConfig,
  store: ThemeStore | null = defaultStore(),
): void {
  if (!store) return
  try {
    store.setItem(THEME_STORAGE_KEY, serializeTheme(cfg))
  } catch {
    // Quota exhausted or storage disabled. The theme still applies in memory
    // for this run, which beats refusing to change it at all.
  }
}

/* ---- applying ---------------------------------------------------------- */

/** The bit of an element this module writes to. Structural, so tests can fake it. */
export type ThemeTarget = {
  style: { setProperty(name: string, value: string): void }
  dataset: { theme?: string }
}

/**
 * Write a config onto an element, normally `<html>`.
 *
 * `data-theme` is set alongside the variables so a future light mode can swap
 * the glass material, which cannot be expressed as a colour: its rim-lights,
 * fills and shadows are layered for a dark backdrop.
 *
 * The mode written is the SANITISED one, never the caller's. themeToVars
 * sanitises internally, so reading `cfg.mode` here stamped `data-theme="light"`
 * over a set of dark variables: the one combination that would have selected a
 * light stylesheet block for a dark theme.
 */
export function applyTheme(cfg: ThemeConfig, target: ThemeTarget): void {
  const clean = sanitizeTheme(cfg)
  const vars = themeToVars(clean)
  for (const [name, value] of Object.entries(vars)) target.style.setProperty(name, value)
  target.dataset.theme = clean.mode
}

/**
 * Apply whatever is in storage to the document. Called from `main.tsx` before
 * the React root is created, so the first painted frame is already the user's
 * theme rather than the default one replaced a frame later.
 *
 * Returns the config it applied so the settings screen can seed its state from
 * the same read instead of doing a second one.
 */
export function applyStoredTheme(): ThemeConfig {
  const cfg = readStoredTheme()
  if (typeof document !== "undefined" && document.documentElement) {
    applyTheme(cfg, document.documentElement)
  }
  return cfg
}
