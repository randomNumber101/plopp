import { useState } from 'react'
import { breweryProgress } from '../api'
import { ErrorBox, Progress, Spinner, TrustDot, TrustLegend, useAsync } from '../components'
import { go } from '../router'
import { initials } from '../brewery'
import { BREWERY_TYPES, STATES, type BreweryType } from '../types'

export default function Breweries() {
  const data = useAsync(breweryProgress, [])
  const [q, setQ] = useState('')
  const [state, setState] = useState('')
  const [filter, setFilter] = useState<'beers' | 'all' | 'open' | 'started'>('beers')
  const [limit, setLimit] = useState(100)
  const [type, setType] = useState<'' | BreweryType>('')
  const [onlyVerified, setOnlyVerified] = useState(false)

  const list = (data.data ?? []).filter(
    (b) =>
      (!q || `${b.name} ${b.city ?? ''}`.toLowerCase().includes(q.toLowerCase())) &&
      (!state || b.state === state) &&
      (!type || b.brewery_type === type) &&
      (!onlyVerified || b.trust === 'verified') &&
      (filter === 'all' ||
        (filter === 'beers' ? b.total > 0 : filter === 'started' ? b.drunk > 0 : b.drunk < b.total)),
  )

  return (
    <div className="page">
      <h2>Brauereien</h2>
      <input className="search" placeholder="Brauerei oder Ort suchen …" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="two">
        <select value={state} onChange={(e) => setState(e.target.value)}>
          <option value="">Alle Bundesländer</option>
          {STATES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="beers">Mit Bieren</option>
          <option value="all">Alle Brauereien</option>
          <option value="started">Schon probiert</option>
          <option value="open">Noch Biere offen</option>
        </select>
      </div>
      <div className="two">
        <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
          <option value="">Alle Typen</option>
          {Object.entries(BREWERY_TYPES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <label className="check small">
          <input type="checkbox" checked={onlyVerified} onChange={(e) => setOnlyVerified(e.target.checked)} />
          Nur geprüfte
        </label>
      </div>
      <TrustLegend />
      {data.loading && !data.data && <Spinner />}
      <ErrorBox msg={data.error} />
      {data.data?.length === 0 && <p className="empty">Noch keine Brauereien. Sie entstehen automatisch, wenn du Biere anlegst.</p>}
      <div className="list">
        {list.slice(0, limit).map((b) => (
          <button
            key={b.id}
            className={`row ${b.trust === 'unverified' ? 'row-unverified' : ''}`}
            onClick={() => go(`/brewery/${b.id}`)}
          >
            {b.logo_url || b.image_url ? (
              <img
                className={`thumb ${b.logo_url ? 'thumb-logo' : ''}`}
                src={(b.logo_url || b.image_url)!}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="thumb thumb-empty thumb-ini">{initials(b.name)}</div>
            )}
            <div className="row-main">
              <div className="row-title">
                <TrustDot trust={b.trust} />
                {b.name}
              </div>
              <div className="row-sub">
                {[b.city, b.state, b.brewery_type && b.brewery_type !== 'brauerei' ? BREWERY_TYPES[b.brewery_type] : null]
                  .filter(Boolean)
                  .join(' · ') || b.country}
              </div>
            </div>
            <div className="row-right">
              <Progress drunk={b.drunk} total={b.total} />
            </div>
          </button>
        ))}
      </div>
      {list.length > limit && (
        <button className="btn" onClick={() => setLimit(limit + 200)}>
          Mehr anzeigen ({list.length - limit} weitere)
        </button>
      )}
      {data.data && <p className="muted small">{list.length} Brauereien</p>}
    </div>
  )
}
