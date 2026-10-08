import { useEffect, useState } from 'react'
import { drunkBeerIds, searchBeers } from '../api'
import { BeerRow, ErrorBox, Spinner, useAsync } from '../components'
import { go } from '../router'
import { setPrefill } from '../store'
import type { Beer } from '../types'

export default function Catalog() {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Beer[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const drunk = useAsync(drunkBeerIds, [])

  useEffect(() => {
    const t = setTimeout(() => {
      searchBeers(q, 50)
        .then((r) => (setResults(r), setError(null)))
        .catch((e: Error) => setError(e.message))
    }, 250)
    return () => clearTimeout(t)
  }, [q])

  return (
    <div className="page">
      <h2>Bier suchen</h2>
      <input className="search" autoFocus placeholder="Name des Biers …" value={q} onChange={(e) => setQ(e.target.value)} />
      <ErrorBox msg={error} />
      {!results && <Spinner />}
      <div className="list">
        {results?.map((b) => (
          <BeerRow key={b.id} beer={b} right={drunk.data?.has(b.id) ? <span className="badge ok">✓</span> : null} />
        ))}
      </div>
      {results && results.length === 0 && <p className="empty">Nichts gefunden.</p>}
      <button
        className="btn btn-primary"
        onClick={() => {
          setPrefill({ name: q.trim() || undefined })
          go('/new')
        }}
      >
        + Neues Bier anlegen{q.trim() ? `: „${q.trim()}“` : ''}
      </button>
    </div>
  )
}
