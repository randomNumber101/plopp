/**
 * Abzeichen: eigene Seite mit zwei Reitern.
 * „Sammlung“ (alles rund ums Biertrinken) im Kasten-Look – jedes Abzeichen ein Kronkorken im Fach.
 * „Losbude“: oben die Herzenbude mit den gewonnenen Abend-Challenges (je Challenge ein Lebkuchenherz),
 * darunter schlicht die Abzeichen zu Challenges und Bierquiz.
 * Antippen öffnet ein Blatt mit der Erklärung, was man dafür tun muss.
 */
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { myCheckins } from '../api'
import { ACHIEVEMENTS, GROUPS, computeStats, markSeen, progress, useStatsContext, type Achievement } from '../achievements'
import { byId, type ChallengeDef } from '../challenges'
import { ErrorBox, Spinner, formatDate, useAsync } from '../components'
import { usePageState } from '../pageState'
import { go } from '../router'

const RUMMEL_GROUPS = new Set<string>(['Challenges', 'Bierquiz'])

/** Zuckerguss-Rand und Herzfarbe – stabil je Challenge */
const RIMS = ['var(--rummel-red)', 'var(--bulb)', '#3fc1a5', '#ff7eb6', '#7aa7ff', '#b48cff', '#ff9a3c']
const GINGER = ['var(--ginger)', '#a8642d', '#8c4f22', '#b5743a']
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)

const KIND: Record<ChallengeDef['kind'], string> = {
  auto: 'Erkennt die App an deinen Check-ins',
  manual: 'Selbst abhaken',
  quiz: 'Bierquiz-Runde',
}

interface Info {
  icon: string
  title: string
  how: string
  hint?: string
  done: boolean
  value?: number
  goal?: number
  pct?: number
  rummel?: boolean
}

function InfoSheet({ info, onClose }: { info: Info; onClose: () => void }) {
  return createPortal(
    <div className="choice-backdrop" onClick={onClose}>
      <div className={`choice-sheet badge-sheet ${info.rummel ? 'rummel' : ''}`} role="dialog" aria-label={info.title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className={`bs-icon ${info.done ? 'done' : ''}`}>{info.icon}</div>
        <b className="bs-title">{info.title}</b>
        <p className="bs-how">{info.how}</p>
        {info.hint && <p className="bs-hint">{info.hint}</p>}
        {info.goal != null && (
          <div className="bs-prog">
            <div className="bs-bar">
              <i style={{ width: `${info.pct ?? 0}%` }} />
            </div>
            <span>{info.done ? 'Geschafft' : `${info.value}/${info.goal}`}</span>
          </div>
        )}
        <button className="btn btn-ghost" onClick={onClose}>
          Schließen
        </button>
      </div>
    </div>,
    document.body,
  )
}

export default function Badges() {
  const data = useAsync(myCheckins, [], 'my-checkins')
  const ctx = useStatsContext()
  const s = useMemo(() => computeStats(data.data ?? [], ctx), [data.data, ctx])
  const [tab, setTab] = usePageState<'sammlung' | 'losbude'>('badges-tab', 'sammlung')
  const [open, setOpen] = useState<Info | null>(null)
  useEffect(() => {
    if (data.data) markSeen(s)
  }, [data.data, s])

  // gewonnene Abend-Challenges: je Challenge ein Herz, mit Anzahl und letztem Datum
  const won = useMemo(() => {
    const m = new Map<string, { def: ChallengeDef; n: number; last: string }>()
    for (const r of ctx.challenges ?? []) {
      if (r.status !== 'geschafft') continue
      const def = byId(r.challenge)
      if (!def) continue
      const t = r.completed_at ?? r.started_at
      const e = m.get(def.id)
      if (e) {
        e.n++
        if (t > e.last) e.last = t
      } else m.set(def.id, { def, n: 1, last: t })
    }
    return [...m.values()].sort((a, b) => (a.last < b.last ? 1 : -1))
  }, [ctx.challenges])

  if (data.loading && !data.data) return <Spinner />
  if (data.error) return <ErrorBox msg={data.error} />

  const groups = GROUPS.filter((g) => (tab === 'losbude') === RUMMEL_GROUPS.has(g))
  const all = ACHIEVEMENTS.filter((a) => groups.includes(a.group))
  const doneAll = (list: Achievement[]) => list.filter((a) => progress(a, s).done).length
  const sammlung = ACHIEVEMENTS.filter((a) => !RUMMEL_GROUPS.has(a.group))
  // geschaffte zuerst, offene nach Fortschritt
  const sorted = (grp: string) =>
    all
      .filter((a) => a.group === grp)
      .sort((x, y) => Number(progress(y, s).done) - Number(progress(x, s).done) || progress(y, s).pct - progress(x, s).pct)

  const openBadge = (a: Achievement, rummel = false) => {
    const p = progress(a, s)
    setOpen({ icon: a.icon, title: a.title, how: a.desc, done: p.done, value: p.value, goal: a.goal, pct: p.pct, rummel })
  }

  return (
    <div className={`page badges-page ${tab}`}>
      <h2>Abzeichen</h2>
      <div className="tabs" style={{ '--i': tab === 'sammlung' ? 0 : 1, '--n': 2 } as React.CSSProperties}>
        <span className="tabs-ind" />
        <button className={tab === 'sammlung' ? 'on' : ''} onClick={() => setTab('sammlung')}>
          Sammlung <span className="tab-count">{doneAll(sammlung)}/{sammlung.length}</span>
        </button>
        <button className={tab === 'losbude' ? 'on' : ''} onClick={() => setTab('losbude')}>
          Losbude <span className="tab-count">{won.length}</span>
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
                    <button
                      key={a.id}
                      className={`bc-cell ${p.done ? 'done' : ''}`}
                      onClick={() => openBadge(a)}
                      aria-label={`${a.title}: ${a.desc}`}
                      style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
                    >
                      <span className="bc-slot">
                        <span className="kk bc-cap" style={p.done ? undefined : ({ '--p': `${p.pct}%` } as React.CSSProperties)}>
                          <span className="bc-icon">{a.icon}</span>
                        </span>
                      </span>
                      <b className="bc-title">{a.title}</b>
                      <span className="bc-desc">{p.done ? 'Geschafft' : `${p.value}/${a.goal}`}</span>
                    </button>
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
            <span>{won.length}</span>
          </div>
          {won.length ? (
            <div className="badges hb-won">
              {won.map((w, i) => {
                const h = hash(w.def.id)
                return (
                  <button
                    key={w.def.id}
                    className="ach done won"
                    onClick={() =>
                      setOpen({
                        icon: w.def.icon,
                        title: w.def.title,
                        how: w.def.desc,
                        hint: `${KIND[w.def.kind]} · ${w.n === 1 ? 'einmal' : `${w.n}-mal`} geschafft, zuletzt am ${formatDate(w.last)}`,
                        done: true,
                        rummel: true,
                      })
                    }
                    aria-label={`${w.def.title}, ${w.n}-mal geschafft`}
                    style={
                      {
                        animationDelay: `${Math.min(i, 12) * 30}ms`,
                        '--tilt': `${(h % 7) - 3}deg`,
                        '--str': `${12 + (h % 18)}px`,
                        '--rim': RIMS[h % RIMS.length],
                        '--gb': GINGER[(h >> 3) % GINGER.length],
                      } as React.CSSProperties
                    }
                  >
                    <svg className="ach-heart" viewBox="0 0 160 146" preserveAspectRatio="none" aria-hidden="true">
                      <path d="M80 140C40 112 6 86 6 46 6 22 24 6 46 6c15 0 27 8 34 20 7-12 19-20 34-20 22 0 40 16 40 40 0 40-34 66-74 94Z" />
                      <path className="icing" d="M80 126C46 102 18 80 18 47 18 30 31 18 47 18c14 0 25 9 33 24 8-15 19-24 33-24 16 0 29 12 29 29 0 33-28 55-62 79Z" />
                    </svg>
                    <div className="ach-icon">{w.def.icon}</div>
                    <div className="ach-title">{w.def.title}</div>
                    {w.n > 1 && <div className="hb-n">×{w.n}</div>}
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="hb-empty">
              <p>Noch kein Herz an der Bude.</p>
              <button className="btn" onClick={() => go('/challenge')}>
                Zur Abend-Challenge
              </button>
            </div>
          )}

          <div className="hb-meta">
            {groups.map((grp) => {
              const items = sorted(grp)
              return (
                <section key={grp} className="hb-meta-group">
                  <div className="hb-meta-head">
                    <b>{grp === 'Challenges' ? 'Challenge-Abzeichen' : 'Quiz-Abzeichen'}</b>
                    <span>
                      {doneAll(items)}/{items.length}
                    </span>
                  </div>
                  {items.map((a) => {
                    const p = progress(a, s)
                    return (
                      <button key={a.id} className={`hb-meta-row ${p.done ? 'done' : ''}`} onClick={() => openBadge(a, true)}>
                        <span className="hb-meta-icon">{a.icon}</span>
                        <span className="hb-meta-main">
                          <b>{a.title}</b>
                          <i style={{ width: `${p.pct}%` }} />
                        </span>
                        <span className="hb-meta-val">{p.done ? '✓' : `${p.value}/${a.goal}`}</span>
                      </button>
                    )
                  })}
                </section>
              )
            })}
          </div>
        </div>
      )}
      {open && <InfoSheet info={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
