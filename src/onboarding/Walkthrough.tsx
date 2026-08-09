import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  HardDrive,
  KeyRound,
  Keyboard,
  Radar,
  ScanFace,
  Search,
  ShieldCheck,
  Sparkles,
  Wrench,
  type LucideIcon,
} from "lucide-react"

import { markWalkthroughSeen, nextStep, prevStep } from "../lib/onboarding"
import { WindowControls } from "../shell/WindowControls"

/**
 * First-run walkthrough.
 *
 * Four screens, each earning its place: the thing only the desktop app can do
 * (the global hotkey), what is and is not in this release, the fact that the
 * login code is the only way back in, and how updates and the integrity check
 * actually work. Anything a user would discover on their own is left out.
 *
 * It covers the whole window rather than sitting in a modal. The shell behind
 * it is a dashboard full of numbers, and half-showing it while explaining
 * something else asks the reader to ignore the more interesting thing on
 * screen. Because it covers the shell, it carries its own WindowControls: the
 * ones underneath would be unreachable, and a frameless window with no way to
 * close it is a trap.
 *
 * Keyboard: Left and Right move, Enter advances, Escape skips.
 */

/* ---- Small shared pieces ------------------------------------------------ */

/** A physical-looking key cap. Two shadows: an inner top light, a base edge. */
function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-11 min-w-[52px] items-center justify-center rounded-lg border border-white/15 bg-white/[0.07] px-3.5 font-mono text-[13px] font-medium text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.14),0_2px_0_0_rgba(0,0,0,0.55)]">
      {children}
    </kbd>
  )
}

function Plus() {
  return <span className="text-[13px] text-white/25">+</span>
}

/** Section label, matching the mono eyebrow used across the dashboard. */
function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]">
      {children}
    </p>
  )
}

function Panel({ children, dim = false }: { children: ReactNode; dim?: boolean }) {
  return (
    <div
      className={`rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 ${dim ? "opacity-55" : ""}`}
    >
      {children}
    </div>
  )
}

/* ---- Step content ------------------------------------------------------- */

type Step = {
  icon: LucideIcon
  title: string
  body: string
  visual: ReactNode
}

/** The platform lookups, shown as an app-launcher grid on the welcome screen -
 *  the true value proposition now that the whole platform ships in the app. The
 *  brand marks are the recognisable, on-brand element the first screen is built
 *  around. */
const PLATFORM_TILES: { label: string; brand: string }[] = [
  { label: "Discord", brand: "/brand/discord.svg" },
  { label: "Telegram", brand: "/brand/telegram.svg" },
  { label: "Roblox", brand: "/brand/roblox.svg" },
  { label: "TikTok", brand: "/brand/tiktok.svg" },
  { label: "Snapchat", brand: "/brand/snapchat.svg" },
  { label: "Instagram", brand: "/brand/instagram.svg" },
  { label: "Minecraft", brand: "/brand/minecraft.svg" },
]

const TOOL_TILES: { label: string; icon: LucideIcon }[] = [
  { label: "Search", icon: Search },
  { label: "Live Intel", icon: Radar },
  { label: "Machine", icon: HardDrive },
  { label: "Face", icon: ScanFace },
  { label: "Tools", icon: Wrench },
]

function ModuleShowcase() {
  return (
    <div>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
        {PLATFORM_TILES.map((p) => (
          <div
            key={p.label}
            className="glass-tile flex flex-col items-center gap-1.5 px-1 py-3"
            title={p.label}
          >
            <img src={p.brand} alt="" className="h-6 w-6 opacity-95" />
            <span className="truncate text-[9.5px] text-white/55">{p.label}</span>
          </div>
        ))}
        {TOOL_TILES.map((t) => {
          const Icon = t.icon
          return (
            <div
              key={t.label}
              className="glass-tile flex flex-col items-center gap-1.5 px-1 py-3"
              title={t.label}
            >
              <Icon className="h-[22px] w-[22px] text-white/85" aria-hidden="true" />
              <span className="truncate text-[9.5px] text-white/55">{t.label}</span>
            </div>
          )
        })}
      </div>
      <p className="mt-3 text-[11.5px] leading-relaxed text-[var(--color-muted-foreground)]">
        Plus Address Insights on a live map, Investigations and Monitor - all metered to your plan,
        the same as the website.
      </p>
    </div>
  )
}

const STEPS: Step[] = [
  {
    icon: Sparkles,
    title: "The whole platform, on your desktop",
    body:
      "Every lookup from swatted.wtf, now a native app. Resolve profiles and breach data across Discord, Telegram, Roblox, TikTok, Snapchat, Instagram and Minecraft; run a unified breach Search; sweep an email or phone with Live Intelligence; open captured machines in the Machine Browser; and reach the full Tools suite - all signed in as you, gated to your plan.",
    visual: <ModuleShowcase />,
  },
  {
    // Deliberately not the Command glyph: this is a Windows app and the
    // hotkey has no Command key in it.
    icon: Keyboard,
    title: "One hotkey, from anywhere",
    body:
      "Press Ctrl, Shift and Space together, in any window in Windows, and a lookup bar opens over whatever you were doing. Paste an ID, an email, a phone number, a domain or a username, press Enter, and the matching lookup opens. This is the reason the app exists: the website cannot reach you while you are in another program.",
    visual: (
      <div>
        <div className="flex items-center gap-2.5">
          <Key>Ctrl</Key>
          <Plus />
          <Key>Shift</Key>
          <Plus />
          <Key>Space</Key>
        </div>

        {/* A shrunken stand-in for the real overlay, so the first press is
            recognised rather than surprising. */}
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-white/10 bg-black/45 px-3.5 py-2.5">
          <Search className="h-4 w-4 shrink-0 text-white/30" aria-hidden="true" />
          <span className="truncate text-[12.5px] text-white/30">
            Paste an ID, email, phone, domain or username
          </span>
          <span className="ml-auto shrink-0 rounded-full border border-white/12 px-2 py-[1px] font-mono text-[9px] uppercase tracking-[0.1em] text-white/35">
            enter
          </span>
        </div>
      </div>
    ),
  },
  {
    icon: KeyRound,
    title: "Your login code is the account",
    body:
      "There is no password here. The 12-digit code you were given at signup is the only way back in, and there is no reset: lose it and the account is gone. Keep the recovery file offered on the screen that showed your code, or write the digits down somewhere real. Settings shows which account you are signed in to.",
    visual: (
      <div className="rounded-xl border border-white/[0.08] bg-black/45 px-4 py-4 text-center">
        <p className="font-mono text-[24px] tracking-[0.32em] text-white/55">
          {"•••• •••• ••••"}
        </p>
        <p className="mt-2.5 text-[12px] text-[var(--color-warning)]">
          No password. No reset. No support recovery.
        </p>
      </div>
    ),
  },
  {
    icon: ShieldCheck,
    title: "Updates and integrity",
    body:
      "The app keeps itself current. It checks for updates on launch, and an update is only installed once its signature has been verified, so a build we did not sign will not be applied.",
    visual: (
      <div className="space-y-2.5">
        <Panel>
          <div className="flex gap-3">
            <Download
              className="mt-[3px] h-4 w-4 shrink-0 text-white/45"
              aria-hidden="true"
            />
            <div>
              <p className="text-[13px] text-white/85">Signed updates</p>
              <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-muted-foreground)]">
                Downloaded in the background, signature checked, then applied on your next
                restart.
              </p>
            </div>
          </div>
        </Panel>

        <Panel>
          <div className="flex gap-3">
            <ShieldCheck
              className="mt-[3px] h-4 w-4 shrink-0 text-white/45"
              aria-hidden="true"
            />
            <div>
              <p className="text-[13px] text-white/85">Integrity check</p>
              {/* Deliberately the same sentence as the Settings screen. The
                  honest framing is the point, so it should not drift. */}
              <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-muted-foreground)]">
                On every launch the app hashes its own files against a manifest. This detects a
                corrupted or modified install. It is not a security control: the app is open
                source, so the check can be removed from a modified copy.
              </p>
            </div>
          </div>
        </Panel>
      </div>
    ),
  },
]

const TOTAL = STEPS.length

/* ---- Component ---------------------------------------------------------- */

export function Walkthrough({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0)
  // Skip, Enter and the Escape key can all land within a frame of each other.
  // onDone tears down this tree, so a second call would run against an unmounted
  // parent.
  const finished = useRef(false)

  const finish = useCallback(() => {
    if (finished.current) return
    finished.current = true
    // Written here as well as by the caller: whichever of the two is forgotten,
    // the walkthrough still never shows twice.
    markWalkthroughSeen()
    onDone()
  }, [onDone])

  // Reads `step` from the closure rather than from a setState updater: finishing
  // is a side effect, and React is free to run an updater more than once.
  const advance = useCallback(() => {
    if (step >= TOTAL - 1) {
      finish()
      return
    }
    setStep((s) => nextStep(s, TOTAL))
  }, [step, finish])

  const back = useCallback(() => setStep((s) => prevStep(s)), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        finish()
        return
      }
      if (e.key === "ArrowRight") {
        e.preventDefault()
        advance()
        return
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault()
        back()
        return
      }
      if (e.key === "Enter") {
        // A focused button already activates on Enter. Handling it here too
        // would move two steps for one keypress.
        const target = e.target as HTMLElement | null
        if (target?.closest?.("button")) return
        e.preventDefault()
        advance()
      }
    }

    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [advance, back, finish])

  const current = STEPS[step]
  const Icon = current.icon
  const isFirst = step === 0
  const isLast = step === TOTAL - 1

  const ghostButton =
    "no-drag btn-secondary btn-compact gap-2 disabled:pointer-events-none"

  return (
    <div
      data-tauri-drag-region
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to swatted.wtf"
      className="drag fixed inset-0 z-50 flex flex-col overflow-hidden bg-[var(--color-background)]"
    >
      {/* Same three-layer surface as the shell, so the tour reads as part of
          the app rather than a page laid on top of it. */}
      <div className="app-backdrop">
        <div className="app-backdrop-wash" />
      </div>

      <WindowControls />

      <header className="relative z-10 flex shrink-0 items-center gap-3 px-8 pt-6">
        <p className="text-[15px] font-semibold tracking-[-0.01em] text-[var(--mark-fg)]">
          swatted<span className="text-[var(--mark-tld)]">.wtf</span>
        </p>
        <span className="rounded-full border border-white/10 px-2 py-[2px] font-mono text-[9px] uppercase tracking-[0.18em] text-white/35">
          first run
        </span>
      </header>

      <main className="relative z-10 flex min-h-0 flex-1 items-center justify-center px-8">
        <section className="glass no-drag w-full max-w-[720px] p-7">
          {/* Keyed on the step so every child replays its entrance rather than
              swapping text in place. */}
          <div key={step} className="flex min-h-[338px] flex-col">
            <div className="screen-in flex items-center gap-3.5">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[var(--color-border)] bg-white/[0.04]">
                <Icon className="h-[18px] w-[18px] text-white/85" aria-hidden="true" />
              </span>
              <div>
                <Eyebrow>{`Step ${step + 1} of ${TOTAL}`}</Eyebrow>
                <h1 className="mt-1 text-[21px] font-semibold leading-tight tracking-[-0.015em]">
                  {current.title}
                </h1>
              </div>
            </div>

            <p
              className="screen-in mt-5 max-w-[600px] text-[13.5px] leading-[1.65] text-[var(--color-muted-foreground)]"
              style={{ animationDelay: "60ms" }}
            >
              {current.body}
            </p>

            <div className="screen-in mt-auto pt-6" style={{ animationDelay: "120ms" }}>
              {current.visual}
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 grid shrink-0 grid-cols-3 items-center gap-4 px-8 pb-7 pt-6">
        <div className="no-drag justify-self-start">
          <button
            type="button"
            onClick={finish}
            className="h-9 rounded-lg px-3 text-[13px] text-white/40 transition-colors hover:text-white/80"
          >
            Skip tour
          </button>
        </div>

        <div className="no-drag flex items-center justify-center gap-1.5">
          {STEPS.map((s, i) => (
            <button
              key={s.title}
              type="button"
              onClick={() => setStep(i)}
              aria-label={`Go to step ${i + 1}`}
              aria-current={i === step ? "step" : undefined}
              className={`h-[6px] rounded-full transition-all duration-300 ${
                i === step
                  ? "w-7 bg-white"
                  : i < step
                    ? "w-[6px] bg-white/45 hover:bg-white/70"
                    : "w-[6px] bg-white/15 hover:bg-white/35"
              }`}
            />
          ))}
        </div>

        <div className="no-drag flex items-center justify-end gap-2">
          <button type="button" onClick={back} disabled={isFirst} className={ghostButton}>
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back
          </button>
          <button
            type="button"
            onClick={advance}
            className="no-drag btn-primary btn-compact gap-2"
          >
            {isLast ? "Open the dashboard" : "Next"}
            {isLast ? (
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        </div>
      </footer>
    </div>
  )
}
