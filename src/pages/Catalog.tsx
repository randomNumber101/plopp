import { useEffect, useState } from 'react'
import { drunkBeerIds, searchBeers } from '../api'
import { BeerRow, EmptyState, ErrorBox, SearchInput, SkeletonList, TrustLegend, useAsync } from '../components'
import { go } from '../router'
import { setPrefill } from '../store'
import type { Beer } from '../types'
import { load, save } from '../ui/fx'
import { IconHistory, IconPlus } from '../ui/icons'

const RECENT = 'bier-recent-searches'

export default function Catalog() {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Beer[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recent, setRecent] = useState<string[]>(() => load(RECENT, [] as string[]))
  const drunk = useAsync(drunkBeerIds, [])

  useEffect(() => {
    const t = setTimeout(() => {
      searchBeers(q, 50)
        .then((r) => (setResults(r), setError(null)))
        .catch((e: Error) => setError(e.message))
    }, 250)
    return () => clearTimeout(t)
  }, [q])

  // Suchbegriff merken, wenn man ein Ergebnis öffnet oder die Suche abschickt
  function remember() {
    const term = q.trim()
    if (term.length < 2) return
    const next = [term, ...recent.filter((r) => r.toLowerCase() !== term.toLowerCase())].slice(0, 6)
    setRecent(next)
    save(RECENT, next)
  }

  return (
    <div className="page">
      <h2>Bier suchen</h2>
      <SearchInput autoFocus value={q} onChange={setQ} onSubmit={remember} placeholder="Bier oder Brauerei …" />
      {!q && recent.length > 0 && (
        <div className="recent">
          <span className="recent-label">
            <IconHistory size={15} /> Zuletzt:
          </span>
          {recent.map((r) => (
            <button key={r} className="chip-btn" onClick={() => setQ(r)}>
              {r}
            </button>
          ))}
        </div>
      )}
      <TrustLegend />
      <ErrorBox msg={error} />
      {!results && <SkeletonList />}
      {results && results.length > 0 && (
        <div className="list" onClickCapture={remember}>
          {results.map((b, i) => (
            <BeerRow
              key={b.id}
              beer={b}
              index={i}
              quick
              onChanged={() => drunk.reload()}
              right={drunk.data?.has(b.id) ? <span className="badge ok">✓</span> : null}
            />
          ))}
        </div>
      )}
      {results && results.length === 0 && (
        <EmptyState icon="🤷" title="Nichts gefunden">
          <p>Leg das Bier einfach selbst an – dauert 20 Sekunden.</p>
        </EmptyState>
      )}
      <button
        className="btn btn-primary"
        onClick={() => {
          setPrefill({ name: q.trim() || undefined })
          go('/new')
        }}
      >
        <IconPlus size={20} /> Neues Bier anlegen{q.trim() ? `: „${q.trim()}“` : ''}
      </button>
    </div>
  )
}
