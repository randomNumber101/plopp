import { useState } from 'react'
import { applySuggestion, isAdmin, listSuggestions, rejectSuggestion } from '../api'
import { ChipBar, EmptyState, ErrorBox, SkeletonList, relDate, toast, useAsync } from '../components'
import { go } from '../router'
import { HIDE_REASONS, SUGGESTION_KINDS, type HideReason, type Suggestion } from '../types'
import { haptic } from '../ui/fx'

const FIELD: Record<string, string> = {
  name: 'Name',
  style: 'Sorte',
  abv: 'Alkohol',
  city: 'Ort',
  state: 'Bundesland',
  country: 'Land',
  website: 'Website',
  lat: 'Breite',
  lng: 'Länge',
  ean: 'Barcode',
  reason: 'Grund',
}

const STATUS: Record<Suggestion['status'], string> = {
  offen: 'offen',
  übernommen: '✓ übernommen',
  abgelehnt: '✗ abgelehnt',
  zurückgezogen: 'zurückgezogen',
}

function fmt(k: string, v: unknown): string {
  if (v == null || v === '') return '–'
  if (k === 'abv') return `${v} %`
  if (k === 'reason') return HIDE_REASONS[v as HideReason] ?? String(v)
  if (k === 'lat' || k === 'lng') return Number(v).toFixed(4)
  return String(v)
}

function target(s: Suggestion): string | null {
  if (!s.target_id) return null
  return s.kind.startsWith('brewery') ? `/brewery/${s.target_id}` : `/beer/${s.target_id}`
}

export default function Suggestions() {
  const [filter, setFilter] = useState<'offen' | 'alle'>('offen')
  const admin = useAsync(isAdmin, [])
  const list = useAsync(() => listSuggestions(filter), [filter])
  const [busy, setBusy] = useState<number | null>(null)
  const [rejecting, setRejecting] = useState<number | null>(null)
  const [note, setNote] = useState('')

  const items = list.data ?? []

  async function decide(s: Suggestion, ok: boolean) {
    setBusy(s.id)
    try {
      if (ok) {
        const msg = await applySuggestion(s.id)
        toast({ icon: '✅', msg: msg || 'In den Katalog übernommen' })
      } else {
        await rejectSuggestion(s.id, note.trim() || undefined)
        toast({ icon: '🗑️', msg: 'Abgelehnt' })
      }
      haptic()
      setRejecting(null)
      setNote('')
      list.setData(
        filter === 'offen'
          ? items.filter((x) => x.id !== s.id)
          : items.map((x) => (x.id === s.id ? { ...x, status: ok ? 'übernommen' : 'abgelehnt' } : x)),
      )
    } catch (e) {
      toast({ icon: '⚠️', msg: (e as Error).message })
    }
    setBusy(null)
  }

  return (
    <div className="page">
      <h2>Änderungsvorschläge</h2>
      <p className="muted small">
        {admin.data
          ? 'Alle Änderungen aus allen Runden. „Übernehmen“ schreibt sie in den gemeinsamen Katalog – der Katalog-Import überschreibt übernommene Angaben danach nicht mehr.'
          : 'Was du und deine Runde am Katalog geändert, angelegt oder ausgeblendet habt. Für euch gilt das sofort – für alle anderen erst, wenn es geprüft und übernommen wurde.'}
      </p>
      <ChipBar
        value={filter}
        onChange={(v) => setFilter((v as 'offen' | 'alle') ?? 'offen')}
        options={[
          { id: 'offen', label: 'Offen' },
          { id: 'alle', label: 'Alle' },
        ]}
      />
      <ErrorBox msg={list.error} />
      {list.loading && !list.data && <SkeletonList rows={4} />}
      {list.data && items.length === 0 && (
        <EmptyState
          icon="📝"
          title={filter === 'offen' ? 'Keine offenen Vorschläge' : 'Noch keine Vorschläge'}
        >
          Sobald jemand ein Bier bearbeitet, ausblendet oder neu anlegt, taucht es hier auf.
        </EmptyState>
      )}
      <div className="sugg-list">
        {items.map((s, i) => {
          const k = SUGGESTION_KINDS[s.kind]
          const isEdit = s.kind === 'beer_edit' || s.kind === 'brewery_edit'
          const keys = Object.keys(s.payload ?? {}).filter(
            (x) =>
              x !== 'brewery_id' &&
              x !== 'hidden_reason' &&
              !(isEdit && fmt(x, s.previous?.[x]) === fmt(x, s.payload[x])),
          )
          const link = target(s)
          return (
            <div key={s.id} className={`card sugg sugg-${s.status}`} style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}>
              <div className="sugg-head">
                <span className="sugg-icon" aria-hidden="true">
                  {k?.icon ?? '📝'}
                </span>
                <div className="sugg-main">
                  <div className="sugg-kind">{k?.label ?? s.kind}</div>
                  {link ? (
                    <button className="link sugg-name" onClick={() => go(link)}>
                      {s.target_name ?? 'Eintrag'}
                    </button>
                  ) : (
                    <span className="sugg-name">{s.target_name ?? 'Eintrag'}</span>
                  )}
                </div>
                <span className={`sugg-status st-${s.status}`}>{STATUS[s.status]}</span>
              </div>
              {keys.length > 0 && (
                <dl className="sugg-diff">
                  {keys.map((f) => (
                    <div key={f}>
                      <dt>{FIELD[f] ?? f}</dt>
                      <dd>
                        {isEdit && (
                          <>
                            <s>{fmt(f, s.previous?.[f])}</s> →{' '}
                          </>
                        )}
                        <b>{fmt(f, s.payload[f])}</b>
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              <div className="sugg-meta small muted">
                {s.created_by_email ?? 'unbekannt'} · {relDate(s.updated_at ?? s.created_at)}
                {s.note ? ` · „${s.note}“` : ''}
              </div>
              {admin.data && s.status === 'offen' && (
                <>
                  {rejecting === s.id ? (
                    <div className="sugg-reject">
                      <input
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="Begründung (optional)"
                        autoFocus
                      />
                      <div className="btn-row">
                        <button className="btn btn-danger" disabled={busy === s.id} onClick={() => decide(s, false)}>
                          Ablehnen
                        </button>
                        <button className="btn btn-ghost" onClick={() => setRejecting(null)}>
                          Abbrechen
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="btn-row">
                      <button className="btn btn-primary" disabled={busy === s.id} onClick={() => decide(s, true)}>
                        ✓ Übernehmen
                      </button>
                      <button
                        className="btn btn-ghost"
                        disabled={busy === s.id}
                        onClick={() => {
                          setRejecting(s.id)
                          setNote('')
                        }}
                      >
                        Ablehnen
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
