import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { inviteStatus, type InviteStatus } from '../api'
import { ErrorBox, Spinner } from '../components'
import { go, useRoute } from '../router'

function translate(msg: string) {
  if (/invalid login credentials/i.test(msg)) return 'E-Mail oder Passwort falsch.'
  if (/already registered|already been registered|user_already_exists/i.test(msg))
    return 'Diese E-Mail hat schon ein Konto – bitte anmelden.'
  if (/signups not allowed|signup.*disabled/i.test(msg))
    return 'Neue Konten sind gerade gesperrt. Sag der Person Bescheid, die dich eingeladen hat.'
  if (/database error saving new user|einladungslink/i.test(msg))
    return 'Der Einladungslink ist ungültig, abgelaufen oder wurde schon benutzt. Bitte um einen neuen Link.'
  if (/password should be at least/i.test(msg)) return 'Das Passwort ist zu kurz (mind. 8 Zeichen).'
  if (/rate limit/i.test(msg)) return 'Zu viele Versuche – bitte kurz warten.'
  return msg
}

const STATUS_TEXT: Record<Exclude<InviteStatus, 'ok'>, string> = {
  used: 'Dieser Einladungslink wurde schon benutzt. Hast du schon ein Konto? Dann melde dich unten an – sonst bitte um einen neuen Link.',
  expired: 'Dieser Einladungslink ist abgelaufen. Bitte um einen neuen Link.',
  unknown: 'Diesen Einladungslink gibt es nicht. Prüfe, ob er vollständig kopiert wurde.',
}

export default function Login() {
  const [page, param] = useRoute()
  const invite = page === 'invite' && param ? param.toLowerCase() : null

  const [mode, setMode] = useState<'login' | 'signup'>(invite ? 'signup' : 'login')
  const [status, setStatus] = useState<InviteStatus | 'checking' | null>(invite ? 'checking' : null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!invite) {
      setStatus(null)
      setMode('login')
      return
    }
    let alive = true
    setStatus('checking')
    inviteStatus(invite)
      .then((s) => {
        if (!alive) return
        setStatus(s)
        setMode(s === 'ok' ? 'signup' : 'login')
      })
      .catch(() => alive && (setStatus('ok'), setMode('signup'))) // im Zweifel versuchen lassen
    return () => {
      alive = false
    }
  }, [invite])

  async function submit() {
    setError(null)
    if (mode === 'signup' && password !== password2) return setError('Die Passwörter stimmen nicht überein.')
    setBusy(true)
    const res =
      mode === 'login'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { data: { invite } } })
    setBusy(false)
    if (res.error) return setError(translate(res.error.message))
    if (mode === 'signup' && !res.data.session) {
      // Falls die Bestätigungs-Mail doch aktiv ist
      return setError('Konto angelegt. Bitte bestätige die E-Mail und melde dich dann an.')
    }
    go('/')
  }

  const signup = mode === 'signup' && invite && status === 'ok'

  return (
    <div className="login">
      <div className="login-logo">🍻</div>
      <h1>Bier-Tracker</h1>
      <p className="tagline">Jedes Bier zählt. Prost!</p>

      {status === 'checking' ? (
        <Spinner />
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          {signup && (
            <div className="info invite-banner">
              <b>Du wurdest eingeladen! 🍻</b>
              <br />
              Leg dir mit E-Mail und Passwort ein Konto an.
            </div>
          )}
          {invite && status && status !== 'ok' && (
            <div className="error">{STATUS_TEXT[status]}</div>
          )}

          <label>
            E-Mail
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            Passwort
            <input
              type="password"
              autoComplete={signup ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </label>
          {signup && (
            <label>
              Passwort wiederholen
              <input
                type="password"
                autoComplete="new-password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                required
                minLength={8}
              />
            </label>
          )}
          <ErrorBox msg={error} />
          <button className="btn btn-primary" disabled={busy}>
            {busy ? '…' : signup ? 'Konto erstellen' : 'Anmelden'}
          </button>

          {invite && status === 'ok' && (
            <button
              type="button"
              className="link login-switch"
              onClick={() => {
                setError(null)
                setMode(signup ? 'login' : 'signup')
              }}
            >
              {signup ? 'Ich habe schon ein Konto – anmelden' : 'Neues Konto mit der Einladung anlegen'}
            </button>
          )}
          {!invite && (
            <p className="muted small login-note">Neu hier? Konten gibt es nur mit einem Einladungslink von jemandem, der schon dabei ist.</p>
          )}
        </form>
      )}
    </div>
  )
}
