import { useEffect, useRef } from "react"
import "mapbox-gl/dist/mapbox-gl.css"

/**
 * The interactive Mapbox canvas, the desktop's answer to the web's Address
 * Insights map. The library is BUNDLED (no remote script) but dynamically
 * imported, so its ~1.9 MB only loads the first time a map is shown rather than
 * on every app launch; the strict CSP is opened only to Mapbox's own
 * tile/style/telemetry hosts and blob workers.
 *
 * A dark style to match the app, a single marker on the point, standard pan/zoom
 * controls, torn down on unmount so a new lookup never stacks maps.
 */
export function MapView({
  token,
  latitude,
  longitude,
  className,
}: {
  token: string
  latitude: number
  longitude: number
  className?: string
}) {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!container.current) return
    let map: import("mapbox-gl").Map | undefined
    let cancelled = false

    void import("mapbox-gl").then(({ default: mapboxgl }) => {
      if (cancelled || !container.current) return
      mapboxgl.accessToken = token
      map = new mapboxgl.Map({
        container: container.current,
        style: "mapbox://styles/mapbox/dark-v11",
        center: [longitude, latitude],
        zoom: 15,
        attributionControl: true,
      })
      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right")
      new mapboxgl.Marker({ color: "#ffffff" }).setLngLat([longitude, latitude]).addTo(map)
    })

    return () => {
      cancelled = true
      map?.remove()
    }
  }, [token, latitude, longitude])

  return <div ref={container} className={className} />
}
