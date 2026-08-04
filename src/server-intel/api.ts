/**
 * The Roblox Server Intel session, minus React.
 *
 * Everything the screen does that is not drawing lives here: the six calls, the
 * coercion of what comes back, and the clocks the session header runs on. It is
 * separated for the reason ModuleScreen separates `runLookup` from its
 * component, which is that this is the part worth testing and none of it needs
 * a DOM.
 *
 * Server Intel is NOT a lookup. It is a pairing session: the operator mints a
 * one-time connector, runs it in their Roblox executor, and the connector
 * reports the roster back to our API. Nothing here is metered and nothing
 * spends a search. Minting is the one call the server gates on the Heist plan,
 * exactly where the web gates it.
 *
 * Every payload is coerced through `withDefaults`/`list` before a single field
 * is read. A renderer that reads `.length` on an absent field throws inside
 * React's render, which in this app is a white window with no console the user
 * can reach and no way to fix without shipping a release.
 */
import { ipc } from "../lib/ipc"
import { list, withDefaults } from "../modules/safe"

/** How often the session is re-read while the screen is open. Matches the web
 *  page's own poll, which is what the server is sized for. */
export const POLL_MS = 3000

/** Past this with no heartbeat, the connector is treated as gone quiet. The web
 *  uses the same window to decide between its Live and Idle pills. */
export const LIVE_WINDOW_MS = 30_000

/** An account younger than this is called out on its row. */
export const NEW_ACCOUNT_DAYS = 30

/** How far a player's background enrichment has got. */
export type ScanState = "queued" | "pending" | "done" | "error"

/** Prior sightings of a player, across every past session of this operator. */
export type SeenInfo = {
  firstSeen: number
  lastSeen: number
  count: number
  lastPlace: string
}

export type Overlay = { highlight: boolean; esp: boolean }

/** One roster row. Deliberately without a dossier: see `openPlayer`. */
export type Player = {
  userId: string
  username: string
  displayName: string
  accountAge: number
  scan: ScanState
  hits: number
  latestHit: string
  avatarUrl: string | null
  presence: string
  isVerified: boolean
  highlighted: boolean
  seen: SeenInfo | null
}

export type Session = {
  paired: boolean
  connected: boolean
  lastSeen: number | null
  firstConnectedAt: number | null
  overlay: Overlay
  place: { id: string; name: string } | null
  server: { id: string; players: number } | null
  players: Player[]
}

export const EMPTY_SESSION: Session = {
  paired: false,
  connected: false,
  lastSeen: null,
  firstConnectedAt: null,
  overlay: { highlight: false, esp: false },
  place: null,
  server: null,
  players: [],
}

const EMPTY_PLAYER: Player = {
  userId: "",
  username: "",
  displayName: "",
  accountAge: 0,
  scan: "queued",
  hits: 0,
  latestHit: "",
  avatarUrl: null,
  presence: "offline",
  isVerified: false,
  highlighted: false,
  seen: null,
}

const SCAN_STATES: ScanState[] = ["queued", "pending", "done", "error"]

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function stamp(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null
}

function scanOf(value: unknown): ScanState {
  return SCAN_STATES.includes(value as ScanState) ? (value as ScanState) : "queued"
}

/**
 * A prior-sighting record, or null.
 *
 * Null when the server did not send one, which means "never seen before". A
 * half-built object here would put "seen 0 times" on a stranger's row, which
 * reads as a claim rather than as an absence.
 */
export function toSeen(raw: unknown): SeenInfo | null {
  if (typeof raw !== "object" || raw === null) return null
  const s = withDefaults(raw, { firstSeen: 0, lastSeen: 0, count: 0, lastPlace: "" })
  const lastSeen = count(s.lastSeen)
  if (!lastSeen) return null
  return {
    firstSeen: count(s.firstSeen) || lastSeen,
    lastSeen,
    // A recorded sighting is at least one, whatever arrived in the counter.
    count: Math.max(1, count(s.count)),
    lastPlace: str(s.lastPlace),
  }
}

export function toPlayer(raw: unknown): Player {
  const p = withDefaults(raw, EMPTY_PLAYER)
  const username = str(p.username)
  return {
    userId: str(p.userId),
    username,
    // A row with no name at all is unreadable, and the userId is the one field
    // that is always there.
    displayName: str(p.displayName) || username || str(p.userId),
    accountAge: count(p.accountAge),
    scan: scanOf(p.scan),
    hits: count(p.hits),
    latestHit: str(p.latestHit),
    avatarUrl: typeof p.avatarUrl === "string" && p.avatarUrl ? p.avatarUrl : null,
    presence: str(p.presence, "offline"),
    isVerified: p.isVerified === true,
    highlighted: p.highlighted === true,
    seen: toSeen(p.seen),
  }
}

export function toSession(raw: unknown): Session {
  const s = withDefaults(raw, {} as Record<string, unknown>)
  const overlay = withDefaults(s.overlay, { highlight: false, esp: false })
  const place = withDefaults(s.place, { id: "", name: "" })
  const server = withDefaults(s.server, { id: "", players: 0 })
  const hasPlace = str(place.id) !== "" || str(place.name) !== ""
  const hasServer = str(server.id) !== ""
  return {
    paired: s.paired === true,
    connected: s.connected === true,
    lastSeen: stamp(s.lastSeen),
    firstConnectedAt: stamp(s.firstConnectedAt),
    overlay: { highlight: overlay.highlight === true, esp: overlay.esp === true },
    place: hasPlace ? { id: str(place.id), name: str(place.name) } : null,
    server: hasServer ? { id: str(server.id), players: count(server.players) } : null,
    players: list<unknown>(s.players).map(toPlayer),
  }
}

/** Players carrying at least one stealer or breach row. */
export function flaggedPlayers(players: Player[]): Player[] {
  return players.filter((p) => p.hits > 0)
}

/** How many players have actually been checked. Distinct from how many are in
 *  the server: the rest are queued or still running. */
export function scannedCount(players: Player[]): number {
  return players.filter((p) => p.scan === "done").length
}

/** Name, username or id. Case-insensitive, and never a regex, so a query full
 *  of punctuation is a search rather than a syntax error. */
export function filterPlayers(players: Player[], query: string): Player[] {
  const q = query.trim().toLowerCase()
  if (!q) return players
  return players.filter(
    (p) =>
      p.displayName.toLowerCase().includes(q) ||
      p.username.toLowerCase().includes(q) ||
      p.userId.includes(q),
  )
}

/**
 * Whether the connector is still checking in.
 *
 * A session that is connected but silent is NOT the same as one that was never
 * connected: the executor was closed or the player left the game, the roster on
 * screen is the last one we were told about, and saying "Live" over stale data
 * is the one thing this screen must not do.
 */
export function isLive(session: Session, now: number = Date.now()): boolean {
  if (!session.connected || session.lastSeen === null) return false
  return now - session.lastSeen < LIVE_WINDOW_MS
}

/** "12 seconds ago". Takes `now` so the same input always renders the same
 *  string, and reads as "just now" rather than "NaN" for a missing stamp. */
export function relativeTime(at: number | null, now: number = Date.now()): string {
  if (at === null) return "never"
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 2) return "just now"
  if (seconds < 60) return `${seconds} seconds ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m ago`
}

/** "4 minutes", for how long a session has been open. */
export function durationLabel(from: number | null, now: number = Date.now()): string {
  if (from === null) return "not yet"
  const seconds = Math.max(0, Math.round((now - from) / 1000))
  if (seconds < 60) return `${seconds} seconds`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

/** A provider date, in the user's own locale. Empty for anything unparseable,
 *  so a caption never reads "Invalid Date". */
export function shortDate(value: string): string {
  if (!value) return ""
  const at = new Date(value).getTime()
  if (!Number.isFinite(at)) return ""
  return new Date(at).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })
}

// ---------------------------------------------------------------------------
// The six calls
// ---------------------------------------------------------------------------

/** Mints a one-time connector and returns the loadstring to paste. This is the
 *  Heist-gated, rate-limited call, and the only one that is. */
export async function mintConnector(): Promise<string> {
  const payload = await ipc.serverIntel("pair")
  return str(withDefaults(payload, {} as Record<string, unknown>).loadstring)
}

/** Drops every live pairing for this account. The connector's next check-in
 *  401s and it stops on its own. */
export async function unpair(): Promise<void> {
  await ipc.serverIntel("unpair")
}

export async function readSession(): Promise<Session> {
  const payload = await ipc.serverIntel("state")
  return toSession(withDefaults(payload, {} as Record<string, unknown>).session)
}

export async function setOverlay(patch: Partial<Overlay>): Promise<Overlay> {
  const payload = await ipc.serverIntel("overlay", { patch })
  const body = withDefaults(payload, {} as Record<string, unknown>)
  const overlay = withDefaults(body.overlay, { highlight: false, esp: false })
  return { highlight: overlay.highlight === true, esp: overlay.esp === true }
}

export async function setHighlight(userId: string, on: boolean): Promise<string[]> {
  const payload = await ipc.serverIntel("highlight", { userId, on })
  const body = withDefaults(payload, {} as Record<string, unknown>)
  return list<unknown>(body.manualHighlight).filter((v): v is string => typeof v === "string")
}

/**
 * One player's dossier, out of enrichment the session has already done.
 *
 * `dossier` is null when the scan has not finished or failed, and `scan` says
 * which. The two are reported together because an empty card and a card that is
 * still coming look identical otherwise, and only one of them is worth waiting
 * for.
 */
export type Dossier = { dossier: Record<string, unknown> | null; scan: ScanState }

export async function openPlayer(userId: string): Promise<Dossier> {
  const payload = await ipc.serverIntel("player", { userId })
  const body = withDefaults(payload, {} as Record<string, unknown>)
  const dossier =
    typeof body.dossier === "object" && body.dossier !== null && !Array.isArray(body.dossier)
      ? (body.dossier as Record<string, unknown>)
      : null
  return { dossier, scan: scanOf(body.scan) }
}
