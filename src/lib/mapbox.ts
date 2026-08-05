/**
 * The public Mapbox token, stashed once the overview loads so the Address
 * Insights map (rendered deep inside a module Result, far from the overview)
 * can reach it without threading a prop through the whole module layer.
 *
 * Public by design: a Mapbox `pk.` token is meant to live in client code. Null
 * until the server ships it, in which case the screen falls back to the static
 * still.
 */
let token: string | null = null

export function setMapboxToken(next: string | null | undefined): void {
  token = next ?? null
}

export function getMapboxToken(): string | null {
  return token
}
