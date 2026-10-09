import { useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { exportAll, isAdmin, listSuggestions } from '../api'
import { ErrorBox, toast, useAsync } from '../components'
import { supabase } from '../supabase'
import { go } from '../router'
import { IconChevron } from '../ui/icons'
import { InviteSection } from './Invites'

export default function Settings({ session }: { session: Session }) {
  const [error, setError] = useState<string | null>(null)
  const [pw, setPw] = useState('')
  const [pwOpen, setPwOpen] = useState(false)
  const review = useAsync(async () => {
    const admin = await isAdmin()
    return { admin, open: admin ? (await listSuggestions('offen')).length : 0 }
  }, [])

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
      <div className="menu">
        <button onClick={() => go('/stats')}>
          <span className="m-icon">🏆</span>
          <span className="m-main">Statistik & Abzeichen</span>
          <IconChevron size={18} className="m-chev" />
        </button>
        <button onClick={() => go('/catalog')}>
          <span className="m-icon">🔎</span>
          <span className="m-main">Bier suchen oder anlegen</span>
          <IconChevron size={18} className="m-chev" />
        </button>
        <button onClick={() => go('/suggestions')}>
          <span className="m-icon">📝</span>
          <span className="m-main">
            Änderungsvorschläge
            <div className="row-sub">
              {review.data?.admin ? 'prüfen & in den Katalog übernehmen' : 'was deine Runde geändert hat'}
            </div>
          </span>
          {!!review.data?.open && <span className="m-badge">{review.data.open}</span>}
          <IconChevron size={18} className="m-chev" />
        </button>
        <button onClick={download}>
          <span className="m-icon">⬇️</span>
          <span className="m-main">Meine Daten exportieren (JSON)</span>
        </button>
        <button onClick={() => setPwOpen(!pwOpen)}>
          <span className="m-icon">🔑</span>
          <span className="m-main">Passwort ändern</span>
        </button>
        <button onClick={() => supabase.auth.signOut()}>
          <span className="m-icon">👋</span>
          <span className="m-main">
            Abmelden
            <div className="row-sub">{session.user.email}</div>
          </span>
        </button>
      </div>
      {pwOpen && (
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
      <ErrorBox msg={error} />

      <InviteSection />

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
      <p className="app-footer">
        <b>Plopp!</b> – Der Biertracker 🍻
      </p>
    </div>
  )
}
