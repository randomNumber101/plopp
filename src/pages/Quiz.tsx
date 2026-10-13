import { useEffect, useMemo, useRef, useState } from 'react'
import { byId, finishQuizChallenge, useChallenges } from '../challenges'
import { ErrorBox, Spinner, toast } from '../components'
import {
  checkNum,
  myAnswers,
  pickQuestions,
  quizStats,
  saveAnswer,
  shuffled,
  type Answer,
  type Question,
} from '../quiz'
import { go } from '../router'
import { celebrate, haptic } from '../ui/fx'

type Feedback = { correct: boolean; exact: boolean; picked?: number; guess?: number }

const fmt = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 2 })

/** Bierquiz – frei (mode „free“) oder als Runde einer Quiz-Challenge („challenge“) */
export default function Quiz({ mode }: { mode: 'free' | 'challenge' }) {
  const st = useChallenges()
  const live = mode === 'challenge' && st.active ? byId(st.active.challenge) : null
  // die Challenge merken – nach dem Erfolg ist sie nicht mehr „aktiv“
  const lastDef = useRef(live)
  if (live) lastDef.current = live
  const def = lastDef.current
  const rule = def?.quiz ?? { count: 5, need: 0 }
  const [history, setHistory] = useState<Answer[] | null>(null)
  const [round, setRound] = useState(0)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    myAnswers()
      .then((a) => setHistory([...a]))
      .catch((e: Error) => (setErr(e.message), setHistory([])))
  }, [])

  const questions = useMemo(
    () => (history ? pickQuestions(rule.count, history, rule.filter) : []),
    // neue Fragen je Runde
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history === null, round, def?.id],
  )
  const [i, setI] = useState(0)
  const [results, setResults] = useState<boolean[]>([])
  const [fb, setFb] = useState<Feedback | null>(null)
  const [guess, setGuess] = useState('')
  const q: Question | undefined = questions[i]
  const shuffle = useMemo(() => (q?.kind === 'mc' ? shuffled(q) : null), [q])
  const [done, setDone] = useState<null | { won: boolean }>(null)

  if (mode === 'challenge' && st.loaded && !def?.quiz && !done) {
    return (
      <div className="page">
        <h2>Bierquiz</h2>
        <p className="muted">Gerade läuft keine Quiz-Challenge.</p>
        <button className="btn btn-primary" onClick={() => go('/quiz')}>
          🧠 Freies Quiz spielen
        </button>
      </div>
    )
  }
  if (!history || !q) return err ? <ErrorBox msg={err} /> : <Spinner />

  async function answer(correct: boolean, exact: boolean, extra: Partial<Feedback>) {
    haptic(correct ? 15 : 40)
    setFb({ correct, exact, ...extra })
    setResults((r) => [...r, correct])
    try {
      await saveAnswer(q!.id, correct, exact)
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  async function next() {
    if (i + 1 < questions.length) {
      setI(i + 1)
      setFb(null)
      setGuess('')
      return
    }
    const correct = results.filter(Boolean).length
    // Quiz-Abzeichen prüfen
    window.dispatchEvent(new Event('plopp-challenge-done'))
    if (mode === 'challenge') {
      const won = await finishQuizChallenge(correct)
      setDone({ won })
      if (!won) toast({ icon: '🤔', msg: `${correct} von ${questions.length} – knapp! Noch eine Runde?` })
    } else {
      setDone({ won: correct === questions.length })
      if (correct === questions.length) celebrate({ icon: '🧠', title: 'Alles richtig!', sub: `${correct} von ${questions.length}` })
    }
  }

  function newRound() {
    setRound((r) => r + 1)
    setI(0)
    setResults([])
    setFb(null)
    setGuess('')
    setDone(null)
    myAnswers().then((a) => setHistory([...a])).catch(() => {})
  }

  const correctSoFar = results.filter(Boolean).length
  const total = quizStats(history)

  if (done) {
    return (
      <div className="page quiz-page">
        <div className="card quiz-end">
          <div className="quiz-end-icon">{done.won ? '🏆' : correctSoFar >= (rule.need || 3) ? '👏' : '🍺'}</div>
          <h2>
            {correctSoFar} von {questions.length} richtig
          </h2>
          {mode === 'challenge' ? (
            <p>{done.won ? 'Challenge geschafft – such dir gleich die nächste aus!' : `Für die Challenge brauchst du ${rule.need}. Probier’s nochmal!`}</p>
          ) : (
            <p className="muted">
              Insgesamt {total.correct + correctSoFar} richtige Antworten im Bierquiz
            </p>
          )}
          <div className="btn-row">
            {mode === 'challenge' && done.won ? (
              <button className="btn btn-primary" onClick={() => go('/challenge')}>
                Zur nächsten Challenge
              </button>
            ) : (
              <button className="btn btn-primary" onClick={newRound}>
                Noch eine Runde
              </button>
            )}
            <button className="btn btn-ghost" onClick={() => history && go(mode === 'challenge' ? '/challenge' : '/stats')}>
              Fertig
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page quiz-page">
      <div className="quiz-head">
        <span className="quiz-title">{def ? `${def.icon} ${def.title}` : '🧠 Bierquiz'}</span>
        <span className="quiz-count">
          Frage {i + 1}/{questions.length}
          {rule.need ? ` · ${correctSoFar}/${rule.need} nötig` : ''}
        </span>
      </div>
      <div className="quiz-dots">
        {questions.map((x, k) => (
          <span key={x.id} className={`quiz-dot ${k < results.length ? (results[k] ? 'ok' : 'bad') : k === i ? 'cur' : ''}`} />
        ))}
      </div>

      <div className="card quiz-card" key={q.id}>
        <span className="quiz-cat">{q.cat}</span>
        <h3 className="quiz-q">{q.q}</h3>

        {q.kind === 'mc' && shuffle && (
          <div className="quiz-options">
            {shuffle.options.map((o, k) => {
              const state = fb ? (k === shuffle.correct ? 'right' : k === fb.picked ? 'wrong' : 'dim') : ''
              return (
                <button
                  key={o}
                  className={`quiz-opt ${state}`}
                  disabled={!!fb}
                  onClick={() => answer(k === shuffle.correct, false, { picked: k })}
                >
                  <span className="quiz-letter">{'ABCD'[k]}</span>
                  {o}
                </button>
              )
            })}
          </div>
        )}

        {q.kind === 'num' && (
          <form
            className="quiz-num"
            onSubmit={(e) => {
              e.preventDefault()
              const g = Number(guess.replace(',', '.'))
              if (!guess.trim() || Number.isNaN(g)) return
              const r = checkNum(q, g)
              answer(r.correct, r.exact, { guess: g })
            }}
          >
            <input
              inputMode="decimal"
              autoFocus
              placeholder="Deine Schätzung"
              value={guess}
              disabled={!!fb}
              onChange={(e) => setGuess(e.target.value)}
            />
            {q.unit && <span className="quiz-unit">{q.unit}</span>}
            {!fb && (
              <button className="btn btn-primary" disabled={!guess.trim()}>
                Antworten
              </button>
            )}
          </form>
        )}

        {fb && (
          <div className={`quiz-fb ${fb.correct ? 'ok' : 'bad'}`}>
            <b>
              {fb.correct
                ? fb.exact
                  ? '🎯 Volltreffer!'
                  : q.kind === 'num'
                    ? `✅ Im grünen Bereich! Genau: ${fmt(q.answer)}${q.unit ? ` ${q.unit}` : ''}`
                    : '✅ Richtig!'
                : q.kind === 'num'
                  ? `❌ Daneben – richtig ist ${fmt(q.answer)}${q.unit ? ` ${q.unit}` : ''} (±${fmt(q.tol)} hätte gereicht)`
                  : `❌ Leider falsch – richtig: ${q.options[q.answer]}`}
            </b>
            {q.fact && <p>{q.fact}</p>}
            <button className="btn btn-primary" onClick={next}>
              {i + 1 < questions.length ? 'Nächste Frage' : 'Auswertung'}
            </button>
          </div>
        )}
      </div>
      <ErrorBox msg={err} />
    </div>
  )
}
