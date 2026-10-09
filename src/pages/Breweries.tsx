import { useState } from 'react'
import { breweryProgress } from '../api'
import { ChipBar, EmptyState, ErrorBox, Progress, SearchInput, SkeletonList, TrustDot, TrustLegend, useAsync } from '../components'
import { load, save } from '../ui/fx'
import { go } from '../router'
import { initials } from '../brewery'
import { BREWERY_TYPES, STATES, type BreweryType } from '../types'

export default function Breweries() {
  const data = useAsync(breweryProgress, [])
  const prefs = load('bier-breweries', { state: '', filter: 'beers' })
  const [q, setQ] = useState('')
  const [state, setStateRaw] = useState(prefs.state)
  const [filter, setFilterRaw] = useState<'beers' | 'all' | 'open' | 'started'>(prefs.filter as 'beers')
  const setState = (v: string) => (setStateRaw(v), save('bier-breweries', { state: v, filter }))
  const setFilter = (v: typeof filter) => (setFilterRaw(v), save('bier-breweries', { state, filter: v }))
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
      <SearchInput value={q} onChange={setQ} placeholder="Brauerei oder Ort suchen …" />
      <ChipBar
        value={filter}
        onChange={(v) => setFilter((v || 'beers') as typeof filter)}
        options={[
          { id: 'beers', label: 'Mit Bieren' },
          { id: 'started', label: 'Probiert' },
          { id: 'open', label: 'Noch offen' },
          { id: 'all', label: 'Alle' },
        ]}
      />
      <div className="two">
        <select value={state} onChange={(e) => setState(e.target.value)}>
          <option value="">Alle Bundesländer</option>
          {STATES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
          <option value="">Alle Typen</option>
          {Object.entries(BREWERY_TYPES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <TrustLegend />
      <label className="check small">
        <input type="checkbox" checked={onlyVerified} onChange={(e) => setOnlyVerified(e.target.checked)} />
        Nur geprüfte (Wikipedia-Liste)
      </label>
      {data.loading && !data.data && <SkeletonList rows={8} />}
      <ErrorBox msg={data.error} />
      {data.data && list.length === 0 && (
        <EmptyState icon="🏭" title="Keine Brauerei gefunden">
          <p>Filter ändern oder Suchbegriff kürzen.</p>
        </EmptyState>
      )}
      <div className="list">
        {list.slice(0, limit).map((b, i) => (
          <button
            key={b.id}
            style={{ '--i': i % 20 } as React.CSSProperties}
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
