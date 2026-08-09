import { useEffect, useRef } from "react"
import "mapbox-gl/dist/mapbox-gl.css"

/**
 * Full-bleed, pitched 3D Mapbox map for Address Insights - the app port of the
 * web's address-map. A dark map with extruded 3D buildings, a single pin at the
 * searched address, and click-anywhere-to-analyze (reverse geocode -> callback).
 *
 * mapbox-gl touches `window` at import time, so it's imported dynamically inside
 * the effect; the stylesheet is a plain static import. The desktop CSP allows
 * api.mapbox.com (tiles + geocoding) and events.mapbox.com (telemetry), so both
 * the canvas and the reverse-geocode fetch below work under it.
 */

export type PickInfo = { street: string; where: string; label: string; lat: number; lng: number }

export function AddressMap({
  token,
  point,
  onPick,
  busy,
}: {
  token: string
  point: { lat: number; lng: number } | null
  onPick: (info: PickInfo) => void
  busy: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<import("mapbox-gl").Map | null>(null)
  const markerRef = useRef<import("mapbox-gl").Marker | null>(null)
  const mapboxRef = useRef<typeof import("mapbox-gl") | null>(null)
  const pickRef = useRef(onPick)
  const busyRef = useRef(busy)
  pickRef.current = onPick
  busyRef.current = busy

  // Build the map once.
  useEffect(() => {
    if (!token || !ref.current) return
    let cancelled = false
    void (async () => {
      const mapboxgl = (await import("mapbox-gl")).default
      if (cancelled || !ref.current) return
      mapboxRef.current = mapboxgl as unknown as typeof import("mapbox-gl")
      mapboxgl.accessToken = token
      const map = new mapboxgl.Map({
        container: ref.current,
        style: "mapbox://styles/mapbox/dark-v11",
        center: point ? [point.lng, point.lat] : [-98.5, 39.5],
        zoom: point ? 16.5 : 3.4,
        pitch: point ? 45 : 0,
        bearing: point ? -14 : 0,
        antialias: false,
        fadeDuration: 0,
        refreshExpiredTiles: false,
        attributionControl: false,
      })
      map.setMaxPitch(60)
      mapRef.current = map

      map.on("load", () => {
        const layers = map.getStyle().layers ?? []
        const labelLayer = layers.find(
          (l) => l.type === "symbol" && (l.layout as Record<string, unknown> | undefined)?.["text-field"],
        )
        try {
          map.addLayer(
            {
              id: "3d-buildings",
              source: "composite",
              "source-layer": "building",
              filter: ["==", "extrude", "true"],
              type: "fill-extrusion",
              minzoom: 14,
              paint: {
                "fill-extrusion-color": "#3a3a5c",
                "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 14, 0, 16, ["get", "height"]],
                "fill-extrusion-base": ["get", "min_height"],
                "fill-extrusion-opacity": 1,
              },
            },
            labelLayer?.id,
          )
        } catch {
          /* style may not expose the composite building layer - non-fatal */
        }
        if (point) placeMarker(point.lng, point.lat)
      })

      map.getCanvas().style.cursor = "crosshair"
      map.on("click", async (e) => {
        if (busyRef.current) return
        const { lng, lat } = e.lngLat
        try {
          const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?types=address&limit=1&access_token=${token}`
          const res = await fetch(url)
          const json = await res.json()
          const info = featureToPick(json?.features?.[0])
          if (info && !busyRef.current) pickRef.current(info)
        } catch {
          /* click on unaddressed space -> no-op */
        }
      })
    })()
    return () => {
      cancelled = true
      markerRef.current?.remove()
      markerRef.current = null
      mapRef.current?.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  // Fly to / drop the pin whenever the selected point changes.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !point) return
    const go = () => {
      map.flyTo({ center: [point.lng, point.lat], zoom: 16.5, pitch: 45, bearing: -14, duration: 1100, essential: true })
      placeMarker(point.lng, point.lat)
    }
    if (map.isStyleLoaded()) go()
    else map.once("load", go)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [point?.lat, point?.lng])

  function placeMarker(lng: number, lat: number) {
    const mapboxgl = mapboxRef.current
    const map = mapRef.current
    if (!mapboxgl || !map) return
    markerRef.current?.remove()
    const el = document.createElement("div")
    el.innerHTML = PIN_SVG
    el.style.cssText = "width:34px;height:44px;filter:drop-shadow(0 4px 8px rgba(0,0,0,.55))"
    markerRef.current = new mapboxgl.Marker({ element: el, anchor: "bottom" }).setLngLat([lng, lat]).addTo(map)
  }

  if (!token) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-white/[0.02] text-sm text-[var(--color-muted-foreground)]">
        Map token not configured.
      </div>
    )
  }
  return <div ref={ref} className="h-full w-full" />
}

/** Derive `{street, where, label}` from a Mapbox `address` feature. */
export function featureToPick(f: unknown): PickInfo | null {
  const feat = f as Record<string, unknown> | null
  if (!feat || !Array.isArray(feat.center)) return null
  const houseNo = typeof feat.address === "string" ? feat.address : ""
  const streetName = typeof feat.text === "string" ? feat.text : ""
  const street = [houseNo, streetName].filter(Boolean).join(" ").trim()
  const ctx = Array.isArray(feat.context) ? (feat.context as Record<string, unknown>[]) : []
  const find = (p: string) => ctx.find((c) => typeof c?.id === "string" && (c.id as string).startsWith(p))
  const city = (find("place")?.text as string) ?? (find("locality")?.text as string) ?? ""
  const region = find("region")
  const sc = typeof region?.short_code === "string" ? (region.short_code as string) : ""
  const state = sc.toUpperCase().startsWith("US-") ? sc.slice(3) : ((region?.text as string) ?? "")
  const zip = (find("postcode")?.text as string) ?? ""
  const country = (find("country")?.text as string) ?? ""
  const where = [city, [state, zip].filter(Boolean).join(" "), country].filter(Boolean).join(", ").trim()
  if (!street || !where) return null
  const center = feat.center as number[]
  return {
    street,
    where,
    label: typeof feat.place_name === "string" ? feat.place_name : `${street}, ${where}`,
    lat: center[1],
    lng: center[0],
  }
}

// A rounded teardrop pin with a light ring, matching the web marker.
const PIN_SVG = `<svg viewBox="0 0 34 44" width="34" height="44" xmlns="http://www.w3.org/2000/svg">
<path d="M17 1C8.7 1 2 7.7 2 16c0 10.5 13 25.5 14.1 26.7.5.5 1.3.5 1.8 0C19 41.5 32 26.5 32 16 32 7.7 25.3 1 17 1Z" fill="#e5e7eb" stroke="#0a0a0f" stroke-width="1.5"/>
<circle cx="17" cy="16" r="6.5" fill="#0a0a0f"/>
<circle cx="17" cy="16" r="2.4" fill="#e5e7eb"/>
</svg>`
