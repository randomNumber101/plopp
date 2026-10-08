import { useCallback, useEffect, useState } from 'react'
import type { Beer } from './types'
import { go } from './router'

/** Lädt Daten asynchron; reload() lädt neu */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps)
  useEffect(() => {
    let alive = true
    setLoading(true)
    run()
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [run, tick])
  return { data, error, loading, reload: () => setTick((t) => t + 1) }
}

export function Spinner() {
  return <div className="spinner" aria-label="Lädt" />
}

export function ErrorBox({ msg }: { msg: string | null }) {
  if (!msg) return null
  return <div className="error">{msg}</div>
}

export function Stars({
  value,
  onChange,
  size = 'md',
}: {
  value: number | null
  onChange?: (v: number | null) => void
  size?: 'sm' | 'md'
}) {
  return (
    <span className={`stars stars-${size}`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!onChange}
          className={value != null && n <= value ? 'on' : ''}
          onClick={() => onChange?.(value === n ? null : n)}
          aria-label={`${n} Sterne`}
        >
          ★
        </button>
      ))}
    </span>
  )
}

export function BeerThumb({ beer }: { beer: Beer }) {
  return beer.image_url ? (
    <img className="thumb" src={beer.image_url} alt="" loading="lazy" />
  ) : (
    <div className="thumb thumb-empty">🍺</div>
  )
}

export function BeerRow({
  beer,
  right,
  sub,
}: {
  beer: Beer
  right?: React.ReactNode
  sub?: React.ReactNode
}) {
  return (
    <button className="row" onClick={() => go(`/beer/${beer.id}`)}>
      <BeerThumb beer={beer} />
      <div className="row-main">
        <div className="row-title">{beer.name}</div>
        <div className="row-sub">
          {sub ?? [beer.brewery?.name, beer.style, beer.abv != null ? `${beer.abv} %` : null]
            .filter(Boolean)
            .join(' · ')}
        </div>
      </div>
      {right && <div className="row-right">{right}</div>}
    </button>
  )
}

export function Progress({ drunk, total }: { drunk: number; total: number }) {
  const pct = total ? Math.round((drunk / total) * 100) : 0
  return (
    <div className="progress" title={`${drunk} von ${total}`}>
      <div className="progress-bar" style={{ width: `${pct}%` }} />
      <span>
        {drunk}/{total}
      </span>
    </div>
  )
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
