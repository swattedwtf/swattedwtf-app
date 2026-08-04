import { useEffect, useRef, useState } from "react"

import type { Overview } from "../lib/ipc"
import { resolveWelcomeName, shouldPromptTelegram } from "../lib/welcome"
import "./boot.css"

/**
 * The whole boot sequence, as one component.
 *
 * It replaces a BootScreen that hard-swapped into a RevealScreen. That swap
 * left a 250ms hole where the screen was completely empty except the window
 * controls, because the ring cut out the instant the phase changed while the
 * reveal's wordmark waited on an animation delay before appearing. Keeping the
 * mark mounted across both modes removes the hole entirely: it simply grows as
 * the ring retires, and the sequence reads as one gesture instead of three.
 *
 * Timings live in boot.css. This component only decides which mode is showing
 * and when to hand over to the shell.
 */

/** Total reveal, from the mark starting to grow to the shell taking over. */
const REVEAL_MS = 2600

/** How long before the end the stage starts fading, so the shell crossfades. */
const LEAVE_MS = 220

export function BootStage({
  mode,
  label,
  overview,
  onRevealDone,
}: {
  mode: "loading" | "reveal"
  /** Shown under the ring while loading. Ignored in reveal mode. */
  label?: string
  /** Required in reveal mode: supplies the name to greet. */
  overview?: Overview | null
  onRevealDone?: () => void
}) {
  const [leaving, setLeaving] = useState(false)

  // Held in a ref so the timers below never restart when the parent re-renders.
  // Keying the effect on the callback would strand the user on a black screen
  // the moment anything else in App started re-rendering.
  const done = useRef(onRevealDone)
  done.current = onRevealDone

  useEffect(() => {
    if (mode !== "reveal") return

    const fade = setTimeout(() => setLeaving(true), REVEAL_MS - LEAVE_MS)
    const finish = setTimeout(() => done.current?.(), REVEAL_MS)

    return () => {
      clearTimeout(fade)
      clearTimeout(finish)
    }
  }, [mode])

  const revealing = mode === "reveal" && overview

  return (
    <div
      data-tauri-drag-region
      className="stage drag"
      data-mode={mode}
      data-leaving={leaving}
    >
      {/* The dashboard's three layers, dimmed right down, so the app opens on
          the same material the web does instead of on a black rectangle. */}
      <div className="stage-art" aria-hidden="true" />
      <div className="stage-wash" aria-hidden="true" />
      <div className="stage-glow" aria-hidden="true" />
      <div className="stage-grain" aria-hidden="true" />
      <div className="stage-edge" aria-hidden="true" />

      <div className="stage-inner">
        <p className="stage-mark">
          swatted<span style={{ color: "var(--mark-tld)" }}>.wtf</span>
        </p>

        {/* Stays mounted through the reveal and fades out, rather than
            unmounting, so nothing pops out of the layout mid-transition. */}
        <div className="stage-ring" aria-hidden="true">
          <Ring />
        </div>

        {mode === "loading" && label && (
          <p key={label} className="stage-label">
            {label}
          </p>
        )}

        {revealing && (
          <>
            <div className="stage-rule" aria-hidden="true" />
            <p className="stage-welcome">
              Welcome,{" "}
              <span style={{ color: "rgba(255,255,255,0.9)", fontWeight: 500 }}>
                {resolveWelcomeName(overview)}
              </span>
            </p>
            {shouldPromptTelegram(overview) && (
              <p className="stage-hint">Link Telegram to show your username here</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/**
 * A hairline arc on a faint track, with a slower counter-rotating inner arc and
 * a bright head at the leading tip.
 *
 * The head is a separate circle rather than part of the dash, because a dash cap
 * cannot be brighter than the dash it caps. It sits at the coordinates the tip
 * of the sweep reaches (see below) and shares the arc's animation exactly, so
 * the two stay locked together for as long as the ring turns.
 */
function Ring() {
  // An SVG circle's stroke starts at 3 o'clock and runs clockwise, so the tip of
  // a 40-unit dash on a radius-30 circle (circumference 188.5) sits 40/188.5 of
  // a turn along: 76.4 degrees, which is (36 + 30cos, 36 + 30sin) = 43.1, 65.2.
  return (
    <svg viewBox="0 0 72 72" width="66" height="66" aria-hidden="true">
      <circle cx="36" cy="36" r="30" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1.5" />
      <circle
        className="stage-ring-arc-inner"
        cx="36"
        cy="36"
        r="23"
        fill="none"
        stroke="rgba(255,255,255,0.28)"
        strokeWidth="1"
        strokeLinecap="round"
        strokeDasharray="16 128"
      />
      <circle
        className="stage-ring-arc"
        cx="36"
        cy="36"
        r="30"
        fill="none"
        stroke="url(#stageSweep)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray="40 180"
      />
      <circle className="stage-ring-head" cx="43.1" cy="65.2" r="2.1" fill="#fff" opacity="0.95" />

      <defs>
        {/* The sweep fades from nothing to solid along its own length, so the
            arc reads as a trail behind the head rather than as a floating bar
            with two identical ends. */}
        <linearGradient id="stageSweep" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="1" />
        </linearGradient>
      </defs>
    </svg>
  )
}
