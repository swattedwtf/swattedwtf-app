/**
 * The boot ring: a single 1.5px arc sweeping on a faint track.
 * Deliberately minimal, no sub-caption under the label.
 */
export function Ring() {
  return (
    <svg viewBox="0 0 72 72" className="h-[72px] w-[72px]" aria-hidden="true">
      <circle cx="36" cy="36" r="30" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="1.5" />
      <circle
        cx="36"
        cy="36"
        r="30"
        fill="none"
        stroke="#fff"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray="40 180"
        className="origin-center animate-[bootspin_1.15s_cubic-bezier(.5,.1,.4,.9)_infinite]"
      />
    </svg>
  )
}
