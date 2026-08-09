import { useState } from "react"
import { Database, MapPinHouse, Radar, ShieldAlert, Smartphone, Users } from "lucide-react"

import { copyText } from "../lib/clipboard"
import { ipc } from "../lib/ipc"
import { getMapboxToken } from "../lib/mapbox"
import { RemoteImage } from "./RemoteImage"
import { MapView } from "./ui/MapView"
import { list, withDefaults } from "./safe"
import type { ModuleDescriptor, ResultProps } from "./types"
import {
  BadgeRow,
  EmptyState,
  FieldGrid,
  ProfileCard,
  Section,
  StatTiles,
  type Field,
  type StatTile,
} from "./ui"

/**
 * The whole Tools group: Samsung Lookup, Skiptracer, Address Insights, Falcon,
 * IntelX and Cobra.
 *
 * Six screens in one file for the same reason the server keeps them in one file
 * (lib/desktop/modules/tools.ts): they are one upstream each, they share a
 * provider family, a plan gate and a throttle, and every one of them carries the
 * same `answered` marker. Six near-identical files would be six copies of the
 * same "did the provider actually speak" branch drifting apart.
 *
 * WHAT EVERY ONE OF THE SIX CARRIES: `answered`.
 *
 * The server's normalisers are total, so a provider that DIED produces a fully
 * populated negative: `found: false`, `exists: false`, empty record lists, zero
 * counts. That is byte-for-byte the payload of a provider that searched and came
 * up empty. Rendering it as "no records found" is a confident, false statement
 * about a real person, made from a request nobody answered. So every screen here
 * opens on `answered` and says the provider could not be reached instead. It is
 * defaulted to FALSE when the field is absent: an unknown marker has to fail
 * towards saying nothing rather than towards asserting a negative.
 *
 * The other markers that are branched on rather than ignored:
 *   - Falcon `truncated`  : entries were cut, so the list shown is not the list.
 *   - Falcon `incomplete` : the sweep hit its own deadline, so this is partial.
 *   - IntelX `truncated`  : the file was cut at the download limit.
 *   - Cobra `risk.max`    : the denominator, which may be absent.
 *   - Cobra `linkedAccounts[].status === "unknown"`: the provider DECLINED to say
 *     whether the account exists. It must never read as a confirmed account.
 *   - Skiptracer `deceased`: `boolean | null`, where null means the provider said
 *     nothing at all. Null must never render as "alive".
 *
 * All six are Heist-only server-side (`minPlan: "plus"`, which is the Heist plan),
 * so a lower plan is refused before any of this renders and ModuleScreen shows
 * the upgrade panel. Nothing here needs a LockedSection.
 *
 * Nothing here styles a container of its own. Everything is `ui/`.
 */

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/**
 * The provider never spoke.
 *
 * Deliberately not an EmptyState sentence about the subject of the search: the
 * only true statement available is about our side of the call.
 */
function Unreachable({ what }: { what: string }) {
  return (
    <div className="space-y-4">
      <EmptyState
        message={`${what} could not be reached, so this search has no answer. Nothing here says anything about the query itself. Try again in a moment.`}
      />
    </div>
  )
}

/** A link the user can open in their real browser, or plain text when the
 *  server could not sanitise the provider's string into an http(s) URL. */
function LinkOrText({ label, url }: { label: string; url: string | null }) {
  if (!url) return <span className="truncate text-white/85">{label}</span>
  return (
    <button
      type="button"
      onClick={() => void ipc.openExternal(url).catch(() => {})}
      className="truncate text-left text-white/85 underline decoration-white/20 underline-offset-2 hover:decoration-white/60"
    >
      {label}
    </button>
  )
}

/** A note under a result: quieter than an EmptyState, because the rows above it
 *  are real and only their completeness is in question. */
function Caveat({ children }: { children: string }) {
  return <p className="text-[12px] text-[var(--color-muted-foreground)]">{children}</p>
}

function text(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function nullableCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/** Yes / No / "Not reported", never a bare blank that reads as "no". */
function yesNo(value: boolean | null | undefined): string {
  return value === true ? "Yes" : value === false ? "No" : ""
}

function bool3(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null
}

/**
 * A provider's own key as a human label: "first_name" becomes "First Name".
 *
 * The same transform the web's Samsung record table applies. Samsung's records
 * are whatever fields the upstream happened to send, so the label IS the raw key
 * unless something turns it into words, and a column of "birth_date" reads as a
 * database dump rather than a record about a person.
 */
export function prettyLabel(key: string): string {
  const words = key.replace(/[_-]+/g, " ").replace(/([a-z\d])([A-Z])/g, "$1 $2").trim()
  return words.replace(/\b\p{L}/gu, (c) => c.toUpperCase()) || key
}

/**
 * A ten digit North American number as "(415) 555-0123", the way the web's
 * Address Insights panel prints one.
 *
 * Anything that is not exactly that shape is returned UNCHANGED. An
 * international number reformatted by a North American rule is a wrong number,
 * and a phone number in an OSINT result is something a person will dial.
 */
export function fmtPhone(raw: string): string {
  const match = raw.replace(/\D/g, "").match(/^1?(\d{3})(\d{3})(\d{4})$/)
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : raw
}

/** The plurals a bare "+s" gets wrong in this file's copy. */
const IRREGULAR_PLURALS: Record<string, string> = { person: "people" }

/** A count with its noun, pluralised. "1 address", "2 addresses", "3 people". */
export function plural(n: number, noun: string): string {
  if (n === 1) return `1 ${noun}`
  const many = IRREGULAR_PLURALS[noun] ?? (/(?:s|x|z|ch|sh)$/.test(noun) ? `${noun}es` : `${noun}s`)
  return `${n.toLocaleString()} ${many}`
}

/**
 * Values as pills, the way the web renders Falcon's group entries and Cobra's
 * exposed-data tags.
 *
 * `tone` is the one visual distinction: an exposed data class ("passwords") is
 * a finding about the user's own risk rather than an ordinary value. It is
 * warning-toned rather than destructive-toned because the destructive colour in
 * this palette is a dark red that is genuinely hard to read on near-black, and
 * an unreadable warning is not a warning.
 */
function Chips({
  items,
  tone,
}: {
  items: { label: string; note?: string }[]
  tone?: "warning"
}) {
  if (items.length === 0) return null
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((item, i) => (
        <li
          key={`${item.label}-${i}`}
          title={item.label}
          className={`glass-tile inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] ${
            tone === "warning" ? "text-[var(--color-warning)]" : "text-white/85"
          }`}
        >
          <span className="min-w-0 truncate">{item.label}</span>
          {item.note ? (
            <span className="shrink-0 text-[10px] text-[var(--color-muted-foreground)]">
              {item.note}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

/**
 * A list that opens at `step` rows and grows on request.
 *
 * Every one of these screens can be handed hundreds of rows, and the web pages
 * page them rather than dropping them. The desktop screens used to `slice()` a
 * hard cap and say nothing, which silently hid real findings. Nothing is hidden
 * without a control that says how much.
 */
function useLimit(step: number, total: number) {
  const [limit, setLimit] = useState(step)
  const shown = Math.min(limit, total)
  return {
    shown,
    remaining: total - shown,
    more: () => setLimit((n) => n + step),
  }
}

/** The "show the rest" control for a `useLimit` list. */
function MoreButton({
  remaining,
  noun,
  onMore,
}: {
  remaining: number
  noun: string
  onMore: () => void
}) {
  if (remaining <= 0) return null
  return (
    <button type="button" onClick={onMore} className="btn-secondary btn-compact mt-3">
      {`Show ${plural(remaining, noun)}`}
    </button>
  )
}

/** Copies a value to the clipboard and says so briefly. */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="btn-secondary btn-compact"
      onClick={() => {
        void copyText(value).then((ok) => {
          if (!ok) return
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        })
      }}
    >
      {copied ? "Copied" : label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Shared validation, mirroring the server's own rules in tools.ts
// ---------------------------------------------------------------------------

/** RFC 5321's maximum path length, and the length cap that has to be applied
 *  BEFORE the email regex so its `+` classes cannot be walked. */
const EMAIL_MAX = 254
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** The server's own IP shape check: hex digits, colons and dots, so one pattern
 *  covers v4 and v6 without a backtracking alternation. */
const IP_RE = /^[0-9a-fA-F:.]{3,45}$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const YEAR = /^\d{1,4}$/
const COUNTRY_RE = /^[A-Za-z]{2}$/
const SAMSUNG_MIN_YEAR = 1950
const SAMSUNG_NAME_MAX = 100
const TEXT_MAX = 200

function emailOk(v: string): boolean {
  return v.length <= EMAIL_MAX && EMAIL_RE.test(v.toLowerCase())
}

/** The server's phone normalisation: keep digits and a leading +, then require
 *  at least seven actual digits. */
function phoneOk(v: string): boolean {
  return v.length <= 40 && v.replace(/[^\d+]/g, "").replace(/\D/g, "").length >= 7
}

/** Read per call, never at module load: a process that stays up across New Year
 *  would otherwise refuse the current year for the rest of its life. */
function currentYear(): number {
  return new Date().getUTCFullYear()
}

// ---------------------------------------------------------------------------
// Samsung Lookup
// ---------------------------------------------------------------------------

/** One provider record, already flattened into scalar rows by the server. */
type SamsungRecord = { fields: { label: string; value: string }[] }

type SamsungData = {
  mode: string
  firstName: string
  lastName: string
  countryCode: string
  birthDate: string
  startYear: number | null
  endYear: number | null
  found: boolean
  status: string
  records: SamsungRecord[]
  recordCount: number
  /** False when the provider never answered, or answered `status: "error"`,
   *  which the upstream parser launders into a clean `found: false`. */
  answered: boolean
}

export function SamsungResult({ data }: ResultProps) {
  const raw = withDefaults(data, {} as Partial<SamsungData>)
  const d: SamsungData = {
    mode: text(raw.mode) || "direct",
    firstName: text(raw.firstName),
    lastName: text(raw.lastName),
    countryCode: text(raw.countryCode),
    birthDate: text(raw.birthDate),
    startYear: nullableCount(raw.startYear),
    endYear: nullableCount(raw.endYear),
    found: raw.found === true,
    status: text(raw.status),
    records: list<SamsungRecord>(raw.records),
    recordCount: count(raw.recordCount),
    answered: raw.answered === true,
  }

  if (!d.answered) return <Unreachable what="The Samsung lookup" />

  const name = [d.firstName, d.lastName].filter(Boolean).join(" ")
  const enumerate = d.mode === "enumerate"

  return (
    <div className="space-y-4">
      <ProfileCard
        name={name || "Samsung lookup"}
        subtitle={d.countryCode ? d.countryCode.toUpperCase() : null}
        meta={[
          { label: "Mode", value: enumerate ? "Birth date sweep" : "Direct" },
          { label: "Birth date", value: d.birthDate, mono: true },
          {
            label: "Years scanned",
            value:
              enumerate && d.startYear !== null && d.endYear !== null
                ? `${d.startYear} to ${d.endYear}`
                : "",
          },
          { label: "Provider status", value: d.status, mono: true },
        ]}
      />

      {d.records.length === 0 ? (
        <Section title="Records">
          {/* Safe to state plainly: `answered` is true, so the provider really
              did search and really did come back with nothing. */}
          <EmptyState
            message={
              d.found
                ? "The provider reported a match but sent no readable record fields."
                : "No matching Samsung account record was found."
            }
          />
        </Section>
      ) : (
        <SamsungRecords records={d.records} total={d.recordCount || d.records.length} />
      )}
    </div>
  )
}

/** How many records open before the "show more" control appears. */
const SAMSUNG_PAGE = 10

/**
 * The records, paged.
 *
 * The labels are the provider's own keys, humanised on the way out exactly as
 * the web's record table humanises them: the server carries the key verbatim,
 * because the key is data, and turning it into words is presentation.
 */
function SamsungRecords({ records, total }: { records: SamsungRecord[]; total: number }) {
  const page = useLimit(SAMSUNG_PAGE, records.length)
  return (
    <>
      {records.slice(0, page.shown).map((record, i) => (
        <Section key={i} title={`Record ${i + 1} of ${total}`}>
          <FieldGrid
            fields={list<{ label: string; value: string }>(record?.fields).map((f) => ({
              label: prettyLabel(text(f?.label)),
              value: text(f?.value),
            }))}
          />
        </Section>
      ))}
      <MoreButton remaining={page.remaining} noun="record" onMore={page.more} />
    </>
  )
}

export const samsungDescriptor: ModuleDescriptor = {
  id: "samsung",
  route: "/tools/samsung",
  label: "Samsung Lookup",
  icon: Smartphone,
  description: "Reverse-lookup a person by name and country, direct or date-of-birth enumeration.",
  // Mirrors the server's `validate()`. A per-field validator cannot see the
  // other fields, so the cross-field rules (a sweep needs start <= end) stay
  // with the server, which is the authority in any case.
  inputs: [
    {
      name: "mode",
      label: "Mode",
      placeholder: "direct",
      // A toggle, like the web, rather than a box you type the word into, and
      // kept FIRST so it sits at the top of the form exactly as the web does.
      // Direct is the server's own default; enumerate sweeps birth dates.
      options: [
        { value: "direct", label: "Direct Lookup" },
        { value: "enumerate", label: "Enumerate DOB" },
      ],
      defaultValue: "direct",
      optional: true,
      validate: (v) => {
        const s = v.trim()
        if (s.length === 0) return null
        return s === "direct" || s === "enumerate" ? null : 'Enter "direct" or "enumerate".'
      },
    },
    {
      name: "first_name",
      label: "First name",
      placeholder: "e.g. John",
      validate: (v) =>
        v.trim().length > 0 && v.trim().length <= SAMSUNG_NAME_MAX
          ? null
          : "Enter a first name (100 characters max).",
    },
    {
      name: "last_name",
      label: "Last name",
      placeholder: "e.g. Smith",
      validate: (v) =>
        v.trim().length > 0 && v.trim().length <= SAMSUNG_NAME_MAX
          ? null
          : "Enter a last name (100 characters max).",
    },
    {
      name: "country_code",
      label: "Country code",
      placeholder: "e.g. us",
      validate: (v) =>
        COUNTRY_RE.test(v.trim()) ? null : "Enter a two letter country code, for example us.",
    },
    {
      name: "birth_date",
      label: "Birth date (direct mode, optional)",
      placeholder: "YYYY-MM-DD",
      optional: true,
      validate: (v) => {
        const s = v.trim()
        if (s.length === 0) return null
        return ISO_DATE.test(s) ? null : "Birth date must be YYYY-MM-DD."
      },
    },
    {
      name: "start_year",
      label: "Sweep start year (enumerate mode, optional)",
      placeholder: String(SAMSUNG_MIN_YEAR),
      optional: true,
      validate: (v) => {
        const s = v.trim()
        if (s.length === 0) return null
        const max = currentYear()
        if (!YEAR.test(s) || Number(s) < SAMSUNG_MIN_YEAR || Number(s) > max) {
          return `Enter a year between ${SAMSUNG_MIN_YEAR} and ${max}.`
        }
        return null
      },
    },
    {
      name: "end_year",
      label: "Sweep end year (enumerate mode, optional)",
      placeholder: "leave blank for this year",
      optional: true,
      validate: (v) => {
        const s = v.trim()
        if (s.length === 0) return null
        const max = currentYear()
        if (!YEAR.test(s) || Number(s) < SAMSUNG_MIN_YEAR || Number(s) > max) {
          return `Enter a year between ${SAMSUNG_MIN_YEAR} and ${max}.`
        }
        return null
      },
    },
  ],
  Result: SamsungResult,
}

// ---------------------------------------------------------------------------
// Skiptracer
// ---------------------------------------------------------------------------

type SkiptracerPerson = {
  name: string
  age: string | null
  gender: string | null
  ownershipRole: string | null
  occupation: string | null
  /** Null means the provider said NOTHING about mortality. It is not "alive". */
  deceased: boolean | null
}

type SkiptracerRecord = {
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  county: string | null
  propertyType: string | null
  owner: {
    name: string | null
    address: string | null
    city: string | null
    state: string | null
    zip: string | null
  }
  persons: SkiptracerPerson[]
}

type SkiptracerData = {
  records: SkiptracerRecord[]
  count: number
  /** False when NONE of the up-to-four field queries came back. */
  answered: boolean
}

const EMPTY_OWNER: SkiptracerRecord["owner"] = {
  name: null,
  address: null,
  city: null,
  state: null,
  zip: null,
}

/**
 * Mortality, in three states.
 *
 * The server carries `boolean | null` precisely so "we were not told" survives
 * the trip. Rendering null as "living" would assert something nobody checked,
 * and rendering it as "deceased" is worse still, so it is neither.
 */
function mortality(deceased: boolean | null): string {
  if (deceased === true) return "Reported deceased"
  if (deceased === false) return "Reported living"
  return ""
}

function placeLine(record: SkiptracerRecord): string {
  return [record.address, record.city, record.state, record.zip].filter(Boolean).join(", ")
}

export function SkiptracerResult({ data }: ResultProps) {
  const raw = withDefaults(data, {} as Partial<SkiptracerData>)
  const d: SkiptracerData = {
    records: list<SkiptracerRecord>(raw.records),
    count: count(raw.count),
    answered: raw.answered === true,
  }

  if (!d.answered) return <Unreachable what="Skiptracer" />

  if (d.records.length === 0) {
    return (
      <div className="space-y-4">
        <EmptyState message="Skiptracer searched and returned no records for those details." />
      </div>
    )
  }

  const records = d.records.map((rec) =>
    withDefaults(rec, {
      address: null,
      city: null,
      state: null,
      zip: null,
      county: null,
      propertyType: null,
      owner: EMPTY_OWNER,
      persons: [],
    } as SkiptracerRecord),
  )
  const people = records.reduce((n, r) => n + list<SkiptracerPerson>(r.persons).length, 0)
  const owned = records.filter((r) => withDefaults(r.owner, EMPTY_OWNER).name).length

  return (
    <div className="space-y-4">
      {/* The web opens its record list with a plain count. These are the same
          numbers, derived from the rows below rather than from any field the
          provider sent, so they cannot disagree with what is on screen. */}
      <StatTiles
        tiles={[
          { label: "Records", value: (d.count || records.length).toLocaleString() },
          { label: "People", value: people.toLocaleString() },
          { label: "With an owner", value: owned.toLocaleString() },
        ]}
      />
      <SkiptracerRecords records={records} total={d.count || records.length} />
    </div>
  )
}

/** How many records open before the "show more" control appears. */
const SKIPTRACER_PAGE = 10

function SkiptracerRecords({
  records,
  total,
}: {
  records: SkiptracerRecord[]
  total: number
}) {
  const page = useLimit(SKIPTRACER_PAGE, records.length)
  return (
    <>
      {records.slice(0, page.shown).map((record, i) => {
        const owner = withDefaults(record.owner, EMPTY_OWNER)
        const persons = list<SkiptracerPerson>(record.persons)

        return (
          <Section
            key={i}
            title={`Record ${i + 1} of ${total}`}
            // The web puts the property type in a pill beside the address. It is
            // the one field that classifies the whole record, so it reads better
            // as a label on the section than as another row in the grid.
            action={
              record.propertyType ? (
                <span className="glass-tile shrink-0 rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-white/80">
                  {record.propertyType}
                </span>
              ) : undefined
            }
          >
            <FieldGrid
              fields={[
                { label: "Address", value: placeLine(record) },
                { label: "County", value: record.county },
                { label: "Property type", value: record.propertyType },
                { label: "Owner", value: owner.name },
                {
                  label: "Owner address",
                  value: [owner.address, owner.city, owner.state, owner.zip]
                    .filter(Boolean)
                    .join(", "),
                },
              ]}
            />

            {persons.length > 0 ? (
              <ul className="mt-4 space-y-2">
                {persons.map((p, j) => {
                  const person = withDefaults(p, {
                    name: "",
                    age: null,
                    gender: null,
                    ownershipRole: null,
                    occupation: null,
                    deceased: null,
                  } as SkiptracerPerson)
                  return (
                    <li key={j} className="glass-tile px-4 py-3">
                      <p className="text-[14px] font-medium text-white">
                        {person.name || "Unnamed person"}
                      </p>
                      <div className="mt-2">
                        <FieldGrid
                          fields={[
                            { label: "Age", value: person.age },
                            { label: "Gender", value: person.gender },
                            { label: "Role", value: person.ownershipRole },
                            { label: "Occupation", value: person.occupation },
                            // Three states, and the third is silence. A blank
                            // here renders as "Not reported", never as "living".
                            { label: "Mortality", value: mortality(bool3(person.deceased)) },
                          ]}
                        />
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="mt-4 text-[12px] text-[var(--color-muted-foreground)]">
                No people are attached to this record.
              </p>
            )}
          </Section>
        )
      })}
      <MoreButton remaining={page.remaining} noun="record" onMore={page.more} />
    </>
  )
}

export const skiptracerDescriptor: ModuleDescriptor = {
  id: "skiptracer",
  route: "/tools/skiptracer",
  label: "Skiptracer",
  icon: Users,
  description: "People and property records. Fill any fields to search by name, email, phone, or address.",
  /**
   * Every field is optional on its own, exactly as the server has it: the search
   * runs on whichever of the four query kinds were filled in.
   *
   * The server's two cross-field rules (at least one of phone, email, name or
   * street, and street and city/ZIP together or not at all) cannot be expressed
   * here: `InputField.validate` is handed its own value and nothing else. They
   * stay server-side, where they were already enforced.
   */
  inputs: [
    {
      name: "phone",
      label: "Phone (optional)",
      placeholder: "e.g. +14155550123",
      optional: true,
      validate: (v) => {
        const s = v.trim()
        if (s.length === 0) return null
        return phoneOk(s) ? null : "Enter a valid phone number."
      },
    },
    {
      name: "email",
      label: "Email (optional)",
      placeholder: "e.g. name@example.com",
      optional: true,
      validate: (v) => {
        const s = v.trim()
        if (s.length === 0) return null
        return emailOk(s) ? null : "Enter a valid email address."
      },
    },
    {
      name: "name",
      label: "Name (optional)",
      placeholder: "e.g. John Smith",
      optional: true,
      validate: (v) => {
        const s = v.trim()
        if (s.length === 0) return null
        return s.length >= 2 && s.length <= TEXT_MAX
          ? null
          : "Enter a name of 2 to 200 characters."
      },
    },
    {
      name: "street",
      label: "Street (optional, needs a city or ZIP)",
      placeholder: "e.g. 1600 Pennsylvania Ave",
      optional: true,
      validate: (v) => {
        const s = v.trim()
        if (s.length === 0) return null
        return s.length <= TEXT_MAX ? null : "Street is too long (200 characters max)."
      },
    },
    {
      name: "where",
      label: "City or ZIP (optional, needs a street)",
      placeholder: "e.g. Washington, DC",
      optional: true,
      validate: (v) => {
        const s = v.trim()
        if (s.length === 0) return null
        return s.length <= TEXT_MAX ? null : "City or ZIP is too long (200 characters max)."
      },
    },
  ],
  Result: SkiptracerResult,
}

// ---------------------------------------------------------------------------
// Address Insights
// ---------------------------------------------------------------------------

type LatLong = { latitude: number; longitude: number; accuracy: string | null }

type AddressPerson = {
  name: string | null
  firstName: string | null
  middleName: string | null
  lastName: string | null
  type: string | null
  ageRange: string | null
  industry: string | null
  linkedSince: string | null
  alternateNames: string[]
  phones: { phoneNumber: string; lineType: string | null }[]
  associatedPeople: { name: string; relation: string | null; since: string | null }[]
  historicalAddresses: {
    streetLine1: string | null
    streetLine2: string | null
    city: string | null
    stateCode: string | null
    postalCode: string | null
    locationType: string | null
    latLong: LatLong | null
    since: string | null
    until: string | null
  }[]
}

type AddressData = {
  answered: boolean
  found: boolean
  streetLine1: string | null
  streetLine2: string | null
  city: string | null
  stateCode: string | null
  postalCode: string | null
  zip4: string | null
  countryCode: string | null
  deliveryPoint: string | null
  isCommercial: boolean | null
  isForwarder: boolean | null
  isValid: boolean | null
  /** Text, not a number: the upstream sends it as a string on some records. */
  totalValue: string | null
  lastSaleDate: string | null
  latLong: LatLong | null
  /**
   * A static Mapbox render of `latLong`, already rewritten onto our own image
   * proxy by the server, or null when there are no coordinates or no map token.
   *
   * This is the desktop's answer to the web's interactive Mapbox GL canvas. The
   * webview's CSP is `img-src 'self' data:` with remote script blocked, so there
   * is no SDK to load and no canvas to pan; a picture of the same place, fetched
   * through the same proxy as every other image in the app, is what is actually
   * reachable here.
   */
  mapImageUrl: string | null
  /**
   * Where the map's centre came from. "provider" means the record carried
   * coordinates; "geocoded" means they were derived from the address that was
   * searched for, which answers "where is that address" rather than "where does
   * the record place the subject". The caption says which, because quietly
   * presenting one as the other is the kind of thing an investigation acts on.
   */
  mapSource: "provider" | "geocoded" | null
  /** The point actually drawn. Not always latLong, see mapSource. */
  mapCenter: { latitude: number; longitude: number } | null
  currentResidents: AddressPerson[]
  owners: AddressPerson[]
}

const EMPTY_PERSON: AddressPerson = {
  name: null,
  firstName: null,
  middleName: null,
  lastName: null,
  type: null,
  ageRange: null,
  industry: null,
  linkedSince: null,
  alternateNames: [],
  phones: [],
  associatedPeople: [],
  historicalAddresses: [],
}

function coords(ll: LatLong | null): string {
  if (!ll || !Number.isFinite(ll.latitude) || !Number.isFinite(ll.longitude)) return ""
  const at = `${ll.latitude}, ${ll.longitude}`
  return ll.accuracy ? `${at} (${ll.accuracy})` : at
}

/** The six-decimal pair the web's address panel prints under the summary. */
function preciseCoords(ll: LatLong | null): string {
  if (!ll || !Number.isFinite(ll.latitude) || !Number.isFinite(ll.longitude)) return ""
  return `${ll.latitude.toFixed(6)}, ${ll.longitude.toFixed(6)}`
}

/**
 * The map, as a still.
 *
 * The web's version of this screen is a full-bleed interactive canvas that can
 * be panned, zoomed and clicked to analyse another address. None of that
 * survives the desktop CSP, so the two things worth keeping are kept: the
 * picture, and a way to get to a real map. The button hands the coordinates to
 * the user's own browser rather than pretending the still is interactive.
 */
function AddressMapSection({
  url,
  place,
  ll,
  center,
  source,
}: {
  url: string | null
  place: string
  /** The provider's coordinates, or null when it sent none. */
  ll: LatLong | null
  center: { latitude: number; longitude: number } | null
  source: "provider" | "geocoded" | null
}) {
  // The provider's own coordinates when it sent them, else the point the map is
  // actually centred on. Without this the external link opened 0,0 for every
  // geocoded result, which looks like a working button and is not one.
  const at = preciseCoords(ll)
  const target = ll ?? center
  // When the server has shipped a public Mapbox token and we have a point, draw
  // the real interactive canvas the web shows; otherwise fall back to the static
  // still (or, with no point at all, say so).
  const mapToken = getMapboxToken()
  return (
    <Section
      title="Map"
      action={
        !target ? null : (
        <button
          type="button"
          className="btn-secondary btn-compact"
          onClick={() => {
            void ipc
              .openExternal(
                `https://www.google.com/maps/search/?api=1&query=${target?.latitude},${target?.longitude}`,
              )
              .catch(() => {})
          }}
        >
          Open in a map
        </button>
        )
      }
    >
      {mapToken && target ? (
        <MapView
          token={mapToken}
          latitude={target.latitude}
          longitude={target.longitude}
          className="aspect-video w-full overflow-hidden rounded-xl"
        />
      ) : url ? (
        <RemoteImage
          url={url}
          alt={place ? `Map of ${place}` : "Map of the searched address"}
          name="Map"
          className="aspect-video w-full rounded-xl text-sm"
        />
      ) : (
        // No coordinates from the provider, or no map key on the server. Neither
        // is a fact about the address, so it is stated as what it is.
        <EmptyState message="No map is available for this address." />
      )}
      {at ? (
        <p className="mt-3 font-mono text-[11px] text-white/70">
          {ll?.accuracy ? `${at}  ${ll.accuracy}` : at}
        </p>
      ) : null}
      {source === "geocoded" ? (
        <p className="mt-2 text-[12px] text-[var(--color-muted-foreground)]">
          Approximate location of the address you searched for. The records below did not include
          their own coordinates.
        </p>
      ) : null}
    </Section>
  )
}

type HistoricalAddress = AddressPerson["historicalAddresses"][number]

const EMPTY_HISTORICAL: HistoricalAddress = {
  streetLine1: null,
  streetLine2: null,
  city: null,
  stateCode: null,
  postalCode: null,
  locationType: null,
  latLong: null,
  since: null,
  until: null,
}

/** Everything a person's block needs to count, read once. */
function personParts(person: AddressPerson) {
  const p = withDefaults(person, EMPTY_PERSON)
  return {
    p,
    name: p.name || [p.firstName, p.middleName, p.lastName].filter(Boolean).join(" "),
    alternateNames: list<string>(p.alternateNames),
    phones: list<{ phoneNumber: string; lineType: string | null }>(p.phones),
    associated: list<{ name: string; relation: string | null; since: string | null }>(
      p.associatedPeople,
    ),
    historical: list<HistoricalAddress>(p.historicalAddresses).filter(
      (h) => withDefaults(h, EMPTY_HISTORICAL).streetLine1,
    ),
  }
}

/** How many address-history rows open before the "show more" control appears. */
const HISTORY_PAGE = 6

/** One past address, drawn as the web's address-history card draws it: the
 *  street on its own line, the city line beneath, and the span it was linked
 *  for last. */
function HistoryRows({ historical }: { historical: HistoricalAddress[] }) {
  const page = useLimit(HISTORY_PAGE, historical.length)
  return (
    <div className="mt-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted-foreground)]">
        {`Address history (${historical.length})`}
      </p>
      <ul className="mt-2 space-y-2">
        {historical.slice(0, page.shown).map((row, i) => {
          const h = withDefaults(row, EMPTY_HISTORICAL)
          const line2 = [h.city, [h.stateCode, h.postalCode].filter(Boolean).join(" ")]
            .filter(Boolean)
            .join(", ")
          // "to", never an arrow: the web uses one and it is not a character
          // this app's copy uses anywhere else.
          const span = [h.since, h.until].filter(Boolean).join(" to ")
          return (
            <li key={i} className="glass-tile px-3 py-2.5">
              <p className="text-[13px] text-white">
                {[h.streetLine1, h.streetLine2].filter(Boolean).join(" ") || "Address withheld"}
              </p>
              {line2 ? <p className="text-[12px] text-white/70">{line2}</p> : null}
              <p className="mt-1 font-mono text-[10px] text-[var(--color-muted-foreground)]">
                {[span, h.locationType].filter(Boolean).join("  ")}
              </p>
            </li>
          )
        })}
      </ul>
      <MoreButton remaining={page.remaining} noun="address" onMore={page.more} />
    </div>
  )
}

/**
 * One resident or owner.
 *
 * The web's right-hand panel opens a person into their own view: a header, a row
 * of counts, the phone numbers formatted for dialling, and the address history
 * as cards. There is no second view to push here, so the same material is drawn
 * inline, on its own tile so a household of six does not read as one wall of
 * text.
 */
function PersonBlock({ person }: { person: AddressPerson }) {
  const { p, name, alternateNames, phones, associated, historical } = personParts(person)

  const fields: Field[] = [
    { label: "Type", value: p.type },
    { label: "Age range", value: p.ageRange },
    { label: "Industry", value: p.industry },
    { label: "Linked since", value: p.linkedSince },
    { label: "Also known as", value: alternateNames.join(", ") },
  ]

  return (
    <li className="glass-tile p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 truncate text-[15px] font-semibold text-white">
          {name || "Unnamed person"}
        </p>
        <p className="shrink-0 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted-foreground)]">
          {[
            phones.length ? plural(phones.length, "phone") : null,
            historical.length ? plural(historical.length, "address") : null,
            associated.length ? plural(associated.length, "link") : null,
          ]
            .filter(Boolean)
            .join("  ") || "No linked records"}
        </p>
      </div>

      <div className="mt-3">
        <FieldGrid fields={fields} hideEmpty />
      </div>

      {phones.length > 0 ? (
        <div className="mt-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted-foreground)]">
            {`Phone numbers (${phones.length})`}
          </p>
          <ul className="mt-2 space-y-1.5">
            {phones.map((ph, i) => (
              <li key={i} className="flex items-center justify-between gap-3">
                {/* Formatted for a person to read and dial, exactly as the web
                    formats it. A number that is not a ten digit North American
                    one is printed as it arrived rather than reshaped. */}
                <span className="min-w-0 truncate font-mono text-[13px] text-white">
                  {fmtPhone(text(ph?.phoneNumber))}
                </span>
                <span className="shrink-0 text-[11px] text-white/70">{text(ph?.lineType)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {associated.length > 0 ? (
        <div className="mt-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted-foreground)]">
            {`Associated people (${associated.length})`}
          </p>
          <div className="mt-2">
            <Chips
              items={associated.map((a) => ({
                label: text(a?.name) || "Unnamed",
                note: nullableText(a?.relation) ?? undefined,
              }))}
            />
          </div>
        </div>
      ) : null}

      {historical.length > 0 ? <HistoryRows historical={historical} /> : null}
    </li>
  )
}

/** How many people open in a section before the "show more" control appears. */
const PEOPLE_PAGE = 8

function PeopleSection({
  title,
  people,
  empty,
}: {
  title: string
  people: AddressPerson[]
  empty: string
}) {
  const page = useLimit(PEOPLE_PAGE, people.length)
  return (
    <Section title={people.length ? `${title} (${people.length})` : title}>
      {people.length === 0 ? (
        <EmptyState message={empty} />
      ) : (
        <>
          <ul className="space-y-3">
            {people.slice(0, page.shown).map((p, i) => (
              <PersonBlock key={i} person={p} />
            ))}
          </ul>
          <MoreButton remaining={page.remaining} noun="person" onMore={page.more} />
        </>
      )}
    </Section>
  )
}

export function AddressInsightsResult({ data }: ResultProps) {
  const raw = withDefaults(data, {} as Partial<AddressData>)
  const d: AddressData = {
    answered: raw.answered === true,
    found: raw.found === true,
    streetLine1: nullableText(raw.streetLine1),
    streetLine2: nullableText(raw.streetLine2),
    city: nullableText(raw.city),
    stateCode: nullableText(raw.stateCode),
    postalCode: nullableText(raw.postalCode),
    zip4: nullableText(raw.zip4),
    countryCode: nullableText(raw.countryCode),
    deliveryPoint: nullableText(raw.deliveryPoint),
    isCommercial: bool3(raw.isCommercial),
    isForwarder: bool3(raw.isForwarder),
    isValid: bool3(raw.isValid),
    totalValue: nullableText(raw.totalValue),
    lastSaleDate: nullableText(raw.lastSaleDate),
    mapImageUrl: nullableText(raw.mapImageUrl),
    mapSource:
      raw.mapSource === "provider" || raw.mapSource === "geocoded" ? raw.mapSource : null,
    mapCenter: (() => {
      if (!raw.mapCenter || typeof raw.mapCenter !== "object") return null
      const c = withDefaults(raw.mapCenter, { latitude: NaN, longitude: NaN })
      return Number.isFinite(c.latitude) && Number.isFinite(c.longitude)
        ? { latitude: c.latitude, longitude: c.longitude }
        : null
    })(),
    // A coordinate pair is only carried when both halves are real numbers: a
    // defaulted 0, 0 is a spot in the Atlantic, not a missing value.
    latLong: (() => {
      if (!raw.latLong || typeof raw.latLong !== "object") return null
      const ll = withDefaults(raw.latLong, { latitude: NaN, longitude: NaN, accuracy: null })
      return Number.isFinite(ll.latitude) && Number.isFinite(ll.longitude) ? ll : null
    })(),
    currentResidents: list<AddressPerson>(raw.currentResidents),
    owners: list<AddressPerson>(raw.owners),
  }

  if (!d.answered) return <Unreachable what="Address Insights" />

  if (!d.found) {
    return (
      <div className="space-y-4">
        <EmptyState message="Address Insights searched and could not resolve that address." />
      </div>
    )
  }

  const street = [d.streetLine1, d.streetLine2].filter(Boolean).join(" ")
  const place = [d.city, d.stateCode, d.postalCode].filter(Boolean).join(", ")

  // Everyone the provider attached to this address, counted once. The web's
  // panel merges residents and owners into one list; they are kept apart here,
  // because "lives here" and "owns it" are different claims, but the headline
  // numbers are over both.
  const everyone = [...d.currentResidents, ...d.owners].map(personParts)
  const phones = everyone.reduce((n, x) => n + x.phones.length, 0)
  const pastAddresses = everyone.reduce((n, x) => n + x.historical.length, 0)

  const tiles: StatTile[] = [
    { label: "Residents", value: d.currentResidents.length.toLocaleString() },
    { label: "Owners", value: d.owners.length.toLocaleString() },
    { label: "Phones", value: phones.toLocaleString() },
    { label: "Past addresses", value: pastAddresses.toLocaleString() },
  ]

  return (
    <div className="space-y-4">
      <ProfileCard
        name={street || place || "Address"}
        subtitle={place || null}
        meta={[
          { label: "ZIP+4", value: d.zip4, mono: true },
          { label: "Country", value: d.countryCode },
          { label: "Delivery point", value: d.deliveryPoint, mono: true },
          { label: "Coordinates", value: coords(d.latLong), mono: true },
        ]}
        badges={
          <BadgeRow
            badges={[
              d.isValid === true ? { label: "Deliverable" } : null,
              d.isCommercial === true ? { label: "Commercial" } : null,
              d.isForwarder === true ? { label: "Mail forwarder" } : null,
            ].filter((b): b is { label: string } => b !== null)}
            empty="No delivery flags reported."
          />
        }
      />

      <StatTiles tiles={tiles} />

      {/* Only when the provider actually placed the address. A map section with
          nothing in it says less than no map section at all. */}
      {d.mapImageUrl || d.latLong ? (
        <AddressMapSection
          url={d.mapImageUrl}
          place={[street, place].filter(Boolean).join(", ")}
          ll={d.latLong}
          center={d.mapCenter}
          source={d.mapSource}
        />
      ) : null}

      <Section title="Property">
        <FieldGrid
          fields={[
            { label: "Valuation", value: d.totalValue },
            { label: "Last sale", value: d.lastSaleDate },
            { label: "Deliverable", value: yesNo(d.isValid) },
            { label: "Commercial", value: yesNo(d.isCommercial) },
            { label: "Mail forwarder", value: yesNo(d.isForwarder) },
          ]}
        />
      </Section>

      <PeopleSection
        title="Current residents"
        people={d.currentResidents}
        empty="No current residents are recorded for this address."
      />

      <PeopleSection
        title="Owners"
        people={d.owners}
        empty="No owners are recorded for this address."
      />
    </div>
  )
}

export const addressInsightsDescriptor: ModuleDescriptor = {
  id: "address-insights",
  route: "/tools/address-insights",
  label: "Address Insights",
  icon: MapPinHouse,
  description: "Map every resident and property record tied to a street address.",
  // The server requires both, and refuses either alone.
  inputs: [
    {
      name: "street",
      label: "Street",
      placeholder: "e.g. 1600 Pennsylvania Ave",
      validate: (v) =>
        v.trim().length > 0 && v.trim().length <= TEXT_MAX
          ? null
          : "Enter a street address (200 characters max).",
    },
    {
      name: "where",
      label: "City or ZIP",
      placeholder: "e.g. Washington, DC",
      validate: (v) =>
        v.trim().length > 0 && v.trim().length <= TEXT_MAX
          ? null
          : "Enter a city or ZIP (200 characters max).",
    },
  ],
  Result: AddressInsightsResult,
}

// ---------------------------------------------------------------------------
// Falcon
// ---------------------------------------------------------------------------

type FalconGroup = {
  title: string
  /** How many entries the group really has, before the server's own per-group
   *  ceiling. Never derived from `entries.length`, which is the CUT list. */
  entryTotal: number
  entries: { value: string; quantity: number }[]
}

type FalconData = {
  answered: boolean
  query: string
  queryType: string
  groups: FalconGroup[]
  /** True when the server cut entries to stay inside its own per-group ceiling. */
  truncated: boolean
  profiles: {
    network: string
    name: string | null
    alias: string | null
    url: string | null
    imageUrl: string | null
  }[]
  discoveryCount: number
  /** True when the upstream sweep hit its own deadline and returned early. */
  incomplete: boolean
}

export function FalconResult({ data }: ResultProps) {
  const raw = withDefaults(data, {} as Partial<FalconData>)
  const d: FalconData = {
    answered: raw.answered === true,
    query: text(raw.query),
    queryType: text(raw.queryType) || "email",
    groups: list<FalconGroup>(raw.groups),
    truncated: raw.truncated === true,
    profiles: list<FalconData["profiles"][number]>(raw.profiles),
    discoveryCount: count(raw.discoveryCount),
    incomplete: raw.incomplete === true,
  }

  if (!d.answered) return <Unreachable what="Falcon" />

  const empty = d.groups.length === 0 && d.profiles.length === 0

  return (
    <div className="space-y-4">
      <ProfileCard
        name={d.query || "Falcon sweep"}
        subtitle={d.queryType === "phone" ? "Phone sweep" : "Email sweep"}
        meta={[
          { label: "Discoveries", value: d.discoveryCount > 0 ? d.discoveryCount.toLocaleString() : "" },
          { label: "Groups", value: d.groups.length > 0 ? String(d.groups.length) : "" },
          { label: "Profiles", value: d.profiles.length > 0 ? String(d.profiles.length) : "" },
        ]}
      >
        {/* Both markers are about completeness, not about the subject, so they
            sit with the summary rather than replacing any of the rows below. */}
        {d.incomplete ? (
          <Caveat>
            The sweep hit its time limit and returned early, so this result is partial. Anything
            missing here has not been ruled out.
          </Caveat>
        ) : null}
        {d.truncated ? (
          <Caveat>
            Some groups had more entries than can be carried, so the lists below are incomplete.
          </Caveat>
        ) : null}
      </ProfileCard>

      {empty ? (
        <Section title="Results">
          <EmptyState
            message={
              d.incomplete
                ? "Nothing had arrived before the sweep ran out of time, so nothing can be concluded from this run."
                : "Falcon swept and found nothing for that query."
            }
          />
        </Section>
      ) : null}

      {/* Profiles first, as the web orders them: a named account somewhere is a
          stronger result than a bag of harvested strings. */}
      {d.profiles.length > 0 ? (
        <FalconProfiles profiles={d.profiles} />
      ) : null}

      {d.groups.map((g, i) => (
        <FalconGroupSection
          key={i}
          group={withDefaults(g, { title: "", entryTotal: 0, entries: [] } as FalconGroup)}
          index={i}
        />
      ))}
    </div>
  )
}

/** How many entries of a group open before the "show more" control appears. */
const FALCON_ENTRY_PAGE = 24
/** How many linked profiles open before the "show more" control appears. */
const FALCON_PROFILE_PAGE = 24

/**
 * One harvested group, as the pill wall the web draws.
 *
 * The heading carries the group's REAL size, which is the server's `entryTotal`
 * and not the length of the list below it: a group the server cut at its own
 * ceiling would otherwise report the ceiling as the total.
 */
function FalconGroupSection({ group, index }: { group: FalconGroup; index: number }) {
  const entries = list<{ value: string; quantity: number }>(group.entries)
  const total = Math.max(count(group.entryTotal), entries.length)
  const page = useLimit(FALCON_ENTRY_PAGE, entries.length)

  return (
    <Section
      title={group.title || `Group ${index + 1}`}
      action={
        <span className="shrink-0 font-mono text-[11px] text-white/70">
          {total.toLocaleString()}
        </span>
      }
    >
      <Chips
        items={entries.slice(0, page.shown).map((e) => ({
          label: text(e?.value),
          // The web shows a multiplier only when a value was seen more than
          // once, because "x1" on every pill is noise.
          note: count(e?.quantity) > 1 ? `x${count(e.quantity).toLocaleString()}` : undefined,
        }))}
      />
      <MoreButton remaining={page.remaining} noun="entry" onMore={page.more} />
      {total > entries.length ? (
        <div className="mt-3">
          <Caveat>
            {`This group has ${total.toLocaleString()} entries and only the first ${entries.length.toLocaleString()} were carried.`}
          </Caveat>
        </div>
      ) : null}
    </Section>
  )
}

function FalconProfiles({ profiles }: { profiles: FalconData["profiles"] }) {
  const page = useLimit(FALCON_PROFILE_PAGE, profiles.length)
  return (
    <Section title={`Linked profiles (${profiles.length})`}>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {profiles.slice(0, page.shown).map((p, i) => (
          <li key={i} className="glass-tile flex items-center gap-2.5 px-3 py-2.5">
            <RemoteImage
              url={p?.imageUrl}
              alt={text(p?.name) || text(p?.network) || "Profile"}
              className="h-8 w-8 shrink-0 rounded-lg text-[11px]"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-white">
                {text(p?.network) || "Unknown network"}
              </span>
              <span className="block truncate text-[12px] text-white/70">
                <LinkOrText
                  label={text(p?.name) || text(p?.alias) || text(p?.url) || "Profile"}
                  url={nullableText(p?.url)}
                />
              </span>
            </span>
          </li>
        ))}
      </ul>
      <MoreButton remaining={page.remaining} noun="profile" onMore={page.more} />
    </Section>
  )
}

export const falconDescriptor: ModuleDescriptor = {
  id: "falcon",
  route: "/tools/falcon",
  label: "Falcon",
  icon: Radar,
  description: "Identity aggregate: usernames, names, locations, and linked profiles from an email or phone.",
  inputs: [
    {
      name: "query_type",
      label: "Lookup type",
      placeholder: "email",
      // A real toggle, matching the web's Email / Phone selector, rather than a
      // box you type the word into. Defaults to email, the server's own default.
      options: [
        { value: "email", label: "Email" },
        { value: "phone", label: "Phone" },
      ],
      defaultValue: "email",
      optional: true,
      validate: (v) => {
        const s = v.trim()
        if (s.length === 0) return null
        return s === "email" || s === "phone" ? null : 'Enter "email" or "phone".'
      },
    },
    {
      name: "query",
      label: "Email or phone",
      placeholder: "e.g. name@example.com, +14155550123",
      // The server picks its branch from query_type, which this validator cannot
      // see, so it accepts the union of the two branches: an email or a phone.
      validate: (v) => {
        const s = v.trim()
        if (s.length === 0 || s.length > EMAIL_MAX) {
          return "Enter an email address or a phone number."
        }
        return emailOk(s) || phoneOk(s) ? null : "Enter a valid email address or phone number."
      },
    },
  ],
  Result: FalconResult,
}

// ---------------------------------------------------------------------------
// IntelX
// ---------------------------------------------------------------------------

type IntelxData = {
  answered: boolean
  found: boolean
  filename: string | null
  mimeType: string | null
  size: number
  content: string
  /** True when the file was cut at the download limit. */
  truncated: boolean
  totalLines: number
}

/** How much of a leaked file is put in the DOM at once. The server already caps
 *  the payload at about a megabyte; a megabyte of text in one <pre> still stalls
 *  the webview, so the tail is clipped and the clipping is stated. */
const INTELX_DISPLAY_MAX = 100_000

function fileSize(bytes: number): string {
  if (bytes <= 0) return ""
  if (bytes < 1024) return `${bytes} bytes`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function IntelxResult({ data }: ResultProps) {
  const raw = withDefaults(data, {} as Partial<IntelxData>)
  const d: IntelxData = {
    answered: raw.answered === true,
    found: raw.found === true,
    filename: nullableText(raw.filename),
    mimeType: nullableText(raw.mimeType),
    size: count(raw.size),
    content: text(raw.content),
    truncated: raw.truncated === true,
    totalLines: count(raw.totalLines),
  }

  if (!d.answered) return <Unreachable what="IntelX" />

  if (!d.found) {
    return (
      <div className="space-y-4">
        <EmptyState message="IntelX answered, and holds no file for that system ID." />
      </div>
    )
  }

  const shown = d.content.slice(0, INTELX_DISPLAY_MAX)
  const clipped = d.content.length > INTELX_DISPLAY_MAX

  return (
    <div className="space-y-4">
      <ProfileCard
        name={d.filename || "Untitled file"}
        subtitle={d.mimeType}
        meta={[
          { label: "Size", value: fileSize(d.size), mono: true },
          { label: "Lines", value: d.totalLines > 0 ? d.totalLines.toLocaleString() : "", mono: true },
        ]}
      >
        {d.truncated ? (
          <Caveat>
            IntelX cut this file at the download limit, so what follows is the start of it and not
            the whole record.
          </Caveat>
        ) : null}
      </ProfileCard>

      <Section
        title="Contents"
        // The web offers a Download button, built from a Blob URL. The webview
        // holds no filesystem permission at all, so the equivalent that is
        // actually reachable is the clipboard, and it carries the WHOLE payload
        // rather than the clipped view below it.
        action={
          d.content.length > 0 ? <CopyButton value={d.content} label="Copy file" /> : undefined
        }
      >
        {shown.length === 0 ? (
          <EmptyState message="The file came back empty." />
        ) : (
          <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-white/75">
            {shown}
          </pre>
        )}
        {clipped ? (
          <div className="mt-3">
            <Caveat>
              {`Showing the first ${INTELX_DISPLAY_MAX.toLocaleString()} characters of the file so the window stays responsive.`}
            </Caveat>
          </div>
        ) : null}
      </Section>
    </div>
  )
}

export const intelxDescriptor: ModuleDescriptor = {
  id: "intelx",
  route: "/tools/intelx",
  label: "IntelX",
  icon: Database,
  description: "Fetch a leaked file's contents by its IntelX system ID.",
  inputs: [
    {
      name: "systemId",
      label: "IntelX system ID",
      placeholder: "e.g. 7d2f1e0a-4c3b-4a5d-9e8f-0b1c2d3e4f50",
      validate: (v) =>
        UUID_RE.test(v.trim()) ? null : "Enter an IntelX system ID (a UUID).",
    },
  ],
  Result: IntelxResult,
}

// ---------------------------------------------------------------------------
// Cobra
// ---------------------------------------------------------------------------

type CobraAccount = {
  platform: string
  /** "registered", "unknown" and whatever else the provider says. "unknown" is a
   *  real value: it means the provider DECLINED to confirm the account. */
  status: string
  displayName: string | null
  accountId: string | null
  fullName: string | null
  parsedEmail: string | null
  profileImgUrl: string | null
}

type CobraData = {
  answered: boolean
  query: string
  exists: boolean
  handle: string | null
  primaryProvider: string | null
  risk: { score: number; max: number | null; label: string | null } | null
  firstSeen: string | null
  lastSeen: string | null
  timesSeen: number | null
  linkedAccounts: CobraAccount[]
  domain: {
    domain: string | null
    provider: string | null
    free: boolean | null
    disposable: boolean | null
    registrar: string | null
    registered: string | null
    expires: string | null
    suffix: string | null
    description: string | null
  } | null
  badActivity: {
    blacklisted: boolean | null
    reports: number | null
    reports24h: number | null
    disposable: boolean | null
  } | null
  breaches: {
    name: string
    domain: string | null
    date: string | null
    exposedData: string[]
    recordCount: number | null
    description: string | null
  }[]
  totalBreaches: number
}

/**
 * What one linked-account status means, in words.
 *
 * "unknown" is the one that matters. The provider says it deliberately when it
 * could not confirm whether an account exists on that platform, and the obvious
 * rendering (the bare status string under a platform name) reads as a confirmed
 * account. It is spelled out here instead.
 */
function accountStatus(status: string): string {
  const s = status.trim().toLowerCase()
  if (s === "registered") return "Registered"
  if (s === "unknown" || s === "") return "The provider did not confirm this account"
  if (s === "not_registered" || s === "unregistered") return "Not registered"
  return status
}

export function CobraResult({ data }: ResultProps) {
  const raw = withDefaults(data, {} as Partial<CobraData>)
  const rawRisk = raw.risk ? withDefaults(raw.risk, { score: 0, max: null, label: null }) : null
  const d: CobraData = {
    answered: raw.answered === true,
    query: text(raw.query),
    exists: raw.exists === true,
    handle: nullableText(raw.handle),
    primaryProvider: nullableText(raw.primaryProvider),
    risk: rawRisk
      ? {
          score: count(rawRisk.score),
          // The denominator may be absent or nonsense. It is never invented here:
          // a missing max means the score is shown on its own rather than over a
          // number nobody sent.
          max: nullableCount(rawRisk.max) !== null && count(rawRisk.max) > 0 ? count(rawRisk.max) : null,
          label: nullableText(rawRisk.label),
        }
      : null,
    firstSeen: nullableText(raw.firstSeen),
    lastSeen: nullableText(raw.lastSeen),
    timesSeen: nullableCount(raw.timesSeen),
    linkedAccounts: list<CobraAccount>(raw.linkedAccounts),
    domain: raw.domain
      ? withDefaults(raw.domain, {
          domain: null,
          provider: null,
          free: null,
          disposable: null,
          registrar: null,
          registered: null,
          expires: null,
          suffix: null,
          description: null,
        } as NonNullable<CobraData["domain"]>)
      : null,
    badActivity: raw.badActivity
      ? withDefaults(raw.badActivity, {
          blacklisted: null,
          reports: null,
          reports24h: null,
          disposable: null,
        } as NonNullable<CobraData["badActivity"]>)
      : null,
    breaches: list<CobraData["breaches"][number]>(raw.breaches),
    totalBreaches: count(raw.totalBreaches),
  }

  if (!d.answered) return <Unreachable what="Cobra" />

  const confirmed = d.linkedAccounts.filter(
    (a) => text(a?.status).trim().toLowerCase() === "registered",
  ).length

  return (
    <div className="space-y-4">
      <ProfileCard
        name={d.handle || d.query || "Cobra lookup"}
        subtitle={d.query || null}
        meta={[
          { label: "Identity", value: d.exists ? "Known to the provider" : "Not known to the provider" },
          { label: "Primary provider", value: d.primaryProvider },
          { label: "First seen", value: d.firstSeen },
          { label: "Last seen", value: d.lastSeen },
          {
            label: "Times seen",
            value: d.timesSeen !== null && d.timesSeen > 0 ? d.timesSeen.toLocaleString() : "",
          },
        ]}
      />

      {d.risk ? (
        <Section title="Risk">
          <RiskMeter risk={d.risk} />
        </Section>
      ) : null}

      <Section
        title={`Linked accounts${
          d.linkedAccounts.length ? ` (${confirmed} confirmed of ${d.linkedAccounts.length})` : ""
        }`}
      >
        {d.linkedAccounts.length === 0 ? (
          <EmptyState message="Cobra reported no linked accounts for that identifier." />
        ) : (
          <CobraAccounts accounts={d.linkedAccounts} />
        )}
      </Section>

      {d.domain ? (
        <Section title="Domain">
          <FieldGrid
            fields={[
              { label: "Domain", value: d.domain.domain, mono: true },
              { label: "Provider", value: d.domain.provider },
              { label: "Registrar", value: d.domain.registrar },
              { label: "Registered", value: d.domain.registered },
              { label: "Expires", value: d.domain.expires },
              { label: "Suffix", value: d.domain.suffix, mono: true },
              { label: "Free provider", value: yesNo(bool3(d.domain.free)) },
              { label: "Disposable", value: yesNo(bool3(d.domain.disposable)) },
              { label: "Notes", value: d.domain.description },
            ]}
          />
        </Section>
      ) : null}

      {d.badActivity ? (
        <Section title="Reputation">
          <FieldGrid
            fields={[
              { label: "Blacklisted", value: yesNo(bool3(d.badActivity.blacklisted)) },
              { label: "Disposable", value: yesNo(bool3(d.badActivity.disposable)) },
              {
                label: "Reports",
                value:
                  d.badActivity.reports !== null ? d.badActivity.reports.toLocaleString() : "",
              },
              {
                label: "Reports in 24 hours",
                value:
                  d.badActivity.reports24h !== null
                    ? d.badActivity.reports24h.toLocaleString()
                    : "",
              },
            ]}
          />
        </Section>
      ) : null}

      <Section title={`Breaches${d.breaches.length ? ` (${d.totalBreaches || d.breaches.length})` : ""}`}>
        {d.breaches.length === 0 ? (
          <EmptyState message="Cobra reported no breaches for that identifier." />
        ) : (
          <CobraBreaches breaches={d.breaches} />
        )}
      </Section>
    </div>
  )
}

/**
 * The risk score as the slim meter the web draws, rather than a bare number.
 *
 * The bar exists only when a denominator was actually reported. A missing max
 * means the score is shown on its own: a bar needs a proportion, and inventing
 * the denominator is how "12 / 0" and a NaN width got on screen on the web.
 */
function RiskMeter({ risk }: { risk: NonNullable<CobraData["risk"]> }) {
  const max = risk.max
  const pct = max !== null && max > 0 ? Math.min(100, Math.round((risk.score / max) * 100)) : null
  // Palette tokens, not raw hex: the theme owns these three colours and they are
  // the same three the rest of the app reads a severity from.
  const tone =
    pct === null
      ? "bg-white"
      : pct >= 66
        ? "bg-[var(--color-destructive)]"
        : pct >= 33
          ? "bg-[var(--color-warning)]"
          : "bg-[var(--color-positive)]"

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[15px] font-semibold text-white">{risk.label || "Risk"}</span>
        <span className="font-mono text-[12px] text-white/70">
          {max !== null ? `${risk.score} of ${max}` : String(risk.score)}
        </span>
      </div>
      {pct !== null ? (
        <div
          role="meter"
          aria-valuenow={risk.score}
          aria-valuemin={0}
          aria-valuemax={max ?? undefined}
          aria-label={risk.label || "Risk"}
          className="glass-tile mt-3 h-1.5 w-full overflow-hidden rounded-full"
        >
          {/* Width is the datum, so it is the one inline style here. The fill is
              a palette colour class, never an inline background. */}
          <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
        </div>
      ) : null}
      <div className="mt-3">
        <FieldGrid
          hideEmpty
          fields={[
            { label: "Rating", value: risk.label },
            { label: "Share of maximum", value: pct !== null ? `${pct}%` : "" },
          ]}
        />
      </div>
    </div>
  )
}

/** How many linked accounts open before the "show more" control appears. */
const COBRA_ACCOUNT_PAGE = 24
/** How many breaches open before the "show more" control appears. Matches the
 *  web page's own page size. */
const COBRA_BREACH_PAGE = 24

/**
 * One linked account, opening onto whatever the provider knew about it.
 *
 * The web collapses the account id, the full name, the parsed email and the
 * avatar behind a disclosure, and that is worth keeping: those fields exist on a
 * minority of rows, and putting them inline turns a list of forty platforms into
 * a page of mostly blanks.
 */
function CobraAccountRow({ account }: { account: CobraAccount }) {
  const [open, setOpen] = useState(false)
  const details: Field[] = [
    { label: "Account ID", value: nullableText(account?.accountId), mono: true },
    { label: "Full name", value: nullableText(account?.fullName) },
    { label: "Parsed email", value: nullableText(account?.parsedEmail), mono: true },
  ]
  const hasDetails = details.some((f) => f.value) || Boolean(account?.profileImgUrl)
  const registered = text(account?.status).trim().toLowerCase() === "registered"

  return (
    <li className="glass-tile overflow-hidden">
      <button
        type="button"
        disabled={!hasDetails}
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left ${
          hasDetails ? "glass-tile-hover" : ""
        }`}
      >
        <RemoteImage
          url={account?.profileImgUrl}
          alt={text(account?.platform) || "Account"}
          className="h-8 w-8 shrink-0 rounded-lg text-[11px]"
        />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-[13px] font-medium text-white">
              {text(account?.platform) || "Unknown platform"}
            </span>
            <span className="min-w-0 truncate font-mono text-[11px] text-white/70">
              {text(account?.displayName) ||
                text(account?.fullName) ||
                text(account?.parsedEmail)}
            </span>
          </span>
          {/* Never the bare status string: "unknown" under a platform name reads
              as a confirmed account, which the provider explicitly refused to
              say. A confirmed one is the only row that gets a colour. */}
          <span
            className={`mt-0.5 block truncate text-[11px] ${
              registered ? "text-[var(--color-positive)]" : "text-[var(--color-muted-foreground)]"
            }`}
          >
            {accountStatus(text(account?.status))}
          </span>
        </span>
        {hasDetails ? (
          <span className="shrink-0 font-mono text-[10px] text-white/60">
            {open ? "Hide" : "More"}
          </span>
        ) : null}
      </button>
      {open && hasDetails ? (
        <div className="border-t border-white/[0.06] px-3 py-3">
          <FieldGrid hideEmpty fields={details} />
        </div>
      ) : null}
    </li>
  )
}

function CobraAccounts({ accounts }: { accounts: CobraAccount[] }) {
  const page = useLimit(COBRA_ACCOUNT_PAGE, accounts.length)
  return (
    <>
      <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {accounts.slice(0, page.shown).map((a, i) => (
          <CobraAccountRow key={i} account={a} />
        ))}
      </ul>
      <MoreButton remaining={page.remaining} noun="account" onMore={page.more} />
    </>
  )
}

function CobraBreaches({ breaches }: { breaches: CobraData["breaches"] }) {
  const page = useLimit(COBRA_BREACH_PAGE, breaches.length)
  return (
    <>
      <ul className="space-y-2">
        {breaches.slice(0, page.shown).map((b, i) => {
          const exposed = list<string>(b?.exposedData)
          const meta = [nullableText(b?.domain), nullableText(b?.date)].filter(Boolean).join("  ")
          return (
            <li key={i} className="glass-tile px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="min-w-0 truncate text-[14px] font-medium text-white">
                  {text(b?.name) || "Unnamed breach"}
                </p>
                {nullableCount(b?.recordCount) !== null ? (
                  <p className="shrink-0 font-mono text-[11px] text-white/70">
                    {plural(count(b.recordCount), "record")}
                  </p>
                ) : null}
              </div>
              {meta ? (
                <p className="mt-0.5 font-mono text-[11px] text-[var(--color-muted-foreground)]">
                  {meta}
                </p>
              ) : null}
              {nullableText(b?.description) ? (
                <p className="mt-2 text-[12px] leading-relaxed text-white/70">
                  {text(b.description)}
                </p>
              ) : null}
              {exposed.length > 0 ? (
                <div className="mt-2">
                  {/* What was actually leaked, as its own row of tags: this is
                      the part of a breach a person is looking for. */}
                  <Chips tone="warning" items={exposed.map((e) => ({ label: e }))} />
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
      <MoreButton remaining={page.remaining} noun="breach" onMore={page.more} />
    </>
  )
}

export const cobraDescriptor: ModuleDescriptor = {
  id: "cobra",
  route: "/tools/cobra",
  label: "Cobra",
  icon: ShieldAlert,
  description: "Email-exposure intelligence: risk, linked accounts, domain reputation, and breaches.",
  /**
   * Email, phone and IP are each optional, and the server needs at least one of
   * them; country and postal are filters that cannot identify anyone on their
   * own. That "at least one" rule is cross-field and so cannot live in a
   * per-field validator, which is handed its own value and nothing else.
   */
  inputs: [
    {
      name: "email",
      label: "Email (optional)",
      placeholder: "e.g. name@example.com",
      optional: true,
      validate: (v) => {
        const s = v.trim()
        if (s.length === 0) return null
        return emailOk(s) ? null : "Enter a valid email address."
      },
    },
    {
      name: "phone",
      label: "Phone (optional)",
      placeholder: "e.g. +14155550123",
      optional: true,
      validate: (v) => {
        const s = v.trim()
        if (s.length === 0) return null
        return phoneOk(s) ? null : "Enter a valid phone number."
      },
    },
    {
      name: "ip",
      label: "IP address (optional)",
      placeholder: "e.g. 8.8.8.8",
      optional: true,
      validate: (v) => {
        const s = v.trim()
        if (s.length === 0) return null
        return IP_RE.test(s) ? null : "Enter a valid IP address."
      },
    },
    {
      name: "country",
      label: "Country code (optional)",
      placeholder: "e.g. US",
      optional: true,
      // Stricter than the server, which accepts any text up to 32 characters and
      // then truncates it to two. That truncation is silent and turns "United
      // States" into "UN", so a country that cannot mean what the user typed is
      // refused here rather than searched.
      validate: (v) => {
        const s = v.trim()
        if (s.length === 0) return null
        return COUNTRY_RE.test(s) ? null : "Enter a two letter country code, for example US."
      },
    },
    {
      name: "postal",
      label: "Postal code (optional)",
      placeholder: "e.g. 94103",
      optional: true,
      // The server sends at most the first 12 characters, so anything longer is
      // not the code that would be searched for.
      validate: (v) => {
        const s = v.trim()
        if (s.length === 0) return null
        return s.length <= 12 ? null : "Postal code is too long (12 characters max)."
      },
    },
  ],
  Result: CobraResult,
}
