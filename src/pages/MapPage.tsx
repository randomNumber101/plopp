import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { breweryProgress } from '../api'
import { ErrorBox, useAsync } from '../components'

const COLORS = { none: '#a8a29e', some: '#f59e0b', all: '#16a34a' }

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

export default function MapPage() {
  const data = useAsync(breweryProgress, [])
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!el.current || map.current) return
    map.current = L.map(el.current, { zoomControl: true, preferCanvas: true }).setView([51.1, 10.4], 6)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap-Mitwirkende',
    }).addTo(map.current)
    layer.current = L.layerGroup().addTo(map.current)
    return () => {
      map.current?.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    if (!layer.current || !data.data) return
    layer.current.clearLayers()
    const pts: L.LatLngExpression[] = []
    for (const b of data.data) {
      if (b.lat == null || b.lng == null) continue
      const kind = b.drunk === 0 ? 'none' : b.drunk >= b.total ? 'all' : 'some'
      const m = L.circleMarker([b.lat, b.lng], {
        radius: b.total === 0 ? 4 : 6 + Math.min(6, Math.round(b.total / 3)),
        color: '#1c1917',
        weight: 1,
        fillColor: COLORS[kind],
        fillOpacity: b.total === 0 ? 0.5 : 0.9,
      })
      m.bindPopup(
        `<b>${escapeHtml(b.name)}</b><br>${escapeHtml(b.city ?? '')}<br>` +
          `${b.total ? `${b.drunk} von ${b.total} Bieren probiert` : 'Noch keine Biere im Katalog'}<br><a href="#/brewery/${b.id}">Sortiment ansehen →</a>`,
      )
      m.addTo(layer.current)
      pts.push([b.lat, b.lng])
    }
    if (pts.length > 1) map.current?.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 9 })
    else if (pts.length === 1) map.current?.setView(pts[0], 9)
  }, [data.data])

  const missing = data.data?.filter((b) => b.lat == null).length ?? 0

  return (
    <div className="page page-map">
      <div ref={el} className="map" />
      <div className="legend">
        <span>
          <i style={{ background: COLORS.all }} /> alles probiert
        </span>
        <span>
          <i style={{ background: COLORS.some }} /> teilweise
        </span>
        <span>
          <i style={{ background: COLORS.none }} /> noch nichts
        </span>
      </div>
      {missing > 0 && <p className="muted small">{missing} Brauerei(en) ohne Standort werden nicht angezeigt.</p>}
      <ErrorBox msg={data.error} />
    </div>
  )
}
