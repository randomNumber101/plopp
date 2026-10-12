import { useEffect, useMemo, useState } from 'react'
import { breweryProgress, myCheckins } from '../api'
import {
  ACHIEVEMENTS,
  GROUPS,
  computeStats,
  markSeen,
  progress,
  timeline,
  useStatsContext,
  type BeerAgg,
  type Unit,
} from '../achievements'
import { BeerThumb, ChipBar, CountUp, EmptyState, ErrorBox, Spinner, Stars, formatRating, useAsync } from '../components'
import { go } from '../router'
import { usePageState } from '../pageState'
import { loadRegions, regionProgress } from '../regions'
import { quizStats, type Answer } from '../quiz'
import { STATES, type Checkin } from '../types'

const SHORT: Record<string, string> = {
  'Baden-Württemberg': 'BW',
  Bayern: 'BY',
  Berlin: 'BE',
  Brandenburg: 'BB',
  Bremen: 'HB',
  Hamburg: 'HH',
  Hessen: 'HE',
  'Mecklenburg-Vorpommern': 'MV',
  Niedersachsen: 'NI',
  'Nordrhein-Westfalen': 'NW',
  'Rheinland-Pfalz': 'RP',
  Saarland: 'SL',
  Sachsen: 'SN',
  'Sachsen-Anhalt': 'ST',
  'Schleswig-Holstein': 'SH',
  Thüringen: 'TH',
}
const MEDALS = ['🥇', '🥈', '🥉', '4.', '5.']
const rank = (i: number) => (i < 3 ? MEDALS[i] : `${i + 1}.`)

export default function Stats() {
  const data = useAsync(myCheckins, [], 'my-checkins')
  const ctx = useStatsContext()
  const s = useMemo(() => computeStats(data.data ?? [], ctx), [data.data, ctx])
  useEffect(() => {
    if (data.data) markSeen(s)
  }, [data.data, s])

  if (data.loading && !data.data) return <Spinner />
  if (data.error) return <ErrorBox msg={data.error} />
  if (!s.checkins)
    return (
      <div className="page">
        <EmptyState title="Noch keine Statistik">
          <p>Sobald du Biere einträgst, siehst du hier deine Zahlen und Abzeichen.</p>
        </EmptyState>
      </div>
    )

  const styles = [...s.styles.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  const maxStyle = Math.max(1, ...styles.map((x) => x[1]))
  const done = ACHIEVEMENTS.filter((a) => progress(a, s).done)
  const open = ACHIEVEMENTS.filter((a) => !progress(a, s).done).sort((a, b) => progress(b, s).pct - progress(a, s).pct)

  return (
    <div className="page">
      <h2>Deine Statistik</h2>
      {s.firstDate && (
        <p className="meta">
          seit {new Date(s.firstDate).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })} · {s.checkins}{' '}
          Check-ins
        </p>
      )}

      <div className="stat-row">
        <div className="stat">
          <b>
            <CountUp value={s.unique} />
          </b>
          <span>verschiedene</span>
        </div>
        <div className="stat">
          <b>
            <CountUp value={s.thisYear} />
          </b>
          <span>dieses Jahr</span>
        </div>
        <div className="stat">
          <b>{s.avgRating != null ? <CountUp value={s.avgRating} decimals={1} /> : '–'}</b>
          <span>Ø Sterne</span>
        </div>
      </div>

      <Review list={data.data ?? []} avgAbv={s.avgAbv} />

      {s.bestRated.length > 0 && <BestList list={s.bestRated} />}

      <RegionsCard />

      <QuizCard answers={ctx.quiz} />

      <h3>
        Abzeichen · {done.length}/{ACHIEVEMENTS.length}
      </h3>
      {GROUPS.map((grp) => {
        const items = [...done, ...open].filter((a) => a.group === grp)
        const n = items.filter((a) => progress(a, s).done).length
        return (
          <section key={grp} className="ach-group">
            <div className="ach-group-head">
              <b>{grp}</b>
              <span className="muted small">
                {n}/{items.length}
              </span>
            </div>
            <div className="badges">
              {items.map((a, i) => {
                const p = progress(a, s)
                return (
                  <div
                    key={a.id}
                    className={`ach ${p.done ? 'done' : ''}`}
                    style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
                    title={a.desc}
                  >
                    <div className="ach-icon">{a.icon}</div>
                    <div className="ach-title">{a.title}</div>
                    <div className="ach-desc">{a.desc}</div>
                    {!p.done && (
                      <>
                        <div className="ach-prog">
                          <i style={{ width: `${p.pct}%` }} />
                        </div>
                        <div className="ach-desc">
                          {p.value}/{a.goal}
                        </div>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}

      {styles.length > 0 && (
        <div className="card">
          <b>Lieblingssorten</b>
          <div className="hbars">
            {styles.map(([name, n], i) => (
              <div className="hbar" key={name}>
                <span>{name}</span>
                <span className="muted">{n}×</span>
                <div className="hbar-track">
                  <i style={{ width: `${(n / maxStyle) * 100}%`, animationDelay: `${i * 60}ms` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="section-title">
          <b>Bundesländer</b>
          <span className="muted small">{s.states.size}/16</span>
        </div>
        <div className="states">
          {STATES.map((st, i) => (
            <div
              key={st}
              className={`state ${s.states.has(st) ? 'on' : ''}`}
              title={st}
              style={{ animationDelay: `${i * 25}ms` }}
            >
              <b>{SHORT[st]}</b>
              {s.states.get(st) ?? 0}
            </div>
          ))}
        </div>
      </div>

      {s.topBeers.length > 0 && (
        <>
          <h3>Meistgetrunken</h3>
          <div className="list">
            {s.topBeers.map((a, i) => (
              <div key={a.beer.id} className="row" style={{ '--i': i } as React.CSSProperties} onClick={() => go(`/beer/${a.beer.id}`)}>
                <span className="medal">{MEDALS[i]}</span>
                <BeerThumb beer={a.beer} />
                <div className="row-main">
                  <div className="row-title">{a.beer.name}</div>
                  <div className="row-sub">{a.beer.brewery?.name}</div>
                </div>
                <div className="row-right">
                  <span className="count">{a.count}×</span>
                  {a.avg != null && <Stars value={Math.round(a.avg * 10) / 10} size="sm" />}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {s.topBreweries.length > 0 && (
        <>
          <h3>Lieblingsbrauereien</h3>
          <div className="list">
            {s.topBreweries.map((b, i) => (
              <div key={b.id} className="row" style={{ '--i': i } as React.CSSProperties} onClick={() => go(`/brewery/${b.id}`)}>
                <span className="medal">{MEDALS[i]}</span>
                <div className="row-main">
                  <div className="row-title">{b.name}</div>
                </div>
                <span className="count">{b.count}×</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ------------------------------------------------------------------------------------------ Rückblick

const UNITS: { id: Unit; label: string }[] = [
  { id: 'day', label: 'Tage' },
  { id: 'week', label: 'Wochen' },
  { id: 'month', label: 'Monate' },
  { id: 'year', label: 'Jahre' },
]

function Review({ list, avgAbv }: { list: Checkin[]; avgAbv: number | null }) {
  const [unit, setUnit] = usePageState<Unit>('stats-unit', 'month')
  const buckets = useMemo(() => timeline(list, unit), [list, unit])
  const [sel, setSel] = useState<number | null>(null)
  const idx = sel != null && sel < buckets.length ? sel : buckets.length - 1
  const b = buckets[idx]
  const max = Math.max(1, ...buckets.map((x) => x.checkins.length))

  // erstmals getrunkene Biere (für „neu“)
  const firstSeen = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of list) {
      const t = new Date(c.drunk_at).getTime()
      if (!m.has(c.beer_id) || t < m.get(c.beer_id)!) m.set(c.beer_id, t)
    }
    return m
  }, [list])

  const beers = useMemo(() => {
    const m = new Map<string, { c: Checkin; n: number; ratings: number[] }>()
    for (const c of b?.checkins ?? []) {
      const x = m.get(c.beer_id) ?? { c, n: 0, ratings: [] }
      x.n++
      if (c.rating != null) x.ratings.push(c.rating)
      m.set(c.beer_id, x)
    }
    return [...m.values()].sort((x, y) => y.n - x.n)
  }, [b])
  const fresh = beers.filter((x) => {
    const t = firstSeen.get(x.c.beer_id)
    return t != null && b && t >= b.start.getTime() && t < b.end.getTime()
  }).length
  const ratings = beers.flatMap((x) => x.ratings)
  const avg = ratings.length ? ratings.reduce((a, c) => a + c, 0) / ratings.length : null

  return (
    <div className="card review">
      <div className="section-title">
        <b>Rückblick</b>
        <span className="muted small">{avgAbv != null ? `Ø ${avgAbv.toFixed(1)} % vol` : ''}</span>
      </div>
      <ChipBar
        value={unit}
        onChange={(v) => {
          setUnit((v || 'month') as Unit)
          setSel(null)
        }}
        options={UNITS}
      />
      <div className={`bars bars-${unit}`}>
        {buckets.map((x, i) => (
          <button
            key={x.key}
            className={`bar ${x.checkins.length ? '' : 'zero'} ${i === idx ? 'sel' : ''}`}
            title={`${x.long}: ${x.checkins.length}`}
            onClick={() => setSel(i)}
          >
            {x.checkins.length > 0 && <b>{x.checkins.length}</b>}
            <i style={{ height: `${(x.checkins.length / max) * 72}%`, animationDelay: `${i * 30}ms` }} />
            <span>{x.label}</span>
          </button>
        ))}
      </div>
      {b && (
        <div className="review-detail">
          <div className="review-head">
            <b>{b.long}</b>
            <span className="muted small">
              {b.checkins.length
                ? [
                    `${b.checkins.length} Check-in${b.checkins.length === 1 ? '' : 's'}`,
                    `${beers.length} verschiedene`,
                    fresh ? `${fresh} neu` : null,
                    avg != null ? `Ø ${formatRating(avg)} ★` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : 'nichts eingetragen'}
            </span>
          </div>
          {beers.length > 0 && (
            <div className="list review-list">
              {beers.slice(0, 8).map(({ c, n, ratings: r }) => (
                <div key={c.beer_id} className="row" onClick={() => go(`/beer/${c.beer_id}`)}>
                  {c.beer && <BeerThumb beer={c.beer} />}
                  <div className="row-main">
                    <div className="row-title">{c.beer?.name}</div>
                    <div className="row-sub">{c.beer?.brewery?.name}</div>
                  </div>
                  <div className="row-right">
                    {n > 1 && <span className="count">{n}×</span>}
                    {r.length > 0 && <Stars value={Math.round((r.reduce((a, x) => a + x, 0) / r.length) * 10) / 10} size="sm" />}
                  </div>
                </div>
              ))}
              {beers.length > 8 && <div className="row muted small">… und {beers.length - 8} weitere</div>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------------------------------ Bestenliste

function BestList({ list }: { list: BeerAgg[] }) {
  const [all, setAll] = useState(false)
  const shown = all ? list.slice(0, 50) : list.slice(0, 10)
  return (
    <>
      <h3>
        Deine Bestenliste <span className="muted small">· {list.length} bewertet</span>
      </h3>
      <div className="list best-list">
        {shown.map((a, i) => (
          <div
            key={a.beer.id}
            className={`row ${i < 3 ? 'podium' : ''}`}
            style={{ '--i': Math.min(i, 12) } as React.CSSProperties}
            onClick={() => go(`/beer/${a.beer.id}`)}
          >
            <span className="medal">{rank(i)}</span>
            <BeerThumb beer={a.beer} />
            <div className="row-main">
              <div className="row-title">{a.beer.name}</div>
              <div className="row-sub">
                {[a.beer.brewery?.name, a.rated > 1 ? `${a.rated} Bewertungen` : null].filter(Boolean).join(' · ')}
              </div>
            </div>
            <div className="row-right best-score">
              <b>{formatRating(a.avg!)}</b>
              <Stars value={Math.round(a.avg! * 10) / 10} size="sm" />
            </div>
          </div>
        ))}
      </div>
      {list.length > 10 && (
        <button className="link" onClick={() => setAll(!all)}>
          {all ? 'weniger zeigen' : `alle ${Math.min(list.length, 50)} zeigen`}
        </button>
      )}
    </>
  )
}

// ------------------------------------------------------------------------------------------ Regionen

function RegionsCard() {
  const regions = useAsync(loadRegions, [])
  const prog = useAsync(breweryProgress, [], 'brewery_progress')
  const [, setMapLayer] = usePageState<'pins' | 'regions'>('map-layer', 'pins')
  const [all, setAll] = useState(false)
  const rows = useMemo(
    () =>
      regions.data && prog.data
        ? regionProgress(regions.data, prog.data)
            .filter((r) => r.breweries > 0)
            .sort((a, b) => b.visited - a.visited || b.visited / b.breweries - a.visited / a.breweries)
        : null,
    [regions.data, prog.data],
  )
  if (!rows) return null
  const explored = rows.filter((r) => r.visited > 0).length
  const shown = all ? rows : rows.filter((r) => r.visited > 0).slice(0, 6)
  return (
    <div className="card">
      <div className="section-title">
        <b>Bier-Regionen</b>
        <span className="muted small">
          {explored}/{rows.length} erkundet
        </span>
      </div>
      <div className="run-bar">
        <span style={{ width: `${(explored / rows.length) * 100}%` }} />
      </div>
      {shown.length === 0 && <p className="muted small">Noch keine Region erkundet – jede probierte Brauerei färbt ihre Region ein.</p>}
      <div className="region-rows">
        {shown.map((r) => (
          <div key={r.region.id} className={`region-row ${r.visited ? '' : 'todo'}`}>
            <span className="region-name">{r.region.name}</span>
            <span className="muted small">
              {r.visited}/{r.breweries}
            </span>
            <div className="hbar-track">
              <i style={{ width: `${Math.max(r.visited ? 4 : 0, (r.visited / r.breweries) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="btn-row">
        <button
          className="btn btn-small"
          onClick={() => {
            setMapLayer('regions')
            go('/map')
          }}
        >
          🗺️ Auf der Karte
        </button>
        <button className="link" onClick={() => setAll(!all)}>
          {all ? 'nur erkundete' : 'alle Regionen'}
        </button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------------------------------ Bierquiz

function QuizCard({ answers }: { answers?: Answer[] }) {
  const q = quizStats(answers ?? [])
  return (
    <div className="card quiz-stats">
      <div className="section-title">
        <b>🧠 Bierquiz</b>
        <span className="muted small">{q.answered ? `${Math.round((q.correct / q.answered) * 100)} % richtig` : 'noch nicht gespielt'}</span>
      </div>
      {q.answered > 0 && (
        <div className="stat-row">
          <div className="stat">
            <b>{q.correct}</b>
            <span>richtig</span>
          </div>
          <div className="stat">
            <b>{q.bestStreak}</b>
            <span>beste Serie</span>
          </div>
          <div className="stat">
            <b>{q.exact}</b>
            <span>Volltreffer</span>
          </div>
        </div>
      )}
      <button className="btn btn-primary" onClick={() => go('/quiz')}>
        {q.answered ? 'Neue Runde' : 'Quiz starten'}
      </button>
    </div>
  )
}
