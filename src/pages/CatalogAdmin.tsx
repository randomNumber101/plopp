import { useEffect, useMemo, useState } from 'react'
import { assignBrand, catalogRuns, isAdmin, unassignedBrands, type CatalogRun, type UnassignedBrand } from '../api'
import { EmptyState, ErrorBox, SearchInput, SkeletonList, relDate, toast, useAsync } from '../components'
import { searchIndex, useSearchIndex, type IndexBrewery, type SearchIndex } from '../search'
import { haptic } from '../ui/fx'

/** Admin: Katalog-Aufbau live verfolgen und Marken ohne Brauerei zuordnen */
export default function CatalogAdmin() {
  const admin = useAsync(isAdmin, [])
  if (admin.data === false) {
    return (
      <div className="page">
        <h2>Katalog</h2>
        <EmptyState icon="🔒" title="Nur für Admins" />
      </div>
    )
  }
  return (
    <div className="page">
      <h2>Katalog</h2>
      <RunStatus />
      <BrandAssign />
    </div>
  )
}

// ------------------------------------------------------------------------------------------ Laufstatus

const fmtDur = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min` : s >= 60 ? `${Math.floor(s / 60)} min` : `${s} s`
}

function RunStatus() {
  const [runs, setRuns] = useState<CatalogRun[] | null>(null)
  const [, tick] = useState(0)
  useEffect(() => {
    let alive = true
    let t: ReturnType<typeof setTimeout>
    const load = async () => {
      const r = await catalogRuns(6)
      if (!alive) return
      setRuns(r)
      // läuft gerade → alle 4 s nachsehen, sonst jede Minute
      t = setTimeout(load, r[0]?.status === 'läuft' ? 4000 : 60000)
    }
    load()
    const clock = setInterval(() => tick((x) => x + 1), 1000)
    return () => {
      alive = false
      clearTimeout(t)
      clearInterval(clock)
    }
  }, [])

  if (!runs) return <SkeletonList rows={1} />
  const cur = runs[0]
  if (!cur)
    return (
      <div className="card run-card">
        <b>Noch kein Katalog-Lauf aufgezeichnet.</b>
        <p className="muted small">Der nächste Lauf (GitHub → Actions → Katalog) erscheint hier live.</p>
      </div>
    )
  const stale = cur.status === 'läuft' && Date.now() - new Date(cur.updated_at).getTime() > 15 * 60_000
  const pctStep = cur.total ? Math.min(1, (cur.done ?? 0) / cur.total) : null
  const pctAll = cur.steps ? Math.min(1, (Math.max(cur.step - 1, 0) + (pctStep ?? 0.5)) / cur.steps) : 0
  const running = cur.status === 'läuft' && !stale
  const last = runs.find((r) => r.status !== 'läuft' && r.stats)
  const st = (last?.stats ?? {}) as Record<string, unknown>
  const methods = (st.off_match_methods ?? {}) as Record<string, number>
  const offAssigned = Object.entries(methods)
    .filter(([k]) => !k.startsWith('korrektur_keine') && k !== 'ohne_marke')
    .reduce((n, [, v]) => n + v, 0)
  const num = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('de-DE') : '–')

  return (
    <>
      <div className={`card run-card ${running ? 'running' : ''}`}>
        <div className="run-head">
          <span className={`run-dot st-${stale ? 'abgebrochen' : cur.status}`} />
          <b>
            {running
              ? 'Katalog wird aufgebaut'
              : stale
                ? 'Lauf reagiert nicht mehr'
                : cur.status === 'fertig'
                  ? 'Letzter Lauf fertig'
                  : cur.status === 'fehler'
                    ? 'Letzter Lauf mit Fehlern'
                    : 'Letzter Lauf abgebrochen'}
          </b>
          <span className="muted small">
            {running
              ? `seit ${fmtDur(Date.now() - new Date(cur.started_at).getTime())}`
              : relDate(cur.finished_at ?? cur.updated_at)}
          </span>
        </div>
        {running && (
          <>
            <div className="run-step">
              Schritt {cur.step} von {cur.steps}: <b>{cur.phase}</b>
            </div>
            <div className="run-bar" aria-label={`${Math.round(pctAll * 100)} %`}>
              <span style={{ width: `${pctAll * 100}%` }} />
            </div>
            {pctStep != null && (
              <div className="run-sub">
                <div className="run-bar thin">
                  <span style={{ width: `${pctStep * 100}%` }} />
                </div>
                <span className="small">
                  {num(cur.done)} / {num(cur.total)} ({Math.round(pctStep * 100)} %)
                </span>
              </div>
            )}
            {cur.detail && <p className="small muted run-detail">{cur.detail}</p>}
            <p className="muted small">Aktualisiert {relDate(cur.updated_at)} · die Seite aktualisiert sich selbst.</p>
          </>
        )}
        {!running && last && (
          <dl className="run-stats">
            <div>
              <dt>Brauereien</dt>
              <dd>{num(st.db_breweries ?? st.breweries_total)}</dd>
            </div>
            <div>
              <dt>Biere</dt>
              <dd>{num(st.db_beers ?? st.beers_total)}</dd>
            </div>
            <div>
              <dt>Barcodes</dt>
              <dd>{num(st.db_barcodes ?? st.barcodes_total)}</dd>
            </div>
            <div>
              <dt>Websites mit Bieren</dt>
              <dd>
                {num(st.sites_with_beers)} / {num(st.sites_total)}
              </dd>
            </div>
            <div>
              <dt>OFF zugeordnet</dt>
              <dd>
                {num(offAssigned)} / {num(st.off_products)}
              </dd>
            </div>
            <div>
              <dt>Dubletten zusammengeführt</dt>
              <dd>{num(st.beers_merged)}</dd>
            </div>
          </dl>
        )}
        {cur.run_url && (
          <a className="small" href={cur.run_url} target="_blank" rel="noreferrer">
            Lauf auf GitHub ansehen ↗
          </a>
        )}
      </div>
      {runs.length > 1 && (
        <details className="run-history">
          <summary className="small">Frühere Läufe</summary>
          <ul className="small">
            {runs.slice(1).map((r) => (
              <li key={r.id}>
                {new Date(r.started_at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })} · {r.status}
                {r.finished_at ? ` · ${fmtDur(new Date(r.finished_at).getTime() - new Date(r.started_at).getTime())}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  )
}

// ------------------------------------------------------------------------------------------ Marken zuordnen

function candidatesFor(index: SearchIndex | null, q: string, limit = 3): IndexBrewery[] {
  if (!index || !q.trim()) return []
  const out: IndexBrewery[] = []
  for (const g of searchIndex(index, q, { maxGroups: 30 })) {
    const b = g.brewery
    if (b && b.brewery_type !== 'marke' && g.breweryMatch && !out.includes(b)) out.push(b)
    if (out.length >= limit) break
  }
  return out
}

function BrandAssign() {
  const list = useAsync(unassignedBrands, [])
  const { index } = useSearchIndex()
  const [filter, setFilter] = useState('')
  const items = (list.data ?? []).filter((b) => !filter || b.name.toLowerCase().includes(filter.toLowerCase()))
  const total = list.data?.reduce((n, b) => n + b.beers, 0) ?? 0

  async function assign(b: UnassignedBrand, target: IndexBrewery | null) {
    list.setData((list.data ?? []).filter((x) => x.id !== b.id))
    try {
      const n = await assignBrand(b.id, target?.id ?? null)
      haptic()
      toast({
        icon: target ? '🔗' : '🏷️',
        msg: target ? `${b.name} → ${target.name} (${n} ${n === 1 ? 'Bier' : 'Biere'})` : `${b.name}: als Handelsmarke gemerkt`,
      })
    } catch (e) {
      toast({ icon: '⚠️', msg: (e as Error).message })
      list.reload()
    }
  }

  return (
    <>
      <h3>Marken ohne Brauerei</h3>
      <p className="muted small">
        Diese Marken aus Open Food Facts konnte der Katalog keiner Brauerei zuordnen
        {list.data ? ` – ${list.data.length} Marken mit ${total} Bieren` : ''}. Eine Zuordnung gilt sofort und für alle
        künftigen Katalog-Läufe. Handelsmarken (z. B. von Aldi oder Lidl) als „keine Brauerei“ markieren.
      </p>
      {(list.data?.length ?? 0) > 8 && <SearchInput value={filter} onChange={setFilter} placeholder="Marke filtern …" />}
      <ErrorBox msg={list.error} />
      {list.loading && !list.data && <SkeletonList rows={3} />}
      {list.data && items.length === 0 && (
        <EmptyState icon="🎉" title="Alles zugeordnet">
          <p>Keine offenen Marken.</p>
        </EmptyState>
      )}
      <div className="brand-list">
        {items.slice(0, 60).map((b) => (
          <BrandCard key={b.id} brand={b} index={index} onAssign={(t) => assign(b, t)} />
        ))}
      </div>
    </>
  )
}

function BrandCard({
  brand,
  index,
  onAssign,
}: {
  brand: UnassignedBrand
  index: SearchIndex | null
  onAssign: (target: IndexBrewery | null) => void
}) {
  const [q, setQ] = useState('')
  const [searching, setSearching] = useState(false)
  const suggestions = useMemo(() => candidatesFor(index, brand.name), [index, brand.name])
  const found = useMemo(() => (searching ? candidatesFor(index, q, 6) : []), [index, q, searching])
  return (
    <div className="card brand-card">
      <div className="brand-head">
        <b>{brand.name}</b>
        <span className="muted small">
          {brand.beers} {brand.beers === 1 ? 'Bier' : 'Biere'}
        </span>
      </div>
      {brand.examples && brand.examples.length > 0 && (
        <p className="small muted brand-ex">
          {brand.examples.join(' · ')}
          {brand.eans?.[0] ? ` · EAN ${brand.eans[0]}` : ''}
        </p>
      )}
      <div className="brand-actions">
        {suggestions.map((s) => (
          <button key={s.id} className="chip-btn brand-cand" onClick={() => onAssign(s)}>
            → {s.name}
            {s.city ? <span className="muted"> · {s.city}</span> : null}
          </button>
        ))}
        <button className="chip-btn" onClick={() => setSearching(!searching)}>
          🔎 Andere Brauerei …
        </button>
        <button className="chip-btn" onClick={() => onAssign(null)}>
          🏷️ Keine Brauerei / Handelsmarke
        </button>
      </div>
      {searching && (
        <div className="brand-search">
          <SearchInput autoFocus value={q} onChange={setQ} placeholder="Brauerei suchen …" />
          {found.map((s) => (
            <button key={s.id} className="row brand-pick" onClick={() => onAssign(s)}>
              <div className="row-main">
                <div className="row-title">{s.name}</div>
                <div className="row-sub">
                  {[s.city, `${s.beerCount} Biere`].filter(Boolean).join(' · ')}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
