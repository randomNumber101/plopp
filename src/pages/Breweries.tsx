import { useState } from 'react'
import { breweryProgress } from '../api'
import { ErrorBox, Progress, Spinner, useAsync } from '../components'
import { go } from '../router'
import { STATES } from '../types'

export default function Breweries() {
  const data = useAsync(breweryProgress, [])
  const [q, setQ] = useState('')
  const [state, setState] = useState('')
  const [filter, setFilter] = useState<'beers' | 'all' | 'open' | 'started'>('beers')
  const [limit, setLimit] = useState(100)

  const list = (data.data ?? []).filter(
    (b) =>
      (!q || `${b.name} ${b.city ?? ''}`.toLowerCase().includes(q.toLowerCase())) &&
      (!state || b.state === state) &&
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
          <option value="beers">Mit Bieren im Katalog</option>
          <option value="all">Alle Brauereien</option>
          <option value="started">Schon probiert</option>
          <option value="open">Noch Biere offen</option>
        </select>
      </div>
      {data.loading && !data.data && <Spinner />}
      <ErrorBox msg={data.error} />
      {data.data?.length === 0 && <p className="empty">Noch keine Brauereien. Sie entstehen automatisch, wenn du Biere anlegst.</p>}
      <div className="list">
        {list.slice(0, limit).map((b) => (
          <button key={b.id} className="row" onClick={() => go(`/brewery/${b.id}`)}>
            <div className="thumb thumb-empty">🏭</div>
            <div className="row-main">
              <div className="row-title">{b.name}</div>
              <div className="row-sub">{[b.city, b.state].filter(Boolean).join(' · ') || b.country}</div>
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
