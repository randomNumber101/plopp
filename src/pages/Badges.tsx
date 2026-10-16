/**
 * Abzeichen: eigene Seite mit zwei Reitern.
 * „Sammlung“ (alles rund ums Biertrinken) im Kasten-Look – jedes Abzeichen ein Kronkorken im Fach.
 * „Losbude“ (Abend-Challenges und Bierquiz) auf dem Rummel – Lebkuchenherzen an der Herzenbude.
 */
import { useEffect, useMemo } from 'react'
import { myCheckins } from '../api'
import { ACHIEVEMENTS, GROUPS, computeStats, markSeen, progress, useStatsContext, type Achievement } from '../achievements'
import { ErrorBox, Spinner, useAsync } from '../components'
import { usePageState } from '../pageState'

const RUMMEL_GROUPS = new Set<string>(['Challenges', 'Bierquiz'])

export default function Badges() {
  const data = useAsync(myCheckins, [], 'my-checkins')
  const ctx = useStatsContext()
  const s = useMemo(() => computeStats(data.data ?? [], ctx), [data.data, ctx])
  const [tab, setTab] = usePageState<'sammlung' | 'losbude'>('badges-tab', 'sammlung')
  useEffect(() => {
    if (data.data) markSeen(s)
  }, [data.data, s])

  if (data.loading && !data.data) return <Spinner />
  if (data.error) return <ErrorBox msg={data.error} />

  const groups = GROUPS.filter((g) => (tab === 'losbude') === RUMMEL_GROUPS.has(g))
  const all = ACHIEVEMENTS.filter((a) => groups.includes(a.group))
  const doneAll = (list: Achievement[]) => list.filter((a) => progress(a, s).done).length
  const sammlung = ACHIEVEMENTS.filter((a) => !RUMMEL_GROUPS.has(a.group))
  const losbude = ACHIEVEMENTS.filter((a) => RUMMEL_GROUPS.has(a.group))
  // geschaffte zuerst, offene nach Fortschritt
  const sorted = (grp: string) =>
    all
      .filter((a) => a.group === grp)
      .sort((x, y) => Number(progress(y, s).done) - Number(progress(x, s).done) || progress(y, s).pct - progress(x, s).pct)

  return (
    <div className={`page badges-page ${tab}`}>
      <h2>Abzeichen</h2>
      <div className="tabs" style={{ '--i': tab === 'sammlung' ? 0 : 1, '--n': 2 } as React.CSSProperties}>
        <span className="tabs-ind" />
        <button className={tab === 'sammlung' ? 'on' : ''} onClick={() => setTab('sammlung')}>
          Sammlung <span className="tab-count">{doneAll(sammlung)}/{sammlung.length}</span>
        </button>
        <button className={tab === 'losbude' ? 'on' : ''} onClick={() => setTab('losbude')}>
          Losbude <span className="tab-count">{doneAll(losbude)}/{losbude.length}</span>
        </button>
      </div>

      {tab === 'sammlung' ? (
        groups.map((grp) => {
          const items = sorted(grp)
          return (
            <section key={grp} className="bc-crate">
              <i className="ks-grip" aria-hidden="true" />
              <div className="bc-head">
                <b>{grp}</b>
                <span>
                  {doneAll(items)}/{items.length}
                </span>
              </div>
              <div className="bc-grid">
                {items.map((a, i) => {
                  const p = progress(a, s)
                  return (
                    <div key={a.id} className={`bc-cell ${p.done ? 'done' : ''}`} title={a.desc} style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}>
                      <span className="bc-slot">
                        <span className="kk bc-cap" style={p.done ? undefined : ({ '--p': `${p.pct}%` } as React.CSSProperties)}>
                          <span className="bc-icon">{a.icon}</span>
                        </span>
                      </span>
                      <b className="bc-title">{a.title}</b>
                      <span className="bc-desc">{p.done ? a.desc : `${p.value}/${a.goal}`}</span>
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })
      ) : (
        <div className="herzenbude">
          <div className="hb-awning" aria-hidden="true" />
          <div className="hb-head">
            <h3>Herzenbude</h3>
            <span>
              {doneAll(all)} von {all.length}
            </span>
          </div>
          {groups.map((grp) => {
            const items = sorted(grp)
            return (
              <section key={grp} className="ach-group">
                <div className="ach-group-head">
                  <b>{grp === 'Challenges' ? 'Abend-Challenges' : grp}</b>
                  <span className="muted small">
                    {doneAll(items)}/{items.length}
                  </span>
                </div>
                <div className="badges">
                  {items.map((a, i) => {
                    const p = progress(a, s)
                    return (
                      <div
                        key={a.id}
                        className={`ach ${p.done ? 'done' : ''}`}
                        style={{ animationDelay: `${Math.min(i, 12) * 30}ms`, '--tilt': `${((i * 7) % 7) - 3}deg`, '--str': `${12 + ((i * 5) % 18)}px` } as React.CSSProperties}
                        title={a.desc}
                      >
                        <svg className="ach-heart" viewBox="0 0 160 146" preserveAspectRatio="none" aria-hidden="true">
                          <path d="M80 140C40 112 6 86 6 46 6 22 24 6 46 6c15 0 27 8 34 20 7-12 19-20 34-20 22 0 40 16 40 40 0 40-34 66-74 94Z" />
                          <path className="icing" d="M80 126C46 102 18 80 18 47 18 30 31 18 47 18c14 0 25 9 33 24 8-15 19-24 33-24 16 0 29 12 29 29 0 33-28 55-62 79Z" />
                        </svg>
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
        </div>
      )}
    </div>
  )
}
