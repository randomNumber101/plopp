import { useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { exportAll } from '../api'
import { ErrorBox, toast } from '../components'
import { supabase } from '../supabase'

export default function Settings({ session }: { session: Session }) {
  const [error, setError] = useState<string | null>(null)
  const [pw, setPw] = useState('')
  const [pwOpen, setPwOpen] = useState(false)

  async function download() {
    try {
      const data = await exportAll()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `biere-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="page">
      <h2>Mehr</h2>
      <div className="card">
        <div className="row-sub">Angemeldet als</div>
        <div>{session.user.email}</div>
      </div>
      <button className="btn" onClick={download}>
        ⬇️ Meine Daten exportieren (JSON)
      </button>
      {!pwOpen ? (
        <button className="btn" onClick={() => setPwOpen(true)}>
          🔑 Passwort ändern
        </button>
      ) : (
        <form
          className="card"
          onSubmit={async (e) => {
            e.preventDefault()
            setError(null)
            const res = await supabase.auth.updateUser({ password: pw })
            if (res.error) return setError(res.error.message)
            setPw('')
            setPwOpen(false)
            toast('Passwort geändert')
          }}
        >
          <input
            type="password"
            autoComplete="new-password"
            placeholder="Neues Passwort (mind. 8 Zeichen)"
            minLength={8}
            required
            value={pw}
            onChange={(e) => setPw(e.target.value)}
          />
          <div className="btn-row">
            <button className="btn btn-primary">Speichern</button>
            <button type="button" className="btn" onClick={() => setPwOpen(false)}>
              Abbrechen
            </button>
          </div>
        </form>
      )}
      <button className="btn" onClick={() => supabase.auth.signOut()}>
        Abmelden
      </button>
      <ErrorBox msg={error} />

      <h3>Als App installieren</h3>
      <p className="muted">
        <b>iPhone:</b> In Safari auf „Teilen“ tippen → „Zum Home-Bildschirm“.
        <br />
        <b>Android:</b> In Chrome auf das Menü (⋮) → „App installieren“ bzw. „Zum Startbildschirm hinzufügen“.
      </p>

      <h3>Datenquellen</h3>
      <p className="muted small">
        Brauereien aus den Wikipedia-Listen aktiver Brauereien (CC BY-SA), Wikidata (CC0) und OpenStreetMap (© OpenStreetMap-Mitwirkende, ODbL); Adressen und Sortimente von den Websites der Brauereien; Biere und Barcodes aus Open Food Facts (ODbL). Karten © OpenStreetMap-Mitwirkende. Ortssuche über Nominatim.
      </p>
    </div>
  )
}
