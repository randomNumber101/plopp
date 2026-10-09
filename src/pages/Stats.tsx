import { useEffect, useMemo } from 'react'
import { myCheckins } from '../api'
import { ACHIEVEMENTS, computeStats, markSeen, progress } from '../achievements'
import { BeerThumb, CountUp, EmptyState, ErrorBox, Spinner, Stars, useAsync } from '../components'
import { go } from '../router'
import { STATES } from '../types'

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

export default function Stats() {
  const data = useAsync(myCheckins, [])
  const s = useMemo(() => computeStats(data.data ?? []), [data.data])
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

  const maxMonth = Math.max(1, ...s.months.map((m) => m.count))
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

      <div className="card">
        <div className="section-title">
          <b>Letzte 12 Monate</b>
          <span className="muted small">{s.avgAbv != null ? `Ø ${s.avgAbv.toFixed(1)} % vol` : ''}</span>
        </div>
        <div className="bars">
          {s.months.map((m, i) => (
            <div key={m.key} className={`bar ${m.count ? '' : 'zero'}`} title={`${m.count} im ${m.key}`}>
              {m.count > 0 && <b>{m.count}</b>}
              <i style={{ height: `${(m.count / maxMonth) * 72}%`, animationDelay: `${i * 40}ms` }} />
              <span>{m.label}</span>
            </div>
          ))}
        </div>
      </div>

      <h3>
        Abzeichen · {done.length}/{ACHIEVEMENTS.length}
      </h3>
      <div className="badges">
        {[...done, ...open].map((a, i) => {
          const p = progress(a, s)
          return (
            <div key={a.id} className={`ach ${p.done ? 'done' : ''}`} style={{ animationDelay: `${i * 30}ms` }} title={a.desc}>
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
