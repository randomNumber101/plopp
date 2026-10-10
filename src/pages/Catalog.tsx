import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { drunkBeerIds, myCheckins, searchBeers } from '../api'
import { BeerRow, EmptyState, ErrorBox, SearchInput, SkeletonList, useAsync } from '../components'
import { go } from '../router'
import { setPrefill } from '../store'
import type { Beer } from '../types'
import { load, save } from '../ui/fx'
import { IconChevron, IconHistory, IconPlus, IconScan } from '../ui/icons'
import { usePageState } from '../pageState'
import { beerNameShortener, initials } from '../brewery'
import { searchIndex, toBeer, useSearchIndex, type BreweryGroup } from '../search'

const RECENT = 'bier-recent-searches'
const SHOW = 4

/** Bier erfassen: Suche zuerst, Barcode nur optional */
export default function Catalog() {
  const [q, setQ] = usePageState('catalog-q', '')
  const [limit, setLimit] = usePageState('catalog-limit', 20)
  const [open, setOpen] = usePageState<string[]>('catalog-open', [])
  const [recent, setRecent] = useState<string[]>(() => load(RECENT, [] as string[]))
  const { index, error: indexError } = useSearchIndex()
  const drunk = useAsync(drunkBeerIds, [], 'drunk-ids')
  const checkins = useAsync(myCheckins, [], 'my-checkins')

  const term = q.trim()
  // Tippen bleibt flüssig, die Trefferliste rechnet kurz danach
  const deferred = useDeferredValue(term)
  const groups = useMemo<BreweryGroup[] | null>(
    () => (index && deferred ? searchIndex(index, deferred, { drunk: drunk.data ?? undefined }) : null),
    [index, deferred, drunk.data],
  )

  // Rückfall, solange der Index noch nicht da ist: Suche auf dem Server
  const [server, setServer] = useState<Beer[] | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  useEffect(() => {
    if (index || !term) return
    const t = setTimeout(() => {
      searchBeers(term, 60)
        .then((r) => (setServer(r), setServerError(null)))
        .catch((e: Error) => setServerError(e.message))
    }, 200)
    return () => clearTimeout(t)
  }, [index, term])

  // zuletzt getrunkene Biere für „nochmal“ (ohne Suche)
  const again = useMemo(() => {
    const seen = new Set<string>()
    const out: Beer[] = []
    for (const c of checkins.data ?? []) {
      if (c.beer && !seen.has(c.beer.id)) {
        seen.add(c.beer.id)
        out.push(c.beer)
      }
      if (out.length >= 8) break
    }
    return out
  }, [checkins.data])

  function remember() {
    if (term.length < 2) return
    const next = [term, ...recent.filter((r) => r.toLowerCase() !== term.toLowerCase())].slice(0, 6)
    setRecent(next)
    save(RECENT, next)
  }

  const shownGroups = groups?.slice(0, limit) ?? []
  const beerHits = groups?.reduce((n, g) => n + g.hits.length, 0) ?? 0
  const drunkSet = drunk.data ?? new Set<string>()
  const badge = (id: string) => (drunkSet.has(id) ? <span className="badge ok">✓</span> : null)

  return (
    <div className="page">
      <h2>Bier erfassen</h2>
      <div className="search-row">
        <SearchInput
          autoFocus={!q}
          value={q}
          onChange={(v) => {
            setQ(v)
            setLimit(20)
            setOpen([])
          }}
          onSubmit={remember}
          placeholder="Bier, Sorte oder Brauerei …"
        />
        <button className="scan-btn" onClick={() => go('/scan')} aria-label="Barcode scannen" title="Barcode scannen">
          <IconScan size={24} />
        </button>
      </div>

      {!term && (
        <>
          {recent.length > 0 && (
            <div className="recent">
              <span className="recent-label">
                <IconHistory size={15} /> Zuletzt gesucht:
              </span>
              {recent.map((r) => (
                <button key={r} className="chip-btn" onClick={() => setQ(r)}>
                  {r}
                </button>
              ))}
            </div>
          )}
          {again.length > 0 && (
            <>
              <h3>Nochmal eins?</h3>
              <div className="list">
                {again.map((b, i) => (
                  <BeerRow key={b.id} beer={b} index={i} quick onChanged={() => drunk.reload()} right={badge(b.id)} />
                ))}
              </div>
            </>
          )}
          <p className="muted small search-hint">
            Tipp: Teilwörter reichen – „alt“ findet alle Altbiere, „hefe weizen“ auch „Hefeweizen“, „weiss“ auch
            „Weiß“. Kleine Tippfehler sind egal.
            {index && ` ${index.beers.length.toLocaleString('de-DE')} Biere von ${index.breweries.size.toLocaleString('de-DE')} Brauereien.`}
          </p>
        </>
      )}

      {term && (
        <>
          <ErrorBox msg={!index ? (serverError ?? indexError) : null} />
          {groups && (
            <p className="muted small result-count">
              {groups.length === 0
                ? 'Keine Treffer'
                : `${beerHits} ${beerHits === 1 ? 'Bier' : 'Biere'} · ${groups.length}${groups.length >= 60 ? '+' : ''} ${groups.length === 1 ? 'Brauerei' : 'Brauereien'}`}
            </p>
          )}
          {groups ? (
            <div className="sgroups" onClickCapture={remember}>
              {shownGroups.map((g, gi) => (
                <SearchGroup
                  key={g.brewery?.id ?? `x${gi}`}
                  group={g}
                  index={gi}
                  expanded={open.includes(g.brewery?.id ?? '')}
                  onExpand={() => setOpen([...open, g.brewery?.id ?? ''])}
                  badge={badge}
                  onChanged={() => drunk.reload()}
                />
              ))}
              {groups.length > limit && (
                <button className="btn" onClick={() => setLimit(limit + 20)}>
                  Mehr Brauereien anzeigen ({groups.length - limit})
                </button>
              )}
            </div>
          ) : server ? (
            <div className="list" onClickCapture={remember}>
              {server.map((b, i) => (
                <BeerRow key={b.id} beer={b} index={i} quick onChanged={() => drunk.reload()} right={badge(b.id)} />
              ))}
            </div>
          ) : (
            <SkeletonList />
          )}
          {groups && groups.length === 0 && (
            <EmptyState icon="🤷" title="Nichts gefunden">
              <p>Anders schreiben, Barcode scannen – oder das Bier einfach selbst anlegen, dauert 20 Sekunden.</p>
            </EmptyState>
          )}
        </>
      )}

      <div className="btn-row">
        <button
          className="btn btn-primary"
          onClick={() => {
            setPrefill({ name: term || undefined })
            go('/new')
          }}
        >
          <IconPlus size={20} /> Neues Bier anlegen{term ? `: „${term}“` : ''}
        </button>
      </div>
      <button className="btn btn-ghost" onClick={() => go('/scan')}>
        <IconScan size={20} /> Barcode scannen
      </button>
    </div>
  )
}

function SearchGroup({
  group,
  index,
  expanded,
  onExpand,
  badge,
  onChanged,
}: {
  group: BreweryGroup
  index: number
  expanded: boolean
  onExpand: () => void
  badge: (id: string) => React.ReactNode
  onChanged: () => void
}) {
  const br = group.brewery
  const short = useMemo(
    () => beerNameShortener(group.hits.map((h) => h.beer.name), br?.name),
    [group.hits, br?.name],
  )
  const hits = expanded ? group.hits : group.hits.slice(0, SHOW)
  const more = group.hits.length - hits.length
  const others = br ? br.beerCount - group.hits.length : 0
  return (
    <section className="sgroup" style={{ '--i': Math.min(index, 12) } as React.CSSProperties}>
      {br ? (
        <button className="sgroup-head" onClick={() => go(`/brewery/${br.id}`)}>
          {br.logo_url ? (
            <img className="sgroup-logo" src={br.logo_url} alt="" loading="lazy" referrerPolicy="no-referrer" />
          ) : (
            <span className="sgroup-logo sgroup-ini">{initials(br.name)}</span>
          )}
          <span className="sgroup-name">
            <b>{br.name}</b>
            <span className="muted small">
              {[br.city, `${br.beerCount} ${br.beerCount === 1 ? 'Bier' : 'Biere'}`].filter(Boolean).join(' · ')}
            </span>
          </span>
          <IconChevron size={18} className="m-chev" />
        </button>
      ) : (
        <div className="sgroup-head sgroup-none">
          <span className="sgroup-logo sgroup-ini">?</span>
          <span className="sgroup-name">
            <b>Ohne Brauerei</b>
          </span>
        </div>
      )}
      {hits.length > 0 && (
        <div className="list sgroup-beers">
          {hits.map((h, i) => (
            <BeerRow
              key={h.beer.id}
              beer={toBeer(h.beer)}
              index={i}
              title={short(h.beer.name)}
              sub={[h.beer.style, h.beer.abv != null ? `${h.beer.abv} %` : null].filter(Boolean).join(' · ') || ' '}
              quick
              onChanged={onChanged}
              right={badge(h.beer.id)}
            />
          ))}
        </div>
      )}
      {(more > 0 || (group.breweryMatch && others > 0) || (br && hits.length === 0)) && (
        <div className="sgroup-foot">
          {more > 0 && (
            <button className="link" onClick={onExpand}>
              + {more} weitere {more === 1 ? 'Treffer' : 'Treffer'}
            </button>
          )}
          {br && (group.breweryMatch || hits.length === 0) && (
            <button className="link" onClick={() => go(`/brewery/${br.id}`)}>
              {br.beerCount ? `alle ${br.beerCount} Biere →` : 'Brauerei öffnen →'}
            </button>
          )}
          {br && hits.length === 0 && (
            <button
              className="link"
              onClick={() => {
                setPrefill({ breweryId: br.id })
                go('/new')
              }}
            >
              + Bier hier anlegen
            </button>
          )}
        </div>
      )}
    </section>
  )
}
