import { useState } from 'react'
import { supabase } from '../supabase'
import { ErrorBox } from '../components'

function translate(msg: string) {
  if (/invalid login credentials/i.test(msg)) return 'E-Mail oder Passwort falsch.'
  if (/already registered/i.test(msg)) return 'Diese E-Mail ist schon registriert – bitte anmelden.'
  if (/signups not allowed|signup.*disabled/i.test(msg)) return 'Registrierung ist deaktiviert.'
  if (/password should be at least/i.test(msg)) return 'Das Passwort ist zu kurz (mind. 8 Zeichen).'
  return msg
}

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  async function submit(mode: 'login' | 'signup') {
    setBusy(true)
    setError(null)
    setInfo(null)
    const res =
      mode === 'login'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password })
    setBusy(false)
    if (res.error) return setError(translate(res.error.message))
    if (mode === 'signup' && !res.data.session) {
      setInfo('Konto angelegt. Bitte bestätige die E-Mail und melde dich dann an.')
    }
  }

  return (
    <div className="login">
      <div className="login-logo">🍺</div>
      <h1>Bier-Tracker</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit('login')
        }}
      >
        <label>
          E-Mail
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Passwort
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </label>
        <ErrorBox msg={error} />
        {info && <div className="info">{info}</div>}
        <button className="btn btn-primary" disabled={busy}>
          Anmelden
        </button>
        <button type="button" className="btn" disabled={busy || !email || password.length < 8} onClick={() => submit('signup')}>
          Konto erstellen
        </button>
      </form>
    </div>
  )
}
