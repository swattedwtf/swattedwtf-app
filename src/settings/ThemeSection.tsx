import { useEffect, useState, type ReactNode } from "react"
import { Palette, RotateCcw } from "lucide-react"

import {
  DEFAULT_THEME,
  FONT_KEYS,
  FONT_LABELS,
  PRESETS,
  PRESET_IDS,
  PRESET_LABELS,
  applyTheme,
  matchPreset,
  readStoredTheme,
  sanitizeTheme,
  themeToVars,
  writeStoredTheme,
  type FontKey,
  type ThemeConfig,
} from "./theme"

/**
 * Appearance.
 *
 * The controls are deliberately the same six the web offers, minus the ambient
 * weather effects (see the note in theme.ts: a never-idling animation loop is a
 * different proposition in a desktop window than in a browser tab).
 *
 * Every control writes a whole `ThemeConfig` through `sanitizeTheme`, so the
 * value that reaches storage is always in range whatever the input element
 * produced. A range input can be driven to a non-numeric value by the platform
 * in at least one case (an empty string, when the control is reset), and this
 * screen is not allowed to crash.
 */

const CAPTION =
  "font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]"

/** The colours offered as one click. Anything else goes through the picker. */
const ACCENT_SWATCHES = [
  "#ffffff",
  "#5b8def",
  "#34d399",
  "#a78bfa",
  "#f43f5e",
  "#f59e0b",
  "#22d3ee",
  "#ec4899",
]

export function ThemeSection() {
  // Read once, lazily. In a test renderer there is no localStorage and no
  // document; `readStoredTheme` answers with the default rather than throwing,
  // which is the whole point of routing every read through it.
  const [theme, setTheme] = useState<ThemeConfig>(() => readStoredTheme())

  // Applying and persisting are the same event: there is no Save button here
  // because there is nothing to fail. A theme that previewed and then did not
  // stick would be the confusing outcome, so the write happens with the paint.
  useEffect(() => {
    if (typeof document === "undefined") return
    applyTheme(theme, document.documentElement)
    writeStoredTheme(theme)
  }, [theme])

  /** Patch one or more controls. Snaps back to a preset id when it lands on one. */
  const patch = (next: Partial<ThemeConfig>) => {
    setTheme((prev) => {
      const merged = sanitizeTheme({ ...prev, ...next })
      return { ...merged, preset: matchPreset(merged) }
    })
  }

  const isDefault = theme.preset === DEFAULT_THEME.preset

  return (
    <section className="glass">
      <div className="glass-body">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <Palette className="h-4 w-4 opacity-70" aria-hidden="true" />
            <h2 className={CAPTION}>Appearance</h2>
          </div>
          <button
            type="button"
            onClick={() => setTheme({ ...DEFAULT_THEME })}
            disabled={isDefault}
            className="btn-secondary btn-compact shrink-0"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Reset
          </button>
        </div>

        <div className="mt-5 space-y-6">
          <Field label="Presets">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {PRESET_IDS.map((id) => (
                <PresetTile
                  key={id}
                  id={id}
                  active={theme.preset === id}
                  onSelect={() => setTheme({ ...PRESETS[id] })}
                />
              ))}
            </div>
          </Field>

          {/* No Dark/Light control. sanitizeTheme forces the mode to dark, so
              both buttons would do the same thing, and a two-option control
              where the options are identical is worse than no control at all.
              The reason light is off, and the one line that turns it back on,
              are written out on sanitizeTheme in theme.ts. */}

          <Field label="Accent colour">
            <div className="flex flex-wrap items-center gap-2.5">
              {ACCENT_SWATCHES.map((hex) => {
                const active = theme.accent.toLowerCase() === hex
                return (
                  <button
                    key={hex}
                    type="button"
                    aria-label={`Accent ${hex}`}
                    aria-pressed={active}
                    onClick={() => patch({ accent: hex })}
                    className={`h-7 w-7 rounded-full transition-transform hover:scale-110 ${
                      active
                        ? "ring-2 ring-white ring-offset-2 ring-offset-transparent"
                        : "ring-1 ring-white/20"
                    }`}
                    // A swatch IS its colour. The rule against inline surface
                    // colours is about surfaces; this is the value itself.
                    style={{ backgroundColor: hex }}
                  />
                )
              })}
              <label className="glass-input relative inline-flex h-7 cursor-pointer items-center gap-2 overflow-hidden px-2.5 text-[11px]">
                <span
                  className="h-3.5 w-3.5 shrink-0 rounded-full"
                  style={{ backgroundColor: theme.accent }}
                />
                <span className="font-mono uppercase tracking-[0.08em] text-white/70">
                  {theme.accent}
                </span>
                <input
                  type="color"
                  aria-label="Custom accent colour"
                  value={theme.accent}
                  onChange={(e) => patch({ accent: e.target.value })}
                  className="absolute inset-0 cursor-pointer opacity-0"
                />
              </label>
            </div>
          </Field>

          <div className="grid gap-6 sm:grid-cols-2">
            <Field label="Background depth" value={String(Math.round(theme.depth))}>
              <Range
                aria-label="Background depth"
                min={0}
                max={100}
                step={1}
                value={theme.depth}
                accent={theme.accent}
                onChange={(v) => patch({ depth: v })}
              />
            </Field>
            <Field label="Roundness" value={`${theme.radius.toFixed(2)}rem`}>
              <Range
                aria-label="Roundness"
                min={0}
                max={1.25}
                step={0.05}
                value={theme.radius}
                accent={theme.accent}
                onChange={(v) => patch({ radius: v })}
              />
            </Field>
          </div>

          <Field label="Font">
            <div className="flex flex-wrap gap-2">
              {FONT_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => patch({ font: key })}
                  aria-pressed={theme.font === key}
                  className={theme.font === key ? "btn-primary btn-compact" : "btn-secondary btn-compact"}
                >
                  {FONT_LABELS[key as FontKey]}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Preview">
            <Preview theme={theme} />
          </Field>

          <p className="text-xs leading-relaxed text-[var(--color-muted-foreground)]">
            Saved on this computer only. Signing in on another machine, or on the web, keeps that
            machine's own appearance.
          </p>
        </div>
      </div>
    </section>
  )
}

/** A labelled control group, with an optional right-aligned numeric readout. */
function Field({
  label,
  value,
  children,
}: {
  label: string
  value?: string
  children: ReactNode
}) {
  return (
    <div className="grid gap-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className={CAPTION}>{label}</span>
        {value && <span className="font-mono text-[11px] text-white/70">{value}</span>}
      </div>
      {children}
    </div>
  )
}

/**
 * A native range input, tinted with `accent-color`.
 *
 * Native rather than a custom track-and-thumb: the platform control already
 * handles keyboard stepping, pointer capture and the drag-outside-and-back
 * case, and a hand-built one in a frameless window that sets `user-select:
 * none` globally gets all three of those subtly wrong.
 */
function Range({
  value,
  min,
  max,
  step,
  accent,
  onChange,
  ...rest
}: {
  value: number
  min: number
  max: number
  step: number
  accent: string
  onChange: (value: number) => void
  "aria-label": string
}) {
  return (
    <input
      {...rest}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="no-drag h-5 w-full cursor-pointer"
      // accent-color tints the track fill and thumb without replacing a
      // surface; the white default would read as a second, brighter accent.
      style={{ accentColor: accent }}
    />
  )
}

/**
 * A preset, drawn in its own colours.
 *
 * The tile is the app's own chrome material; the preset's palette shows as
 * swatches inside it. Painting the whole tile in the preset's background was
 * the web's approach and it works there, but here it would put an untreated
 * flat rectangle in the middle of a glass panel.
 */
function PresetTile({
  id,
  active,
  onSelect,
}: {
  id: string
  active: boolean
  onSelect: () => void
}) {
  const vars = themeToVars(PRESETS[id])
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`glass-tile glass-tile-hover flex items-center gap-3 p-2.5 text-left ${
        active ? "ring-1 ring-white/60" : ""
      }`}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-white/15"
        style={{ background: vars["--background"] }}
      >
        <span
          className="h-4 w-4 rounded-full"
          style={{ background: vars["--primary"] }}
        />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium text-white">
          {PRESET_LABELS[id] ?? id}
        </span>
        <span className="mt-1 flex gap-1">
          <Dot color={vars["--card"]} />
          <Dot color={vars["--secondary"]} />
          <Dot color={vars["--muted-foreground"]} />
        </span>
      </span>
    </button>
  )
}

function Dot({ color }: { color: string }) {
  return (
    <span className="h-2.5 w-2.5 rounded-full ring-1 ring-white/15" style={{ background: color }} />
  )
}

/**
 * A live sample.
 *
 * It reads the same global tokens the rest of the app does rather than the
 * config it is passed, so it is showing the theme that is actually applied. If
 * this looks right and the app does not, the bug is in the app.
 */
function Preview({ theme }: { theme: ThemeConfig }) {
  return (
    <div className="glass-tile p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold text-white" style={{ fontFamily: "var(--font-sans)" }}>
          Aa Preview
        </span>
        {/* The preset name, not the mode: the mode is always "dark" now, and a
            label that never changes is furniture rather than information. */}
        <span className={CAPTION}>{PRESET_LABELS[theme.preset] ?? theme.preset}</span>
      </div>
      <p
        className="mt-2 text-xs text-[var(--color-muted-foreground)]"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        The quick brown fox jumps over the lazy dog.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span
          className="inline-flex h-7 items-center rounded-lg px-3 text-xs font-medium"
          style={{
            background: "var(--color-primary)",
            color: "var(--color-primary-foreground)",
          }}
        >
          Primary
        </span>
        <span className="glass-input inline-flex h-7 items-center px-3 text-xs text-white/70">
          Field
        </span>
        <span className="font-mono text-[11px] text-[var(--color-muted-foreground)]">
          radius {theme.radius.toFixed(2)}rem
        </span>
      </div>
    </div>
  )
}
