/**
 * Bier-Regionen Deutschlands (Regierungsbezirke bzw. Länder, dazu bierreiche Städte/Gegenden wie Bamberger Land,
 * Allgäu oder München) – für „Karte freispielen“ und regionale Abzeichen.
 * Grenzen: © GeoBasis-DE / BKG 2020 (dl-de/by-2-0), vereinfacht – erzeugt mit scripts/build_regions.py.
 */
import type { BreweryProgress } from './types'

export interface Region {
  id: string
  name: string
  state: string
  /** [minLng, minLat, maxLng, maxLat] */
  bbox: [number, number, number, number]
  /** Polygone → Ringe → Punkte [lng, lat] */
  polys: number[][][][]
  geometry: GeoJSON.Geometry
}

let promise: Promise<Region[]> | null = null

export function loadRegions(): Promise<Region[]> {
  promise ??= fetch(`${import.meta.env.BASE_URL}regions-de.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`Regionen: HTTP ${r.status}`)
      return r.json()
    })
    .then((fc: GeoJSON.FeatureCollection) =>
      fc.features.map((f) => {
        const g = f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon
        const polys = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates) as number[][][][]
        let minX = 180,
          minY = 90,
          maxX = -180,
          maxY = -90
        for (const p of polys)
          for (const [x, y] of p[0]) {
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        const props = f.properties as { id: string; name: string; state: string }
        return { ...props, bbox: [minX, minY, maxX, maxY] as Region['bbox'], polys, geometry: f.geometry }
      }),
    )
    .catch((e) => {
      promise = null
      throw e
    })
  return promise
}

/** Punkt in Polygon (gerade/ungerade über alle Ringe – Löcher wie München in Oberbayern zählen richtig) */
function inPolys(polys: number[][][][], x: number, y: number): boolean {
  for (const rings of polys) {
    let inside = false
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]
        const [xj, yj] = ring[j]
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
      }
    }
    if (inside) return true
  }
  return false
}

const memo = new Map<string, string | null>()

export function regionAt(regions: Region[], lat: number | null | undefined, lng: number | null | undefined): Region | null {
  if (lat == null || lng == null) return null
  const k = `${lat.toFixed(4)},${lng.toFixed(4)}`
  if (memo.has(k)) {
    const id = memo.get(k)
    return id ? (regions.find((r) => r.id === id) ?? null) : null
  }
  const r =
    regions.find(
      (r) => lng >= r.bbox[0] && lng <= r.bbox[2] && lat >= r.bbox[1] && lat <= r.bbox[3] && inPolys(r.polys, lng, lat),
    ) ?? null
  memo.set(k, r?.id ?? null)
  return r
}

export interface RegionProgress {
  region: Region
  /** Brauereien mit Bieren im Katalog */
  breweries: number
  /** davon mindestens ein Bier probiert */
  visited: number
  beers: number
  drunk: number
}

/** Fortschritt je Region aus der Brauerei-Übersicht (brewery_progress) */
export function regionProgress(regions: Region[], list: BreweryProgress[]): RegionProgress[] {
  const out = new Map<string, RegionProgress>(
    regions.map((r) => [r.id, { region: r, breweries: 0, visited: 0, beers: 0, drunk: 0 }]),
  )
  for (const b of list) {
    if (b.total <= 0) continue
    const r = regionAt(regions, b.lat, b.lng)
    if (!r) continue
    const p = out.get(r.id)!
    p.breweries++
    p.beers += b.total
    p.drunk += b.drunk
    if (b.drunk > 0) p.visited++
  }
  return [...out.values()]
}
