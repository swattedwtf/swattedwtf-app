import { useState } from "react"
import { formatCount } from "../lib/format"

type Point = { date: string; count: number }

/** Viewbox units. Rendered with preserveAspectRatio="none" so it stretches. */
const W = 100
const H = 100
/** Headroom above the peak so the line never touches the top edge. */
const PAD_TOP = 8

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass-tile px-3 py-2.5">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
        {label}
      </p>
      <p className="stat-value mt-1 text-lg font-semibold">{value}</p>
    </div>
  )
}

/** A day's date as "Aug 4" for the hover tooltip. Dates arrive as YYYY-MM-DD. */
function prettyDate(iso: string): string {
  const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10))
  if (!y || !m || !d) return iso
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  return `${months[m - 1] ?? m} ${d}`
}

/**
 * Usage over time. Hand-rolled SVG rather than a charting library: it keeps the
 * bundle self-contained, which matters because the CSP forbids remote sources
 * and every added dependency is more surface for readers to audit.
 *
 * A gradient area under a crisp line, with a hover layer that puts a guide, a
 * dot and a floating tooltip on whichever day the pointer is over. The old
 * version was flat grey bars with a native <title> tooltip that most platforms
 * never show; this reads the way the rest of the dashboard looks.
 */
export function UsageChart({ series }: { series: Point[] }) {
  const data = series.slice(-30)
  const [active, setActive] = useState<number | null>(null)

  const peak = data.reduce((m, d) => Math.max(m, d.count), 0)
  // Scale divisor only. `peak` itself stays honest so an idle month reads 0.
  const max = Math.max(1, peak)
  const total = data.reduce((sum, d) => sum + d.count, 0)
  const avg = data.length ? total / data.length : 0
  const n = data.length

  // X of a point, 0..W. A single day sits in the middle rather than hard left.
  const xAt = (i: number) => (n > 1 ? (i / (n - 1)) * W : W / 2)
  // Y of a value, PAD_TOP..H. Larger counts sit higher (smaller y).
  const yAt = (count: number) => H - (count / max) * (H - PAD_TOP)

  const line = data.map((d, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(2)} ${yAt(d.count).toFixed(2)}`).join(" ")
  const area =
    n > 0 ? `${line} L ${xAt(n - 1).toFixed(2)} ${H} L ${xAt(0).toFixed(2)} ${H} Z` : ""

  const activePoint = active != null ? data[active] : null
  const activeX = active != null ? xAt(active) : 0
  const activeY = activePoint ? yAt(activePoint.count) : 0

  return (
    <div className="glass">
      <div className="glass-body">
        <div className="flex items-center justify-between">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted-foreground)]">
            Usage (30d)
          </p>
          {peak > 0 ? (
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
              peak {formatCount(peak)}
            </p>
          ) : null}
        </div>

        {data.length === 0 ? (
          <p className="mt-6 text-xs text-[var(--muted-foreground)]">No activity yet.</p>
        ) : (
          <>
            <div
              className="relative mt-4 h-32 w-full"
              onMouseLeave={() => setActive(null)}
            >
              <svg
                viewBox={`0 0 ${W} ${H}`}
                preserveAspectRatio="none"
                role="img"
                aria-label={`Daily lookups over the last ${data.length} days, peaking at ${peak}.`}
                className="absolute inset-0 h-full w-full overflow-visible"
              >
                <defs>
                  <linearGradient id="usage-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgba(255,255,255,0.28)" />
                    <stop offset="100%" stopColor="rgba(255,255,255,0.01)" />
                  </linearGradient>
                </defs>
                {/* Baseline, so an all-zero stretch still reads as a chart. */}
                <line x1={0} y1={H - 0.4} x2={W} y2={H - 0.4} stroke="rgba(255,255,255,0.12)" strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
                {area ? <path d={area} fill="url(#usage-fill)" /> : null}
                {line ? (
                  <path
                    d={line}
                    fill="none"
                    stroke="rgba(255,255,255,0.85)"
                    strokeWidth={1.5}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
                {/* Vertical guide on the hovered day. */}
                {activePoint ? (
                  <line
                    x1={activeX}
                    y1={0}
                    x2={activeX}
                    y2={H}
                    stroke="rgba(255,255,255,0.25)"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
              </svg>

              {/* The dot rides the line at the hovered day. Positioned in HTML
                  (percent) rather than SVG so the stretch doesn't oval it. */}
              {activePoint ? (
                <span
                  className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_8px_1px_rgba(255,255,255,0.5)]"
                  style={{ left: `${activeX}%`, top: `${activeY}%` }}
                />
              ) : null}

              {/* Floating tooltip. Clamped away from the edges so it never
                  clips outside the panel. */}
              {activePoint ? (
                <div
                  className="pointer-events-none absolute -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-black/80 px-2 py-1 text-center shadow-[0_6px_20px_-6px_rgba(0,0,0,0.8)] ring-1 ring-white/10 backdrop-blur"
                  style={{
                    left: `${Math.min(88, Math.max(12, activeX))}%`,
                    top: `${Math.max(12, activeY)}%`,
                    marginTop: -10,
                  }}
                >
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/55">
                    {prettyDate(activePoint.date)}
                  </p>
                  <p className="stat-value text-sm font-semibold text-white">
                    {formatCount(activePoint.count)} {activePoint.count === 1 ? "lookup" : "lookups"}
                  </p>
                </div>
              ) : null}

              {/* Invisible hover columns, one per day, so the whole width is
                  live and the nearest day is always selectable. */}
              <div className="absolute inset-0 flex">
                {data.map((d, i) => (
                  <button
                    key={d.date}
                    type="button"
                    tabIndex={-1}
                    aria-hidden="true"
                    onMouseEnter={() => setActive(i)}
                    onFocus={() => setActive(i)}
                    className="h-full flex-1 cursor-default bg-transparent"
                  />
                ))}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3">
              <Stat label="Window Total" value={formatCount(total)} />
              <Stat label="Avg / Day" value={avg.toFixed(1)} />
              <Stat label="Peak Day" value={formatCount(peak)} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
