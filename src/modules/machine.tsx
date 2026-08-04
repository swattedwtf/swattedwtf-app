import { useState } from "react"

import { ipc } from "../lib/ipc"
import { list, withDefaults } from "./safe"
import type { ModuleDescriptor, ResultProps } from "./types"
import { EmptyState, FieldGrid, ProfileCard, Section } from "./ui"

/**
 * Machine Browser.
 *
 * The real, two-step OathNet flow (the old one-field `pcKey` screen wrapped a
 * different feature entirely). One free-text field opens a search: a query like
 * an email, a username, an HWID, an IP or a domain. The server answers in one of
 * two shapes:
 *
 *   - a single matching machine, whose full dump it already hydrated, so the
 *     screen lands straight on the dump; or
 *   - several matching machines, which the screen lists so the user can pick
 *     one. Picking loads that machine's dump with a SECOND server call
 *     (`machineManifest`), reusing the search's `searchId` and the victim's
 *     signed `machineGrant` so the pick does not spend another OathNet lookup.
 *
 * That second call is the only place a result component reaches for `ipc.lookup`
 * itself. It fits the single-shot ModuleScreen without changes: the screen runs
 * the search, and the picker is state internal to this component.
 *
 * A machine dump carries no images and no links, so nothing here goes through
 * RemoteImage or ipc.openExternal. Every block is a `ui/` primitive.
 */

const QUERY_MAX = 256

type DumpData = {
  filename: string
  hash: string
  user: string
  hardwareId: string
  stats: { files: number; folders: number; creds: number; emails: number }
  ips: string[]
  discord: string[]
  emails: string[]
  totalCreds: number
  emailCount: number
  files: { name: string; danger: boolean }[]
}

type Victim = {
  logId: string
  machineGrant: string | null
  user: string
  hwid: string
  ip: string
  email: string
  discord: string
  totalDocs: number
  pwnedAt: string | null
  indexedAt: string | null
  deviceUsers: string[]
  hwids: string[]
  ips: string[]
  emails: string[]
  discordIds: string[]
}

type MachineSearchData = {
  query: string
  searchId: string | null
  victims: Victim[]
  dump: DumpData | null
}

const EMPTY_STATS = { files: 0, folders: 0, creds: 0, emails: 0 }

function formatDate(iso: string | null): string {
  if (!iso) return ""
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return typeof iso === "string" ? iso : ""
  return at.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

/** Coerces an untyped payload into a dump, or null when there is none. A
 *  renderer that reads `.length` on an absent field throws inside React's
 *  render, which in this app is a white window with no reachable console. */
function coerceDump(raw: unknown): DumpData | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null
  const d = withDefaults(raw, {} as Partial<DumpData>)
  return {
    filename: typeof d.filename === "string" ? d.filename : "",
    hash: typeof d.hash === "string" ? d.hash : "",
    user: typeof d.user === "string" ? d.user : "",
    hardwareId: typeof d.hardwareId === "string" ? d.hardwareId : "",
    stats: withDefaults(d.stats, EMPTY_STATS),
    ips: list<string>(d.ips),
    discord: list<string>(d.discord),
    emails: list<string>(d.emails),
    totalCreds: typeof d.totalCreds === "number" ? d.totalCreds : 0,
    emailCount: typeof d.emailCount === "number" ? d.emailCount : 0,
    files: list<{ name: string; danger: boolean }>(d.files),
  }
}

function coerceVictim(raw: unknown): Victim {
  const v = withDefaults(raw, {} as Partial<Victim>)
  return {
    logId: typeof v.logId === "string" ? v.logId : "",
    machineGrant: typeof v.machineGrant === "string" ? v.machineGrant : null,
    user: typeof v.user === "string" ? v.user : "",
    hwid: typeof v.hwid === "string" ? v.hwid : "",
    ip: typeof v.ip === "string" ? v.ip : "",
    email: typeof v.email === "string" ? v.email : "",
    discord: typeof v.discord === "string" ? v.discord : "",
    totalDocs: typeof v.totalDocs === "number" ? v.totalDocs : 0,
    pwnedAt: typeof v.pwnedAt === "string" ? v.pwnedAt : null,
    indexedAt: typeof v.indexedAt === "string" ? v.indexedAt : null,
    deviceUsers: list<string>(v.deviceUsers),
    hwids: list<string>(v.hwids),
    ips: list<string>(v.ips),
    emails: list<string>(v.emails),
    discordIds: list<string>(v.discordIds),
  }
}

/** A section over a flat string list. Bounded, so a huge dump cannot lock the
 *  render, and each row reads monospaced because these are raw log values. */
function StringList({
  title,
  count,
  rows,
  empty,
}: {
  title: string
  count: number
  rows: string[]
  empty: string
}) {
  return (
    <Section title={`${title}${count ? ` (${count})` : ""}`}>
      {rows.length === 0 ? (
        <EmptyState message={empty} />
      ) : (
        <ul className="space-y-1 font-mono text-[11px] leading-relaxed text-white/70">
          {rows.slice(0, 100).map((row, i) => (
            <li key={i} className="truncate">
              {row || "Empty record"}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

/** The captured file tree, flattened by the server into labelled paths.
 *  Credential-bearing files are tinted so they stand out in a long list. */
function FileList({ files }: { files: { name: string; danger: boolean }[] }) {
  return (
    <Section title={`Files${files.length ? ` (${files.length})` : ""}`}>
      {files.length === 0 ? (
        <EmptyState message="No files listed in this dump." />
      ) : (
        <ul className="space-y-1 font-mono text-[11px] leading-relaxed">
          {files.slice(0, 200).map((f, i) => (
            <li
              key={i}
              className={`truncate ${f.danger ? "text-[var(--color-destructive)]" : "text-white/70"}`}
            >
              {f.name || "Unnamed file"}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

/** One loaded machine dump: identity, counts, recovered selectors, file tree. */
function DumpView({ dump }: { dump: DumpData }) {
  return (
    <div className="space-y-4">
      <ProfileCard
        avatarUrl={null}
        name={dump.user || dump.filename || "Unknown machine"}
        subtitle={dump.filename || dump.hash || null}
        meta={[
          { label: "Hardware ID", value: dump.hardwareId, mono: true },
          { label: "Log hash", value: dump.hash, mono: true },
          { label: "Files", value: dump.stats.files ? String(dump.stats.files) : "" },
          { label: "Credentials", value: dump.totalCreds ? String(dump.totalCreds) : "" },
        ]}
      />

      <StringList
        title="IP addresses"
        count={dump.ips.length}
        rows={dump.ips}
        empty="No IP addresses in this dump."
      />

      <StringList
        title="Email addresses"
        count={dump.emailCount || dump.emails.length}
        rows={dump.emails}
        empty="No email addresses in this dump."
      />

      <StringList
        title="Discord"
        count={dump.discord.length}
        rows={dump.discord}
        empty="No Discord ids in this dump."
      />

      <FileList files={dump.files} />
    </div>
  )
}

/** One machine in the picker: its identity, and what selecting it will load. */
function VictimCard({
  victim,
  busy,
  disabled,
  onSelect,
}: {
  victim: Victim
  busy: boolean
  disabled: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      aria-busy={busy || undefined}
      className="w-full rounded-lg border border-[var(--color-border)] bg-white/[0.02] p-4 text-left transition-colors hover:border-white/30 disabled:cursor-default disabled:opacity-60"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="truncate font-mono text-[12px] text-white/85">
          {victim.user || victim.logId || "Unknown machine"}
        </span>
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted-foreground)]">
          {busy ? "Loading" : `${victim.totalDocs || 0} docs`}
        </span>
      </div>
      <div className="mt-3">
        <FieldGrid
          hideEmpty
          fields={[
            { label: "Log id", value: victim.logId, mono: true },
            { label: "Hardware id", value: victim.hwid, mono: true },
            { label: "IP", value: victim.ip, mono: true },
            { label: "Email", value: victim.email },
            { label: "Discord", value: victim.discord, mono: true },
            { label: "Pwned", value: formatDate(victim.pwnedAt) },
          ]}
        />
      </div>
    </button>
  )
}

export function Result({ data }: ResultProps) {
  const raw = withDefaults(data, {} as Partial<MachineSearchData>)
  const searchId = typeof raw.searchId === "string" ? raw.searchId : null
  const eagerDump = coerceDump(raw.dump)
  const victims = list<unknown>(raw.victims).map(coerceVictim)

  // The picked machine's dump, loaded with a second call. `null` until a pick
  // resolves; `loadingLogId` marks the row the user is waiting on.
  const [picked, setPicked] = useState<DumpData | null>(null)
  const [loadingLogId, setLoadingLogId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function select(victim: Victim) {
    if (loadingLogId || !victim.logId) return
    setError(null)
    setLoadingLogId(victim.logId)
    try {
      const input: Record<string, unknown> = {
        logId: victim.logId,
        // The victim summary the server needs to keep IPs / emails / discord ids
        // on the picked dump (the manifest itself omits them). Echoed back
        // verbatim rather than re-fetched.
        victim: JSON.stringify({
          log_id: victim.logId,
          device_user_str: victim.deviceUsers,
          hwids_str: victim.hwids,
          device_ips: victim.ips,
          device_emails_str: victim.emails,
          discord_ids: victim.discordIds,
        }),
      }
      // Threaded so the pick stays inside the search's one billed OathNet lookup
      // and is authorised off the search's process. Sent only when present.
      if (searchId) input.searchId = searchId
      if (victim.machineGrant) input.machineGrant = victim.machineGrant

      const result = await ipc.lookup("machineManifest", input)
      const dump = coerceDump((result.data as { dump?: unknown } | null)?.dump)
      if (!dump) {
        setError("That machine's dump could not be loaded. Try picking it again.")
        return
      }
      setPicked(dump)
    } catch {
      setError("That machine's dump could not be loaded. Try picking it again.")
    } finally {
      setLoadingLogId(null)
    }
  }

  // A single hit arrives already hydrated; land straight on it.
  if (eagerDump) return <DumpView dump={eagerDump} />

  // A pick has loaded: show the dump, with a way back to the list.
  if (picked) {
    return (
      <div className="space-y-4">
        {victims.length > 1 ? (
          <button
            type="button"
            onClick={() => setPicked(null)}
            className="btn-secondary btn-compact"
          >
            Back to results
          </button>
        ) : null}
        <DumpView dump={picked} />
      </div>
    )
  }

  if (victims.length === 0) {
    return <EmptyState message="No machines matched that query." />
  }

  return (
    <Section title={`${victims.length} matching ${victims.length === 1 ? "machine" : "machines"}`}>
      {error ? (
        <p role="alert" className="mb-3 text-xs text-[var(--color-destructive)]">
          {error}
        </p>
      ) : null}
      <div className="space-y-3">
        {victims.map((victim) => (
          <VictimCard
            key={victim.logId}
            victim={victim}
            busy={loadingLogId === victim.logId}
            disabled={loadingLogId !== null}
            onSelect={() => void select(victim)}
          />
        ))}
      </div>
    </Section>
  )
}

export const descriptor: ModuleDescriptor = {
  id: "machine",
  route: "/machine",
  label: "Machine Browser",
  inputs: [
    {
      name: "query",
      label: "Search query",
      placeholder: "Email, username, HWID, IP, or domain",
      // Mirrors the server's own bound (non-empty, up to 256) so an input that
      // cannot succeed never becomes a metered request. The server is still the
      // authority.
      validate: (v) =>
        v.trim().length > 0 && v.trim().length <= QUERY_MAX
          ? null
          : "Enter a machine search query.",
    },
  ],
  Result,
}
