import { useCallback, useEffect, useState } from 'react'
import type { Beer, Trust } from './types'
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

/** Kurze Rückmeldung unten am Bildschirm */
export function toast(msg: string) {
  window.dispatchEvent(new CustomEvent('bier-toast', { detail: msg }))
}

export function Toaster() {
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    const on = (e: Event) => {
      setMsg((e as CustomEvent<string>).detail)
      clearTimeout(t)
      t = setTimeout(() => setMsg(null), 2600)
    }
    window.addEventListener('bier-toast', on)
    return () => {
      window.removeEventListener('bier-toast', on)
      clearTimeout(t)
    }
  }, [])
  return msg ? (
    <div className="toast" role="status">
      {msg}
    </div>
  ) : null
}

/** yyyy-mm-dd für <input type="date"> (lokale Zeit) */
export function todayInput() {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 10)
}

/** Datum aus <input type="date"> → ISO-Zeitpunkt; heute = jetzt, sonst 20:00 Uhr */
export function dateInputToIso(v: string) {
  if (!v || v === todayInput()) return new Date().toISOString()
  return new Date(`${v}T20:00:00`).toISOString()
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
  const src = beer.image_url || beer.brewery?.logo_url
  return src ? (
    <img
      className={`thumb ${beer.image_url ? '' : 'thumb-logo'}`}
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  ) : (
    <div className="thumb thumb-empty">🍺</div>
  )
}

export const TRUST: Record<Trust, { label: string; icon: string; title: string }> = {
  verified: { label: 'Geprüft', icon: '✓', title: 'Geprüft: steht in der Wikipedia-Liste bzw. stammt von der Brauerei' },
  unverified: { label: 'Ungeprüft', icon: '?', title: 'Automatisch zugeordnet (Open Food Facts / Wikidata) – nicht sicher' },
  user: { label: 'Eigener Eintrag', icon: '✎', title: 'Von dir angelegt' },
}

/** Kleiner farbiger Punkt vor Namen: grün = geprüft, grau = ungeprüft, blau = eigener Eintrag */
export function TrustDot({ trust }: { trust?: Trust | null }) {
  const t = trust ?? 'user'
  return <span className={`trust-dot t-${t}`} title={TRUST[t].title} aria-label={TRUST[t].label} />
}

export function TrustBadge({ trust, detail }: { trust?: Trust | null; detail?: string }) {
  const t = trust ?? 'user'
  return (
    <span className={`trust-badge t-${t}`} title={TRUST[t].title}>
      {TRUST[t].icon} {TRUST[t].label}
      {detail ? <span className="trust-detail"> · {detail}</span> : null}
    </span>
  )
}

export function TrustLegend() {
  return (
    <div className="trust-legend">
      <span>
        <TrustDot trust="verified" /> geprüft
      </span>
      <span>
        <TrustDot trust="unverified" /> ungeprüft
      </span>
      <span>
        <TrustDot trust="user" /> eigener Eintrag
      </span>
    </div>
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
    <button type="button" className="row" onClick={() => go(`/beer/${beer.id}`)}>
      <BeerThumb beer={beer} />
      <div className="row-main">
        <div className="row-title">
          <TrustDot trust={beer.trust} />
          {beer.name}
        </div>
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
