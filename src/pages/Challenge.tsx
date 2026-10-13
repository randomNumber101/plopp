import { useMemo, useState } from 'react'
import {
  CHALLENGES,
  abortChallenge,
  byId,
  confirmChallenge,
  fmtLeft,
  refreshChallenges,
  startChallenge,
  useChallenges,
  type ChallengeRow,
} from '../challenges'
import { ErrorBox, Spinner, toast } from '../components'
import { go } from '../router'

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

  return (
    <div className="page challenge-page">
      <div className={`ch-hero ${night.open ? 'open' : 'closed'}`}>
        <div className="ch-hero-moon" aria-hidden="true">
          {night.open ? '🌙' : '☀️'}
        </div>
        <div>
          <h2>Abend-Challenge</h2>
          <p className="ch-hero-sub">
            {night.open
              ? `Noch ${fmtLeft(night.end.getTime() - now)} – bis 4 Uhr`
              : `Startet um 16 Uhr · in ${fmtLeft(night.start.getTime() - now)}`}
          </p>
        </div>
        {doneTonight.length > 0 && (
          <div className="ch-hero-count" title="Heute geschafft">
            <b>{doneTonight.length}</b>
            <span>heute</span>
          </div>
        )}
      </div>
      <ErrorBox msg={err ?? st.error ?? null} />

      {night.open && st.active && def && (
        <div className="card ch-active">
          <div className={`ch-big-icon cap cap-${def.kind}`}>{def.icon}</div>
          <div className="ch-kicker">
            {def.kind === 'auto' ? 'Läuft · wird automatisch erkannt' : def.kind === 'quiz' ? 'Läuft · Bierquiz' : 'Läuft · selbst abhaken'}
          </div>
          <h3>{def.title}</h3>
          <p>{def.desc}</p>
          {p && (
            <div className="ch-progress">
              <div className="run-bar">
                <span style={{ width: `${Math.min(100, (p.cur / p.goal) * 100)}%` }} />
              </div>
              <span className="small">
                {p.cur} / {p.goal} {p.unit ?? ''}
              </span>
            </div>
          )}
          {def.kind === 'auto' && (
            <p className="muted small">
              Zählt ab dem Start der Challenge. Einfach Biere wie gewohnt eintragen – den Rest erledigt die App.
            </p>
          )}
          <div className="btn-row">
            {def.kind === 'quiz' ? (
              <button className="btn btn-primary btn-big" onClick={() => go('/quiz/challenge')}>
                🧠 Quiz starten
              </button>
            ) : def.kind === 'manual' ? (
              <button className="btn btn-primary btn-big" disabled={!!busy} onClick={() => run('ok', confirmChallenge)}>
                ✅ Geschafft!
              </button>
            ) : (
              <button className="btn btn-primary" onClick={() => go('/catalog')}>
                🍺 Bier eintragen
              </button>
            )}
          </div>
          <div className="ch-secondary">
            {def.kind === 'auto' && (
              <button className="link small" disabled={!!busy} onClick={() => run('ok', confirmChallenge)}>
                Geschafft, aber die App hat's nicht erkannt
              </button>
            )}
            <button
              className="link small danger-link"
              disabled={!!busy}
              onClick={() =>
                run('abort', async () => {
                  await abortChallenge()
                  toast({ icon: '🔄', msg: 'Aufgegeben – such dir eine neue aus' })
                })
              }
            >
              Aufgeben & neu wählen
            </button>
          </div>
        </div>
      )}

      {night.open && !st.active && (
        <>
          <h3 className="ch-choose-title">{doneTonight.length ? 'Weiter geht’s – deine nächste Challenge:' : 'Wähle deine Challenge für heute Abend:'}</h3>
          <div className="ch-options">
            {st.offer.map((id, i) => {
              const c = byId(id)
              if (!c) return null
              return (
                <button
                  key={id}
                  className="card ch-option"
                  style={{ animationDelay: `${i * 90}ms` }}
                  disabled={!!busy}
                  onClick={() => run(id, () => startChallenge(id))}
                >
                  <span className={`ch-opt-icon cap cap-${c.kind}`}>{c.icon}</span>
                  <span className="ch-opt-main">
                    <b>{c.title}</b>
                    <span>{c.desc}</span>
                    <span className={`ch-tag ${c.kind}`}>
                      {c.kind === 'auto' ? '🤖 automatisch' : c.kind === 'quiz' ? '🧠 Bierquiz' : '✋ selbst abhaken'}
                    </span>
                  </span>
                  {busy === id && <Spinner />}
                </button>
              )
            })}
          </div>
          {st.offer.length === 0 && (
            <p className="muted">Wow – heute ist nichts mehr übrig. Respekt! 🎉</p>
          )}
        </>
      )}

      {!night.open && (
        <div className="card ch-closed">
          <p>
            Ab <b>16 Uhr</b> kannst du hier eine von drei zufälligen Challenges wählen. Du hast dann bis <b>4 Uhr</b> Zeit.
            Ist eine geschafft, wartet direkt die nächste.
          </p>
          <button className="link small" onClick={() => refreshChallenges()}>
            Aktualisieren
          </button>
        </div>
      )}

      {doneTonight.length > 0 && (
        <>
          <h3>Heute geschafft</h3>
          <div className="ch-done-list">
            {doneTonight.map((r) => (
              <DoneRow key={r.id} row={r} />
            ))}
          </div>
        </>
      )}

      <button className="card quiz-teaser" onClick={() => go('/quiz')}>
        <span className="ch-opt-icon cap cap-quiz">🧠</span>
        <span className="ch-opt-main">
          <b>Freies Bierquiz</b>
          <span>Jederzeit 5 Fragen zu Geschichte, Brauen, Sorten & Kuriosem – zählt für die Quiz-Abzeichen.</span>
        </span>
      </button>

      <div className="stat-row">
        <div className="stat">
          <b>{totals.done}</b>
          <span>geschafft</span>
        </div>
        <div className="stat">
          <b>
            {totals.kinds}/{CHALLENGES.length}
          </b>
          <span>verschiedene</span>
        </div>
        <div className="stat">
          <b>{totals.nights}</b>
          <span>Abende</span>
        </div>
      </div>

      <History rows={st.rows.filter((r) => r.night !== night.night || r.status === 'verpasst')} />

      <p className="muted small ch-note">
        Alkoholfreie Biere zählen überall mit. Keine Challenge verlangt mehr als 3 Biere – trink, was dir guttut. 💧
      </p>
    </div>
  )
}

function DoneRow({ row }: { row: ChallengeRow }) {
  const c = byId(row.challenge)
  return (
    <div className={`ch-done st-${row.status}`}>
      <span className={`ch-done-icon cap cap-${c?.kind ?? 'auto'} ${row.status !== 'geschafft' ? 'cap-off' : ''}`}>{c?.icon ?? '🎯'}</span>
      <span className="ch-done-main">
        <b>{c?.title ?? row.challenge}</b>
        <span className="muted small">
          {row.status === 'geschafft'
            ? `${row.confirmed ? 'abgehakt' : 'erkannt'} um ${new Date(row.completed_at ?? row.started_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
            : row.status === 'verpasst'
              ? 'verpasst'
              : 'aufgegeben'}
        </span>
      </span>
      <span className="ch-done-mark">{row.status === 'geschafft' ? '✓' : row.status === 'verpasst' ? '⏰' : '↩'}</span>
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
          <div className="list-head">
            {new Date(n + 'T12:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
          {list.map((r) => (
            <DoneRow key={r.id} row={r} />
          ))}
        </div>
      ))}
    </details>
  )
}
