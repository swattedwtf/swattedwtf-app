import { ipc } from "../lib/ipc"
import { RemoteImage } from "./RemoteImage"
import { list, withDefaults } from "./safe"
import type { ModuleDescriptor, ResultProps } from "./types"
import { BadgeRow, EmptyState, FieldGrid, ProfileCard, Section, type Field } from "./ui"

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
        d.records.slice(0, 25).map((record, i) => (
          <Section key={i} title={`Record ${i + 1} of ${d.recordCount || d.records.length}`}>
            <FieldGrid fields={list<{ label: string; value: string }>(record?.fields)} />
          </Section>
        ))
      )}
    </div>
  )
}

export const samsungDescriptor: ModuleDescriptor = {
  id: "samsung",
  route: "/tools/samsung",
  label: "Samsung Lookup",
  // Mirrors the server's `validate()`. A per-field validator cannot see the
  // other fields, so the cross-field rules (a sweep needs start <= end) stay
  // with the server, which is the authority in any case.
  inputs: [
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
      name: "mode",
      label: 'Mode ("direct" or "enumerate", optional)',
      placeholder: "direct",
      // Blank is the server's own default: anything that is not exactly
      // "enumerate" is the direct lookup.
      optional: true,
      validate: (v) => {
        const s = v.trim()
        if (s.length === 0) return null
        return s === "direct" || s === "enumerate" ? null : 'Enter "direct" or "enumerate".'
      },
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

  return (
    <div className="space-y-4">
      {d.records.slice(0, 25).map((rec, i) => {
        const record = withDefaults(rec, {
          address: null,
          city: null,
          state: null,
          zip: null,
          county: null,
          propertyType: null,
          owner: EMPTY_OWNER,
          persons: [],
        } as SkiptracerRecord)
        const owner = withDefaults(record.owner, EMPTY_OWNER)
        const persons = list<SkiptracerPerson>(record.persons)

        return (
          <Section key={i} title={`Record ${i + 1} of ${d.count || d.records.length}`}>
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
              <ul className="mt-4 space-y-3">
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
                    <li key={j}>
                      <p className="text-[13px] text-white/85">{person.name || "Unnamed person"}</p>
                      <FieldGrid
                        fields={[
                          { label: "Age", value: person.age },
                          { label: "Gender", value: person.gender },
                          { label: "Role", value: person.ownershipRole },
                          { label: "Occupation", value: person.occupation },
                          // Three states, and the third is silence. A blank here
                          // renders as "Not reported", never as "living".
                          { label: "Mortality", value: mortality(bool3(person.deceased)) },
                        ]}
                      />
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
    </div>
  )
}

export const skiptracerDescriptor: ModuleDescriptor = {
  id: "skiptracer",
  route: "/tools/skiptracer",
  label: "Skiptracer",
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

function historicalLine(h: HistoricalAddress): string {
  const place = [h.streetLine1, h.streetLine2, h.city, h.stateCode, h.postalCode]
    .filter(Boolean)
    .join(", ")
  const span = [h.since, h.until].filter(Boolean).join(" to ")
  return [place || "Address withheld", span].filter(Boolean).join("  ")
}

function PersonBlock({ person }: { person: AddressPerson }) {
  const p = withDefaults(person, EMPTY_PERSON)
  const alternateNames = list<string>(p.alternateNames)
  const phones = list<{ phoneNumber: string; lineType: string | null }>(p.phones)
  const associated = list<{ name: string; relation: string | null; since: string | null }>(
    p.associatedPeople,
  )
  const historical = list<HistoricalAddress>(p.historicalAddresses)

  const fields: Field[] = [
    { label: "Name", value: p.name || [p.firstName, p.middleName, p.lastName].filter(Boolean).join(" ") },
    { label: "Type", value: p.type },
    { label: "Age range", value: p.ageRange },
    { label: "Industry", value: p.industry },
    { label: "Linked since", value: p.linkedSince },
    { label: "Also known as", value: alternateNames.join(", ") },
    {
      label: "Phones",
      value: phones
        .map((ph) => (ph.lineType ? `${ph.phoneNumber} (${ph.lineType})` : ph.phoneNumber))
        .join(", "),
      mono: true,
    },
    {
      label: "Associated people",
      value: associated
        .map((a) => (a.relation ? `${a.name} (${a.relation})` : a.name))
        .join(", "),
    },
  ]

  return (
    <li>
      <FieldGrid fields={fields} />
      {historical.length > 0 ? (
        <ul className="mt-2 space-y-1 text-[12px] text-white/70">
          {historical.slice(0, 10).map((h, i) => (
            <li key={i} className="truncate">
              {historicalLine(withDefaults(h, EMPTY_HISTORICAL))}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
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

      <Section title={`Current residents${d.currentResidents.length ? ` (${d.currentResidents.length})` : ""}`}>
        {d.currentResidents.length === 0 ? (
          <EmptyState message="No current residents are recorded for this address." />
        ) : (
          <ul className="space-y-4">
            {d.currentResidents.slice(0, 20).map((p, i) => (
              <PersonBlock key={i} person={p} />
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Owners${d.owners.length ? ` (${d.owners.length})` : ""}`}>
        {d.owners.length === 0 ? (
          <EmptyState message="No owners are recorded for this address." />
        ) : (
          <ul className="space-y-4">
            {d.owners.slice(0, 20).map((p, i) => (
              <PersonBlock key={i} person={p} />
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}

export const addressInsightsDescriptor: ModuleDescriptor = {
  id: "address-insights",
  route: "/tools/address-insights",
  label: "Address Insights",
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

type FalconGroup = { title: string; entries: { value: string; quantity: number }[] }

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

      {d.groups.slice(0, 25).map((g, i) => {
        const group = withDefaults(g, { title: "", entries: [] } as FalconGroup)
        const entries = list<{ value: string; quantity: number }>(group.entries)
        return (
          <Section key={i} title={group.title || `Group ${i + 1}`}>
            <ul className="space-y-1 text-[13px]">
              {entries.slice(0, 200).map((e, j) => (
                <li key={j} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-white/85">{text(e?.value)}</span>
                  {count(e?.quantity) > 0 ? (
                    <span className="shrink-0 font-mono text-[11px] text-[var(--color-muted-foreground)]">
                      {count(e.quantity).toLocaleString()}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </Section>
        )
      })}

      {d.profiles.length > 0 ? (
        <Section title={`Profiles (${d.profiles.length})`}>
          <ul className="space-y-2">
            {d.profiles.slice(0, 50).map((p, i) => (
              <li key={i} className="flex items-center gap-2.5">
                <RemoteImage
                  url={p?.imageUrl}
                  alt={text(p?.name) || text(p?.network) || "Profile"}
                  className="h-8 w-8 shrink-0 rounded-lg text-[11px]"
                />
                <span className="min-w-[84px] text-[13px] text-[var(--color-muted-foreground)]">
                  {text(p?.network) || "Unknown network"}
                </span>
                <LinkOrText
                  label={text(p?.name) || text(p?.alias) || text(p?.url) || "Profile"}
                  url={nullableText(p?.url)}
                />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  )
}

export const falconDescriptor: ModuleDescriptor = {
  id: "falcon",
  route: "/tools/falcon",
  label: "Falcon",
  inputs: [
    {
      name: "query_type",
      label: 'Lookup type ("email" or "phone", optional)',
      placeholder: "email",
      // Blank is the server's own default: anything that is not exactly "phone"
      // is an email sweep.
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

      <Section title="Contents">
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
          <FieldGrid
            fields={[
              {
                label: "Score",
                value:
                  d.risk.max !== null
                    ? `${d.risk.score} of ${d.risk.max}`
                    : // No denominator was sent, so none is shown. Defaulting one
                      // in would put a number on screen that nobody reported.
                      String(d.risk.score),
              },
              {
                label: "Share of maximum",
                value: d.risk.max !== null ? `${Math.round((d.risk.score / d.risk.max) * 100)}%` : "",
              },
              { label: "Rating", value: d.risk.label },
            ]}
          />
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
          <ul className="space-y-2">
            {d.linkedAccounts.slice(0, 60).map((a, i) => (
              <li key={i} className="flex items-center gap-2.5">
                <RemoteImage
                  url={a?.profileImgUrl}
                  alt={text(a?.platform) || "Account"}
                  className="h-8 w-8 shrink-0 rounded-lg text-[11px]"
                />
                <span className="min-w-[84px] text-[13px] text-white/85">
                  {text(a?.platform) || "Unknown platform"}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--color-muted-foreground)]">
                  {/* Never the bare status string: "unknown" under a platform
                      name reads as a confirmed account, which the provider
                      explicitly refused to say. */}
                  {accountStatus(text(a?.status))}
                </span>
                <span className="min-w-0 truncate text-[12px] text-white/70">
                  {text(a?.displayName) || text(a?.fullName) || text(a?.parsedEmail)}
                </span>
              </li>
            ))}
          </ul>
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
          <ul className="space-y-3">
            {d.breaches.slice(0, 50).map((b, i) => {
              const exposed = list<string>(b?.exposedData)
              return (
                <li key={i}>
                  <p className="text-[13px] text-white/85">
                    {text(b?.name) || "Unnamed breach"}
                    {text(b?.date) ? (
                      <span className="ml-2 font-mono text-[11px] text-[var(--color-muted-foreground)]">
                        {text(b.date)}
                      </span>
                    ) : null}
                  </p>
                  <FieldGrid
                    hideEmpty
                    fields={[
                      { label: "Domain", value: nullableText(b?.domain), mono: true },
                      {
                        label: "Records",
                        value:
                          nullableCount(b?.recordCount) !== null
                            ? count(b.recordCount).toLocaleString()
                            : "",
                      },
                      { label: "Exposed", value: exposed.join(", ") },
                      { label: "Notes", value: nullableText(b?.description) },
                    ]}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </Section>
    </div>
  )
}

export const cobraDescriptor: ModuleDescriptor = {
  id: "cobra",
  route: "/tools/cobra",
  label: "Cobra",
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
