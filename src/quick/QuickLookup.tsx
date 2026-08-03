import { useEffect, useRef, useState } from "react"
import { CornerDownLeft, Search } from "lucide-react"

import { ipc } from "../lib/ipc"
import { KIND_LABEL, identify, targetUrl } from "./identify"
import "../theme.css"

/**
 * The quick-lookup overlay.
 *
 * Summoned by the global hotkey over whatever the user is doing, so it has to
 * behave like a system utility rather than a window: it takes focus, it acts on
 * one keystroke, and it disappears the moment it is not wanted (Escape, or
 * losing focus by clicking away).
 *
 * It opens the matching page on the web dashboard rather than resolving in
 * place. The lookup modules are not ported to the desktop client yet, and
 * sending someone to a page that works beats a native screen that cannot
 * answer. When a module lands natively, only targetUrl changes.
 */
export function QuickLookup() {
  const [value, setValue] = useState("")
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const match = identify(value)

  const dismiss = () => {
    setValue("")
    void ipc.hideQuick().catch(() => {})
  }

  useEffect(() => {
    // Focus on every show, not just first mount: the window is hidden and
    // reshown rather than recreated, so mount happens exactly once.
    const focus = () => inputRef.current?.focus()
    focus()
    window.addEventListener("focus", focus)

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss()
    }
    window.addEventListener("keydown", onKey)

    // Clicking away is a dismissal: an always-on-top overlay that lingers after
    // you have moved on is an obstruction.
    const onBlur = () => dismiss()
    window.addEventListener("blur", onBlur)

    return () => {
      window.removeEventListener("focus", focus)
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("blur", onBlur)
    }
  }, [])

  async function submit() {
    if (!match || busy) return
    setBusy(true)
    try {
      await ipc.openExternal(targetUrl(match))
      dismiss()
    } catch {
      // Blocked or the opener failed. Keep the bar up rather than vanishing
      // with no result, so the user knows nothing happened.
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="quick-root flex h-full flex-col justify-center px-4">
      <div className="flex items-center gap-3">
        <Search className="h-[18px] w-[18px] shrink-0 text-white/35" aria-hidden="true" />

        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
          placeholder="Paste an ID, email, phone, domain or username"
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-[17px] text-white outline-none placeholder:text-white/25"
        />

        {match && (
          <span className="shrink-0 rounded-full border border-white/12 bg-white/[0.06] px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.1em] text-white/60">
            {KIND_LABEL[match.kind]}
          </span>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-white/[0.07] pt-2.5 text-[11px] text-white/30">
        <span className="truncate">
          {value.trim() === ""
            ? "swatted.wtf quick lookup"
            : match
              ? `Look up ${match.value}`
              : "Not a recognisable identifier"}
        </span>

        <span className="flex shrink-0 items-center gap-3">
          <span className="flex items-center gap-1">
            <CornerDownLeft className="h-3 w-3" aria-hidden="true" />
            open
          </span>
          <span>esc close</span>
        </span>
      </div>
    </div>
  )
}
