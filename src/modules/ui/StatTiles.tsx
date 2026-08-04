import type { ComponentType } from "react"

/**
 * One headline number in a result's summary row.
 *
 * `caption` is the small line beneath the value that says what the number is
 * counting; it stays optional so a tile can be just a figure and a label.
 */
export type StatTile = {
  /** A lucide icon, sized by the tile. Optional so a plain number tile works. */
  icon?: ComponentType<{ className?: string }>
  label: string
  value: string | number
  caption?: string
}

/**
 * The row of stat tiles that opens a result, the way the web Search page opens
 * with Records / Passwords / Sources rather than a wall of cards.
 *
 * Built on the shared glass tile so it matches every other sub-surface in the
 * app. The value is the loud element (full white); the label and caption are the
 * quiet ones, because a number nobody can read is not a summary.
 */
export function StatTiles({ tiles }: { tiles: StatTile[] }) {
  if (tiles.length === 0) return null
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map((tile) => {
        const Icon = tile.icon
        return (
          <div key={tile.label} className="glass-tile px-4 py-3.5">
            <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted-foreground)]">
              {Icon ? <Icon className="h-3 w-3" /> : null}
              <span className="truncate">{tile.label}</span>
            </div>
            <div className="mt-2 text-2xl font-semibold tabular-nums text-white">{tile.value}</div>
            {tile.caption ? (
              <div className="mt-0.5 text-[11px] leading-tight text-white/55">{tile.caption}</div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
