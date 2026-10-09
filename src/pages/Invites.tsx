import { useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { createInvite, deleteInvite, myInvites, shareInvite, type Invite } from '../api'
import { ErrorBox, Spinner, toast, useAsync } from '../components'
import { go } from '../router'
import { supabase } from '../supabase'

const fmt = (iso: string) => new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })

function stateOf(i: Invite) {
  if (i.used_at) return 'used'
  if (new Date(i.expires_at) <= new Date()) return 'expired'
  return 'open'
}

/** Abschnitt „Freunde einladen“ auf der Mehr-Seite */
export function InviteSection() {
  const { data, error, loading, reload } = useAsync(myInvites, [])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function share(code: string) {
    const r = await shareInvite(code)
    if (r === 'copied') toast('Link kopiert – jetzt z. B. per WhatsApp schicken')
  }

  async function create() {
    setBusy(true)
    setErr(null)
    try {
      const inv = await createInvite()
      reload()
      await share(inv.code)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function revoke(code: string) {
    setErr(null)
    try {
      await deleteInvite(code)
      toast('Einladung zurückgezogen')
      reload()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  const invites = data ?? []
  const shown = invites.filter((i) => stateOf(i) !== 'expired').slice(0, 15)

  return (
    <>
      <h3>Freunde einladen</h3>
      <p className="muted small">
        Neue Konten gibt es nur per Einladungslink. Jeder Link gilt 14 Tage und für genau ein Konto. Eingeladene haben
        eigene Biere und Listen – nur der Katalog (Brauereien, Biere, Barcodes) ist gemeinsam.
      </p>
      <button className="btn btn-primary" onClick={create} disabled={busy}>
        {busy ? 'Erstelle Link …' : '✉️ Einladungslink erstellen & teilen'}
      </button>
      <ErrorBox msg={err ?? error} />
      {loading && !data && <Spinner />}
      {shown.length > 0 && (
        <div className="list">
          {shown.map((i) =>
            stateOf(i) === 'used' ? (
              <div key={i.code} className="row invite-row">
                <span className="badge ok">✓</span>
                <div className="row-main">
                  <div className="row-title">{i.used_email ?? 'Angenommen'}</div>
                  <div className="row-sub">Konto erstellt am {fmt(i.used_at!)}</div>
                </div>
              </div>
            ) : (
              <div key={i.code} className="row invite-row">
                <span className="badge">✉️</span>
                <div className="row-main">
                  <div className="row-title">Offene Einladung</div>
                  <div className="row-sub">gültig bis {fmt(i.expires_at)}</div>
                </div>
                <div className="invite-actions">
                  <button className="btn btn-small" onClick={() => share(i.code)}>
                    Teilen
                  </button>
                  <button className="btn btn-small" onClick={() => revoke(i.code)} aria-label="Zurückziehen">
                    ✕
                  </button>
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </>
  )
}

/** Einladungslink geöffnet, aber schon angemeldet */
export function InviteWhileLoggedIn({ session, code }: { session: Session; code: string }) {
  return (
    <div className="page">
      <h2>Einladung</h2>
      <div className="card">
        <div>
          Du bist schon als <b>{session.user.email}</b> angemeldet.
        </div>
        <div className="muted small">
          Der Link ist für ein <i>neues</i> Konto gedacht. Schick ihn an die Person weiter, die du einladen willst – oder
          melde dich ab, um damit selbst ein weiteres Konto anzulegen.
        </div>
      </div>
      <button className="btn btn-primary" onClick={() => go('/')}>
        Weiter zur App
      </button>
      <button
        className="btn"
        onClick={async () => {
          await supabase.auth.signOut()
          go(`/invite/${code}`)
        }}
      >
        Abmelden und neues Konto anlegen
      </button>
    </div>
  )
}
