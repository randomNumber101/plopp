import { useState } from 'react'
import { beersOfBrewery, drunkBeerIds, getBrewery, setWishlist, updateBrewery, wishlistIds } from '../api'
import { BeerRow, ErrorBox, Progress, Spinner, useAsync } from '../components'
import { go } from '../router'
import { setPrefill } from '../store'
import { STATES } from '../types'
import { initials } from '../brewery'

export default function BreweryDetail({ id }: { id: string }) {
  const brewery = useAsync(() => getBrewery(id), [id])
  const beers = useAsync(() => beersOfBrewery(id), [id])
  const drunk = useAsync(drunkBeerIds, [id])
  const wish = useAsync(wishlistIds, [id])
  const [editing, setEditing] = useState(false)

  if (brewery.loading && !brewery.data) return <Spinner />
  if (brewery.error || !brewery.data) return <ErrorBox msg={brewery.error ?? 'Brauerei nicht gefunden.'} />
  const b = brewery.data
  const list = beers.data ?? []
  const drunkSet = drunk.data ?? new Set<string>()
  const wishSet = wish.data ?? new Set<string>()
  const drunkCount = list.filter((x) => drunkSet.has(x.id)).length

  return (
    <div className="page">
      <div className="brew-head">
        <div className={`bpin ${drunkCount && drunkCount >= list.length ? 'st-all' : drunkCount ? 'st-some' : ''} ${b.logo_url ? 'has-logo' : ''}`}>
          <span className="bpin-ini">{initials(b.name)}</span>
          {b.logo_url && (
            <img src={b.logo_url} alt="" referrerPolicy="no-referrer" onError={(e) => e.currentTarget.remove()} />
          )}
        </div>
        <h2>{b.name}</h2>
      </div>
      <p className="meta">
        {[b.city, b.state, b.country].filter(Boolean).join(' · ')}
        {b.website && (
          <>
            {' · '}
            <a href={b.website} target="_blank" rel="noreferrer">
              Website
            </a>
          </>
        )}
        {' · '}
        <button className="link" onClick={() => setEditing(!editing)}>
          {editing ? 'schließen' : 'bearbeiten'}
        </button>
      </p>
      {b.lat == null && !editing && (
        <p className="muted small">Kein Standort hinterlegt – über „bearbeiten“ einen Ort eintragen, dann erscheint die Brauerei auf der Karte.</p>
      )}
      {editing && (
        <EditBrewery
          initial={{ name: b.name, city: b.city ?? '', state: b.state ?? '', country: b.country ?? '', website: b.website ?? '' }}
          onSave={async (v) => {
            await updateBrewery(id, {
              name: v.name.trim(),
              city: v.city.trim() || null,
              state: v.state || null,
              country: v.country.trim() || 'Deutschland',
              website: v.website.trim() || null,
            })
            setEditing(false)
            brewery.reload()
          }}
        />
      )}

      <div className="card">
        <div className="row-sub">Sortiment probiert</div>
        <Progress drunk={drunkCount} total={list.length} />
      </div>

      <div className="list">
        {beers.loading && !beers.data && <Spinner />}
        {list.map((beer) => (
          <BeerRow
            key={beer.id}
            beer={beer}
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
      <button
        className="btn"
        onClick={() => {
          setPrefill({ breweryId: id })
          go('/new')
        }}
      >
        + Bier dieser Brauerei hinzufügen
      </button>
    </div>
  )
}

type BreweryForm = { name: string; city: string; state: string; country: string; website: string }

function EditBrewery({ initial, onSave }: { initial: BreweryForm; onSave: (v: BreweryForm) => Promise<void> }) {
  const [v, setV] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <form
      className="form card"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        try {
          await onSave(v)
        } catch (err) {
          setError((err as Error).message)
        }
        setBusy(false)
      }}
    >
      <label>
        Name
        <input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required />
      </label>
      <div className="two">
        <label>
          Ort
          <input value={v.city} onChange={(e) => setV({ ...v, city: e.target.value })} />
        </label>
        <label>
          Bundesland
          <select value={v.state} onChange={(e) => setV({ ...v, state: e.target.value })}>
            <option value="">–</option>
            {STATES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="two">
        <label>
          Land
          <input value={v.country} onChange={(e) => setV({ ...v, country: e.target.value })} />
        </label>
        <label>
          Website
          <input type="url" value={v.website} onChange={(e) => setV({ ...v, website: e.target.value })} />
        </label>
      </div>
      <ErrorBox msg={error} />
      <button className="btn btn-primary" disabled={busy}>
        Speichern
      </button>
    </form>
  )
}
