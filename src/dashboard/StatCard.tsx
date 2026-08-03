import type { CSSProperties, ReactNode } from "react"

/**
 * Dashboard stat tile. Mirrors the web StatCard: icon tile, mono uppercase
 * label, large value, optional progress bar and caption. The web version also
 * carries a cursor-follow glow; that is deliberately omitted here because it
 * costs a per-frame listener for an effect nobody asked for on desktop.
 *
 * The label reserves two lines of height whether or not it wraps (.stat-label),
 * so the four hero numbers in the row share a baseline. Without it the one long
 * label in the set, "Requests (this month)", wraps and drops its value ~25px
 * below its neighbours.
 *
 * The progress fill animates from zero via a CSS custom property rather than a
 * width transition, so it plays on first paint instead of only on change; the
 * per-card stagger lives in theme.css keyed off .stat-grid.
 */
export function StatCard({
  icon,
  label,
  value,
  caption,
  progress,
}: {
  icon: ReactNode
  label: string
  value: ReactNode
  caption?: ReactNode
  progress?: number
}) {
  const pct = typeof progress === "number" ? Math.min(100, Math.max(0, progress)) : 0

  return (
    <div className="glass stat-card">
      <div className="glass-body">
        <div className="stat-head flex items-start gap-4">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[var(--border)] bg-white/5">
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <p className="stat-label font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted-foreground)]">
              {label}
            </p>
            <p className="stat-value mt-1 truncate text-2xl font-semibold">{value}</p>
          </div>
        </div>

        {typeof progress === "number" && (
          <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="stat-fill h-full rounded-full"
              style={{ "--fill": `${pct}%` } as CSSProperties}
            />
          </div>
        )}

        {caption && <p className="mt-3 text-xs text-[var(--muted-foreground)]">{caption}</p>}
      </div>
    </div>
  )
}
