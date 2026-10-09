import { useState } from 'react'
import { addCheckin, checkinsForBeer, deleteCheckin, getBeer, setWishlist, updateBeer, wishlistIds } from '../api'
import { ErrorBox, Spinner, Stars, TrustBadge, dateInputToIso, formatDate, toast, todayInput, useAsync } from '../components'
import { go } from '../router'
import { STYLES } from '../types'

export default function BeerDetail({ id }: { id: string }) {
  const beer = useAsync(() => getBeer(id), [id])
  const checkins = useAsync(() => checkinsForBeer(id), [id])
  const wish = useAsync(() => wishlistIds().then((s) => s.has(id)), [id])

  const [adding, setAdding] = useState(false)
  const [rating, setRating] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [date, setDate] = useState(todayInput)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  if (beer.loading && !beer.data) return <Spinner />
  if (beer.error || !beer.data) return <ErrorBox msg={beer.error ?? 'Bier nicht gefunden.'} />
  const b = beer.data
  const list = checkins.data ?? []
  const rated = list.filter((c) => c.rating != null)
  const avg = rated.length ? rated.reduce((s, c) => s + (c.rating ?? 0), 0) / rated.length : null

  async function saveCheckin() {
    setBusy(true)
    setError(null)
    try {
      await addCheckin(id, rating, note, dateInputToIso(date))
      setAdding(false)
      setRating(null)
      setNote('')
      setDate(todayInput())
      toast(list.length ? `Prost! Das ${list.length + 1}. Mal 🍺` : 'Prost! Neues Bier eingetragen 🍺')
      checkins.reload()
      wish.reload()
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }

  return (
    <div className="page">
      {b.image_url && <img className="hero-img" src={b.image_url} alt="" />}
      <h2>{b.name}</h2>
      <div className="badge-row">
        <TrustBadge
          trust={b.trust}
          detail={
            b.trust === 'user'
              ? undefined
              : [
                  b.sources?.website ? 'Website der Brauerei' : null,
                  b.sources?.wikipedia ? 'Wikipedia' : null,
                  b.sources?.off ? 'Open Food Facts' : null,
                  b.sources?.wikidata ? 'Wikidata' : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || (b.trust === 'verified' ? 'von der Brauerei bzw. Wikipedia' : 'automatisch erkannt')
          }
        />
      </div>
      <p className="meta">
        {b.brewery && (
          <button className="link" onClick={() => go(`/brewery/${b.brewery!.id}`)}>
            {b.brewery.name}
          </button>
        )}
        {b.brewery?.city && <span> · {b.brewery.city}</span>}
        {b.style && <span> · {b.style}</span>}
        {b.abv != null && <span> · {b.abv} %</span>}
      </p>

      <div className="stat-row">
        <div className="stat">
          <b>{list.length}×</b>
          <span>getrunken</span>
        </div>
        <div className="stat">
          <b>{avg != null ? avg.toFixed(1) : '–'}</b>
          <span>Ø Bewertung</span>
        </div>
        <div className="stat">
          <b>{list[0] ? formatDate(list[0].drunk_at) : '–'}</b>
          <span>zuletzt</span>
        </div>
      </div>

      {!adding ? (
        <div className="btn-row">
          <button className="btn btn-primary btn-big" onClick={() => setAdding(true)}>
            🍺 Getrunken
          </button>
          <button
            className={`btn ${wish.data ? 'btn-active' : ''}`}
            onClick={async () => {
              await setWishlist(id, !wish.data)
              toast(wish.data ? 'Von der Merkliste entfernt' : 'Auf die Merkliste gesetzt ★')
              wish.reload()
            }}
          >
            {wish.data ? '★ Auf Merkliste' : '☆ Merken'}
          </button>
        </div>
      ) : (
        <div className="card">
          <Stars value={rating} onChange={setRating} />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Notiz (optional)" />
          <label className="date-row">
            Wann?
            <input type="date" value={date} max={todayInput()} onChange={(e) => setDate(e.target.value)} />
          </label>
          <div className="btn-row">
            <button className="btn btn-primary" disabled={busy} onClick={saveCheckin}>
              Eintragen
            </button>
            <button className="btn" onClick={() => setAdding(false)}>
              Abbrechen
            </button>
          </div>
        </div>
      )}
      <ErrorBox msg={error} />

      {list.length > 0 && (
        <>
          <h3>Verlauf</h3>
          <ul className="history">
            {list.map((c) => (
              <li key={c.id}>
                <span>{formatDate(c.drunk_at)}</span>
                <Stars value={c.rating} size="sm" />
                {c.note && <span className="muted">„{c.note}“</span>}
                <button
                  className="link danger"
                  onClick={async () => {
                    if (!confirm('Diesen Eintrag löschen?')) return
                    await deleteCheckin(c.id)
                    checkins.reload()
                  }}
                >
                  löschen
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3>
        Angaben{' '}
        <button className="link" onClick={() => setEditing(!editing)}>
          {editing ? 'schließen' : 'bearbeiten'}
        </button>
      </h3>
      {editing && (
        <EditBeer
          initial={{ name: b.name, style: b.style ?? '', abv: b.abv != null ? String(b.abv) : '' }}
          onSave={async (v) => {
            await updateBeer(id, {
              name: v.name.trim(),
              style: v.style.trim() || null,
              abv: v.abv ? Number(v.abv.replace(',', '.')) : null,
            })
            setEditing(false)
            beer.reload()
          }}
        />
      )}
    </div>
  )
}

function EditBeer({
  initial,
  onSave,
}: {
  initial: { name: string; style: string; abv: string }
  onSave: (v: { name: string; style: string; abv: string }) => Promise<void>
}) {
  const [v, setV] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  return (
    <form
      className="form card"
      onSubmit={async (e) => {
        e.preventDefault()
        try {
          await onSave(v)
        } catch (err) {
          setError((err as Error).message)
        }
      }}
    >
      <label>
        Name
        <input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required />
      </label>
      <div className="two">
        <label>
          Sorte
          <input list="styles-edit" value={v.style} onChange={(e) => setV({ ...v, style: e.target.value })} />
          <datalist id="styles-edit">
            {STYLES.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        <label>
          Alkohol %
          <input inputMode="decimal" value={v.abv} onChange={(e) => setV({ ...v, abv: e.target.value })} />
        </label>
      </div>
      <ErrorBox msg={error} />
      <button className="btn btn-primary">Speichern</button>
    </form>
  )
}
