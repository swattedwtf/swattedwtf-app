import { useEffect, useRef, useState } from "react"
import { CornerDownLeft, Search } from "lucide-react"

import { ipc } from "../lib/ipc"
import { KIND_LABEL, identify, targetRoute, targetUrl } from "./identify"
import "../theme.css"

/** Longest input worth accepting. Nothing we can look up is near this. */
const MAX_LENGTH = 256

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
  // Bumped on every show. Used as a React key so the panel remounts and replays
  // its entrance: the window is created hidden at startup and then only shown
  // and hidden, so an animation keyed on mount would have played once, before
  // the window was ever visible, and never again.
  const [shown, setShown] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const match = identify(value)

  const dismiss = () => {
    setValue("")
    void ipc.hideQuick().catch(() => {})
  }

  useEffect(() => {
    // Focus on every show, not just first mount, for the same reason the
    // entrance is keyed: mount happens exactly once, at startup.
    const onShow = () => {
      setShown((n) => n + 1)
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    onShow()
    window.addEventListener("focus", onShow)

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss()
    }
    window.addEventListener("keydown", onKey)

    // Clicking away is a dismissal: an always-on-top overlay that lingers after
    // you have moved on is an obstruction.
    const onBlur = () => dismiss()
    window.addEventListener("blur", onBlur)

    return () => {
      window.removeEventListener("focus", onShow)
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("blur", onBlur)
    }
  }, [])

  async function submit() {
    if (!match || busy) return
    setBusy(true)
    try {
      const inApp = targetRoute(match)
      if (inApp) {
        // Resolve inside the app: the main window navigates to the module and
        // runs the lookup. Only kinds with no native screen (an IP) fall back
        // to opening the web dashboard.
        await ipc.resolveQuick(inApp.route, inApp.query, inApp.mode)
      } else {
        await ipc.openExternal(targetUrl(match))
      }
      dismiss()
    } catch {
      // Blocked or the handoff failed. Keep the bar up rather than vanishing
      // with no result, so the user knows nothing happened.
    } finally {
      setBusy(false)
    }
  }

  const typed = value.trim() !== ""

  return (
    <div className="quick-root" data-armed={Boolean(match)}>
      <div key={shown} className="quick-body quick-enter">
        <div className="flex flex-1 items-center gap-3 px-3.5">
          <span className="quick-glyph" aria-hidden="true">
            <Search className="h-[17px] w-[17px]" />
          </span>

          <input
            ref={inputRef}
            value={value}
            maxLength={MAX_LENGTH}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
            placeholder="Search an ID, email, phone, domain or username"
            spellCheck={false}
            autoComplete="off"
            aria-label="Quick lookup"
            className="quick-input"
          />

          {match && <span className="quick-pill">{KIND_LABEL[match.kind]}</span>}
        </div>

        <div className="flex items-center justify-between border-t border-white/[0.06] px-3.5 py-2.5">
          <span className="truncate text-[11px] text-white/35">
            {!typed ? (
              <>
                <span className="text-white/55">swatted</span>
                <span className="text-white/25">.wtf</span>
                <span className="px-1.5 text-white/15">/</span>
                quick lookup
              </>
            ) : match ? (
              <>
                Open <span className="text-white/70">{KIND_LABEL[match.kind].toLowerCase()}</span>{" "}
                lookup for <span className="text-white/70">{match.value}</span>
              </>
            ) : (
              "Not a recognisable identifier"
            )}
          </span>

          <span className="flex shrink-0 items-center gap-2 text-[11px] text-white/30">
            <kbd className="kbd" aria-hidden="true">
              <CornerDownLeft className="h-3 w-3" />
            </kbd>
            <span>open</span>
            <kbd className="kbd ml-1.5">esc</kbd>
            <span>close</span>
          </span>
        </div>
      </div>
    </div>
  )
}
