/**
 * The boot ring: a single 1.5px arc sweeping on a faint track.
 * Deliberately minimal, no sub-caption under the label.
 */
export function Ring() {
  return (
    <svg viewBox="0 0 72 72" className="h-[72px] w-[72px]" aria-hidden="true">
      <circle className="ring-track" cx="36" cy="36" r="30" fill="none" strokeWidth="1.5" />
      {/* Inner arc, slower and counter-rotating, for a little parallax. */}
      <circle
        className="ring-arc-slow"
        cx="36"
        cy="36"
        r="23"
        fill="none"
        stroke="rgba(255,255,255,0.35)"
        strokeWidth="1"
        strokeLinecap="round"
        strokeDasharray="18 120"
      />
      <circle
        className="ring-arc"
        cx="36"
        cy="36"
        r="30"
        fill="none"
        stroke="#fff"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray="40 180"
      />
    </svg>
  )
}
