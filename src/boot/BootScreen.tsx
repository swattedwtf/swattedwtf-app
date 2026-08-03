import { Ring } from "./Ring"

/**
 * Full-screen boot stage: the mark, the ring, and one label.
 *
 * The wordmark sits above the ring rather than the ring standing alone, so the
 * first frame anyone ever sees is branded instead of an anonymous spinner. The
 * label is keyed on its text so a stage change crossfades rather than swapping
 * characters in place, which otherwise reads as a glitch.
 */
export function BootScreen({ label }: { label: string }) {
  return (
    <div
      data-tauri-drag-region
      className="drag relative flex h-full flex-col items-center justify-center gap-8 overflow-hidden bg-[#0b0b0b]"
    >
      {/* One soft pool of light behind the ring so the black has some depth. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(255,255,255,0.055) 0%, rgba(255,255,255,0.018) 42%, transparent 70%)",
        }}
      />

      <p className="boot-mark relative text-[19px] font-medium tracking-[-0.01em] text-[var(--mark-fg)]">
        swatted<span className="text-[var(--mark-tld)]">.wtf</span>
      </p>

      <Ring />

      <p
        key={label}
        className="shimmer-label boot-label relative text-[12px] font-medium uppercase tracking-[0.18em]"
      >
        {label}
      </p>
    </div>
  )
}
