import { useEffect, useMemo, useState } from 'react'
import { addBarcode, addCheckin, createBeer, createBrewery, getBrewery, searchBeers, searchBreweries } from '../api'
import { BeerRow, ErrorBox, RatingInput, TrustDot, dateInputToIso, prostWord, toast, todayInput } from '../components'
import { checkNewAchievements } from '../achievements'
import { celebrate } from '../ui/fx'
import { go } from '../router'
import { takePrefill } from '../store'
import { STATES, STYLES, type Beer, type Brewery } from '../types'
import { supabase } from '../supabase'

export default function NewBeer() {
  const prefill = useMemo(() => takePrefill(), [])
  const [name, setName] = useState(prefill.name ?? '')
  const [style, setStyle] = useState('')
  const [abv, setAbv] = useState(prefill.abv != null ? String(prefill.abv) : '')
  const [ean] = useState(prefill.ean ?? '')

  // Brauerei
  const [brewery, setBrewery] = useState<Brewery | null>(null)
  const [breweryQuery, setBreweryQuery] = useState(prefill.brand ?? '')
  const [matches, setMatches] = useState<Brewery[]>([])
  const [newBrewery, setNewBrewery] = useState(false)
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [country, setCountry] = useState('Deutschland')

  // Direkt als getrunken eintragen
  const [drunk, setDrunk] = useState(true)
  const [rating, setRating] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [date, setDate] = useState(todayInput)
  const [dupes, setDupes] = useState<Beer[]>([])

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (prefill.breweryId) getBrewery(prefill.breweryId).then(setBrewery).catch(() => {})
  }, [prefill.breweryId])

  // Brauerei-Suche (mit kleiner Verzögerung)
  useEffect(() => {
    if (brewery || newBrewery) return
    const q = breweryQuery.trim()
    if (!q) return setMatches([])
    const t = setTimeout(async () => {
      const res = await searchBreweries(q).catch(() => [])
      setMatches(res)
      // exakter Treffer (z. B. Marke aus Open Food Facts) → automatisch wählen
      const exact = res.find((b) => b.name.toLowerCase() === q.toLowerCase())
      if (exact && prefill.brand && q === prefill.brand) setBrewery(exact)
    }, 250)
    return () => clearTimeout(t)
  }, [breweryQuery, brewery, newBrewery, prefill.brand])

  // Gibt es das Bier schon im Katalog? (verhindert Dubletten, z. B. bei neuem Barcode)
  useEffect(() => {
    const term = name.trim()
    if (term.length < 3) return setDupes([])
    const t = setTimeout(async () => {
      const res = await searchBeers(term, 5).catch(() => [])
      setDupes(brewery ? res.filter((b) => b.brewery_id === brewery.id) : res)
    }, 350)
    return () => clearTimeout(t)
  }, [name, brewery])

  async function pickExisting(beer: Beer) {
    setBusy(true)
    setError(null)
    try {
      if (ean) await addBarcode(ean, beer.id)
      if (drunk) await addCheckin(beer.id, rating, note, dateInputToIso(date))
      if (drunk) (celebrate({ title: prostWord(), sub: beer.name }), checkNewAchievements())
      toast(ean ? 'Barcode mit dem Bier verknüpft ✓' : drunk ? 'Eingetragen 🍺' : 'Übernommen')
      go(`/beer/${beer.id}`)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!brewery && !newBrewery && !breweryQuery.trim()) return setError('Bitte eine Brauerei wählen oder anlegen.')
    setBusy(true)
    setError(null)
    try {
      let br = brewery
      if (!br) {
        br = await createBrewery({
          name: breweryQuery.trim(),
          city: city.trim() || null,
          state: state || null,
          country: country.trim() || 'Deutschland',
        })
      }
      let beerId: string
      try {
        const beer = await createBeer({
          brewery_id: br.id,
          name: name.trim(),
          style: style.trim() || null,
          abv: abv ? Number(abv.replace(',', '.')) : null,
          image_url: prefill.imageUrl ?? null,
          source: prefill.fromOff ? 'off' : 'user',
        })
        beerId = beer.id
      } catch (err) {
        // Bier gibt es schon bei dieser Brauerei → vorhandenes verwenden
        if (!(err as Error).message.includes('duplicate')) throw err
        const { data } = await supabase
          .from('beers')
          .select('id')
          .eq('brewery_id', br.id)
          .ilike('name', name.trim())
          .limit(1)
          .single()
        if (!data) throw err
        beerId = data.id
      }
      if (ean) await addBarcode(ean, beerId)
      if (drunk) await addCheckin(beerId, rating, note, dateInputToIso(date))
      if (drunk) (celebrate({ title: prostWord(), sub: name.trim() }), checkNewAchievements())
      toast(drunk ? 'Neues Bier eingetragen 🍺' : 'Bier angelegt')
      go(`/beer/${beerId}`)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <h2>Neues Bier</h2>
      {ean && (
        <p className="muted">
          Barcode {ean}
          {prefill.fromOff ? ' – Angaben aus Open Food Facts übernommen.' : ' – unbekannt, bitte ausfüllen.'}
        </p>
      )}
      {prefill.imageUrl && <img className="hero-img" src={prefill.imageUrl} alt="" />}

      <p className="muted small">
        👥 Neue Biere, Brauereien und Barcodes siehst zuerst nur du und deine Runde. Sie gehen als Vorschlag an den
        Katalog.
      </p>
      <form className="form" onSubmit={save}>
        <label>
          Name des Biers *
          <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="z. B. Augustiner Edelstoff" />
        </label>

        {dupes.length > 0 && (
          <div className="dupes">
            <span className="small">
              <b>Schon im Katalog?</b> Tippe auf das passende Bier
              {ean ? ', dann wird der Barcode damit verknüpft' : ''}:
            </span>
            <div className="list">
              {dupes.map((d) => (
                <div key={d.id} onClickCapture={(e) => { e.stopPropagation(); e.preventDefault(); if (!busy) pickExisting(d) }}>
                  <BeerRow beer={d} />
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="field">
          <span>Brauerei *</span>
          {brewery ? (
            <div className="chip-row">
              <span className="chip">
                {brewery.name}
                {brewery.city ? ` · ${brewery.city}` : ''}
              </span>
              <button type="button" className="link" onClick={() => setBrewery(null)}>
                ändern
              </button>
            </div>
          ) : (
            <>
              <input
                value={breweryQuery}
                onChange={(e) => {
                  setBreweryQuery(e.target.value)
                  setNewBrewery(false)
                }}
                placeholder="Brauerei suchen …"
              />
              {!newBrewery && breweryQuery.trim() && (
                <div className="suggest">
                  {matches.map((b) => (
                    <button type="button" key={b.id} onClick={() => setBrewery(b)}>
                      <TrustDot trust={b.trust} />
                      {b.name}
                      {b.city ? <span className="muted"> · {b.city}</span> : null}
                    </button>
                  ))}
                  <button type="button" className="suggest-new" onClick={() => setNewBrewery(true)}>
                    + „{breweryQuery.trim()}“ als neue Brauerei anlegen
                  </button>
                </div>
              )}
              {newBrewery && (
                <div className="subform">
                  <label>
                    Ort
                    <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="z. B. München" />
                  </label>
                  <label>
                    Bundesland
                    <select value={state} onChange={(e) => setState(e.target.value)}>
                      <option value="">–</option>
                      {STATES.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Land
                    <input value={country} onChange={(e) => setCountry(e.target.value)} />
                  </label>
                </div>
              )}
            </>
          )}
        </div>

        <div className="two">
          <label>
            Sorte
            <input list="styles" value={style} onChange={(e) => setStyle(e.target.value)} placeholder="Pils, Helles …" />
            <datalist id="styles">
              {STYLES.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </label>
          <label>
            Alkohol %
            <input inputMode="decimal" value={abv} onChange={(e) => setAbv(e.target.value)} placeholder="4,9" />
          </label>
        </div>

        <label className="check">
          <input type="checkbox" checked={drunk} onChange={(e) => setDrunk(e.target.checked)} />
          Jetzt als getrunken eintragen
        </label>
        {drunk && (
          <div className="subform">
            <RatingInput value={rating} onChange={setRating} />
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Notiz (optional)" />
            <label className="date-row">
              Wann?
              <input type="date" value={date} max={todayInput()} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>
        )}

        <ErrorBox msg={error} />
        <button className="btn btn-primary" disabled={busy || !name.trim()}>
          {busy ? 'Speichere …' : 'Speichern'}
        </button>
      </form>
    </div>
  )
}
