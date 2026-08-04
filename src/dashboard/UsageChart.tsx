import { formatCount } from "../lib/format"

type Point = { date: string; count: number }

/** Viewbox units. Rendered with preserveAspectRatio="none" so it stretches. */
const W = 100
const H = 32

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

/**
 * Usage over time. Hand-rolled SVG rather than a charting library: it keeps the
 * bundle self-contained, which matters because the CSP forbids remote sources
 * and every added dependency is more surface for readers to audit.
 */
export function UsageChart({ series }: { series: Point[] }) {
  const data = series.slice(-30)
  const peak = data.reduce((m, d) => Math.max(m, d.count), 0)
  // Scale divisor only. `peak` itself stays honest so an idle month reads 0.
  const max = Math.max(1, peak)
  const total = data.reduce((sum, d) => sum + d.count, 0)
  const avg = data.length ? total / data.length : 0
  const bw = data.length ? W / data.length : W

  return (
    <div className="glass">
      <div className="glass-body">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted-foreground)]">
          Usage (30d)
        </p>

        {data.length === 0 ? (
          <p className="mt-6 text-xs text-[var(--muted-foreground)]">No activity yet.</p>
        ) : (
          <>
            <svg
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={`Daily lookups over the last ${data.length} days, peaking at ${peak}.`}
              className="mt-4 h-32 w-full"
            >
              {/* Baseline, so an all-zero stretch still reads as a chart. */}
              <rect x={0} y={H - 0.15} width={W} height={0.15} fill="rgba(255,255,255,0.12)" />
              {data.map((d, i) => {
                // A day with traffic never collapses to nothing: floor the bar at
                // a visible sliver so one lookup is distinguishable from none.
                const h = d.count > 0 ? Math.max(0.6, (d.count / max) * (H - 2)) : 0
                return (
                  <rect
                    key={d.date}
                    x={i * bw + bw * 0.15}
                    y={H - h}
                    width={bw * 0.7}
                    height={h}
                    fill="rgba(255,255,255,0.32)"
                  >
                    <title>{`${d.date}: ${d.count}`}</title>
                  </rect>
                )
              })}
            </svg>

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
