import { useMemo, useRef, useState } from 'react'
import {
  CHALLENGES,
  abortChallenge,
  byId,
  confirmChallenge,
  fmtLeft,
  refreshChallenges,
  startChallenge,
  useChallenges,
  type ChallengeDef,
  type ChallengeRow,
} from '../challenges'
import { ErrorBox, Spinner, toast } from '../components'
import { go } from '../router'
import { haptic, load, reducedMotion, save, startRummel } from '../ui/fx'

const KIND_COLOR: Record<ChallengeDef['kind'], string> = { auto: '#1f4e8c', manual: '#c8102e', quiz: '#6d3fa0' }
const KIND_LABEL: Record<ChallengeDef['kind'], string> = { auto: 'zählt von selbst', manual: 'selbst abhaken', quiz: 'Bierquiz' }

function Bulbs({ n, cls = '' }: { n: number; cls?: string }) {
  return (
    <span className={`bulb-row bulbs-chase ${cls}`} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className="bulb" />
      ))}
    </span>
  )
}

export default function Challenge() {
  const st = useChallenges()
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const now = Date.now()
  const night = st.night

  const totals = useMemo(() => {
    const done = st.rows.filter((r) => r.status === 'geschafft')
    return {
      done: done.length,
      kinds: new Set(done.map((r) => r.challenge)).size,
      nights: new Set(done.map((r) => r.night)).size,
    }
  }, [st.rows])

  async function run(key: string, f: () => Promise<unknown>) {
    setBusy(key)
    setErr(null)
    try {
      await f()
    } catch (e) {
      setErr((e as Error).message)
    }
    setBusy(null)
  }

  if (!st.loaded) return <Spinner />

  const def = st.active ? byId(st.active.challenge) : null
  const p = st.progress
  const doneTonight = st.tonight.filter((r) => r.status === 'geschafft')
  const left = night.open ? fmtLeft(night.end.getTime() - now) : fmtLeft(night.start.getTime() - now)

  return (
    <div className="page challenge-page">
      <div className="los-ticket">
        <Bulbs n={12} />
        <h2>Abend-Los</h2>
        <p>{night.open ? `bis 4 Uhr, noch ${left}` : `Die Losbude öffnet um 16 Uhr, in ${left}`}</p>
        {doneTonight.length > 0 && (
          <span className="los-count" title="Heute geschafft">
            {doneTonight.length}
          </span>
        )}
      </div>
      <ErrorBox msg={err ?? st.error ?? null} />

      {night.open && st.active && def && (
        <div className="los-body los-active">
          <div className="los-mark big" style={{ background: KIND_COLOR[def.kind] }} aria-hidden="true">
            {def.icon}
          </div>
          <div className="los-kind">{KIND_LABEL[def.kind]}</div>
          <h3>{def.title}</h3>
          <p>{def.desc}</p>
          {p && (
            <div className="los-progress" aria-label={`${p.cur} von ${p.goal}`}>
              {p.goal <= 8 ? (
                Array.from({ length: p.goal }, (_, i) => <span key={i} className={`bulb ${i < p.cur ? 'lit' : 'off'}`} />)
              ) : (
                <b>
                  {p.cur} / {p.goal} {p.unit ?? ''}
                </b>
              )}
            </div>
          )}
          <div className="los-actions">
            {def.kind === 'quiz' ? (
              <button className="los-go" onClick={() => go('/quiz/challenge')}>
                Zum Quiz
              </button>
            ) : def.kind === 'manual' ? (
              <button className="los-go" disabled={!!busy} onClick={() => run('ok', confirmChallenge)}>
                Geschafft!
              </button>
            ) : (
              <button className="los-go" onClick={() => go('/catalog')}>
                Bier erfassen
              </button>
            )}
            <button
              className="los-quit"
              disabled={!!busy}
              onClick={() =>
                run('abort', async () => {
                  await abortChallenge()
                  toast({ icon: '🔄', msg: 'Aufgegeben, neues Los wartet' })
                })
              }
            >
              Aufgeben
            </button>
          </div>
          {def.kind === 'auto' && (
            <button className="los-link" disabled={!!busy} onClick={() => run('ok', confirmChallenge)}>
              Geschafft, aber nicht erkannt
            </button>
          )}
        </div>
      )}

      {night.open && !st.active && st.offer.length > 0 && (
        <ScratchCard
          night={night.night}
          offer={st.offer}
          busy={busy}
          onPick={(id) =>
            run(id, async () => {
              await startChallenge(id)
              startRummel(id)
            })
          }
        />
      )}
      {night.open && !st.active && st.offer.length === 0 && <div className="los-body los-empty">Heute ist kein Los mehr übrig. Respekt!</div>}

      {!night.open && (
        <div className="los-body los-closed">
          <p>Ab 16 Uhr gibt es drei Felder zum Freirubbeln. Eins davon spielst du bis 4 Uhr, ist es geschafft, wartet das nächste Los.</p>
          <button className="los-link" onClick={() => refreshChallenges()}>
            Aktualisieren
          </button>
        </div>
      )}

      {doneTonight.length > 0 && (
        <>
          <h3 className="rummel-h">Heute geschafft</h3>
          <div className="ch-done-list">
            {doneTonight.map((r) => (
              <DoneRow key={r.id} row={r} />
            ))}
          </div>
        </>
      )}

      <button className="quiz-booth" onClick={() => go('/quiz')}>
        <span className="qb-awning" aria-hidden="true" />
        <span className="qb-main">
          <b>Bierquiz</b>
          <span>5 Fragen, jederzeit</span>
        </span>
      </button>

      <div className="rummel-stats">
        <div>
          <b>{totals.done}</b>
          <span>geschafft</span>
        </div>
        <div>
          <b>
            {totals.kinds}/{CHALLENGES.length}
          </b>
          <span>verschiedene</span>
        </div>
        <div>
          <b>{totals.nights}</b>
          <span>Abende</span>
        </div>
      </div>

      <History rows={st.rows.filter((r) => r.night !== night.night || r.status === 'verpasst')} />

      <p className="ch-note">Alkoholfreie Biere zählen überall mit. Keine Challenge verlangt mehr als 3 Biere.</p>
    </div>
  )
}

/** Drei Felder zum Freirubbeln: mit dem Finger wischen (oder antippen, dann rubbelt eine Münze). Danach eins wählen. */
function ScratchCard({ night, offer, busy, onPick }: { night: string; offer: string[]; busy: string | null; onPick: (id: string) => void }) {
  const key = `plopp-los-${night}-${offer.join(',')}`
  const [open, setOpen] = useState<number[]>(() => load<number[]>(key, offer.map(() => 0)))
  const [coin, setCoin] = useState<number | null>(null)
  const last = useRef<{ i: number; x: number } | null>(null)
  const dragged = useRef(false)

  const set = (i: number, v: number) =>
    setOpen((prev) => {
      const next = prev.slice()
      next[i] = Math.max(next[i] ?? 0, v)
      save(key, next)
      return next
    })

  const allOpen = offer.every((_, i) => (open[i] ?? 0) >= 100)
  const hidden = offer.filter((_, i) => (open[i] ?? 0) < 100).length

  return (
    <div className="los-body">
      {offer.map((id, i) => {
        const c = byId(id)
        if (!c) return null
        const pct = open[i] ?? 0
        const done = pct >= 100
        return (
          <div key={id} className="los-field">
            <button className="los-prize" disabled={!done || !!busy} onClick={() => onPick(id)} aria-label={`${c.title} spielen`}>
              <span className="los-mark" style={{ background: KIND_COLOR[c.kind] }} aria-hidden="true">
                {c.icon}
              </span>
              <span className="los-prize-text">
                <b>{c.title}</b>
                <span>{c.desc}</span>
                <span className="los-kind">{KIND_LABEL[c.kind]}</span>
              </span>
              {busy === id && <Spinner />}
            </button>
            {!done && (
              <button
                className="los-foil"
                style={{ clipPath: `inset(0 0 0 ${pct}%)` }}
                aria-label={`Feld ${i + 1} freirubbeln`}
                onPointerDown={(e) => {
                  last.current = { i, x: e.clientX }
                  dragged.current = false
                }}
                onPointerMove={(e) => {
                  if (e.pointerType === 'mouse' && !e.buttons) return
                  const l = last.current
                  const dist = l && l.i === i ? Math.abs(e.clientX - l.x) : 0
                  last.current = { i, x: e.clientX }
                  if (dist < 2) return
                  dragged.current = true
                  const v = pct + Math.min(6, dist / 6)
                  if (Math.floor(v / 12) > Math.floor(pct / 12)) haptic(4)
                  set(i, v >= 70 ? 100 : v)
                }}
                onPointerUp={() => (last.current = null)}
                onClick={() => {
                  if (dragged.current) return
                  haptic(10)
                  if (reducedMotion()) return set(i, 100)
                  setCoin(i)
                  window.setTimeout(() => {
                    set(i, 100)
                    setCoin(null)
                  }, 480)
                }}
              >
                rubbeln
              </button>
            )}
            {coin === i && <span className="los-coin" aria-hidden="true" />}
          </div>
        )
      })}
      <div className="los-hint">{allOpen ? 'Tipp eins an' : hidden === 1 ? 'Noch 1 Feld verdeckt' : `Noch ${hidden} Felder verdeckt`}</div>
    </div>
  )
}

function DoneRow({ row }: { row: ChallengeRow }) {
  const c = byId(row.challenge)
  return (
    <div className={`ch-done st-${row.status}`}>
      <span className="los-mark small" style={{ background: row.status === 'geschafft' ? KIND_COLOR[c?.kind ?? 'auto'] : '#4a4f86' }} aria-hidden="true">
        {c?.icon ?? '🎯'}
      </span>
      <span className="ch-done-main">
        <b>{c?.title ?? row.challenge}</b>
        <span>
          {row.status === 'geschafft'
            ? `${row.confirmed ? 'abgehakt' : 'erkannt'} um ${new Date(row.completed_at ?? row.started_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
            : row.status === 'verpasst'
              ? 'verpasst'
              : 'aufgegeben'}
        </span>
      </span>
      <span className={`bulb ${row.status === 'geschafft' ? 'lit' : 'off'}`} aria-hidden="true" />
    </div>
  )
}

function History({ rows }: { rows: ChallengeRow[] }) {
  const nights = useMemo(() => {
    const m = new Map<string, ChallengeRow[]>()
    for (const r of rows) {
      if (r.status === 'aktiv') continue
      m.set(r.night, [...(m.get(r.night) ?? []), r])
    }
    return [...m.entries()].slice(0, 10)
  }, [rows])
  if (!nights.length) return null
  return (
    <details className="ch-history">
      <summary>Frühere Abende</summary>
      {nights.map(([n, list]) => (
        <div key={n} className="ch-history-night">
          <div className="rummel-day">{new Date(n + 'T12:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          {list.map((r) => (
            <DoneRow key={r.id} row={r} />
          ))}
        </div>
      ))}
    </details>
  )
}
