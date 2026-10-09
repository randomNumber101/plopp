import { useState } from 'react'
import {
  beersOfBrewery,
  drunkBeerIds,
  getBrewery,
  hiddenBeersOfBrewery,
  hideBeers,
  setWishlist,
  sitesOfBrewery,
  unhideBeers,
  updateBrewery,
  wishlistIds,
} from '../api'
import {
  BeerRow,
  ChoiceSheet,
  ErrorBox,
  FloatingBar,
  Progress,
  RoundChip,
  RoundNote,
  SkeletonList,
  Spinner,
  TrustBadge,
  TrustDot,
  toast,
  useAsync,
} from '../components'
import { haptic } from '../ui/fx'
import { go } from '../router'
import { setPrefill } from '../store'
import { BREWERY_TYPES, HIDE_REASONS, STATES, type HideReason } from '../types'
import { initials, shortBeerName } from '../brewery'
import { IconEyeOff, IconTrash } from '../ui/icons'

export default function BreweryDetail({ id }: { id: string }) {
  const brewery = useAsync(() => getBrewery(id), [id])
  const beers = useAsync(() => beersOfBrewery(id), [id])
  const drunk = useAsync(drunkBeerIds, [id])
  const wish = useAsync(wishlistIds, [id])
  const sites = useAsync(() => sitesOfBrewery(id), [id])
  const parent = useAsync(async () => {
    const b = await getBrewery(id)
    return b.parent_id ? getBrewery(b.parent_id) : null
  }, [id])
  const hidden = useAsync(() => hiddenBeersOfBrewery(id), [id])
  const [editing, setEditing] = useState(false)
  /** Aufräum-Modus: ausgewählte Biere */
  const [sel, setSel] = useState<Set<string> | null>(null)
  const [asking, setAsking] = useState(false)
  const [showHidden, setShowHidden] = useState(false)

  if (brewery.loading && !brewery.data) return <Spinner />
  if (brewery.error || !brewery.data) return <ErrorBox msg={brewery.error ?? 'Brauerei nicht gefunden.'} />
  const b = brewery.data
  const list = beers.data ?? []
  const drunkSet = drunk.data ?? new Set<string>()
  const wishSet = wish.data ?? new Set<string>()
  const drunkCount = list.filter((x) => drunkSet.has(x.id)).length
  const hiddenList = hidden.data ?? []

  const toggle = (bid: string) => {
    const next = new Set(sel ?? [])
    if (next.has(bid)) next.delete(bid)
    else next.add(bid)
    setSel(next)
  }

  async function hideSelected(reason: HideReason) {
    const ids = [...(sel ?? [])]
    setAsking(false)
    if (!ids.length) return
    const gone = list.filter((x) => ids.includes(x.id))
    beers.setData(list.filter((x) => !ids.includes(x.id)))
    setSel(null)
    try {
      await hideBeers(ids, reason)
      hidden.reload()
      toast({
        icon: '🙈',
        msg: ids.length === 1 ? `„${shortBeerName(gone[0].name, brewery.data?.name)}“ ausgeblendet` : `${ids.length} Einträge ausgeblendet`,
        action: {
          label: 'Rückgängig',
          run: async () => {
            await unhideBeers(ids)
            beers.reload()
            hidden.reload()
          },
        },
      })
    } catch (e) {
      toast({ icon: '⚠️', msg: (e as Error).message })
      beers.reload()
    }
  }

  return (
    <div className={`page ${sel ? "with-bar" : ""}`}>
      <div className="brew-hero">
      <div className="brew-head">
        <div className={`bpin ${drunkCount && drunkCount >= list.length ? 'st-all' : drunkCount ? 'st-some' : ''} ${b.logo_url ? 'has-logo' : ''}`}>
          <span className="bpin-ini">{initials(b.name)}</span>
          {b.logo_url && (
            <img src={b.logo_url} alt="" referrerPolicy="no-referrer" onError={(e) => e.currentTarget.remove()} />
          )}
        </div>
        <h2>{b.name}</h2>
      </div>
      <div className="badge-row">
        <TrustBadge
          trust={b.trust}
          detail={b.trust === 'verified' ? 'Wikipedia-Liste' : b.trust === 'unverified' ? 'automatisch zugeordnet' : undefined}
        />
        {b.brewery_type && <span className="type-chip">{BREWERY_TYPES[b.brewery_type] ?? b.brewery_type}</span>}
        {b.founded && <span className="type-chip">seit {b.founded}</span>}
        <RoundChip item={b} />
      </div>
      {parent.data && (
        <p className="small">
          Braustätte von{' '}
          <button className="link" onClick={() => go(`/brewery/${parent.data!.id}`)}>
            {parent.data.name}
          </button>
        </p>
      )}
      <p className="meta">
        {[b.city, b.district && b.district !== b.city ? b.district : null, b.state].filter(Boolean).join(' · ') ||
          b.country}
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
      {(b.street || b.lat != null) && !editing && (
        <p className="address small">
          {b.street && (
            <span>
              📍 {b.street}, {[b.postcode, b.city].filter(Boolean).join(' ')}
            </span>
          )}
          {b.lat != null && (
            <a
              className="route-link"
              href={`https://www.google.com/maps/dir/?api=1&destination=${
                b.street
                  ? encodeURIComponent(`${b.name}, ${b.street}, ${b.postcode ?? ''} ${b.city ?? ''}`)
                  : `${b.lat},${b.lng}`
              }`}
              target="_blank"
              rel="noreferrer"
            >
              Route ↗
            </a>
          )}
        </p>
      )}
      {b.lat != null && !b.street && (b.geo_precision === 'ort' || b.geo_precision === 'gemeinde') && !editing && (
        <p className="muted small">📍 Standort auf der Karte ungefähr (Ortsmitte).</p>
      )}
      {b.lat == null && !editing && (
        <p className="muted small">Kein Standort hinterlegt – über „bearbeiten“ einen Ort eintragen, dann erscheint die Brauerei auf der Karte.</p>
      )}
      </div>
      {editing && (
        <EditBrewery
          initial={{ name: b.name, city: b.city ?? '', state: b.state ?? '', country: b.country ?? '', website: b.website ?? '' }}
          onSave={async (v) => {
            const next = {
              name: v.name.trim(),
              city: v.city.trim() || null,
              state: v.state || null,
              country: v.country.trim() || 'Deutschland',
              website: v.website.trim() || null,
            }
            // nur tatsächlich geänderte Felder als Vorschlag einreichen
            const changed: Partial<typeof next> = Object.fromEntries(
              Object.entries(next).filter(([k, val]) => val !== ((b as unknown as Record<string, unknown>)[k] ?? null)),
            )
            if (changed.city && !changed.country) changed.country = next.country
            if (Object.keys(changed).length) await updateBrewery(id, changed)
            setEditing(false)
            toast({ icon: '✏️', msg: 'Gespeichert – gilt für deine Runde, Vorschlag ist eingereicht' })
            brewery.reload()
          }}
        />
      )}

      {sites.data && sites.data.length > 0 && (
        <>
          <h3>Weitere Braustätten</h3>
          <div className="list">
            {sites.data.map((s) => (
              <button key={s.id} className="row" onClick={() => go(`/brewery/${s.id}`)}>
                <div className="row-main">
                  <div className="row-title">
                    <TrustDot trust={s.trust} />
                    {s.name}
                  </div>
                  <div className="row-sub">
                    {[s.city, s.brewery_type ? BREWERY_TYPES[s.brewery_type] : null].filter(Boolean).join(' · ')}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {list.length > 0 && (
        <div className="card">
          <div className="section-title">
            <b>Sortiment probiert</b>
            <span className="muted small">
              {drunkCount >= list.length ? '🏆 alles probiert!' : `noch ${list.length - drunkCount} offen`}
            </span>
          </div>
          <Progress drunk={drunkCount} total={list.length} wide />
        </div>
      )}

      {list.length > 0 && (
        <div className="list-toolbar">
          <span className="list-head">
            {sel ? `${sel.size} ausgewählt` : `${list.length} ${list.length === 1 ? 'Eintrag' : 'Einträge'}`}
          </span>
          {sel ? (
            <>
              <button className="link" onClick={() => setSel(sel.size === list.length ? new Set() : new Set(list.map((x) => x.id)))}>
                {sel.size === list.length ? 'keine' : 'alle'}
              </button>
              <button className="link" onClick={() => setSel(null)}>
                fertig
              </button>
            </>
          ) : (
            <button className="link tidy-btn" onClick={() => setSel(new Set())} title="Merch, Dubletten oder Falsches ausblenden">
              <IconEyeOff size={16} /> Aufräumen
            </button>
          )}
        </div>
      )}
      {beers.loading && !beers.data && <SkeletonList rows={4} />}
      <div className="list">
        {list.map((beer, i) => (
          <BeerRow
            key={beer.id}
            beer={beer}
            index={i}
            title={shortBeerName(beer.name, b.name)}
            quick
            selected={sel?.has(beer.id)}
            onSelect={sel ? () => toggle(beer.id) : undefined}
            onLongPress={() => setSel(new Set([beer.id]))}
            onChanged={() => drunk.reload()}
            sub={[beer.style, beer.abv != null ? `${beer.abv} %` : null].filter(Boolean).join(' · ') || ' '}
            right={
              drunkSet.has(beer.id) ? (
                <span className="badge ok" title="Schon probiert">
                  ✓
                </span>
              ) : (
                <button
                  className={`badge ${wishSet.has(beer.id) ? 'wish' : ''}`}
                  title="Merken"
                  aria-label={wishSet.has(beer.id) ? 'Von der Merkliste nehmen' : 'Merken'}
                  onClick={async (e) => {
                    e.stopPropagation()
                    haptic()
                    const on = !wishSet.has(beer.id)
                    const next = new Set(wishSet)
                    if (on) next.add(beer.id)
                    else next.delete(beer.id)
                    wish.setData(next)
                    await setWishlist(beer.id, on)
                    toast({ icon: on ? '⭐' : '☆', msg: on ? `${beer.name} gemerkt` : 'Von der Merkliste genommen' })
                  }}
                >
                  {wishSet.has(beer.id) ? '★' : '☆'}
                </button>
              )
            }
          />
        ))}
      </div>
      {!sel && list.length > 3 && (
        <p className="muted small hint-line">Tipp: Eintrag lange gedrückt halten, um Merch oder Dubletten auszublenden.</p>
      )}

      {hiddenList.length > 0 && (
        <>
          <button className="link hidden-toggle" onClick={() => setShowHidden(!showHidden)}>
            {showHidden ? '▾' : '▸'} {hiddenList.length} ausgeblendet
          </button>
          {showHidden && (
            <div className="list list-hidden">
              {hiddenList.map((beer, i) => (
                <BeerRow
                  key={beer.id}
                  beer={beer}
                  index={i}
                  title={shortBeerName(beer.name, b.name)}
                  sub={beer.hidden_reason ? HIDE_REASONS[beer.hidden_reason] : 'ausgeblendet'}
                  right={
                    <button
                      className="btn btn-small"
                      onClick={async (e) => {
                        e.stopPropagation()
                        haptic()
                        await unhideBeers([beer.id])
                        toast({ icon: '👀', msg: 'Wieder eingeblendet' })
                        beers.reload()
                        hidden.reload()
                      }}
                    >
                      Einblenden
                    </button>
                  }
                />
              ))}
            </div>
          )}
        </>
      )}

      {sel && (
        <FloatingBar>
          <span>{sel.size ? `${sel.size} ausgewählt` : 'Einträge antippen'}</span>
          <button className="btn btn-danger" disabled={!sel.size} onClick={() => setAsking(true)}>
            <IconTrash size={18} /> Ausblenden
          </button>
          <button className="btn btn-ghost" onClick={() => setSel(null)}>
            Fertig
          </button>
        </FloatingBar>
      )}
      {asking && (
        <ChoiceSheet
          title={sel && sel.size > 1 ? `${sel.size} Einträge ausblenden` : 'Eintrag ausblenden'}
          sub="Gilt für dich und deine Runde (eingeladene Freunde) und geht als Vorschlag an den Katalog. Rückgängig über „ausgeblendet“ unten auf der Seite."
          options={(Object.keys(HIDE_REASONS) as HideReason[]).map((r) => ({
            id: r,
            label: HIDE_REASONS[r],
            icon: r === 'kein_bier' ? '🧢' : r === 'doppelt' ? '👯' : '🚫',
          }))}
          onPick={hideSelected}
          onClose={() => setAsking(false)}
        />
      )}

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
      <RoundNote />
      <ErrorBox msg={error} />
      <button className="btn btn-primary" disabled={busy}>
        Speichern
      </button>
    </form>
  )
}
