import { useCallback, useEffect, useRef, useState } from "react"
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
  Crosshair,
  History,
  LogOut,
  Radio,
  Search,
  ShieldAlert,
  SignalHigh,
  Users,
} from "lucide-react"

import { classifyError, type ClassifiedError } from "../lib/errors"
import { OutcomePanel } from "../modules/ModuleScreen"
import { RemoteImage } from "../modules/RemoteImage"
import { Result as RobloxResult } from "../modules/roblox"
import { EmptyState, Section } from "../modules/ui"
import {
  EMPTY_SESSION,
  NEW_ACCOUNT_DAYS,
  POLL_MS,
  durationLabel,
  filterPlayers,
  flaggedPlayers,
  isLive,
  mintConnector,
  openPlayer,
  readSession,
  relativeTime,
  scannedCount,
  setHighlight,
  setOverlay,
  shortDate,
  unpair,
  type Dossier,
  type Player,
  type Session,
} from "./api"

/**
 * Roblox Server Intel.
 *
 * NOT a lookup module, and deliberately not routed through ModuleScreen. There
 * is no query to submit: the operator mints a one-time connector, pastes it
 * into their Roblox executor, and the connector reports the server's roster
 * back to our API. The screen then reads that session and steers it. It is a
 * built-in route beside /monitor and /investigations for exactly that reason.
 *
 * HEIST ONLY on the part that matters, exactly as on the web. The server gates
 * MINTING on `requireFeatureAccess(user, "heist")` and on the same two-per-five-
 * hours budget the browser spends from; reading and steering an existing session
 * are signed-in only, because without a connector there is nothing to read. This
 * screen does not re-implement that decision: it asks the server, and a refusal
 * renders as the upgrade panel carrying the server's own copy. That way the gate
 * cannot drift out of step with the web by a client release.
 *
 * Two views over one route, the way Investigations does it, rather than the
 * web's slide-over drawer. The app has no router and this window is small; a
 * drawer over a polling list would have meant a modal layer, a scroll lock and a
 * portal, for a panel that wants the whole width anyway.
 *
 * THE POLL IS THE THING TO GET RIGHT. It runs on one interval, started on mount
 * and cleared on unmount, with a single request in flight at a time and a hard
 * stop on a refusal that will not fix itself. A leaked interval here would keep
 * an unattended app calling a plan-gated endpoint forever.
 */

/** Where the screen is. Two views, one route. */
type View = { kind: "session" } | { kind: "player"; userId: string }

type Phase = "loading" | "ready" | "failed"

export function ServerIntel() {
  const [session, setSession] = useState<Session>(EMPTY_SESSION)
  const [phase, setPhase] = useState<Phase>("loading")
  const [outcome, setOutcome] = useState<ClassifiedError | null>(null)
  const [view, setView] = useState<View>({ kind: "session" })
  const [filter, setFilter] = useState("")
  const [now, setNow] = useState(() => Date.now())

  /**
   * Whether the poll is allowed to keep going.
   *
   * A ref rather than state because the interval callback closes over it: with
   * state, the running interval would keep reading the value it captured and a
   * stop would not take effect until the next render scheduled a new interval.
   */
  const polling = useRef(true)
  /** One request at a time. A slow answer must not let ticks pile up behind it. */
  const inFlight = useRef(false)

  const load = useCallback(async () => {
    if (inFlight.current || !polling.current) return
    inFlight.current = true
    try {
      const next = await readSession()
      if (!polling.current) return
      setSession(next)
      setPhase("ready")
      setOutcome(null)
    } catch (err) {
      const classified = classifyError(err)
      // A dead session, a plan refusal or a suspension will not fix itself on
      // the next tick, and an unattended app must not keep asking a plan-gated
      // endpoint forever. A network blip or a 5xx will, so those keep polling.
      const fatal =
        classified.kind === "auth" ||
        classified.kind === "upgrade" ||
        classified.kind === "suspended"
      if (fatal) polling.current = false
      setOutcome(classified)
      // Never an empty session. A refused or unreachable request rendered as
      // "nothing is paired" would tell the operator their server link dropped,
      // which is a different and much worse claim than "we could not read it".
      //
      // And a session already on screen STAYS on screen through a transient
      // failure. This polls every few seconds, so one dropped request replacing
      // a live roster with an error page would make the screen flicker between
      // the two on a shaky connection. The banner says the roster may be stale;
      // the roster itself is still the last thing we were actually told.
      setPhase((current) => (fatal || current !== "ready" ? "failed" : "ready"))
    } finally {
      inFlight.current = false
    }
  }, [])

  useEffect(() => {
    polling.current = true
    void load()
    const timer = setInterval(() => void load(), POLL_MS)
    return () => {
      // Both, and in this order. Clearing the interval stops new ticks; the flag
      // stops a request that is already in flight from writing state into an
      // unmounted screen when it lands.
      polling.current = false
      clearInterval(timer)
    }
  }, [load])

  // The session clocks tick once a second, and only while a session is open.
  // There are no clocks on the connect screen, so there is nothing to redraw.
  const connected = session.connected
  useEffect(() => {
    if (!connected) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [connected])

  const retry = useCallback(() => {
    polling.current = true
    setPhase("loading")
    setOutcome(null)
    void load()
  }, [load])

  const onOverlay = useCallback(async (patch: Partial<{ highlight: boolean; esp: boolean }>) => {
    // Optimistic, because a toggle that waits three seconds for the next poll
    // to move reads as broken. The next poll is the correction if it failed.
    setSession((s) => ({ ...s, overlay: { ...s.overlay, ...patch } }))
    await setOverlay(patch).catch(() => undefined)
  }, [])

  const onHighlight = useCallback(async (userId: string, on: boolean) => {
    setSession((s) => ({
      ...s,
      players: s.players.map((p) => (p.userId === userId ? { ...p, highlighted: on } : p)),
    }))
    await setHighlight(userId, on).catch(() => undefined)
  }, [])

  const onDisconnect = useCallback(async () => {
    await unpair().catch(() => undefined)
    setSession(EMPTY_SESSION)
    setView({ kind: "session" })
    void load()
  }, [load])

  if (view.kind === "player") {
    const player = session.players.find((p) => p.userId === view.userId) ?? null
    return (
      <PlayerView
        userId={view.userId}
        player={player}
        onBack={() => setView({ kind: "session" })}
        onHighlight={onHighlight}
      />
    )
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <Header live={isLive(session, now)} connected={session.connected} />

      {phase === "failed" && outcome ? (
        // The whole screen, not a corner of it. If the session could not be
        // read, the connector button would be offering an action that is going
        // to fail the same way, and a Heist refusal applies to every part of
        // this page at once.
        <OutcomePanel outcome={outcome} onRetry={retry} />
      ) : phase === "loading" ? (
        <Section title="Session">
          <p className="text-[13px] text-[var(--color-muted-foreground)]">Reading your session.</p>
        </Section>
      ) : session.connected ? (
        <>
          {outcome ? <StaleBanner message={outcome.message} /> : null}
          <SessionPanel session={session} now={now} onDisconnect={() => void onDisconnect()} />
          <StealerPanel
            flagged={flaggedPlayers(session.players)}
            scanned={scannedCount(session.players)}
            onOpen={(id) => setView({ kind: "player", userId: id })}
          />
          <OverlayPanel
            overlay={session.overlay}
            flagged={flaggedPlayers(session.players).length}
            onChange={(patch) => void onOverlay(patch)}
          />
          <RosterPanel
            players={filterPlayers(session.players, filter)}
            total={session.players.length}
            filter={filter}
            onFilter={setFilter}
            onOpen={(id) => setView({ kind: "player", userId: id })}
          />
        </>
      ) : (
        <ConnectPanel paired={session.paired} />
      )}
    </div>
  )
}

function Header({ live, connected }: { live: boolean; connected: boolean }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]">
          / Roblox / Server Intel
        </p>
        <h1 className="mt-1 flex items-center gap-2 text-3xl font-semibold tracking-tight text-white">
          <Radio className="h-6 w-6" aria-hidden="true" />
          Server Intel
        </h1>
        <p className="mt-1 max-w-[70ch] text-sm text-[var(--color-muted-foreground)]">
          Link a live Roblox server. Run the connector in your executor and the roster resolves into
          full dossiers as players join.
        </p>
      </div>
      {connected ? <LivePill live={live} /> : null}
    </div>
  )
}

/**
 * A poll that failed while a session was already on screen.
 *
 * Quiet on purpose. The roster below is real, it is just not necessarily
 * current, and the poll is still running. Replacing the whole screen for this
 * would make a shaky connection look like a dropped server link.
 */
export function StaleBanner({ message }: { message: string }) {
  return (
    <div className="glass-tile flex items-center gap-3 px-4 py-3">
      <AlertTriangle
        className="h-4 w-4 shrink-0"
        style={{ color: "var(--warning)" }}
        aria-hidden="true"
      />
      <p className="text-[13px] text-white/80">
        This roster may be out of date, the last refresh did not go through: {message}
      </p>
    </div>
  )
}

/**
 * Live or Idle.
 *
 * Idle is not an error. It means the connector has stopped checking in (the
 * executor was closed, or the player left the game), so the roster on screen is
 * the last one we were told about. Saying "Live" over stale data is the single
 * claim this screen must never make.
 */
export function LivePill({ live }: { live: boolean }) {
  return (
    <span className="glass-tile inline-flex items-center gap-2 rounded-full px-3 py-1.5">
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: live ? "var(--positive)" : "var(--warning)" }}
        aria-hidden="true"
      />
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/85">
        {live ? "Live" : "Idle"}
      </span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Connecting
// ---------------------------------------------------------------------------

/**
 * Clipboard write that degrades instead of throwing. The Tauri webview is a
 * secure context so navigator.clipboard is normally there, but WebKitGTK
 * without a running clipboard owner can still reject, and the whole panel must
 * not die over a copy button.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const field = document.createElement("textarea")
    field.value = text
    field.setAttribute("readonly", "")
    field.style.position = "fixed"
    field.style.opacity = "0"
    document.body.appendChild(field)
    field.select()
    const ok = document.execCommand("copy")
    document.body.removeChild(field)
    return ok
  } catch {
    return false
  }
}

function ConnectPanel({ paired }: { paired: boolean }) {
  const [loadstring, setLoadstring] = useState("")
  const [minting, setMinting] = useState(false)
  const [failure, setFailure] = useState<ClassifiedError | null>(null)
  const [copied, setCopied] = useState(false)

  const mint = useCallback(async () => {
    if (minting) return
    setMinting(true)
    setFailure(null)
    try {
      setLoadstring(await mintConnector())
    } catch (err) {
      // This is the one call the plan gate and the connector budget sit on, so
      // this is where a Heist refusal and a 429 arrive. Both are shown in the
      // server's own words.
      setFailure(classifyError(err))
    } finally {
      setMinting(false)
    }
  }, [minting])

  const copy = useCallback(async () => {
    if (!loadstring) return
    const ok = await copyText(loadstring)
    setCopied(ok)
  }, [loadstring])

  return (
    <Section title={loadstring ? "Listening for your server" : "Link a live server"}>
      <div className="glass-tile px-4 py-5">
        <p className="max-w-[62ch] text-[13px] text-white/80">
          {loadstring
            ? "Run the connector in your executor. The moment it checks in, this server goes live."
            : paired
              ? "A connector is already waiting for a check-in. Generate a new one if you have lost the old script."
              : "Generate a one-time connector, paste it into your executor, and run it inside the server you want to watch."}
        </p>

        {loadstring ? (
          <div className="mt-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]">
              Paste into executor
            </p>
            <pre className="glass-input mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-all px-3 py-2 font-mono text-[11px] leading-relaxed text-white/85">
              {loadstring}
            </pre>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void copy()} className="btn-primary btn-compact">
                {copied ? (
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {copied ? "Copied" : "Copy connector"}
              </button>
              <button
                type="button"
                onClick={() => void mint()}
                aria-busy={minting}
                className="btn-secondary btn-compact"
              >
                Generate a new one
              </button>
              <span className="text-[12px] text-[var(--color-muted-foreground)]">
                The link expires in 15 minutes. A running connector is not affected.
              </span>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void mint()}
            disabled={minting}
            aria-busy={minting}
            className="btn-primary btn-compact mt-4"
          >
            <Radio className="h-3.5 w-3.5" aria-hidden="true" />
            Generate connector
          </button>
        )}
      </div>

      {failure ? (
        <div className="mt-4">
          <OutcomePanel outcome={failure} onRetry={() => void mint()} />
        </div>
      ) : null}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// The live session
// ---------------------------------------------------------------------------

function SessionPanel({
  session,
  now,
  onDisconnect,
}: {
  session: Session
  now: number
  onDisconnect: () => void
}) {
  return (
    <Section
      title={session.place?.name?.trim() || "Live server"}
      action={
        <button type="button" onClick={onDisconnect} className="btn-secondary btn-compact">
          <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
          Disconnect
        </button>
      }
    >
      <div className="glass-tile px-4 py-4">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-3">
          <Stat icon={<Users className="h-3.5 w-3.5" aria-hidden="true" />} label="Players">
            {session.players.length}
          </Stat>
          <Stat icon={<Radio className="h-3.5 w-3.5" aria-hidden="true" />} label="Session open">
            {durationLabel(session.firstConnectedAt, now)}
          </Stat>
          <Stat
            icon={<SignalHigh className="h-3.5 w-3.5" aria-hidden="true" />}
            label="Last heartbeat"
          >
            {relativeTime(session.lastSeen, now)}
          </Stat>
        </dl>
        {session.place || session.server ? (
          <p className="mt-3 truncate font-mono text-[11px] text-[var(--color-muted-foreground)]">
            {session.place?.id ? `Place ${session.place.id}` : ""}
            {session.place?.id && session.server?.id ? " · " : ""}
            {session.server?.id ? `Job ${session.server.id}` : ""}
          </p>
        ) : null}
      </div>
    </Section>
  )
}

function Stat({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted-foreground)]">
        {icon}
        {label}
      </dt>
      <dd className="mt-1 truncate text-[13px] text-white">{children}</dd>
    </div>
  )
}

function StealerPanel({
  flagged,
  scanned,
  onOpen,
}: {
  flagged: Player[]
  scanned: number
  onOpen: (userId: string) => void
}) {
  return (
    <Section
      title="Stealer logs"
      action={
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted-foreground)]">
          {scanned} scanned
        </span>
      }
    >
      {flagged.length === 0 ? (
        // Says what was checked, not just that nothing turned up. "No hits" on
        // its own reads as a clean server even when only two of forty players
        // have been through the scanner.
        <EmptyState
          message={
            scanned === 0
              ? "Nobody has been checked yet. Dossiers resolve as the connector reports the roster."
              : `No stealer hits among the ${scanned} ${scanned === 1 ? "player" : "players"} checked so far.`
          }
        />
      ) : (
        <ul className="space-y-2">
          {flagged.map((player) => (
            <li key={player.userId}>
              <button
                type="button"
                onClick={() => onOpen(player.userId)}
                className="glass-tile glass-tile-hover flex w-full items-center gap-3 px-4 py-3 text-left"
              >
                <Avatar player={player} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <ShieldAlert
                      className="h-3.5 w-3.5 shrink-0"
                      style={{ color: "var(--color-destructive)" }}
                      aria-hidden="true"
                    />
                    <span className="truncate text-[13px] text-white">{player.displayName}</span>
                  </span>
                  <span className="mt-1 block truncate font-mono text-[11px] text-[var(--color-muted-foreground)]">
                    @{player.username} · {player.hits} {player.hits === 1 ? "log" : "logs"}
                    {shortDate(player.latestHit) ? ` · latest ${shortDate(player.latestHit)}` : ""}
                  </span>
                </span>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]"
                  aria-hidden="true"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function OverlayPanel({
  overlay,
  flagged,
  onChange,
}: {
  overlay: { highlight: boolean; esp: boolean }
  flagged: number
  onChange: (patch: Partial<{ highlight: boolean; esp: boolean }>) => void
}) {
  return (
    <Section
      title="In-game overlay"
      action={
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted-foreground)]">
          {flagged} flagged
        </span>
      }
    >
      <div className="space-y-2">
        <Toggle
          on={overlay.highlight}
          onToggle={() => onChange({ highlight: !overlay.highlight })}
          icon={<Crosshair className="h-4 w-4" aria-hidden="true" />}
          title="Highlight flagged players"
          hint="A red outline drawn on anyone carrying stealer logs, including new detections."
        />
        <Toggle
          on={overlay.esp}
          onToggle={() => onChange({ esp: !overlay.esp })}
          icon={<Activity className="h-4 w-4" aria-hidden="true" />}
          title="ESP tracers"
          hint="Lines from you to each flagged player, if your executor supports drawing."
        />
      </div>
    </Section>
  )
}

function Toggle({
  on,
  onToggle,
  icon,
  title,
  hint,
}: {
  on: boolean
  onToggle: () => void
  icon: React.ReactNode
  title: string
  hint: string
}) {
  return (
    <div className="glass-tile flex items-center gap-3 px-4 py-3">
      <span className="shrink-0 text-[var(--color-muted-foreground)]">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] text-white">{title}</span>
        <span className="mt-0.5 block text-[12px] text-[var(--color-muted-foreground)]">{hint}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={title}
        onClick={onToggle}
        className={on ? "btn-primary btn-compact" : "btn-secondary btn-compact"}
      >
        {on ? "On" : "Off"}
      </button>
    </div>
  )
}

function RosterPanel({
  players,
  total,
  filter,
  onFilter,
  onOpen,
}: {
  players: Player[]
  total: number
  filter: string
  onFilter: (value: string) => void
  onOpen: (userId: string) => void
}) {
  return (
    <Section
      title={`Players (${total})`}
      action={
        <span className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-muted-foreground)]"
            aria-hidden="true"
          />
          <input
            value={filter}
            onChange={(event) => onFilter(event.target.value)}
            placeholder="Filter players"
            aria-label="Filter players"
            className="glass-input w-48 py-1.5 pl-8 pr-3 font-mono text-[11px]"
          />
        </span>
      }
    >
      {players.length === 0 ? (
        <EmptyState
          message={
            total === 0
              ? "The connector has not reported anyone yet."
              : "No players match that filter."
          }
        />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {players.map((player) => (
            <li key={player.userId}>
              <RosterRow player={player} onOpen={() => onOpen(player.userId)} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

/**
 * One roster row.
 *
 * Only a finished scan is openable. A row that is still queued has nothing
 * behind it, and letting it open a blank dossier would read as "we looked and
 * found nothing about this person".
 */
function RosterRow({ player, onOpen }: { player: Player; onOpen: () => void }) {
  const openable = player.scan === "done"
  const isNew = player.accountAge > 0 && player.accountAge < NEW_ACCOUNT_DAYS

  const body = (
    <>
      <Avatar player={player} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[13px] text-white">{player.displayName}</span>
          {player.isVerified ? (
            <Check
              className="h-3 w-3 shrink-0"
              style={{ color: "var(--positive)" }}
              aria-label="Verified"
            />
          ) : null}
          {player.hits > 0 ? (
            <ShieldAlert
              className="h-3.5 w-3.5 shrink-0"
              style={{ color: "var(--color-destructive)" }}
              aria-label={`${player.hits} stealer rows`}
            />
          ) : null}
          {player.highlighted ? (
            <Crosshair className="h-3 w-3 shrink-0 text-white/70" aria-label="Highlighted in game" />
          ) : null}
        </span>
        <span className="mt-1 flex items-center gap-1.5 truncate font-mono text-[11px] text-[var(--color-muted-foreground)]">
          @{player.username}
          {isNew ? (
            <AlertTriangle
              className="h-3 w-3 shrink-0"
              style={{ color: "var(--warning)" }}
              aria-label={`Account is ${player.accountAge} days old`}
            />
          ) : null}
          {player.seen ? (
            <History className="h-3 w-3 shrink-0" aria-label="Seen in a previous session" />
          ) : null}
        </span>
      </span>
      {openable ? (
        <ChevronRight
          className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]"
          aria-hidden="true"
        />
      ) : (
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted-foreground)]">
          {player.scan === "error" ? "failed" : player.scan === "pending" ? "scanning" : "queued"}
        </span>
      )}
    </>
  )

  return openable ? (
    <button
      type="button"
      onClick={onOpen}
      className="glass-tile glass-tile-hover flex w-full items-center gap-3 px-4 py-3 text-left"
    >
      {body}
    </button>
  ) : (
    <div className="glass-tile flex w-full items-center gap-3 px-4 py-3">{body}</div>
  )
}

function Avatar({ player }: { player: Player }) {
  return (
    <RemoteImage
      url={player.avatarUrl}
      alt={player.displayName}
      className="h-9 w-9 shrink-0 rounded-lg text-[11px]"
    />
  )
}

// ---------------------------------------------------------------------------
// One player
// ---------------------------------------------------------------------------

/**
 * A player's dossier.
 *
 * The result renders through the /roblox module's own `Result`, because it IS a
 * Roblox profile lookup result: the server normalises it with the very same
 * function. Rewriting the card here would have been a second renderer for one
 * payload, drifting apart one field at a time.
 */
function PlayerView({
  userId,
  player,
  onBack,
  onHighlight,
}: {
  userId: string
  player: Player | null
  onBack: () => void
  onHighlight: (userId: string, on: boolean) => void
}) {
  const [state, setState] = useState<
    { phase: "loading" } | { phase: "ready"; dossier: Dossier } | { phase: "failed"; outcome: ClassifiedError }
  >({ phase: "loading" })

  /** Fetched once, not polled. The dossier is enrichment the session has
   *  already done, so it does not change while the operator reads it. */
  const load = useCallback(
    async (alive: () => boolean = () => true) => {
      setState({ phase: "loading" })
      try {
        const dossier = await openPlayer(userId)
        if (alive()) setState({ phase: "ready", dossier })
      } catch (err) {
        if (alive()) setState({ phase: "failed", outcome: classifyError(err) })
      }
    },
    [userId],
  )

  useEffect(() => {
    let cancelled = false
    void load(() => !cancelled)
    return () => {
      cancelled = true
    }
  }, [load])

  const name = player?.displayName || userId

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <button type="button" onClick={onBack} className="btn-secondary btn-compact">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to the server
          </button>
          <h1 className="mt-3 truncate text-2xl font-semibold tracking-tight text-white">{name}</h1>
          <p className="mt-1 truncate font-mono text-[11px] text-[var(--color-muted-foreground)]">
            {player ? `@${player.username} · ` : ""}
            {userId}
          </p>
        </div>
        {player ? (
          <button
            type="button"
            onClick={() => onHighlight(player.userId, !player.highlighted)}
            className={player.highlighted ? "btn-primary btn-compact" : "btn-secondary btn-compact"}
          >
            <Crosshair className="h-3.5 w-3.5" aria-hidden="true" />
            {player.highlighted ? "Highlighted in game" : "Highlight in game"}
          </button>
        ) : null}
      </div>

      {player?.seen ? <SeenPanel seen={player.seen} /> : null}

      {state.phase === "loading" ? (
        <Section title="Dossier">
          <p className="text-[13px] text-[var(--color-muted-foreground)]">Loading the dossier.</p>
        </Section>
      ) : state.phase === "failed" ? (
        <OutcomePanel outcome={state.outcome} onRetry={() => void load()} />
      ) : state.dossier.dossier ? (
        <RobloxResult data={state.dossier.dossier} partial={[]} />
      ) : (
        <Section title="Dossier">
          {/* NOT an empty state. Nothing was looked up, so "no results" would be
              a claim about this account rather than about our progress. */}
          <EmptyState
            message={
              state.dossier.scan === "error"
                ? "This player's dossier could not be resolved, so this is not a clean result."
                : "This player has not been scanned yet. The dossier appears once the connector's batch reaches them."
            }
          />
        </Section>
      )}
    </div>
  )
}

function SeenPanel({ seen }: { seen: NonNullable<Player["seen"]> }) {
  const when = shortDate(new Date(seen.lastSeen).toISOString())
  return (
    <div className="glass-tile flex items-center gap-3 px-4 py-3">
      <History className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" aria-hidden="true" />
      <p className="text-[13px] text-white/80">
        You have seen this player {seen.count === 1 ? "once before" : `${seen.count} times before`}
        {when ? `, last on ${when}` : ""}
        {seen.lastPlace ? ` in ${seen.lastPlace}` : ""}.
      </p>
    </div>
  )
}
