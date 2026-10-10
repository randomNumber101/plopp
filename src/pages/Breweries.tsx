import { breweryProgress, hiddenBreweries, unhideBreweries } from '../api'
import {
  ChipBar,
  EmptyState,
  ErrorBox,
  Progress,
  SearchInput,
  SkeletonList,
  TrustDot,
  TrustLegend,
  toast,
  useAsync,
} from '../components'
import { load, save, haptic } from '../ui/fx'
import { go } from '../router'
import { usePageState } from '../pageState'
import { initials } from '../brewery'
import { BREWERY_HIDE_REASONS, BREWERY_TYPES, STATES, type BreweryType } from '../types'

type Filter = 'beers' | 'all' | 'open' | 'started' | 'hidden'

export default function Breweries() {
  const data = useAsync(breweryProgress, [], 'brewery_progress')
  const prefs = load('bier-breweries', { state: '', filter: 'beers' })
  // Suche & Filter bleiben erhalten, wenn man eine Brauerei öffnet und zurückkommt
  const [q, setQ] = usePageState('breweries-q', '')
  const [state, setStateRaw] = usePageState('breweries-state', prefs.state)
  const [filter, setFilterRaw] = usePageState<Filter>('breweries-filter', prefs.filter as Filter)
  const setState = (v: string) => (setStateRaw(v), save('bier-breweries', { state: v, filter }))
  const setFilter = (v: Filter) => (
    setFilterRaw(v), save('bier-breweries', { state, filter: v === 'hidden' ? 'beers' : v })
  )
  const [limit, setLimit] = usePageState('breweries-limit', 100)
  const [type, setType] = usePageState<'' | BreweryType>('breweries-type', '')
  const [onlyVerified, setOnlyVerified] = usePageState('breweries-verified', false)
  const hidden = useAsync(() => (filter === 'hidden' ? hiddenBreweries() : Promise.resolve([])), [filter])

  const term = q.trim().toLowerCase()
  const list = (data.data ?? []).filter(
    (b) =>
      (!term || `${b.name} ${b.city ?? ''}`.toLowerCase().includes(term)) &&
      (!state || b.state === state) &&
      (!type || b.brewery_type === type) &&
      (!onlyVerified || b.trust === 'verified') &&
      (filter === 'all' ||
        (filter === 'beers' ? b.total > 0 : filter === 'started' ? b.drunk > 0 : b.drunk < b.total)),
  )
  const hiddenList = (hidden.data ?? []).filter(
    (b) => (!term || `${b.name} ${b.city ?? ''}`.toLowerCase().includes(term)) && (!state || b.state === state),
  )

  return (
    <div className="page">
      <h2>Brauereien</h2>
      <SearchInput value={q} onChange={setQ} placeholder="Brauerei oder Ort suchen …" />
      <ChipBar
        value={filter}
        onChange={(v) => {
          setFilter((v || 'beers') as Filter)
          setLimit(100)
        }}
        options={[
          { id: 'beers', label: 'Mit Bieren' },
          { id: 'started', label: 'Probiert' },
          { id: 'open', label: 'Noch offen' },
          { id: 'all', label: 'Alle' },
          { id: 'hidden', label: 'Ausgeblendet' },
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

      {filter === 'hidden' ? (
        <>
          <p className="muted small">
            Ausgeblendete Brauereien erscheinen für dich und deine Runde nicht in Listen, Karte und Suche.
          </p>
          {hidden.loading && !hidden.data && <SkeletonList rows={3} />}
          <ErrorBox msg={hidden.error} />
          {hidden.data && hiddenList.length === 0 && (
            <EmptyState icon="🙈" title="Nichts ausgeblendet">
              <p>Auf einer Brauerei-Seite ganz unten: „Keine Brauerei? Ausblenden“.</p>
            </EmptyState>
          )}
          <div className="list list-hidden">
            {hiddenList.map((b, i) => (
              <div key={b.id} className="row" style={{ '--i': i % 20 } as React.CSSProperties}>
                <button className="row-main row-link" onClick={() => go(`/brewery/${b.id}`)}>
                  <div className="row-title">{b.name}</div>
                  <div className="row-sub">
                    {[b.city, b.hidden_reason ? (BREWERY_HIDE_REASONS[b.hidden_reason] ?? b.hidden_reason) : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </button>
                <button
                  className="btn btn-small"
                  onClick={async () => {
                    haptic()
                    hidden.setData((hidden.data ?? []).filter((x) => x.id !== b.id))
                    await unhideBreweries([b.id])
                    toast({ icon: '👀', msg: `${b.name} wieder eingeblendet` })
                    data.reload()
                  }}
                >
                  Einblenden
                </button>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
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
        </>
      )}
    </div>
  )
}
