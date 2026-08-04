import { RemoteImage } from "../RemoteImage"
import { EmptyState } from "./EmptyState"

export type Badge = {
  label: string
  /** Icon on our own origin. Resolved through the image command like any other. */
  iconUrl?: string | null
  /** Longer explanation, on hover. */
  title?: string
}

/**
 * Badges, flags and tags as pills.
 *
 * Icons go through RemoteImage, so a badge whose art fails to load still reads
 * as its label rather than as a broken image.
 */
export function BadgeRow({
  badges,
  empty = "None",
}: {
  badges: Badge[]
  /** Copy when there are none. */
  empty?: string
}) {
  if (badges.length === 0) return <EmptyState message={empty} />

  return (
    <ul className="flex flex-wrap gap-2">
      {badges.map((badge) => (
        <li
          key={badge.label}
          title={badge.title ?? badge.label}
          className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/80 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.10)]"
        >
          {badge.iconUrl ? (
            <RemoteImage
              url={badge.iconUrl}
              alt={badge.label}
              className="h-3.5 w-3.5 rounded-[3px] text-[8px]"
            />
          ) : null}
          <span>{badge.label}</span>
        </li>
      ))}
    </ul>
  )
}
