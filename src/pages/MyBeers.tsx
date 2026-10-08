import { useMemo, useState } from 'react'
import { myCheckins, myWishlist } from '../api'
import { BeerRow, ErrorBox, Spinner, Stars, formatDate, useAsync } from '../components'
import { go } from '../router'
import type { Beer } from '../types'

interface Agg {
  beer: Beer
  count: number
  last: string
  avg: number | null
}

export default function MyBeers() {
  const [tab, setTab] = useState<'drunk' | 'wish'>('drunk')
  const checkins = useAsync(myCheckins, [])
  const wish = useAsync(myWishlist, [])
  const [q, setQ] = useState('')
  const [style, setStyle] = useState('')
  const [brewery, setBrewery] = useState('')

  const agg = useMemo<Agg[]>(() => {
    const map = new Map<string, Agg & { ratings: number[] }>()
    for (const c of checkins.data ?? []) {
      if (!c.beer) continue
      const a = map.get(c.beer_id) ?? { beer: c.beer, count: 0, last: c.drunk_at, avg: null, ratings: [] }
      a.count++
      if (c.drunk_at > a.last) a.last = c.drunk_at
      if (c.rating != null) a.ratings.push(c.rating)
      map.set(c.beer_id, a)
    }
    return [...map.values()]
      .map((a) => ({ ...a, avg: a.ratings.length ? a.ratings.reduce((s, r) => s + r, 0) / a.ratings.length : null }))
      .sort((x, y) => (x.last < y.last ? 1 : -1))
  }, [checkins.data])

  const styles = useMemo(() => [...new Set(agg.map((a) => a.beer.style).filter(Boolean))].sort() as string[], [agg])
  const breweries = useMemo(
    () => [...new Set(agg.map((a) => a.beer.brewery?.name).filter(Boolean))].sort() as string[],
    [agg],
  )

  const filtered = agg.filter(
    (a) =>
      (!q || `${a.beer.name} ${a.beer.brewery?.name ?? ''}`.toLowerCase().includes(q.toLowerCase())) &&
      (!style || a.beer.style === style) &&
      (!brewery || a.beer.brewery?.name === brewery),
  )

  const total = checkins.data?.length ?? 0

  return (
    <div className="page">
      <div className="stat-row">
        <div className="stat">
          <b>{agg.length}</b>
          <span>Biere</span>
        </div>
        <div className="stat">
          <b>{breweries.length}</b>
          <span>Brauereien</span>
        </div>
        <div className="stat">
          <b>{total}</b>
          <span>Check-ins</span>
        </div>
      </div>

      <div className="tabs">
        <button className={tab === 'drunk' ? 'on' : ''} onClick={() => setTab('drunk')}>
          Getrunken
        </button>
        <button className={tab === 'wish' ? 'on' : ''} onClick={() => setTab('wish')}>
          Merkliste {wish.data?.length ? `(${wish.data.length})` : ''}
        </button>
      </div>

      {tab === 'drunk' && (
        <>
          <input className="search" placeholder="Suchen …" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="two">
            <select value={style} onChange={(e) => setStyle(e.target.value)}>
              <option value="">Alle Sorten</option>
              {styles.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <select value={brewery} onChange={(e) => setBrewery(e.target.value)}>
              <option value="">Alle Brauereien</option>
              {breweries.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          {checkins.loading && !checkins.data && <Spinner />}
          <ErrorBox msg={checkins.error} />
          {checkins.data && agg.length === 0 && (
            <div className="empty">
              <p>Noch keine Biere eingetragen.</p>
              <button className="btn btn-primary" onClick={() => go('/scan')}>
                📷 Erstes Bier scannen
              </button>
            </div>
          )}
          <div className="list">
            {filtered.map((a) => (
              <BeerRow
                key={a.beer.id}
                beer={a.beer}
                right={
                  <>
                    <span className="count">{a.count}×</span>
                    {a.avg != null && <Stars value={Math.round(a.avg)} size="sm" />}
                  </>
                }
                sub={`${a.beer.brewery?.name ?? ''}${a.beer.style ? ` · ${a.beer.style}` : ''} · ${formatDate(a.last)}`}
              />
            ))}
          </div>
        </>
      )}

      {tab === 'wish' && (
        <div className="list">
          {wish.loading && !wish.data && <Spinner />}
          {wish.data?.length === 0 && <p className="empty">Merkliste ist leer. Setze Biere im Katalog oder auf Brauerei-Seiten auf die Merkliste.</p>}
          {wish.data?.map((b) => <BeerRow key={b.id} beer={b} />)}
        </div>
      )}
    </div>
  )
}
