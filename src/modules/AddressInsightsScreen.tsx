import { useCallback, useEffect, useRef, useState } from "react"
import {
  ArrowLeft,
  ChevronRight,
  Clock,
  Loader2,
  MapPin,
  Navigation,
  Phone,
  Search,
  User,
  X,
} from "lucide-react"

import { ipc } from "../lib/ipc"
import { getMapboxToken } from "../lib/mapbox"
import { classifyError } from "../lib/errors"
import { AddressMap, featureToPick, type PickInfo } from "./ui/AddressMap"

/**
 * Address Insights, the app port of the web's full-screen tool: a full-bleed 3D
 * map with a floating Mapbox typeahead, click-anywhere-to-analyze, recent
 * searches and locate-me, over a right-hand panel that lists the people tied to
 * the address and drills into each one. Backed by the same desktop
 * `addressInsights` module the old form used, so metering and gating are
 * unchanged - only the surface matches the web now.
 */

type LatLong = { latitude: number; longitude: number; accuracy?: string | null }
type Ph = { phoneNumber: string; lineType?: string | null }
type Hist = {
  streetLine1?: string | null
  streetLine2?: string | null
  city?: string | null
  stateCode?: string | null
  postalCode?: string | null
  since?: string | null
  until?: string | null
}
type Person = {
  name?: string | null
  ageRange?: string | null
  phones: Ph[]
  associatedPeople: { name: string; relation?: string | null }[]
  historicalAddresses: Hist[]
}
type Result = {
  found: boolean
  streetLine1?: string | null
  city?: string | null
  stateCode?: string | null
  postalCode?: string | null
  latLong?: LatLong | null
  currentResidents: Person[]
  owners: Person[]
}

type Recent = { label: string; street: string; where: string; lat: number; lng: number }

const RECENTS_KEY = "sw_address_recents"

function fmtPhone(n: string): string {
  const m = n.replace(/[^\d]/g, "").match(/^1?(\d{3})(\d{3})(\d{4})$/)
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : n
}

function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

/** Coerce the module's untyped `data` into the Result shape this screen renders. */
function coerceResult(data: unknown): Result {
  const d = (data ?? {}) as Record<string, unknown>
  const person = (raw: unknown): Person => {
    const p = (raw ?? {}) as Record<string, unknown>
    return {
      name: typeof p.name === "string" ? p.name : null,
      ageRange: typeof p.ageRange === "string" ? p.ageRange : null,
      phones: arr<Record<string, unknown>>(p.phones).map((x) => ({
        phoneNumber: String(x.phoneNumber ?? ""),
        lineType: typeof x.lineType === "string" ? x.lineType : null,
      })),
      associatedPeople: arr<Record<string, unknown>>(p.associatedPeople).map((x) => ({
        name: String(x.name ?? ""),
        relation: typeof x.relation === "string" ? x.relation : null,
      })),
      historicalAddresses: arr<Record<string, unknown>>(p.historicalAddresses).map((x) => ({
        streetLine1: typeof x.streetLine1 === "string" ? x.streetLine1 : null,
        streetLine2: typeof x.streetLine2 === "string" ? x.streetLine2 : null,
        city: typeof x.city === "string" ? x.city : null,
        stateCode: typeof x.stateCode === "string" ? x.stateCode : null,
        postalCode: typeof x.postalCode === "string" ? x.postalCode : null,
        since: typeof x.since === "string" ? x.since : null,
        until: typeof x.until === "string" ? x.until : null,
      })),
    }
  }
  const ll = (d.latLong ?? null) as LatLong | null
  return {
    found: d.found === true,
    streetLine1: typeof d.streetLine1 === "string" ? d.streetLine1 : null,
    city: typeof d.city === "string" ? d.city : null,
    stateCode: typeof d.stateCode === "string" ? d.stateCode : null,
    postalCode: typeof d.postalCode === "string" ? d.postalCode : null,
    latLong: ll && typeof ll.latitude === "number" ? ll : null,
    currentResidents: arr<unknown>(d.currentResidents).map(person),
    owners: arr<unknown>(d.owners).map(person),
  }
}

export function AddressInsightsScreen() {
  const mapToken = getMapboxToken() ?? ""
  const [query, setQuery] = useState("")
  const [suggestions, setSuggestions] = useState<Record<string, unknown>[]>([])
  const [showSug, setShowSug] = useState(false)
  const [showRecents, setShowRecents] = useState(false)
  const [recents, setRecents] = useState<Recent[]>([])

  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null)
  const [label, setLabel] = useState("")
  const [result, setResult] = useState<Result | null>(null)
  const [status, setStatus] = useState<"idle" | "loading" | "loaded">("idle")
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState<number | null>(null)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const busy = status === "loading"

  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENTS_KEY)
      if (raw) setRecents(JSON.parse(raw))
    } catch {
      /* ignore */
    }
  }, [])

  const pushRecent = useCallback((r: Recent) => {
    setRecents((prev) => {
      const next = [r, ...prev.filter((x) => x.label !== r.label)].slice(0, 6)
      try {
        localStorage.setItem(RECENTS_KEY, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  const analyze = useCallback(
    async (info: PickInfo) => {
      setShowSug(false)
      setShowRecents(false)
      setQuery(info.label)
      setLabel(info.label)
      setPoint({ lat: info.lat, lng: info.lng })
      setActive(null)
      setStatus("loading")
      setError(null)
      try {
        const res = await ipc.lookup("address-insights", { street: info.street, where: info.where })
        setResult(coerceResult(res.data))
        setStatus("loaded")
        pushRecent({ label: info.label, street: info.street, where: info.where, lat: info.lat, lng: info.lng })
      } catch (err) {
        setError(classifyError(err).message || "That address could not be analysed.")
        setStatus("idle")
      }
    },
    [pushRecent],
  )

  function onQueryChange(v: string) {
    setQuery(v)
    setShowRecents(false)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (v.trim().length < 3 || !mapToken) {
      setSuggestions([])
      setShowSug(false)
      return
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
          v.trim(),
        )}.json?types=address&autocomplete=true&limit=5&access_token=${mapToken}`
        const res = await fetch(url)
        const json = await res.json()
        setSuggestions(Array.isArray(json?.features) ? json.features : [])
        setShowSug(true)
      } catch {
        setSuggestions([])
      }
    }, 250)
  }

  function selectSuggestion(f: Record<string, unknown>) {
    const info = featureToPick(f)
    if (info) void analyze(info)
  }

  function locateMe() {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude, longitude } = pos.coords
      try {
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude},${latitude}.json?types=address&limit=1&access_token=${mapToken}`
        const res = await fetch(url)
        const json = await res.json()
        const info = featureToPick(json?.features?.[0])
        if (info) void analyze(info)
      } catch {
        /* ignore */
      }
    })
  }

  const persons: Person[] = result ? [...result.currentResidents, ...result.owners] : []
  const summaryAddr =
    label ||
    (result ? [result.streetLine1, result.city, result.stateCode, result.postalCode].filter(Boolean).join(", ") : "")
  const coords = result?.latLong
    ? `${result.latLong.latitude.toFixed(6)}, ${result.latLong.longitude.toFixed(6)}`
    : point
      ? `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`
      : ""

  return (
    <div className="-mx-9 -my-12 flex h-[100dvh] overflow-hidden bg-[#0b0b0b]">
      {/* Map region */}
      <div className="relative flex-1">
        <AddressMap token={mapToken} point={point} onPick={analyze} busy={busy} />

        {/* Floating search bar */}
        <div className="pointer-events-none absolute inset-x-0 top-4 z-20 flex justify-center px-4">
          <div className="pointer-events-auto flex w-full max-w-lg items-center gap-2">
            <div className="relative flex-1">
              <div className="flex h-11 items-center gap-2 rounded-xl border border-[var(--color-border)] bg-black/70 px-3 shadow-lg backdrop-blur-md">
                <Search className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" aria-hidden />
                <input
                  value={query}
                  onChange={(e) => onQueryChange(e.target.value)}
                  onFocus={() => suggestions.length && setShowSug(true)}
                  placeholder="Search an address..."
                  className="h-full w-full bg-transparent text-[13px] text-white placeholder:text-[var(--color-muted-foreground)] focus:outline-none"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("")
                      setSuggestions([])
                      setShowSug(false)
                    }}
                    className="shrink-0 text-[var(--color-muted-foreground)] hover:text-white"
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </div>

              {showSug && suggestions.length > 0 && (
                <div className="absolute inset-x-0 top-12 overflow-hidden rounded-xl border border-[var(--color-border)] bg-black/90 shadow-2xl backdrop-blur-md">
                  {suggestions.map((f, i) => {
                    const parts = String(f.place_name ?? "").split(",")
                    const primary = parts[0] ?? f.text ?? ""
                    const secondary = parts.slice(1).join(",").trim()
                    return (
                      <button
                        key={(f.id as string) ?? i}
                        type="button"
                        onClick={() => selectSuggestion(f)}
                        className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-white/5"
                      >
                        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]" aria-hidden />
                        <span className="min-w-0">
                          <span className="block truncate text-[12.5px] font-medium text-white">{primary as string}</span>
                          {secondary && (
                            <span className="block truncate font-mono text-[10.5px] text-[var(--color-muted-foreground)]">
                              {secondary}
                            </span>
                          )}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Recent searches */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowRecents((s) => !s)
                  setShowSug(false)
                }}
                title="Recent searches"
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--color-border)] bg-black/70 text-[var(--color-muted-foreground)] shadow-lg backdrop-blur-md transition-colors hover:text-white"
              >
                <Clock className="h-4 w-4" aria-hidden />
              </button>
              {showRecents && (
                <div className="absolute right-0 top-12 w-72 overflow-hidden rounded-xl border border-[var(--color-border)] bg-black/90 shadow-2xl backdrop-blur-md">
                  {recents.length === 0 ? (
                    <p className="px-3 py-3 text-center text-[12px] text-[var(--color-muted-foreground)]">
                      No recent searches
                    </p>
                  ) : (
                    recents.map((r, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() =>
                          void analyze({ street: r.street, where: r.where, label: r.label, lat: r.lat, lng: r.lng })
                        }
                        className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-white/5"
                      >
                        <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]" aria-hidden />
                        <span className="min-w-0 truncate text-[12.5px] text-white">{r.label}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Locate me */}
            <button
              type="button"
              onClick={locateMe}
              title="Use my location"
              className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--color-border)] bg-black/70 text-[var(--color-muted-foreground)] shadow-lg backdrop-blur-md transition-colors hover:text-white"
            >
              <Navigation className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>

        {/* Bottom hint pill */}
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center">
          <div className="flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-black/70 px-4 py-2 text-[12px] text-[var(--color-muted-foreground)] shadow-lg backdrop-blur-md">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Navigation className="h-3.5 w-3.5" aria-hidden />}
            {busy ? "Analyzing address…" : "Click anywhere to analyze an address"}
          </div>
        </div>
      </div>

      {/* Right panel */}
      <aside className="flex w-[320px] shrink-0 flex-col overflow-y-auto border-l border-[var(--color-border)] bg-[#0b0b0b] md:w-[380px]">
        {error && (
          <div className="m-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-[12px] text-amber-300">
            {error}
          </div>
        )}

        {status !== "loaded" && !error && <EmptyOrLoading busy={busy} />}

        {status === "loaded" && result && active === null && (
          <ListView addr={summaryAddr} coords={coords} persons={persons} onOpen={setActive} found={result.found} />
        )}

        {status === "loaded" && result && active !== null && persons[active] && (
          <DetailView person={persons[active]} onBack={() => setActive(null)} />
        )}
      </aside>
    </div>
  )
}

function EmptyOrLoading({ busy }: { busy: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--color-border)] bg-white/[0.03]">
        {busy ? (
          <Loader2 className="h-5 w-5 animate-spin text-[var(--color-muted-foreground)]" aria-hidden />
        ) : (
          <MapPin className="h-6 w-6 text-[var(--color-muted-foreground)]" aria-hidden />
        )}
      </div>
      <p className="text-[15px] font-medium text-white">{busy ? "Analyzing…" : "Select a location"}</p>
      <p className="max-w-[16rem] text-[12.5px] leading-relaxed text-[var(--color-muted-foreground)]">
        {busy
          ? "Running a reverse lookup on this address."
          : "Click anywhere on the map or search for an address to run a reverse lookup and uncover associated records."}
      </p>
    </div>
  )
}

function ListView({
  addr,
  coords,
  persons,
  onOpen,
  found,
}: {
  addr: string
  coords: string
  persons: Person[]
  onOpen: (i: number) => void
  found: boolean
}) {
  return (
    <div className="flex flex-col">
      <div className="px-5 pt-5">
        <h2 className="text-[15px] font-semibold text-white">Address summary</h2>
        <div className="mt-3 rounded-xl border border-[var(--color-border)] bg-white/[0.02] p-4">
          <p className="text-[13px] leading-snug text-white">{addr || "Unknown address"}</p>
          {coords && <p className="mt-1.5 font-mono text-[11px] text-[var(--color-muted-foreground)]">{coords}</p>}
        </div>
      </div>

      <div className="px-5 pb-6 pt-5">
        <h3 className="mb-1 text-[14px] font-semibold text-white">
          {found ? `Persons found (${persons.length})` : "Persons found (0)"}
        </h3>
        {persons.length === 0 ? (
          <p className="py-6 text-center text-[12.5px] text-[var(--color-muted-foreground)]">
            No records linked to this address.
          </p>
        ) : (
          <div className="-mx-1">
            {persons.map((p, i) => {
              const nAddr = p.historicalAddresses.filter((h) => h.streetLine1).length
              const nPhone = p.phones.length
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => onOpen(i)}
                  className="group flex w-full items-center gap-3 rounded-lg px-1 py-3 text-left transition-colors hover:bg-white/5"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] bg-white/[0.03]">
                    <User className="h-4 w-4 text-[var(--color-muted-foreground)]" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-white">{p.name || "Unknown"}</span>
                    {(nPhone > 0 || nAddr > 0) && (
                      <span className="mt-0.5 block text-[11.5px] text-[var(--color-muted-foreground)]">
                        {[nPhone > 0 ? `${nPhone} phone${nPhone === 1 ? "" : "s"}` : null, nAddr > 0 ? `${nAddr} addr` : null]
                          .filter(Boolean)
                          .join("  ·  ")}
                      </span>
                    )}
                  </span>
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)] transition-colors group-hover:text-white"
                    aria-hidden
                  />
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function DetailView({ person, onBack }: { person: Person; onBack: () => void }) {
  const phones = person.phones
  const hist = person.historicalAddresses.filter((h) => h.streetLine1)
  return (
    <div className="flex flex-col px-5 py-5">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] text-[var(--color-muted-foreground)] transition-colors hover:text-white"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to results
      </button>

      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-sky-400/30 bg-sky-400/10">
          <User className="h-5 w-5 text-sky-300" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[16px] font-semibold text-white">{person.name || "Unknown"}</p>
          {person.ageRange && <p className="text-[11.5px] text-[var(--color-muted-foreground)]">age {person.ageRange}</p>}
        </div>
      </div>

      {phones.length > 0 && (
        <div className="mb-5">
          <h4 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)]">
            Phone numbers ({phones.length})
          </h4>
          <div className="space-y-1.5">
            {phones.map((p, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-white/[0.02] px-3 py-2.5"
              >
                <span className="inline-flex items-center gap-2 font-mono text-[12.5px] text-white">
                  <Phone className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" aria-hidden />
                  {fmtPhone(p.phoneNumber)}
                </span>
                {p.lineType && <span className="text-[11px] text-[var(--color-muted-foreground)]">{p.lineType}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {person.associatedPeople.length > 0 && (
        <div className="mb-5">
          <h4 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)]">
            Associated people ({person.associatedPeople.length})
          </h4>
          <div className="space-y-1.5">
            {person.associatedPeople.map((a, i) => (
              <div key={i} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-white/[0.02] px-3 py-2.5">
                <span className="truncate text-[12.5px] text-white">{a.name}</span>
                {a.relation && <span className="shrink-0 text-[11px] text-[var(--color-muted-foreground)]">{a.relation}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {hist.length > 0 && (
        <div>
          <h4 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)]">
            Address history ({hist.length})
          </h4>
          <div className="space-y-2">
            {hist.map((h, i) => {
              const line2 = [h.city, [h.stateCode, h.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ")
              const span = [h.since, h.until].filter(Boolean).join(" → ")
              return (
                <div key={i} className="rounded-lg border border-[var(--color-border)] bg-white/[0.02] p-3">
                  <div className="flex items-start gap-2">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]" aria-hidden />
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-medium text-white">
                        {[h.streetLine1, h.streetLine2].filter(Boolean).join(" ")}
                      </p>
                      {line2 && <p className="text-[11.5px] text-[var(--color-muted-foreground)]">{line2}</p>}
                      {span && <p className="mt-1 font-mono text-[10.5px] text-[var(--color-muted-foreground)]">{span}</p>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
