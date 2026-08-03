import { Ring } from "./Ring"

/** Full-screen boot stage: the ring plus one shimmering label. */
export function BootScreen({ label }: { label: string }) {
  return (
    <div data-tauri-drag-region className="drag flex h-full flex-col items-center justify-center gap-7 bg-[#0b0b0b]">
      <Ring />
      <p className="shimmer-label text-[13px] font-medium uppercase tracking-[0.14em]">{label}</p>
    </div>
  )
}
