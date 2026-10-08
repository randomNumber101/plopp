import { useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { exportAll } from '../api'
import { ErrorBox } from '../components'
import { supabase } from '../supabase'

export default function Settings({ session }: { session: Session }) {
  const [error, setError] = useState<string | null>(null)

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
        Produktdaten teilweise von Open Food Facts (ODbL). Karten © OpenStreetMap-Mitwirkende. Ortssuche über Nominatim.
      </p>
    </div>
  )
}
