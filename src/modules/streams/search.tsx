import { useState, type ComponentType, type CSSProperties } from "react"
import {
  Cpu,
  Database,
  Fingerprint,
  Globe,
  HardDrive,
  KeyRound,
  Layers,
  Link2,
  Shield,
  ShieldAlert,
  UserSearch,
} from "lucide-react"

import { copyText } from "../../lib/clipboard"
import { list, withDefaults } from "../safe"
import { EmptyState, RecordCard, StatTiles, type LeakField, type LeakRecord, type StatTile } from "../ui"
import type { StreamFrame, StreamModuleDescriptor, StreamResultProps, StreamStatus } from "../stream-types"

/**
 * Search: the whole web Search page, not just its breach records.
 *
 * The web page is four requests folded into one screen: the breach sweep, plus a
 * unified stealer investigation, Hudson Rock infostealer machines (email), and
 * structured domain intelligence (domain). The desktop stream now emits all of
 * them, each as its own frame, so this renderer mirrors the web section for
 * section rather than drawing a lone grid of record cards:
 *
 *   {"t":"progress"|"done"|"error", …}      the breach cascade (records)
 *   {"t":"investigation","data":{…}}        unified stealer investigation, any mode
 *   {"t":"hudsonrock","infections":[…]}     infostealer machines, email + Heist
 *   {"t":"domain-intel","data":{…}}         structured domain intel, domain mode
 *
 * Frames can interleave and arrive in any order, and an older server simply
 * never sends the new ones, so every section is derived from "whatever frames
 * have arrived" and renders nothing at all when its data is absent. Nothing here
 * assumes a frame lands after `done`.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const USERNAME_RE = /^@?[A-Za-z0-9._-]{2,32}$/
// Advisory only. The server normalises and is the authority; this just keeps an
// obviously-not-a-domain value from becoming a metered request.
const DOMAIN_RE = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/.*)?$/i

type RawField = { label?: unknown; value?: unknown; sensitive?: unknown }
type RawRecord = { source?: unknown; fields?: unknown }

/** A stable, human string from an untrusted field. */
function text(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value)
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

/**
 * Merge the record lists from every progress frame, de-duplicating by source and
 * field values, exactly as the web page does. Re-derived from all frames on each
 * render, so the view always reflects precisely what has arrived.
 */
function mergedRecords(frames: StreamFrame[]): LeakRecord[] {
  const seen = new Set<string>()
  const out: LeakRecord[] = []
  for (const frame of frames) {
    if (frame.t !== "progress") continue
    for (const raw of list<RawRecord>(frame.records)) {
      const source = text(raw?.source) || "Unknown source"
      const fields: LeakField[] = list<RawField>(raw?.fields).map((f) => ({
        label: text(f?.label),
        value: text(f?.value),
        // The server's own sensitivity flag: a captured secret, tinted and
        // monospaced so it never reads as ordinary profile text.
        sensitive: f?.sensitive === true,
      }))
      const key = `${source}|${fields.map((f) => `${f.label}=${f.value}`).join("|")}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ source, fields })
    }
  }
  return out.slice(0, 500)
}

/** The most recent progress/done counters, coerced to numbers. */
function progress(frames: StreamFrame[]): { checked: number; total: number; hits: number } {
  let checked = 0
  let total = 0
  let hits = 0
  for (const frame of frames) {
    if (frame.t === "progress") {
      if (typeof frame.checked === "number") checked = frame.checked
      if (typeof frame.total === "number") total = frame.total
      if (typeof frame.hits === "number") hits = frame.hits
    } else if (frame.t === "done" && frame.stats && typeof frame.stats === "object") {
      const s = frame.stats as Record<string, unknown>
      if (typeof s.modulesQueried === "number") checked = s.modulesQueried
      if (typeof s.modulesHit === "number") hits = s.modulesHit
    }
  }
  return { checked, total, hits }
}

/** A leaked secret is any field the server flagged sensitive. */
function secretCount(records: LeakRecord[]): number {
  let n = 0
  for (const r of records) for (const f of r.fields) if (f.sensitive) n += 1
  return n
}

/** The distinct sources that actually returned a record. */
function sourceCount(records: LeakRecord[]): number {
  return new Set(records.map((r) => r.source)).size
}

// ---------------------------------------------------------------------------
// Client-side derivations over the breach records, ported from the web's
// collectCredentials / collectProfiles / collectMachines so the filter tabs
// carry the same meaning. Field labels arrive UPPER-cased from the cascade
// (extract-records' titleCase), so the classifiers match the upper form.
// ---------------------------------------------------------------------------

type Credential = { login: string; secret: string; secretLabel: string; source: string }

const SECRET_LABEL = /^(PASSWORD|PASS|PASSWD|PWD|HASH|SECRET|TOKEN|TOP PASSWORDS?)$/
const EMAIL_LABEL = /MAIL/
const USERNAME_LABEL = /(USER|LOGIN|NICK|HANDLE|ACCOUNT)/

function pickLogin(record: LeakRecord): string {
  const email = record.fields.find((f) => EMAIL_LABEL.test(f.label) && f.value.includes("@"))
  if (email) return email.value
  const user = record.fields.find((f) => USERNAME_LABEL.test(f.label) && !f.sensitive)
  if (user) return user.value
  const anyEmail = record.fields.find((f) => f.value.includes("@") && !f.sensitive)
  return anyEmail?.value ?? "-"
}

/** Flatten every record carrying a secret into credential rows, deduped. */
function collectCredentials(records: LeakRecord[]): Credential[] {
  const out: Credential[] = []
  const seen = new Set<string>()
  for (const record of records) {
    const secrets = record.fields.filter((f) => f.sensitive || SECRET_LABEL.test(f.label))
    if (secrets.length === 0) continue
    const login = pickLogin(record)
    for (const s of secrets) {
      const value = s.value.trim()
      if (!value) continue
      const key = `${login.toLowerCase()}|${value}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        login,
        secret: value,
        secretLabel: s.label
          .replace(/\b\w/g, (c) => c.toUpperCase())
          .replace(/\B\w+/g, (w) => w.toLowerCase()),
        source: record.source,
      })
    }
  }
  return out
}

const STRONG_IDENTITY =
  /(\bPHONE\b|\bMOBILE\b|\bTELEPHONE\b|\bADDRESS\b|\bSTREET\b|\bCITY\b|\bSTATE\b|\bZIP\b|\bZIPCODE\b|\bPOSTAL\b|\bPOSTCODE\b|\bGENDER\b|\bSEX\b|\bSURNAME\b|FIRST ?NAME|LAST ?NAME|FULL ?NAME|GIVEN ?NAME|MIDDLE ?NAME|\bDOB\b|BIRTH|DATE OF BIRTH|\bCOMPANY\b|\bEMPLOYER\b|\bOCCUPATION\b|JOB ?TITLE)/
const PLAIN_NAME = /\bNAME\b/
const NON_PERSON_NAME =
  /(DB|DATABASE|FILE|HOST|SOURCE|BREACH|DUMP|TABLE|PROFILE|SCREEN|DISPLAY|NICK|CODE|PRODUCT|DOMAIN|COMPANY|USER)/
const CONTACT = /(\bEMAIL\b|\bUSERNAME\b|\bLOGIN\b|\bPHONE\b)/
const HANDLE = /\bUSERNAME\b|\bHANDLE\b|\bLOGIN\b|SCREEN ?NAME|\bNICKNAME\b/
const ACCOUNT_FIELD = /PROFILE|AVATAR ?URL|\bSERVICE\b|\bPLATFORM\b|\bNETWORK\b|\bSOCIAL\b|SITE ?ADMIN|\bGAIA\b/
const SECRET = /\bPASSWORD\b|\bHASH\b|\bPWD\b|\bSECRET\b/
const PLATFORM_FIELD = /\bPLATFORM\b|\bSERVICE\b|\bNETWORK\b|\bSOCIAL\b/
const PRESENCE = /\bEMAIL\b|\bUSERNAME\b|\bLOGIN\b|\bREGISTERED\b|\bSTATUS\b|\bEXISTS\b|\bACCOUNT\b/

function isProfileRecord(record: LeakRecord): boolean {
  const labels = record.fields.map((f) => f.label)
  if (labels.some((l) => STRONG_IDENTITY.test(l))) return true
  const hasSecret = labels.some((l) => SECRET.test(l))
  if (!hasSecret && labels.some((l) => HANDLE.test(l)) && labels.some((l) => ACCOUNT_FIELD.test(l))) return true
  if (!hasSecret && labels.some((l) => PLATFORM_FIELD.test(l)) && labels.some((l) => PRESENCE.test(l))) return true
  const hasPersonName = labels.some((l) => PLAIN_NAME.test(l) && !NON_PERSON_NAME.test(l))
  const hasContact = labels.some((l) => CONTACT.test(l))
  return hasPersonName && hasContact
}

/** Records that describe a person/account, most-detailed first. */
function collectProfiles(records: LeakRecord[]): LeakRecord[] {
  return records.filter(isProfileRecord).sort((a, b) => b.fields.length - a.fields.length)
}

type VictimMachine = { logId: string; source: string }

/** The unique captured machines the records reference, deduped by log id. */
function collectMachines(records: LeakRecord[]): VictimMachine[] {
  const seen = new Set<string>()
  const out: VictimMachine[] = []
  for (const r of records) {
    const field = r.fields.find((f) => /^log\s*id$/i.test(f.label.trim()))
    const logId = field?.value.trim()
    if (!logId || logId.length < 8 || seen.has(logId)) continue
    seen.add(logId)
    out.push({ logId, source: r.source })
  }
  return out
}

// ---------------------------------------------------------------------------
// The three enrichment frames, each read from whatever has arrived. Every field
// is coerced through withDefaults/list so a shape this build does not expect can
// never throw in render (this app white-windows on a render throw).
// ---------------------------------------------------------------------------

type InvCredential = {
  domain: string
  url: string
  username: string
  password: string
  email: string
  sourceType: string
}
type InvVictim = {
  user: string
  os: string
  place: string
  serviceCount: number
  services: string[]
  discordIds: string[]
  steam: string[]
  infectionPath: string
}
type InvEvidence = { service: string; name: string; username: string; confidence: string }
type InvFile = { name: string; path: string; kind: string; sizeBytes: number }
type InvSection<T> = { items: T[]; total: number; redacted: boolean }
type Investigation = {
  query: string
  credentials: InvSection<InvCredential>
  victims: InvSection<InvVictim>
  evidence: InvSection<InvEvidence>
  files: InvSection<InvFile>
  related: InvSection<InvCredential>
}

function invSection<T>(raw: unknown, map: (row: Record<string, unknown>) => T): InvSection<T> {
  const o = withDefaults(raw, {} as Record<string, unknown>)
  return {
    items: list<Record<string, unknown>>(o.items).map((row) =>
      map(withDefaults(row, {} as Record<string, unknown>)),
    ),
    total: num(o.total),
    redacted: o.redacted === true || o.upgradeRequired === true,
  }
}

function invCredential(r: Record<string, unknown>): InvCredential {
  return {
    domain: text(r.domain),
    url: text(r.url),
    username: text(r.username),
    password: text(r.password),
    email: text(r.email),
    sourceType: text(r.source_type),
  }
}

function investigationFrom(frames: StreamFrame[]): Investigation | null {
  let raw: unknown = null
  for (const f of frames) if (f.t === "investigation") raw = f.data
  if (raw == null) return null
  const o = withDefaults(raw, {} as Record<string, unknown>)
  return {
    query: text(o.query),
    credentials: invSection(o.credentials, invCredential),
    victims: invSection(o.victims, (r) => ({
      user: text(r.user),
      os: text(r.os),
      place: [text(r.city), text(r.country)].filter(Boolean).join(", "),
      serviceCount: num(r.serviceCount),
      services: list<unknown>(r.services).map(text).filter(Boolean),
      discordIds: list<unknown>(r.discord_ids).map(text).filter(Boolean),
      steam: list<unknown>(r.steam).map(text).filter(Boolean),
      infectionPath: text(r.infection_path),
    })),
    evidence: invSection(o.evidence, (r) => ({
      service: text(r.service),
      name: text(r.display_name) || text(r.username) || text(r.value),
      username: text(r.username),
      confidence: text(r.confidence),
    })),
    files: invSection(o.files, (r) => ({
      name: text(r.name),
      path: text(r.path),
      kind: text(r.kind),
      sizeBytes: num(r.size_bytes),
    })),
    related: invSection(o.relatedCredentials, invCredential),
  }
}

function investigationTotal(inv: Investigation): number {
  return (
    inv.credentials.total +
    inv.victims.total +
    inv.evidence.total +
    inv.files.total +
    inv.related.total
  )
}

type HudsonInfection = {
  id: string
  stealerFamily: string
  dateCompromised: string
  dateUploaded: string
  computerName: string
  malwarePath: string
  ip: string
  operatingSystem: string
  antiviruses: string[]
  credentialsCount: number
  clientCount: number
}

function hudsonFrom(frames: StreamFrame[]): HudsonInfection[] {
  let raw: unknown = null
  for (const f of frames) if (f.t === "hudsonrock") raw = f.infections
  return list<Record<string, unknown>>(raw).map((row) => {
    const r = withDefaults(row, {} as Record<string, unknown>)
    return {
      id: text(r.id),
      stealerFamily: text(r.stealerFamily) || "Unknown stealer",
      dateCompromised: text(r.dateCompromised),
      dateUploaded: text(r.dateUploaded),
      computerName: text(r.computerName),
      malwarePath: text(r.malwarePath),
      ip: text(r.ip),
      operatingSystem: text(r.operatingSystem),
      antiviruses: list<unknown>(r.antiviruses).map(text).filter(Boolean),
      credentialsCount: num(r.credentialsCount),
      clientCount: num(r.clientCount),
    }
  })
}

type RiskLevel = "low" | "medium" | "high" | "critical"
type DomainIntel = {
  domain: string
  riskScore: number
  riskLevel: RiskLevel
  riskFactors: { name: string; score: number; maxScore: number; detail: string }[]
  whois: { label: string; value: string }[]
  nameservers: string[]
  context: { newlyRegistered: boolean; registeredDaysAgo: number; axfr: boolean; nsProviders: string[] } | null
  subdomains: string[]
  passiveDns: { hostname: string; type: string; value: string }[]
  endpoints: string[]
}

function domainIntelFrom(frames: StreamFrame[]): DomainIntel | null {
  let raw: unknown = null
  for (const f of frames) if (f.t === "domain-intel") raw = f.data
  if (raw == null) return null
  const o = withDefaults(raw, {} as Record<string, unknown>)
  const level = o.riskLevel
  const whoisRaw = withDefaults(o.whois, {} as Record<string, unknown>)
  const ctxRaw = o.domainContext
  const ctx =
    ctxRaw && typeof ctxRaw === "object"
      ? withDefaults(ctxRaw, {} as Record<string, unknown>)
      : null
  return {
    domain: text(o.domain),
    riskScore: num(o.riskScore),
    riskLevel:
      level === "low" || level === "medium" || level === "high" || level === "critical" ? level : "low",
    riskFactors: list<Record<string, unknown>>(o.riskFactors).map((row) => {
      const r = withDefaults(row, {} as Record<string, unknown>)
      return { name: text(r.name), score: num(r.score), maxScore: num(r.maxScore), detail: text(r.detail) }
    }),
    whois: [
      { label: "Registrar", value: text(whoisRaw.registrar) },
      { label: "Created", value: text(whoisRaw.created) },
      { label: "Expires", value: text(whoisRaw.expires) },
      { label: "Status", value: text(whoisRaw.status) },
      { label: "Registrant", value: text(whoisRaw.registrant) },
    ].filter((r) => r.value),
    nameservers: list<unknown>(whoisRaw.nameservers).map(text).filter(Boolean),
    context: ctx
      ? {
          newlyRegistered: ctx.isNewlyRegistered === true,
          registeredDaysAgo: num(ctx.registeredDaysAgo),
          axfr: ctx.axfrVulnerable === true,
          nsProviders: list<Record<string, unknown>>(ctx.nsProviders)
            .map((p) => text(withDefaults(p, {} as Record<string, unknown>).label))
            .filter(Boolean),
        }
      : null,
    subdomains: list<unknown>(o.subdomains).map(text).filter(Boolean),
    passiveDns: list<Record<string, unknown>>(o.thcRecords).map((row) => {
      const r = withDefaults(row, {} as Record<string, unknown>)
      return { hostname: text(r.hostname), type: text(r.type), value: text(r.value) }
    }),
    endpoints: list<unknown>(o.endpoints).map(text).filter(Boolean),
  }
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

/**
 * The summary tiles that open the result, deriving every figure from the frames
 * so the row always states exactly what has arrived. Mirrors the web page's
 * Records / Profiles / Passwords / Machines / Sources header.
 */
function summaryTiles(
  records: LeakRecord[],
  profiles: number,
  machines: number,
  counters: { checked: number; total: number; hits: number },
): StatTile[] {
  const { checked, hits } = counters
  return [
    {
      icon: Database,
      label: "Records",
      value: records.length,
      caption: records.length === 1 ? "leaked record found" : "leaked records found",
    },
    { icon: UserSearch, label: "Profiles", value: profiles, caption: "identity profiles found" },
    { icon: KeyRound, label: "Passwords", value: secretCount(records), caption: "exposed secrets" },
    { icon: HardDrive, label: "Machines", value: machines, caption: "captured stealer logs" },
    {
      icon: Layers,
      label: "Sources",
      value: sourceCount(records),
      caption: `${hits} of ${checked} returned data`,
    },
  ]
}

/** Copy for the empty state, distinguishing a failed sweep from a clean miss. */
function emptyMessage(status: StreamStatus): string {
  if (status === "streaming") {
    return "Querying breach sources. Records appear here as each source answers."
  }
  if (status === "cancelled") return "Search cancelled before any records were found."
  if (status === "error") return "The search stopped before finishing. Retry to run it again."
  return "No records found for this search."
}

/** A small heading with a count chip and a right-aligned hint, like the web. */
function SectionHead({ title, count, hint }: { title: string; count?: number; hint?: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        {count != null ? (
          <span className="glass-tile px-1.5 py-0.5 font-mono text-[10px] text-white/70">{count}</span>
        ) : null}
      </div>
      {hint ? <span className="text-[11px] text-white/55">{hint}</span> : null}
    </div>
  )
}

/** The Credentials tab: a flat, copyable list of every login/secret pair. */
function CredentialsPanel({ credentials }: { credentials: Credential[] }) {
  const [copied, setCopied] = useState(false)
  if (credentials.length === 0) {
    return <EmptyState message="No exposed credentials in this result set." />
  }
  async function copyAll() {
    const ok = await copyText(credentials.map((c) => `${c.login}:${c.secret}`).join("\n"))
    if (!ok) return
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="glass-tile overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-3">
        <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-muted-foreground)]">
          <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
          {credentials.length} credential{credentials.length === 1 ? "" : "s"}
        </span>
        <button type="button" onClick={() => void copyAll()} className="btn-secondary btn-compact">
          {copied ? "Copied" : "Copy all"}
        </button>
      </div>
      <ul className="divide-y divide-white/[0.05]">
        {credentials.map((c, i) => (
          <li
            key={`${c.login}-${i}`}
            style={{ "--i": i } as CSSProperties}
            className="stagger-item grid grid-cols-1 gap-1 px-4 py-2.5 sm:grid-cols-[1fr_1fr_auto] sm:items-center sm:gap-4"
          >
            <span className="min-w-0 break-all text-sm text-white">{c.login}</span>
            <span className="min-w-0 break-all font-mono text-sm text-white/90">
              {c.secret}
              <span className="ml-2 align-middle text-[10px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
                {c.secretLabel}
              </span>
            </span>
            <span className="glass-tile justify-self-start px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-white/70 sm:justify-self-end">
              {c.source}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The captured machines the records reference. No file viewer on desktop yet,
 *  so each card surfaces the log id to carry into the Machine Browser. */
function MachinesList({ machines }: { machines: VictimMachine[] }) {
  return (
    <div className="space-y-3">
      {machines.map((m, i) => (
        <MachineCard key={m.logId} machine={m} index={i} />
      ))}
    </div>
  )
}

function MachineCard({ machine, index }: { machine: VictimMachine; index: number }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    const ok = await copyText(machine.logId)
    if (!ok) return
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }
  return (
    <div
      style={{ "--i": index } as CSSProperties}
      className="glass-tile stagger-item flex items-center gap-4 px-5 py-4"
    >
      <span className="glass-tile flex h-11 w-11 shrink-0 items-center justify-center">
        <HardDrive className="h-5 w-5 text-white" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-white">Captured machine available</span>
        <span className="mt-0.5 block text-xs text-white/70">
          From {machine.source}. Open it in Machine Browser with this log id.
        </span>
      </span>
      <button
        type="button"
        onClick={() => void copy()}
        title={`Copy ${machine.logId}`}
        className="btn-secondary btn-compact shrink-0 font-mono"
      >
        {copied ? "Copied" : machine.logId.slice(0, 10)}
      </button>
    </div>
  )
}

/** Hudson Rock infostealer machines tied to an email. */
function HudsonSection({ infections }: { infections: HudsonInfection[] }) {
  if (infections.length === 0) return null
  return (
    <section className="space-y-3 fade-in">
      <SectionHead
        title="Hudson Rock"
        count={infections.length}
        hint="Infostealer infections tied to this email."
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {infections.map((inf, i) => (
          <div
            key={inf.id || i}
            style={{ "--i": i } as CSSProperties}
            className="glass-tile stagger-item overflow-hidden"
          >
            <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] px-5 py-3">
              <span className="inline-flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-[0.18em] text-white">
                <HardDrive className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" aria-hidden="true" />
                Infected machine
              </span>
              <span className="shrink-0 font-mono text-[11px] text-[var(--color-muted-foreground)]">
                {i + 1} of {infections.length}
              </span>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="glass-tile inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-[var(--color-destructive)]">
                  <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                  {inf.stealerFamily}
                </span>
                {inf.dateUploaded ? (
                  <span className="font-mono text-[11px] text-[var(--color-muted-foreground)]">
                    uploaded {inf.dateUploaded}
                  </span>
                ) : null}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <HudsonField label="Date compromised" value={inf.dateCompromised || "-"} />
                <HudsonField label="Computer name" value={inf.computerName || "-"} />
                {inf.operatingSystem ? <HudsonField label="Operating system" value={inf.operatingSystem} /> : null}
                {inf.ip ? <HudsonField label="IP address" value={inf.ip} mono /> : null}
              </div>
              {inf.malwarePath ? (
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted-foreground)]">
                    Malware path
                  </div>
                  <div className="glass-tile mt-1 break-all px-3 py-2 font-mono text-sm text-white">
                    {inf.malwarePath.trim()}
                  </div>
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-[var(--color-muted-foreground)]">
                {inf.credentialsCount > 0 ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Cpu className="h-3.5 w-3.5" aria-hidden="true" />
                    {inf.credentialsCount} credential{inf.credentialsCount === 1 ? "" : "s"}
                  </span>
                ) : null}
                {inf.clientCount > 0 ? <span>{inf.clientCount} affected services</span> : null}
                {inf.antiviruses.length > 0 ? <span>AV: {inf.antiviruses.join(", ")}</span> : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function HudsonField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="glass-tile px-3 py-2.5">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted-foreground)]">
        {label}
      </div>
      <div className={`mt-1 break-words text-sm text-white ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  )
}

const RISK_TONE: Record<RiskLevel, string> = {
  low: "text-[var(--color-positive)]",
  medium: "text-[var(--color-warning)]",
  high: "text-[var(--color-warning)]",
  critical: "text-[var(--color-destructive)]",
}
const RISK_FILL: Record<RiskLevel, string> = {
  low: "bg-[var(--color-positive)]",
  medium: "bg-[var(--color-warning)]",
  high: "bg-[var(--color-warning)]",
  critical: "bg-[var(--color-destructive)]",
}

/** A thin progress track drawn from tokens, never an arbitrary background. */
function Meter({ pct, fill }: { pct: number; fill: string }) {
  return (
    <div className="glass-tile h-1.5 w-full overflow-hidden p-0">
      <div className={`h-full ${fill}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  )
}

/** Structured domain intelligence, mirroring the web DomainIntelPanels. */
function DomainIntelSection({ intel }: { intel: DomainIntel }) {
  return (
    <section className="space-y-4 fade-in">
      <SectionHead title="Domain intelligence" hint={intel.domain} />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {/* Risk gauge */}
          <div className="glass">
            <div className="glass-body space-y-4">
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]">
                <Shield className="h-3.5 w-3.5" aria-hidden="true" />
                Risk score
              </div>
              <div className="flex items-end gap-4">
                <div className="flex flex-col">
                  <span className="text-4xl font-semibold tabular-nums text-white">{intel.riskScore}</span>
                  <span className="text-xs text-white/55">out of 100</span>
                </div>
                <span
                  className={`glass-tile mb-1 rounded-full px-3 py-0.5 font-mono text-[11px] uppercase tracking-[0.2em] ${RISK_TONE[intel.riskLevel]}`}
                >
                  {intel.riskLevel}
                </span>
              </div>
              <Meter pct={intel.riskScore} fill={RISK_FILL[intel.riskLevel]} />
              {intel.riskFactors.length > 0 ? (
                <ul className="space-y-2 pt-1">
                  {intel.riskFactors.map((f) => {
                    const pct = f.maxScore > 0 ? (f.score / f.maxScore) * 100 : 0
                    const fill = pct >= 70 ? RISK_FILL.critical : pct >= 40 ? RISK_FILL.medium : RISK_FILL.low
                    return (
                      <li key={f.name} className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[12px] text-white">{f.name.replace(/_/g, " ")}</span>
                          <span className="font-mono text-[11px] text-[var(--color-muted-foreground)]">
                            {f.score}/{f.maxScore}
                          </span>
                        </div>
                        <Meter pct={pct} fill={fill} />
                        {f.detail ? <p className="text-[11px] text-white/55">{f.detail}</p> : null}
                      </li>
                    )
                  })}
                </ul>
              ) : null}
            </div>
          </div>

          {intel.subdomains.length > 0 ? (
            <DomainList title="Subdomains" count={intel.subdomains.length} items={intel.subdomains} />
          ) : null}
          {intel.passiveDns.length > 0 ? (
            <div className="glass">
              <div className="glass-body space-y-3">
                <DomainPanelHead icon={Globe} title="Passive DNS" trailing={`${intel.passiveDns.length} records`} />
                <ul className="max-h-60 space-y-1 overflow-y-auto">
                  {intel.passiveDns.map((r, i) => (
                    <li key={i} className="flex items-center gap-3 text-[12px]">
                      {r.type ? <span className="w-10 shrink-0 font-mono text-[var(--color-muted-foreground)]">{r.type}</span> : null}
                      <span className="font-mono text-white">{r.hostname}</span>
                      {r.value ? <span className="text-white/55">{r.value}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
          {intel.endpoints.length > 0 ? (
            <DomainList title="Discovered endpoints" count={intel.endpoints.length} items={intel.endpoints} mono />
          ) : null}
        </div>

        <div className="space-y-4">
          {intel.context ? (
            <div className="glass">
              <div className="glass-body space-y-2 text-[12px]">
                <DomainPanelHead icon={Shield} title="Domain context" />
                <div className="grid grid-cols-[140px_1fr] gap-2">
                  <span className="text-[var(--color-muted-foreground)]">Newly registered</span>
                  <span className={intel.context.newlyRegistered ? "text-[var(--color-warning)]" : "text-white"}>
                    {intel.context.newlyRegistered
                      ? `Yes (${intel.context.registeredDaysAgo || "?"} days ago)`
                      : "No"}
                  </span>
                </div>
                <div className="grid grid-cols-[140px_1fr] gap-2">
                  <span className="text-[var(--color-muted-foreground)]">AXFR vulnerable</span>
                  <span className={intel.context.axfr ? "text-[var(--color-destructive)]" : "text-white"}>
                    {intel.context.axfr ? "Yes" : "No"}
                  </span>
                </div>
                {intel.context.nsProviders.length > 0 ? (
                  <div className="grid grid-cols-[140px_1fr] gap-2">
                    <span className="text-[var(--color-muted-foreground)]">NS providers</span>
                    <span className="flex flex-wrap gap-1">
                      {intel.context.nsProviders.map((p, i) => (
                        <span key={i} className="glass-tile px-1.5 py-0.5 font-mono text-[11px] text-white/80">
                          {p}
                        </span>
                      ))}
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          {intel.whois.length > 0 ? (
            <div className="glass">
              <div className="glass-body space-y-2">
                <DomainPanelHead icon={Globe} title="WHOIS" />
                <dl className="space-y-2">
                  {intel.whois.map((r) => (
                    <div key={r.label} className="grid grid-cols-[100px_1fr] gap-2 text-[12px]">
                      <dt className="text-[var(--color-muted-foreground)]">{r.label}</dt>
                      <dd className="font-mono text-white">{r.value}</dd>
                    </div>
                  ))}
                  {intel.nameservers.length > 0 ? (
                    <div className="grid grid-cols-[100px_1fr] gap-2 text-[12px]">
                      <dt className="text-[var(--color-muted-foreground)]">Nameservers</dt>
                      <dd className="space-y-0.5">
                        {intel.nameservers.map((ns) => (
                          <p key={ns} className="font-mono text-white">
                            {ns}
                          </p>
                        ))}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}

function DomainPanelHead({
  icon: Icon,
  title,
  trailing,
}: {
  icon: ComponentType<{ className?: string }>
  title: string
  trailing?: string
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {title}
      </div>
      {trailing ? <span className="font-mono text-[11px] text-[var(--color-muted-foreground)]">{trailing}</span> : null}
    </div>
  )
}

function DomainList({
  title,
  count,
  items,
  mono,
}: {
  title: string
  count: number
  items: string[]
  mono?: boolean
}) {
  return (
    <div className="glass">
      <div className="glass-body space-y-3">
        <DomainPanelHead icon={Layers} title={title} trailing={String(count)} />
        <ul className="max-h-60 space-y-1 overflow-y-auto">
          {items.map((s, i) => (
            <li
              key={`${s}-${i}`}
              title={s}
              className={`truncate text-[12px] text-white/80 ${mono ? "font-mono" : "font-mono"}`}
            >
              {s}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/** OathNet's unified stealer investigation, mirroring the web FullInvestigation. */
function InvestigationSection({ inv }: { inv: Investigation }) {
  type Tab = "credentials" | "victims" | "evidence" | "files" | "related"
  const [tab, setTab] = useState<Tab>("credentials")
  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "credentials", label: "Credentials", count: inv.credentials.total },
    { id: "victims", label: "Victims", count: inv.victims.total },
    { id: "evidence", label: "Evidence", count: inv.evidence.total },
    { id: "files", label: "Files", count: inv.files.total },
    { id: "related", label: "Related", count: inv.related.total },
  ]
  const tiles: StatTile[] = [
    { icon: KeyRound, label: "Credentials", value: inv.credentials.total },
    { icon: HardDrive, label: "Victims", value: inv.victims.total },
    { icon: Fingerprint, label: "Evidence", value: inv.evidence.total },
    { icon: Link2, label: "Files", value: inv.files.total },
    { icon: Layers, label: "Related", value: inv.related.total },
  ]
  return (
    <section className="space-y-4 fade-in">
      <SectionHead title="Full investigation" hint={`unified stealer-log investigation${inv.query ? ` · ${inv.query}` : ""}`} />
      <StatTiles tiles={tiles} />
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Investigation section">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={tab === t.id ? "btn-primary btn-compact" : "btn-secondary btn-compact"}
          >
            {t.label} <span className="tabular-nums opacity-70">{t.count}</span>
          </button>
        ))}
      </div>
      {tab === "credentials" && <InvCredentialRows section={inv.credentials} what="Credentials" empty="No credentials in this result set." />}
      {tab === "victims" && <InvVictimRows section={inv.victims} />}
      {tab === "evidence" && <InvEvidenceRows section={inv.evidence} />}
      {tab === "files" && <InvFileRows section={inv.files} />}
      {tab === "related" && <InvCredentialRows section={inv.related} what="Related credentials" empty="No related credentials in this result set." />}
    </section>
  )
}

function RedactedNotice({ what }: { what: string }) {
  return (
    <EmptyState message={`${what} are redacted on your current plan. Upgrade to unlock full investigation data.`} />
  )
}

function InvCredentialRows({
  section,
  what,
  empty,
}: {
  section: InvSection<InvCredential>
  what: string
  empty: string
}) {
  if (section.redacted) return <RedactedNotice what={what} />
  if (section.items.length === 0) return <EmptyState message={empty} />
  return (
    <div className="space-y-2">
      {section.items.map((c, i) => (
        <div
          key={i}
          style={{ "--i": i } as CSSProperties}
          className="glass-tile stagger-item p-3 font-mono text-[12px]"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            {c.domain ? <span className="text-white">{c.domain}</span> : null}
            {c.username ? (
              <span className="text-[var(--color-muted-foreground)]">
                user: <span className="text-white">{c.username}</span>
              </span>
            ) : null}
            {c.email ? <span className="text-white/70">{c.email}</span> : null}
          </div>
          {c.password ? <div className="mt-1 break-all text-[var(--color-positive)]">pass: {c.password}</div> : null}
          {c.url || c.sourceType ? (
            <div className="mt-1 truncate text-white/55" title={c.url}>
              {c.sourceType ? `[${c.sourceType}] ` : ""}
              {c.url}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function InvVictimRows({ section }: { section: InvSection<InvVictim> }) {
  if (section.redacted) return <RedactedNotice what="Victim machines" />
  if (section.items.length === 0) return <EmptyState message="No victim machines in this result set." />
  return (
    <div className="space-y-2">
      {section.items.map((v, i) => (
        <div key={i} style={{ "--i": i } as CSSProperties} className="glass-tile stagger-item p-3 text-[12px]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono">
            {v.user ? <span className="text-white">{v.user}</span> : null}
            {v.os ? <span className="text-[var(--color-muted-foreground)]">{v.os}</span> : null}
            {v.place ? <span className="text-[var(--color-muted-foreground)]">{v.place}</span> : null}
            {v.serviceCount > 0 ? <span className="text-[var(--color-muted-foreground)]">{v.serviceCount} services</span> : null}
          </div>
          {v.services.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {v.services.slice(0, 20).map((s, j) => (
                <span key={j} className="glass-tile px-1.5 py-0.5 font-mono text-[10px] text-white">
                  {s}
                </span>
              ))}
            </div>
          ) : null}
          {v.discordIds.length > 0 || v.steam.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] text-[var(--color-muted-foreground)]">
              {v.discordIds.length > 0 ? <span>discord: {v.discordIds.join(", ")}</span> : null}
              {v.steam.length > 0 ? <span>steam: {v.steam.join(", ")}</span> : null}
            </div>
          ) : null}
          {v.infectionPath ? (
            <div className="mt-1 truncate font-mono text-[11px] text-white/55" title={v.infectionPath}>
              {v.infectionPath}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function InvEvidenceRows({ section }: { section: InvSection<InvEvidence> }) {
  if (section.redacted) return <RedactedNotice what="Identity evidence" />
  if (section.items.length === 0) return <EmptyState message="No identity evidence in this result set." />
  return (
    <div className="space-y-2">
      {section.items.map((e, i) => (
        <div
          key={i}
          style={{ "--i": i } as CSSProperties}
          className="glass-tile stagger-item flex flex-wrap items-center gap-x-3 gap-y-0.5 p-3 font-mono text-[12px]"
        >
          {e.service ? (
            <span className="glass-tile px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white">{e.service}</span>
          ) : null}
          {e.name ? <span className="text-white">{e.name}</span> : null}
          {e.username && e.name !== e.username ? <span className="text-[var(--color-muted-foreground)]">@{e.username}</span> : null}
          {e.confidence ? <span className="text-white/55">{e.confidence}</span> : null}
        </div>
      ))}
    </div>
  )
}

function InvFileRows({ section }: { section: InvSection<InvFile> }) {
  if (section.redacted) return <RedactedNotice what="Captured files" />
  if (section.items.length === 0) return <EmptyState message="No captured files in this result set." />
  const fmtBytes = (n: number) =>
    n <= 0 ? "" : n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`
  return (
    <div className="space-y-1.5">
      {section.items.map((f, i) => (
        <div
          key={i}
          style={{ "--i": i } as CSSProperties}
          className="glass-tile stagger-item flex items-center gap-3 px-3 py-2 font-mono text-[12px]"
        >
          {f.kind ? <span className="glass-tile px-1.5 py-0.5 text-[10px] text-white">{f.kind}</span> : null}
          <span className="min-w-0 flex-1 truncate text-white" title={f.path || f.name}>
            {f.name || f.path}
          </span>
          {f.sizeBytes > 0 ? <span className="shrink-0 text-white/55">{fmtBytes(f.sizeBytes)}</span> : null}
        </div>
      ))}
    </div>
  )
}

type Tab = "all" | "credentials" | "profiles" | "machines"

function SearchResult({ frames, status }: StreamResultProps) {
  const [tab, setTab] = useState<Tab>("all")

  const records = mergedRecords(frames)
  const counters = progress(frames)
  const streaming = status === "streaming"

  const credentials = collectCredentials(records)
  const profiles = collectProfiles(records)
  const machines = collectMachines(records)

  const investigation = investigationFrom(frames)
  const hudson = hudsonFrom(frames)
  const domain = domainIntelFrom(frames)

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "all", label: "All results", count: records.length },
    { id: "credentials", label: "Credentials", count: credentials.length },
    { id: "profiles", label: "Profiles", count: profiles.length },
    { id: "machines", label: "Machines", count: machines.length },
  ]

  return (
    <div className="space-y-6 fade-in">
      <StatTiles tiles={summaryTiles(records, profiles.length, machines.length, counters)} />

      {streaming ? (
        <div className="glass-tile flex items-center gap-3 px-4 py-2.5 text-[12px] text-white/70">
          <span
            className="live-dot h-2 w-2 shrink-0 rounded-full bg-[var(--color-positive)]"
            aria-hidden="true"
          />
          <span>
            Searching sources. {records.length} {records.length === 1 ? "record" : "records"} so far across{" "}
            {sourceCount(records)} {sourceCount(records) === 1 ? "source" : "sources"}.
          </span>
        </div>
      ) : null}

      {/* Domain intelligence leads the domain result, as it does on the web. */}
      {domain ? <DomainIntelSection intel={domain} /> : null}

      {records.length === 0 ? (
        <EmptyState message={emptyMessage(status)} />
      ) : (
        <div className="space-y-5">
          {/* Filter tabs, the web's All / Credentials / Profiles / Machines. */}
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Result filter">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={tab === t.id ? "btn-primary btn-compact" : "btn-secondary btn-compact"}
              >
                {t.label} <span className="tabular-nums opacity-70">{t.count}</span>
              </button>
            ))}
          </div>

          {(tab === "all" || tab === "machines") && machines.length > 0 ? (
            <section className="space-y-3">
              <SectionHead
                title="Captured machines"
                count={machines.length}
                hint="Stealer logs referenced by this result."
              />
              <MachinesList machines={machines} />
            </section>
          ) : null}

          {tab === "credentials" ? (
            <section className="space-y-3">
              <SectionHead
                title="Exposed credentials"
                count={credentials.length}
                hint="Every leaked login and secret found across all sources."
              />
              <CredentialsPanel credentials={credentials} />
            </section>
          ) : null}

          {tab === "profiles" ? (
            <section className="space-y-3">
              <SectionHead
                title="Identity profiles"
                count={profiles.length}
                hint="Records carrying a name, phone, address or other identity."
              />
              {profiles.length === 0 ? (
                <EmptyState message="No identity profiles in this result set." />
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {profiles.map((r, i) => (
                    <div key={`${r.source}-${i}`} style={{ "--i": i } as CSSProperties} className="stagger-item">
                      <RecordCard record={r} />
                    </div>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {tab === "all" ? (
            <section className="space-y-3">
              <SectionHead
                title="Breach and leak records"
                count={records.length}
                hint="Every record matched across all sources."
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {records.map((record, i) => (
                  <div key={`${record.source}-${i}`} style={{ "--i": i } as CSSProperties} className="stagger-item">
                    <RecordCard record={record} />
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {tab === "machines" && machines.length === 0 ? (
            <EmptyState message="No captured machines for this search." />
          ) : null}
        </div>
      )}

      {/* Hudson Rock infostealer machines (email + Heist). */}
      {hudson.length > 0 ? <HudsonSection infections={hudson} /> : null}

      {/* The unified stealer investigation closes the result, as on the web. */}
      {investigation && investigationTotal(investigation) > 0 ? (
        <InvestigationSection inv={investigation} />
      ) : null}

      {status === "cancelled" && records.length > 0 ? (
        <p className="text-[12px] text-white/60">
          Cancelled. Showing the sources that answered before you stopped.
        </p>
      ) : null}
    </div>
  )
}

export const searchDescriptor: StreamModuleDescriptor = {
  id: "search",
  route: "/search",
  label: "Search",
  modes: [
    { id: "email", label: "Email" },
    { id: "username", label: "Username" },
    { id: "domain", label: "Domain" },
  ],
  inputs: [
    {
      name: "query",
      label: "Query",
      placeholder: "Email, username, or domain",
      // Non-empty only here; the mode-specific check lives in resolve, since a
      // field validator cannot see which mode is selected.
      validate: (v) => (v.trim() ? null : "Enter something to search for."),
    },
  ],
  resolve: (values, mode) => {
    const query = (values.query ?? "").trim()
    if (!query) return { error: "Enter something to search for." }

    if (mode === "username") {
      if (!USERNAME_RE.test(query)) {
        return { error: "Enter a valid username (2 to 32 letters, digits, . _ or -)." }
      }
      return { module: "search-username", input: { query } }
    }
    if (mode === "domain") {
      if (!DOMAIN_RE.test(query)) return { error: "Enter a valid domain like example.com." }
      return { module: "search-domain", input: { query } }
    }
    // Email is the default mode.
    if (!EMAIL_RE.test(query)) return { error: "Enter a valid email address." }
    return { module: "search-email", input: { query } }
  },
  Result: SearchResult,
}
