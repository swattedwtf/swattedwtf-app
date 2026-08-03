import type { ReactNode } from "react"

/**
 * Dashboard stat tile. Mirrors the web StatCard: icon tile, mono uppercase
 * label, large value, optional progress bar and caption. The web version also
 * carries a cursor-follow glow; that is deliberately omitted here because it
 * costs a per-frame listener for an effect nobody asked for on desktop.
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
  return (
    <div className="glass p-5">
      <div className="flex items-start gap-4">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[var(--border)] bg-white/5">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted-foreground)]">
            {label}
          </p>
          <p className="mt-1.5 truncate text-2xl font-semibold tracking-tight">{value}</p>
        </div>
      </div>

      {typeof progress === "number" && (
        <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-white transition-[width] duration-500"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      )}

      {caption && <p className="mt-3 text-xs text-[var(--muted-foreground)]">{caption}</p>}
    </div>
  )
}
