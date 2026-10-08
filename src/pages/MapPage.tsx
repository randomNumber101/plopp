import { useEffect, useMemo, useRef, useState } from 'react'
import L from '../leaflet'
import 'leaflet.markercluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import { beersOfBrewery, breweryProgress, drunkBeerIds, setWishlist, wishlistIds } from '../api'
import { BeerRow, ErrorBox, Progress, Spinner, TrustBadge, useAsync } from '../components'
import { go } from '../router'
import { setPrefill } from '../store'
import { BREWERY_TYPES, type BreweryProgress } from '../types'
import { initials } from '../brewery'

type Filter = 'beers' | 'drunk' | 'open' | 'wish' | 'all'

const FILTERS: { id: Filter; label: string; test: (b: BreweryProgress) => boolean }[] = [
  { id: 'beers', label: 'Mit Bieren', test: (b) => b.total > 0 },
  { id: 'drunk', label: 'Probiert', test: (b) => b.drunk > 0 },
  { id: 'open', label: 'Noch offen', test: (b) => b.total > 0 && b.drunk < b.total },
  { id: 'wish', label: 'Merkliste', test: (b) => (b.wished ?? 0) > 0 },
  { id: 'all', label: 'Alle', test: () => true },
]

const VIEW_KEY = 'bier-map-view'
const VERIFIED_KEY = 'bier-map-verified'

function loadView(): { lat: number; lng: number; zoom: number; filter: Filter } | null {
  try {
    const v = sessionStorage.getItem(VIEW_KEY)
    return v ? JSON.parse(v) : null
  } catch {
    return null
  }
}

function saveView(v: { lat: number; lng: number; zoom: number; filter: Filter }) {
  try {
    sessionStorage.setItem(VIEW_KEY, JSON.stringify(v))
  } catch {
    /* egal */
  }
}

function status(b: BreweryProgress) {
  if (b.total > 0 && b.drunk >= b.total) return 'all'
  if (b.drunk > 0) return 'some'
  if ((b.wished ?? 0) > 0) return 'wish'
  return b.total > 0 ? 'none' : 'empty'
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function pinIcon(b: BreweryProgress, selected: boolean) {
  const img = b.logo_url || b.image_url
  const cls = `bpin st-${status(b)} tr-${b.trust ?? 'user'}${b.logo_url ? ' has-logo' : ''}${selected ? ' selected' : ''}`
  const badge = b.drunk > 0 ? `<b class="bpin-badge">${b.drunk >= b.total ? '✓' : b.drunk}</b>` : ''
  return L.divIcon({
    className: 'bpin-wrap',
    html:
      `<div class="${cls}"><span class="bpin-ini">${esc(initials(b.name))}</span>` +
      (img ? `<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : '') +
      `${badge}</div>`,
    iconSize: [42, 42],
    iconAnchor: [21, 21],
  })
}

type PinMarker = L.Marker & { brewery: BreweryProgress }

function clusterIcon(cluster: L.MarkerCluster) {
  const ms = cluster.getAllChildMarkers() as PinMarker[]
  const tried = ms.filter((m) => m.brewery.drunk > 0).length
  const pct = Math.round((tried / ms.length) * 100)
  return L.divIcon({
    className: 'bcluster-wrap',
    html:
      `<div class="bcluster" style="--p:${pct}%"><span>${ms.length}</span></div>`,
    iconSize: [46, 46],
    iconAnchor: [23, 23],
  })
}

export default function MapPage() {
  const data = useAsync(breweryProgress, [])
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const cluster = useRef<L.MarkerClusterGroup | null>(null)
  const markers = useRef(new Map<string, PinMarker>())
  const meDot = useRef<L.CircleMarker | null>(null)
  const initial = useMemo(loadView, [])
  const [filter, setFilter] = useState<Filter>(initial?.filter ?? 'beers')
  const [selected, setSelected] = useState<BreweryProgress | null>(null)
  const [onlyVerified, setOnlyVerified] = useState(() => {
    try {
      return sessionStorage.getItem(VERIFIED_KEY) === '1'
    } catch {
      return false
    }
  })
  const [q, setQ] = useState('')
  const [locError, setLocError] = useState<string | null>(null)
  const fitted = useRef(!!initial)
  const lastFilter = useRef(`${filter}${onlyVerified}`)

  // Karte einmalig anlegen
  useEffect(() => {
    if (!el.current || map.current) return
    const m = L.map(el.current, { zoomControl: false, attributionControl: true })
    if (initial) m.setView([initial.lat, initial.lng], initial.zoom)
    else m.setView([51.1, 10.4], 6)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap',
    }).addTo(m)
    cluster.current = L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 48,
      disableClusteringAtZoom: 12,
      spiderfyOnMaxZoom: true,
      chunkedLoading: true,
      iconCreateFunction: clusterIcon,
    }).addTo(m)
    m.on('click', () => setSelected(null))
    map.current = m
    return () => {
      m.remove()
      map.current = null
      markers.current.clear()
    }
  }, [initial])

  // Ansicht merken (für „Zurück“ von einer Brauerei-Seite)
  useEffect(() => {
    const m = map.current
    if (!m) return
    const save = () => {
      const c = m.getCenter()
      saveView({ lat: c.lat, lng: c.lng, zoom: m.getZoom(), filter })
    }
    save()
    m.on('moveend', save)
    return () => {
      m.off('moveend', save)
    }
  }, [filter])

  const counts = useMemo(() => {
    const all = (data.data ?? []).filter((b) => b.lat != null && b.lng != null)
    return Object.fromEntries(FILTERS.map((f) => [f.id, all.filter(f.test).length])) as Record<Filter, number>
  }, [data.data])

  // Marker zeichnen
  useEffect(() => {
    const c = cluster.current
    if (!c || !data.data) return
    c.clearLayers()
    markers.current.clear()
    const test = FILTERS.find((f) => f.id === filter)!.test
    try {
      sessionStorage.setItem(VERIFIED_KEY, onlyVerified ? '1' : '0')
    } catch {
      /* egal */
    }
    const list: PinMarker[] = []
    for (const b of data.data) {
      if (b.lat == null || b.lng == null || !test(b)) continue
      if (onlyVerified && b.trust && b.trust !== 'verified' && b.trust !== 'user') continue
      const mk = L.marker([b.lat, b.lng], { icon: pinIcon(b, false), title: b.name }) as PinMarker
      mk.brewery = b
      mk.on('click', () => setSelected(b))
      markers.current.set(b.id, mk)
      list.push(mk)
    }
    c.addLayers(list)
    // Beim ersten Laden und nach Filterwechsel auf die sichtbaren Brauereien zoomen
    const filterChanged = lastFilter.current !== `${filter}${onlyVerified}`
    lastFilter.current = `${filter}${onlyVerified}`
    if ((!fitted.current || filterChanged) && list.length) {
      fitted.current = true
      map.current?.fitBounds(c.getBounds(), { padding: [40, 40], maxZoom: 10 })
    }
  }, [data.data, filter, onlyVerified])

  // Auswahl hervorheben
  useEffect(() => {
    if (!selected) return
    const mk = markers.current.get(selected.id)
    if (!mk) return
    mk.setIcon(pinIcon(selected, true))
    mk.setZIndexOffset(1000)
    return () => {
      mk.setIcon(pinIcon(selected, false))
      mk.setZIndexOffset(0)
    }
  }, [selected])

  const results = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (s.length < 2 || !data.data) return []
    return data.data
      .filter((b) => b.lat != null && `${b.name} ${b.city ?? ''}`.toLowerCase().includes(s))
      .sort((a, b) => b.total - a.total)
      .slice(0, 6)
  }, [q, data.data])

  function focus(b: BreweryProgress) {
    setQ('')
    if (!FILTERS.find((f) => f.id === filter)!.test(b)) setFilter('all')
    setSelected(b)
    if (b.lat != null && b.lng != null) map.current?.flyTo([b.lat, b.lng], Math.max(map.current.getZoom(), 13), { duration: 0.6 })
  }

  function locate() {
    setLocError(null)
    if (!navigator.geolocation) return setLocError('Standort wird nicht unterstützt.')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const ll: L.LatLngExpression = [pos.coords.latitude, pos.coords.longitude]
        const m = map.current
        if (!m) return
        meDot.current?.remove()
        meDot.current = L.circleMarker(ll, { radius: 8, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }).addTo(m)
        m.flyTo(ll, 11, { duration: 0.8 })
      },
      () => setLocError('Standort nicht verfügbar – bitte Zugriff erlauben.'),
      { enableHighAccuracy: false, timeout: 10000 },
    )
  }

  function showAll() {
    const c = cluster.current
    if (c && c.getLayers().length) map.current?.fitBounds(c.getBounds(), { padding: [40, 40], maxZoom: 10 })
  }

  const missing = data.data?.filter((b) => b.lat == null && b.total > 0).length ?? 0

  return (
    <div className="mapview">
      <div ref={el} className="mapview-map" />

      <div className="map-top">
        <div className="map-search">
          <input
            className="search"
            placeholder="🔎 Brauerei oder Ort finden …"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {results.length > 0 && (
            <div className="suggest map-suggest">
              {results.map((b) => (
                <button key={b.id} onClick={() => focus(b)}>
                  {b.name}
                  <span className="muted">
                    {b.city ? ` · ${b.city}` : ''}
                    {b.total ? ` · ${b.drunk}/${b.total}` : ''}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="chips">
          <button
            className={`chip-btn ${onlyVerified ? 'on' : ''}`}
            onClick={() => setOnlyVerified(!onlyVerified)}
            title="Nur Brauereien aus der Wikipedia-Liste"
          >
            ✓ Nur geprüfte
          </button>
          {FILTERS.map((f) => (
            <button key={f.id} className={`chip-btn ${filter === f.id ? 'on' : ''}`} onClick={() => setFilter(f.id)}>
              {f.label} <span className="chip-count">{counts[f.id] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="map-tools">
        <button className="map-tool" onClick={() => map.current?.zoomIn()} aria-label="Hineinzoomen">
          +
        </button>
        <button className="map-tool" onClick={() => map.current?.zoomOut()} aria-label="Herauszoomen">
          −
        </button>
        <button className="map-tool" onClick={locate} aria-label="Mein Standort" title="Mein Standort">
          ◎
        </button>
        <button className="map-tool" onClick={showAll} aria-label="Alle zeigen" title="Alle zeigen">
          ⤢
        </button>
      </div>

      {data.loading && !data.data && (
        <div className="map-loading">
          <Spinner />
        </div>
      )}
      {(data.error || locError) && (
        <div className="map-msg">
          <ErrorBox msg={data.error ?? locError} />
        </div>
      )}

      {selected ? (
        <BrewerySheet b={selected} onClose={() => setSelected(null)} />
      ) : (
        <div className="map-legend">
          <span>
            <i className="lg lg-all" /> alles probiert
          </span>
          <span>
            <i className="lg lg-some" /> teilweise
          </span>
          <span>
            <i className="lg lg-none" /> offen
          </span>
          <span>
            <i className="lg lg-unverified" /> ungeprüft
          </span>
          {missing > 0 && <span className="muted">· {missing} ohne Standort</span>}
        </div>
      )}
    </div>
  )
}

function BrewerySheet({ b, onClose }: { b: BreweryProgress; onClose: () => void }) {
  const beers = useAsync(() => beersOfBrewery(b.id), [b.id])
  const drunk = useAsync(drunkBeerIds, [b.id])
  const wish = useAsync(wishlistIds, [b.id])
  const list = beers.data ?? []
  const drunkSet = drunk.data ?? new Set<string>()
  const wishSet = wish.data ?? new Set<string>()
  // Offene Biere zuerst – das ist meistens interessanter
  const sorted = [...list].sort((x, y) => Number(drunkSet.has(x.id)) - Number(drunkSet.has(y.id)))
  const img = b.logo_url || b.image_url

  return (
    <div className="sheet" role="dialog" aria-label={b.name}>
      <div className="sheet-handle" />
      <div className="sheet-head">
        <div className={`bpin st-${status(b)} sheet-logo`}>
          <span className="bpin-ini">{initials(b.name)}</span>
          {img && (
            <img
              src={img}
              alt=""
              referrerPolicy="no-referrer"
              onError={(e) => e.currentTarget.remove()}
            />
          )}
        </div>
        <div className="sheet-title">
          <b>{b.name}</b>
          <span className="muted small">
            {[b.city, b.state, b.brewery_type && b.brewery_type !== 'brauerei' ? BREWERY_TYPES[b.brewery_type] : null]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
        <button className="sheet-close" onClick={onClose} aria-label="Schließen">
          ×
        </button>
      </div>
      <div className="badge-row">
        <TrustBadge trust={b.trust} detail={b.trust === 'verified' ? 'Wikipedia-Liste' : undefined} />
      </div>
      {b.total > 0 && <Progress drunk={b.drunk} total={b.total} />}
      <div className="sheet-list">
        {beers.loading && !beers.data && <Spinner />}
        {beers.data && list.length === 0 && <p className="muted small">Noch keine Biere dieser Brauerei im Katalog.</p>}
        {sorted.slice(0, 6).map((beer) => (
          <BeerRow
            key={beer.id}
            beer={beer}
            sub={[beer.style, beer.abv != null ? `${beer.abv} %` : null].filter(Boolean).join(' · ')}
            right={
              drunkSet.has(beer.id) ? (
                <span className="badge ok">✓</span>
              ) : (
                <span
                  role="button"
                  className={`badge ${wishSet.has(beer.id) ? 'wish' : ''}`}
                  title="Merken"
                  onClick={async (e) => {
                    e.stopPropagation()
                    await setWishlist(beer.id, !wishSet.has(beer.id))
                    wish.reload()
                  }}
                >
                  {wishSet.has(beer.id) ? '★' : '☆'}
                </span>
              )
            }
          />
        ))}
      </div>
      <div className="btn-row">
        <button className="btn btn-primary" onClick={() => go(`/brewery/${b.id}`)}>
          {list.length > 6 ? `Alle ${list.length} Biere` : 'Zur Brauerei'} →
        </button>
        {list.length === 0 && (
          <button
            className="btn"
            onClick={() => {
              setPrefill({ breweryId: b.id })
              go('/new')
            }}
          >
            + Bier
          </button>
        )}
      </div>
    </div>
  )
}
