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
        // A badge WITH art shows only the art: the name is on hover, because
        // repeating it beside the icon says the same thing twice and turns a
        // row of marks into a wall of text. A badge without art has to fall
        // back to its name, or it would be an invisible entry.
        <li
          key={badge.label}
          title={badge.title ?? badge.label}
          aria-label={badge.label}
          className={
            badge.iconUrl
              ? "inline-flex items-center justify-center rounded-lg bg-white/[0.06] p-1.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.10)]"
              : "inline-flex items-center rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/80 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.10)]"
          }
        >
          {badge.iconUrl ? (
            <RemoteImage
              url={badge.iconUrl}
              alt={badge.label}
              className="h-5 w-5 rounded-[4px] text-[8px]"
            />
          ) : (
            <span>{badge.label}</span>
          )}
        </li>
      ))}
    </ul>
  )
}
