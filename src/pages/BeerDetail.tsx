import { useState } from 'react'
import {
  checkinsForBeer,
  deleteCheckin,
  getBeer,
  restoreCheckin,
  setWishlist,
  updateBeer,
  updateCheckin,
  wishlistIds,
} from '../api'
import {
  CountUp,
  ErrorBox,
  Spinner,
  RatingInput,
  Stars,
  TrustBadge,
  formatRating,
  dateInputToIso,
  isoToDateInput,
  quickCheckin,
  relDate,
  toast,
  todayInput,
  useAsync,
} from '../components'
import { go } from '../router'
import { STYLES } from '../types'
import { haptic } from '../ui/fx'
import { IconTrash } from '../ui/icons'


export default function BeerDetail({ id }: { id: string }) {
  const beer = useAsync(() => getBeer(id), [id])
  const checkins = useAsync(() => checkinsForBeer(id), [id])
  const wish = useAsync(() => wishlistIds().then((s) => s.has(id)), [id])

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  /** gerade eingetragener Check-in → „Wie war's?“ */
  const [fresh, setFresh] = useState<string | null>(null)
  const [rating, setRating] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [date, setDate] = useState(todayInput)

  if (beer.loading && !beer.data) return <Spinner />
  if (beer.error || !beer.data) return <ErrorBox msg={beer.error ?? 'Bier nicht gefunden.'} />
  const b = beer.data
  const list = checkins.data ?? []
  const rated = list.filter((c) => c.rating != null)
  const avg = rated.length ? rated.reduce((s, c) => s + (c.rating ?? 0), 0) / rated.length : null

  async function prost() {
    setBusy(true)
    setError(null)
    try {
      const cid = await quickCheckin(b, {
        big: true,
        onUndo: () => {
          setFresh(null)
          checkins.reload()
        },
      })
      setFresh(cid)
      setRating(null)
      setNote('')
      setDate(todayInput())
      checkins.reload()
      wish.setData(false)
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }

  async function saveRating() {
    if (!fresh) return
    try {
      await updateCheckin(fresh, { rating, note: note.trim() || null, drunk_at: dateInputToIso(date) })
      haptic()
      toast({ icon: rating ? '⭐' : '📝', msg: rating ? `${formatRating(rating)} von 5 – gespeichert` : 'Gespeichert' })
      setFresh(null)
      checkins.reload()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const sources =
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

  return (
    <div className="page">
      <div className="beer-hero">
        {b.image_url ? (
          <img className="hero-img" src={b.image_url} alt="" referrerPolicy="no-referrer" />
        ) : (
          <div className="beer-hero-emoji" aria-hidden="true">
            🍺
          </div>
        )}
        <h2>{b.name}</h2>
        {b.brewery && (
          <button className="link" onClick={() => go(`/brewery/${b.brewery!.id}`)}>
            {b.brewery.name}
            {b.brewery.city ? ` · ${b.brewery.city}` : ''}
          </button>
        )}
        <div className="tagrow">
          {b.style && <span className="tag">{b.style}</span>}
          {b.abv != null && <span className="tag">{b.abv} % vol</span>}
          <TrustBadge trust={b.trust} detail={sources} />
        </div>
      </div>

      <div className="stat-row">
        <div className="stat">
          <b>
            <CountUp value={list.length} />×
          </b>
          <span>getrunken</span>
        </div>
        <div className="stat">
          <b>{avg != null ? <CountUp value={avg} decimals={1} /> : '–'}</b>
          <span>Ø Bewertung</span>
        </div>
        <div className="stat">
          <b>{list[0] ? relDate(list[0].drunk_at) : '–'}</b>
          <span>zuletzt</span>
        </div>
      </div>

      {fresh ? (
        <div
          className="card rate-card"
          ref={(el) => {
            if (el && !el.dataset.shown) {
              el.dataset.shown = '1'
              setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250)
            }
          }}
        >
          <div className="rate-q">Wie war's?</div>
          <RatingInput value={rating} onChange={setRating} />
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Notiz (optional) – wo, mit wem, wie?" />
          <label className="date-row">
            Wann?
            <input type="date" value={date} max={todayInput()} onChange={(e) => setDate(e.target.value)} />
          </label>
          <div className="btn-row" style={{ width: '100%' }}>
            <button className="btn btn-primary" onClick={saveRating}>
              Speichern
            </button>
            <button className="btn btn-ghost" onClick={() => setFresh(null)}>
              Später
            </button>
          </div>
        </div>
      ) : (
        <div className="btn-row">
          <button className="btn btn-primary btn-big prost-big" disabled={busy} onClick={prost}>
            🍻 Prost!
          </button>
          <button
            className={`btn wish-btn ${wish.data ? 'btn-active on' : ''}`}
            style={{ flex: '0 0 auto' }}
            onClick={async () => {
              const on = !wish.data
              haptic()
              wish.setData(on)
              await setWishlist(id, on)
              toast({ icon: on ? '⭐' : '☆', msg: on ? 'Auf die Merkliste gesetzt' : 'Von der Merkliste genommen' })
            }}
          >
            {wish.data ? '★ Gemerkt' : '☆ Merken'}
          </button>
        </div>
      )}
      <ErrorBox msg={error} />

      {list.length > 0 && (
        <>
          <h3>Verlauf</h3>
          <ul className="history">
            {list.map((c, i) => (
              <li key={c.id} style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}>
                <span className="h-date" title={new Date(c.drunk_at).toLocaleString('de-DE')}>
                  {relDate(c.drunk_at)}
                </span>
                <button
                  className={c.rating != null ? 'h-rating' : 'link small'}
                  title="Bewertung ändern"
                  onClick={() => {
                    setFresh(c.id)
                    setRating(c.rating)
                    setNote(c.note ?? '')
                    setDate(isoToDateInput(c.drunk_at))
                  }}
                >
                  {c.rating != null ? (
                    <>
                      <Stars value={c.rating} size="sm" /> <b>{formatRating(c.rating)}</b>
                    </>
                  ) : (
                    'bewerten'
                  )}
                </button>
                <button
                  className="icon-btn"
                  aria-label="Eintrag löschen"
                  onClick={async () => {
                    haptic()
                    checkins.setData(list.filter((x) => x.id !== c.id))
                    await deleteCheckin(c.id)
                    toast({
                      icon: '🗑️',
                      msg: 'Eintrag gelöscht',
                      action: { label: 'Rückgängig', run: async () => (await restoreCheckin(c), checkins.reload()) },
                    })
                  }}
                >
                  <IconTrash size={16} />
                </button>
                {c.note && <span className="h-note">„{c.note}“</span>}
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
            toast({ icon: '✏️', msg: 'Gespeichert' })
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
