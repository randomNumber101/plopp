/**
 * Startseite: die Sammlung als Getränkekasten.
 * Jedes neue (verschiedene) Bier ist ein Kronkorken in der Hausfarbe seiner Brauerei; 20 Fächer = ein Kasten.
 * Fächer eines Abends teilen sich eine Bodenfarbe, der laufende Abend ist gestrichelt umrandet.
 * Rechts oben klemmt ein gekritzelter Pfandbon (Statistik), unter dem Kasten zeigt der Turm die vollen Kästen
 * (ausziehbar zum Durchblättern), darunter der Lieferschein mit den Bieren des Kastens.
 * Wird ein Kasten voll: Kamerafahrt zurück auf den Turm, der neue Kasten stürzt drauf, danach „Turm teilen“.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Checkin } from '../types'
import type { BeerAgg } from '../achievements'
import { formatRating, toast } from '../components'
import { go } from '../router'
import { usePageState } from '../pageState'
import { Bottle, Cap, capMark, houseColor, inkOn, capBackground } from './kasten'
import { haptic, load, reducedMotion, save } from './fx'
import { IconBack, IconChevron, IconPlus, IconSearch, IconX } from './icons'
import {
  CRATE,
  TOWER_STEPS,
  bucketsOf,
  crateInfo,
  dayLabel,
  evening,
  liveEveningKey,
  splitCrates,
  stripesOf,
  towerCamera,
  type CrateCap,
  type Mode,
  type TowerPhase,
} from './kastenLogic'
import { shareTowerPoster } from './turmPoster'

export { CRATE, type CrateCap }

/** verschiedene Biere in der Reihenfolge ihres ersten Check-ins */
export function capsFromCheckins(list: Checkin[]): CrateCap[] {
  const first = new Map<string, Checkin>()
  for (const c of list) {
    const prev = first.get(c.beer_id)
    if (!prev || c.drunk_at < prev.drunk_at) first.set(c.beer_id, c)
  }
  return [...first.values()]
    .sort((a, b) => (a.drunk_at < b.drunk_at ? -1 : a.drunk_at > b.drunk_at ? 1 : 0))
    .map((c) => {
      const br = c.beer?.brewery
      return {
        beerId: c.beer_id,
        name: c.beer?.name ?? 'Bier',
        brewery: br?.name ?? '',
        color: houseColor(br ?? { name: c.beer?.name }),
        mark: capMark(br?.name || c.beer?.name),
        first: new Date(c.drunk_at).getTime(),
      }
    })
}

const MODES: { id: Mode; label: string }[] = [
  { id: 'kasten', label: 'Kasten' },
  { id: 'tage', label: 'Tage' },
  { id: 'wochen', label: 'Wochen' },
  { id: 'monate', label: 'Monate' },
]

function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(358)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const set = () => setW(Math.round(el.getBoundingClientRect().width) || 358)
    set()
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

function useEscape(on: boolean, close: () => void) {
  useEffect(() => {
    if (!on) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [on, close])
}

const SEEN = 'plopp-kasten-seen'
const BON_SEEN = 'plopp-bon-badges'

export interface BonStats {
  beers: number
  breweries: number
  badges: number
}

export default function KastenStapel({
  caps,
  aggs,
  bon,
  wishCount,
  showSlip,
  onList,
}: {
  caps: CrateCap[]
  aggs: Map<string, BeerAgg>
  bon: BonStats
  wishCount: number
  showSlip: boolean
  onList: (t: 'drunk' | 'wish') => void
}) {
  const crates = useMemo(() => splitCrates(caps), [caps])
  const top = crates.length - 1

  const [mode, setMode] = usePageState<Mode>('kasten-mode', 'kasten')
  const [view, setView] = useState(top)
  const [sel, setSel] = useState<string | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const [dropIdx, setDropIdx] = useState<number | null>(null)
  const [fx, setFx] = useState<number | null>(null) // Index des gerade vollen Kastens während der Turm-Fahrt
  const [shareFor, setShareFor] = useState<number | null>(null)
  const [towerOpen, setTowerOpen] = useState(false)
  const [ref, W] = useWidth()

  const show = (i: number) => {
    setView(i)
    setSel(null)
    setFocus(null)
    setDropIdx(null)
  }

  // Neues Bier seit dem letzten Besuch? Korken fallen lassen – und war der Kasten damit voll, die Turm-Fahrt zeigen.
  useEffect(() => {
    const seen = load<number | null>(SEEN, null)
    save(SEEN, caps.length)
    setView(top)
    if (seen == null || caps.length <= seen) return
    const crossed = Math.floor(caps.length / CRATE) > Math.floor(seen / CRATE)
    if (!crossed) {
      if (!reducedMotion()) setDropIdx((caps.length - 1) % CRATE)
      return
    }
    const full = Math.floor(caps.length / CRATE) - 1
    if (reducedMotion()) setShareFor(full)
    else setFx(full)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caps.length])

  // während der Turm-Fahrt zeigen Kopf und Lieferschein noch den gerade vollen Kasten
  const v = fx != null ? Math.min(fx, top) : Math.min(view, top)
  const crate = crates[v] ?? []
  const isCur = v === top
  const stackMode = mode !== 'kasten'
  const buckets = useMemo(() => bucketsOf(crate, stackMode ? mode : 'tage'), [crate, mode, stackMode])
  const evenings = useMemo(() => bucketsOf(crate, 'tage'), [crate])
  const evOf = useMemo(() => {
    const m: number[] = []
    evenings.forEach((b, j) => b.items.forEach((i) => (m[i] = j)))
    return m
  }, [evenings])
  const bucketOf = useMemo(() => {
    const m: { j: number; n: number }[] = []
    buckets.forEach((b, j) => b.items.forEach((i, n) => (m[i] = { j, n })))
    return m
  }, [buckets])
  const keyOfCap = (i: number) => (stackMode ? buckets[bucketOf[i]?.j]?.key : evenings[evOf[i]]?.key)
  const liveKey = isCur ? liveEveningKey() : null

  // Maße
  const pad = 12
  const gap = 6
  const slot = Math.floor((W - pad * 2 - gap * 4) / 5)
  const H = 26 + slot * 4 + gap * 3 + 14
  const capSize = Math.round(slot * 0.84)
  const B = Math.max(1, buckets.length)
  const colW = W / B
  const discW = Math.max(14, Math.min(44, colW - 8))
  // Korken greifen ineinander: nur ein schmaler Streifen des gezackten Rands bleibt je Korken sichtbar
  const discH = 16
  const base = H - 44
  const maxN = Math.max(1, ...buckets.map((b) => b.items.length))
  const step = Math.min(7, (base - 40) / maxN)
  const slotPos = (i: number) => ({ x: pad + (i % 5) * (slot + gap), y: 26 + Math.floor(i / 5) * (slot + gap) })

  const info = crateInfo(crates, v)
  const sub = !crate.length
    ? isCur && top > 0
      ? 'frischer Kasten'
      : 'noch leer'
    : info.full
      ? `voll, ${info.range}`
      : `${crate.length} von ${CRATE}, seit ${info.since}`

  // Turm unter dem Kasten: die nächsten vollen Kästen darunter (vom angezeigten aus gesehen)
  const below: number[] = []
  for (let c = top; c >= 0 && below.length < 3; c--) if (c !== v && crates[c].length) below.push(c)
  const towerCount = crates.filter((c, i) => c.length || i === top).length

  const pickCap = (i: number) => {
    const c = crate[i]
    const k = keyOfCap(i) ?? null
    haptic(8)
    if (stackMode) return (setSel(sel === k ? null : k), setFocus(null))
    if (focus === c.beerId) return (setSel(null), setFocus(null))
    setSel(k)
    setFocus(c.beerId)
  }

  // Pfandbon: neue Abzeichen seit dem letzten Blick in die Statistik
  const [bonSeen] = useState(() => {
    const s = load<number | null>(BON_SEEN, null)
    if (s == null) save(BON_SEEN, bon.badges)
    return s ?? bon.badges
  })
  const newBadges = Math.max(0, bon.badges - bonSeen)

  const towerPhaseHidden = fx != null

  return (
    <section className="ks" aria-label={`Kasten ${v + 1}`}>
      <div className="ks-head">
        <button className="ks-arrow" disabled={v <= 0} onClick={() => show(v - 1)} aria-label="Älterer Kasten">
          <IconBack size={20} />
        </button>
        <div className="ks-title">
          <b>Kasten {v + 1}</b>
          <span>{sub}</span>
          {!isCur && fx == null && (
            <button className="ks-tocur" onClick={() => show(top)}>
              Zu Kasten {top + 1}
            </button>
          )}
        </div>
        <button className="ks-arrow" disabled={isCur} onClick={() => show(v + 1)} aria-label="Neuerer Kasten">
          <IconChevron size={20} />
        </button>
      </div>

      {bon.beers > 0 && (
        <button
          className="ks-bon"
          onClick={() => (save(BON_SEEN, bon.badges), go('/stats'))}
          aria-label={`Statistik öffnen: ${bon.beers} Biere, ${bon.breweries} Brauereien, ${bon.badges} Abzeichen`}
        >
          <span className="ks-bon-paper">
            <span className="ks-bon-no">Plopp! Pfandbon Nr. {bon.beers}</span>
            <span className="ks-bon-line">
              <span>Biere</span>
              <i />
              <em>{bon.beers}</em>
              <svg className="ks-bon-circle" width="34" height="24" viewBox="0 0 34 24" aria-hidden="true">
                <path d="M5 13c1-7 13-10 22-7 6 2 7 9-1 12-8 3-20 2-23-4-1-3 2-6 6-7" />
              </svg>
            </span>
            <span className="ks-bon-line">
              <span>Brauereien</span>
              <i />
              <em>{bon.breweries}</em>
            </span>
            <span className="ks-bon-line">
              <span>Abzeichen</span>
              <i />
              <em>{bon.badges}</em>
              {newBadges > 0 && <span className="ks-bon-plus">+{newBadges}!</span>}
            </span>
            <span className="ks-bon-go">
              <svg width="30" height="16" viewBox="0 0 30 16" aria-hidden="true">
                <path d="M2 12c6-1 12-7 20-6M17 2l6 4-5 5" />
              </svg>
              Statistik
              <svg className="ks-bon-under" width="74" height="8" viewBox="0 0 74 8" aria-hidden="true">
                <path d="M2 5c12-4 22 2 34-1s24-3 36 0" />
              </svg>
            </span>
          </span>
        </button>
      )}

      <div
        ref={ref}
        className={`ks-stage ${stackMode && fx == null ? 'stacked' : ''}`}
        style={{ height: H }}
      >
        {fx != null ? (
          <TowerFx
            W={W}
            H={H}
            slot={slot}
            capSize={capSize}
            slotPos={slotPos}
            crates={crates}
            full={fx}
            onDone={() => {
              setFx(null)
              show(top)
              setShareFor(fx)
            }}
          />
        ) : (
          <>
            <div className="ks-crate">
              <i className="ks-grip" />
            </div>
            {Array.from({ length: CRATE }, (_, i) => {
              const p = slotPos(i)
              const c = crate[i]
              const k = c ? keyOfCap(i) : null
              const on = !!c && !!sel && !stackMode && k === sel
              const live = !!c && !stackMode && !on && liveKey != null && evenings[evOf[i]]?.key === liveKey
              const next = isCur && !stackMode && i === crate.length
              return next ? (
                <button
                  key={i}
                  className="ks-slot ks-next"
                  style={{ left: p.x, top: p.y, width: slot, height: slot }}
                  onClick={() => go('/catalog')}
                  aria-label="Nächstes Bier erfassen"
                >
                  <IconPlus size={22} />
                </button>
              ) : (
                <span
                  key={i}
                  className={`ks-slot ${c && evOf[i] % 2 ? 'alt' : ''} ${on ? 'on' : ''} ${live ? 'live' : ''}`}
                  style={{ left: p.x, top: p.y, width: slot, height: slot }}
                />
              )
            })}
            {stackMode &&
              buckets.map((b, j) => (
                <button
                  key={b.key}
                  className={`ks-col ${sel === b.key ? 'on' : ''}`}
                  style={{ left: colW * j, width: colW, height: H - 30 }}
                  onClick={() => setSel(sel === b.key ? null : b.key)}
                  aria-label={`${b.title}: ${b.items.length} neue Biere`}
                >
                  <span className="ks-col-n" style={{ bottom: H - base + (b.items.length - 1) * step + 4 }}>
                    {b.items.length}
                  </span>
                  <span className="ks-col-label" style={{ top: base - 2 }}>
                    {B > 12 && j % 2 ? '' : b.label}
                  </span>
                </button>
              ))}
            {stackMode && <span className="ks-base" style={{ top: base + 15 }} />}
            {crate.map((c, i) => {
              const dim = sel && keyOfCap(i) !== sel
              const lifted = !stackMode && focus === c.beerId
              let style: React.CSSProperties & { '--c'?: string }
              if (!stackMode) {
                const p = slotPos(i)
                const o = (slot - capSize) / 2
                style = {
                  left: p.x + o,
                  top: p.y + o,
                  width: capSize,
                  height: capSize,
                  background: capBackground(c.color),
                  color: inkOn(c.color),
                  fontSize: Math.round(capSize * 0.34),
                  transitionDelay: `${i * 18}ms`,
                }
              } else {
                const { j, n } = bucketOf[i] ?? { j: 0, n: 0 }
                style = {
                  left: colW * (j + 0.5) - discW / 2,
                  top: base - n * step,
                  width: discW,
                  height: discH,
                  background: undefined,
                  '--c': c.color,
                  color: 'transparent',
                  fontSize: 0,
                  transitionDelay: `${j * 50 + n * 25}ms`,
                }
              }
              return (
                <button
                  key={c.beerId}
                  className={`ks-cap ${stackMode ? 'disc' : ''} ${dropIdx === i ? 'drop' : ''} ${lifted ? 'lift' : ''}`}
                  style={{ ...style, opacity: dim ? 0.3 : 1 }}
                  onClick={() => pickCap(i)}
                  aria-label={`${c.name}, ${c.brewery ? `${c.brewery}, ` : ''}${dayLabel(evening(c.first))}`}
                >
                  {c.mark}
                </button>
              )
            })}
          </>
        )}
      </div>

      {towerCount > 1 && (
        <button
          className={`ks-tower ${towerPhaseHidden ? 'hide' : ''}`}
          onClick={() => setTowerOpen(true)}
          aria-label={`Turm mit ${towerCount} Kästen öffnen`}
        >
          {below.map((c, k) => (
            <span key={c} className="ks-slice" style={{ marginInline: 2 + k * 6, opacity: [1, 0.75, 0.5][k] }}>
              {stripesOf(crates[c]).map((col, s) => (
                <i key={s} style={{ background: col }} />
              ))}
            </span>
          ))}
          <span className="ks-tower-pill">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 15l6-6 6 6" />
            </svg>
            Turm, {towerCount} Kästen
          </span>
        </button>
      )}

      <div className="ks-modes" role="tablist" aria-label="Ansicht">
        {MODES.map((m) => (
          <button
            key={m.id}
            role="tab"
            aria-selected={mode === m.id}
            className={mode === m.id ? 'on' : ''}
            onClick={() => (setMode(m.id), setSel(null), setFocus(null), setDropIdx(null))}
          >
            {m.label}
          </button>
        ))}
      </div>

      {showSlip && (
        <Lieferschein
          crate={crate}
          num={v + 1}
          isCur={isCur}
          buckets={buckets}
          mode={mode}
          sel={sel}
          focus={focus}
          liveKey={liveKey}
          aggs={aggs}
          total={bon.beers}
          wishCount={wishCount}
          onSel={(k) => (setSel(k), setFocus(null))}
          onList={onList}
        />
      )}

      {towerOpen && (
        <TowerSheet
          crates={crates}
          view={v}
          beers={bon.beers}
          onPick={(i) => (show(i), setTowerOpen(false))}
          onClose={() => setTowerOpen(false)}
        />
      )}
      {shareFor != null && <ShareSheet crates={crates} full={shareFor} onClose={() => setShareFor(null)} />}
    </section>
  )
}

// ------------------------------------------------------------------------------------------ Lieferschein

function Lieferschein({
  crate,
  num,
  isCur,
  buckets,
  mode,
  sel,
  focus,
  liveKey,
  aggs,
  total,
  wishCount,
  onSel,
  onList,
}: {
  crate: CrateCap[]
  num: number
  isCur: boolean
  buckets: ReturnType<typeof bucketsOf>
  mode: Mode
  sel: string | null
  focus: string | null
  liveKey: string | null
  aggs: Map<string, BeerAgg>
  total: number
  wishCount: number
  onSel: (k: string | null) => void
  onList: (t: 'drunk' | 'wish') => void
}) {
  const evMode = mode === 'kasten' || mode === 'tage'
  const unit = evMode ? ['Abend', 'Abenden'] : mode === 'wochen' ? ['Woche', 'Wochen'] : ['Monat', 'Monaten']
  const label = (b: { key: string; title: string }) => (evMode && b.key === liveKey ? 'Heute Abend' : b.title)
  const selB = sel ? buckets.find((b) => b.key === sel) : undefined
  const groups = selB ? [selB] : [...buckets].reverse()
  const n = selB?.items.length ?? 0

  return (
    <section className="lf" aria-label="Lieferschein">
      <span className="lf-clip l" aria-hidden="true" />
      <span className="lf-clip r" aria-hidden="true" />
      {selB ? (
        <div className="lf-sel">
          <div>
            <b>{label(selB)}</b>
            <span>
              {n === 1 ? '1 neues Bier' : `${n} neue Biere`} {evMode ? 'an diesem Abend' : mode === 'wochen' ? 'in dieser Woche' : 'in diesem Monat'}
            </span>
          </div>
          <button onClick={() => onSel(null)}>Ganzer Kasten</button>
        </div>
      ) : (
        <div className="lf-head">
          <b>{isCur ? 'Im Kasten' : `In Kasten ${num}`}</b>
          <span>
            {crate.length
              ? `${crate.length} ${crate.length === 1 ? 'Bier' : 'Biere'} an ${buckets.length} ${buckets.length === 1 ? unit[0] : unit[1]}`
              : 'noch leer'}
          </span>
        </div>
      )}
      {!crate.length && <p className="lf-empty">Das nächste neue Bier kommt hier rein.</p>}

      {groups.map((g) => (
        <div key={g.key} className="lf-group">
          {!selB && (
            <button className="lf-day" onClick={() => onSel(g.key)}>
              {label(g)}
            </button>
          )}
          {[...g.items].reverse().map((i) => {
            const c = crate[i]
            const a = aggs.get(c.beerId)
            const beer = a?.beer
            const where = [beer?.brewery?.name ?? c.brewery, beer?.brewery?.city].filter(Boolean).join(', ')
            const what = [beer?.style, beer?.abv != null ? `${String(beer.abv).replace('.', ',')} %` : null].filter(Boolean).join(', ')
            return (
              <button key={c.beerId} className={`lf-row ${focus === c.beerId ? 'on' : ''}`} onClick={() => go(`/beer/${c.beerId}`)}>
                <span className="lf-pic">
                  <Bottle style={beer?.style} color={c.color} height={70} />
                  <Cap color={c.color} mark={c.mark} size={24} className="lf-cap" />
                </span>
                <span className="lf-txt">
                  <b>{beer?.name ?? c.name}</b>
                  {where && <span>{where}</span>}
                  {what && <span>{what}</span>}
                </span>
                <span className="lf-right">
                  <b>{a?.count ?? 1}×</b>
                  {a?.avg != null && <RateDots value={a.avg} />}
                </span>
              </button>
            )
          })}
        </div>
      ))}

      <div className="lf-foot">
        <button className="lf-all" onClick={() => onList('drunk')}>
          <IconSearch size={17} /> Alle {total} Biere
        </button>
        <button className="lf-wish" onClick={() => onList('wish')}>
          Merkliste {wishCount > 0 && <span>{wishCount}</span>}
        </button>
      </div>
    </section>
  )
}

/** Bewertung als fünf kleine Korken (nur Anzeige, keine Knöpfe – sitzt in einer Zeile, die selbst ein Knopf ist) */
function RateDots({ value }: { value: number }) {
  return (
    <span className="lf-dots" role="img" aria-label={`${formatRating(value)} von 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <i key={n} style={{ '--f': `${Math.max(0, Math.min(1, value - (n - 1))) * 100}%` } as React.CSSProperties} />
      ))}
    </span>
  )
}

// ------------------------------------------------------------------------------------------ Turm zum Ausziehen

function TowerSheet({
  crates,
  view,
  beers,
  onPick,
  onClose,
}: {
  crates: CrateCap[][]
  view: number
  beers: number
  onPick: (i: number) => void
  onClose: () => void
}) {
  useEscape(true, onClose)
  const top = crates.length - 1
  const rows = []
  let lastMonth = ''
  for (let i = top; i >= 0; i--) {
    if (!crates[i].length && i !== top) continue
    const info = crateInfo(crates, i)
    const mark = info.month !== lastMonth ? info.month : ''
    lastMonth = info.month
    rows.push({ i, info, mark })
  }
  return createPortal(
    <div className="tw-backdrop" onClick={onClose}>
      <div className="tw-sheet" role="dialog" aria-label="Dein Turm" onClick={(e) => e.stopPropagation()}>
        <div className="tw-head">
          <span>
            <b>Dein Turm</b>
            <span>
              {rows.length} Kästen, {beers} Biere, seit {crateInfo(crates, 0).since}
            </span>
          </span>
          <button onClick={onClose} aria-label="Schließen">
            <IconX size={18} />
          </button>
        </div>
        <div className="tw-list">
          {rows.map(({ i, info, mark }) => (
            <div key={i} className="tw-row">
              <span className="tw-month">{mark}</span>
              <button
                className={`tw-band ${i === view ? 'on' : ''}`}
                aria-current={i === view ? 'true' : undefined}
                aria-label={`Kasten ${info.num}${i === top ? ', läuft' : `, ${info.range}`}`}
                onClick={() => onPick(i)}
              >
                <b>Kasten {info.num}</b>
                <span className="tw-stripes">
                  {info.stripes.map((c, k) => (
                    <i key={k} style={{ background: c }} />
                  ))}
                </span>
                <span className="tw-range">{i === top ? 'läuft' : info.range}</span>
              </button>
            </div>
          ))}
          <div className="tw-row">
            <span />
            <span className="tw-shadow" />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ------------------------------------------------------------------------------------------ Kasten voll: Turm-Fahrt

function Box({
  W,
  H,
  D,
  z,
  op = 1,
  tone,
  front,
  children,
  style,
}: {
  W: number
  H: number
  D: number
  z: number
  op?: number
  tone: 'old' | 'full' | 'new'
  front: React.ReactNode
  children?: React.ReactNode
  style?: React.CSSProperties
}) {
  return (
    <div className={`tw-box ${tone}`} style={{ width: W, height: H, transform: `translateZ(${z}px)`, opacity: op, ...style }}>
      <div className="tw-side" style={{ width: D, height: H }} />
      <div className="tw-side r" style={{ left: W, width: D, height: H }} />
      <div className="tw-front" style={{ top: H, width: W, height: D, padding: `${Math.round(D * 0.12)}px ${Math.round(W * 0.056)}px` }}>
        {front}
      </div>
      <div className="tw-top">{children}</div>
    </div>
  )
}

function Front({ name, stripes, D, yellow }: { name: string; stripes?: string[]; D: number; yellow?: boolean }) {
  return (
    <>
      <span className="tw-front-row">
        <b style={{ fontSize: Math.round(D * 0.25), color: yellow ? 'var(--pfand)' : undefined }}>{name}</b>
        <span className="tw-grip" style={{ height: Math.round(D * 0.22) }} />
      </span>
      {stripes && (
        <span className="tw-front-stripes" style={{ height: Math.round(D * 0.18) }}>
          {stripes.map((c, k) => (
            <i key={k} style={{ background: c }} />
          ))}
        </span>
      )}
    </>
  )
}

function TowerFx({
  W,
  H,
  slot,
  capSize,
  slotPos,
  crates,
  full,
  onDone,
}: {
  W: number
  H: number
  slot: number
  capSize: number
  slotPos: (i: number) => { x: number; y: number }
  crates: CrateCap[][]
  full: number
  onDone: () => void
}) {
  const [ph, setPh] = useState<TowerPhase>('drop')
  const done = useRef(onDone)
  done.current = onDone
  useEffect(() => {
    haptic(10)
    const ts = TOWER_STEPS.map(([p, t]) =>
      window.setTimeout(() => {
        setPh(p)
        if (p === 'voll' || p === 'land') haptic(p === 'land' ? 30 : 15)
      }, t),
    )
    ts.push(window.setTimeout(() => done.current(), TOWER_STEPS[TOWER_STEPS.length - 1][1] + 500))
    return () => ts.forEach((t) => window.clearTimeout(t))
  }, [])

  const inn = (l: TowerPhase[]) => l.includes(ph)
  const camOf = useMemo(() => towerCamera(full, W), [full, W])
  const { D, below, deep } = camOf
  const pulled = inn(['pull', 'fall', 'land'])
  const isDone = ph === 'done'
  const caps = crates[full] ?? []
  const beers = (full + 1) * CRATE
  const evs = bucketsOf(caps, 'tage')
  const evOf: number[] = []
  evs.forEach((b, j) => b.items.forEach((i) => (evOf[i] = j)))

  const tower = []
  for (let j = 0; j < below; j++) {
    const k = full - 1 - j
    let op = 1
    if (deep && j === below - 2) op = 0.55
    if (deep && j === below - 1) op = 0.22
    tower.push(
      <Box key={k} W={W} H={H} D={D} z={-D * (j + 1)} op={isDone ? 0 : op} tone="old" front={<Front name={`Kasten ${k + 1}`} stripes={stripesOf(crates[k])} D={D} />} />,
    )
  }

  const slots = Array.from({ length: CRATE }, (_, i) => {
    const p = slotPos(i)
    return <span key={i} className={`ks-slot ${evOf[i] % 2 ? 'alt' : ''}`} style={{ left: p.x, top: p.y, width: slot, height: slot }} />
  })

  return (
    <div className={`tw-stage ${ph === 'land' ? 'shake' : ''}`} style={{ height: H }}>
      <div
        className="tw-cam"
        style={{
          width: W,
          height: H,
          transformOrigin: `${W / 2}px ${H / 2}px`,
          transform: pulled ? camOf.pull : ph === 'back' ? camOf.back : 'none',
          transition: pulled ? 'transform 1.3s cubic-bezier(.45,0,.2,1)' : ph === 'back' ? 'transform 1.1s cubic-bezier(.45,0,.2,1)' : 'none',
        }}
      >
        {!deep && (
          <div
            className="tw-floor"
            style={{ left: -W * 0.2, top: -H * 0.23, width: W * 1.4, height: H * 1.46, transform: `translateZ(${-D * (below + 1) - 2}px)`, opacity: isDone ? 0 : 1 }}
          />
        )}
        {tower}
        <Box W={W} H={H} D={D} z={0} op={isDone ? 0 : 1} tone="full" front={<Front name={`Kasten ${full + 1}`} stripes={stripesOf(caps)} D={D} yellow />}>
          <i className="ks-grip" />
          {slots}
          {caps.map((c, i) => {
            const p = slotPos(i)
            const o = (slot - capSize) / 2
            return (
              <span
                key={c.beerId}
                className={`ks-cap ${i === CRATE - 1 && ph === 'drop' ? 'drop' : ''}`}
                style={{
                  left: p.x + o,
                  top: p.y + o,
                  width: capSize,
                  height: capSize,
                  background: capBackground(c.color),
                  color: inkOn(c.color),
                  fontSize: Math.round(capSize * 0.34),
                  cursor: 'default',
                }}
              >
                {c.mark}
              </span>
            )
          })}
          {inn(['voll', 'pull', 'fall', 'land', 'back']) && (
            <div className="ks-voll" aria-hidden="true">
              <span>VOLL</span>
            </div>
          )}
        </Box>
        {inn(['pull', 'fall', 'land', 'back', 'done']) && (
          <Box
            W={W}
            H={H}
            D={D}
            z={isDone ? 0 : inn(['fall', 'land', 'back']) ? D : 1000}
            op={inn(['fall', 'land', 'back', 'done']) ? 1 : 0}
            tone="new"
            front={<Front name={`Kasten ${full + 2}`} D={D} />}
            style={{ transition: ph === 'fall' ? 'transform .56s cubic-bezier(.6,0,1,.6), opacity .08s' : 'none', pointerEvents: 'none' }}
          >
            <i className="ks-grip" />
            {Array.from({ length: CRATE }, (_, i) => {
              const p = slotPos(i)
              return <span key={i} className="ks-slot" style={{ left: p.x, top: p.y, width: slot, height: slot }} />
            })}
          </Box>
        )}
      </div>
      {pulled && (
        <div className="tw-tag" aria-live="polite">
          <span>{full === 0 ? 'Dein erster Kasten' : 'Dein Turm'}</span>
          <span>{full === 0 ? '20 Biere' : `${full + 1} Kästen, ${beers} Biere`}</span>
        </div>
      )}
      {pulled && deep && <div className="tw-deep">und {full - below} darunter</div>}
    </div>
  )
}

// ------------------------------------------------------------------------------------------ Teilen

function ShareSheet({ crates, full, onClose }: { crates: CrateCap[][]; full: number; onClose: () => void }) {
  useEscape(true, onClose)
  const [busy, setBusy] = useState(false)
  const fulls = crates.slice(0, full + 1)
  const beers = fulls.length * CRATE
  const since = crateInfo(crates, 0).since
  const pn = Math.min(fulls.length, 14)
  const posterH = Math.max(7, Math.min(30, Math.floor(150 / (pn + 1)) - 3))
  const poster = fulls.slice(-pn).reverse()
  const share = async () => {
    setBusy(true)
    const r = await shareTowerPoster({ beers, crates: fulls.map((c) => ({ stripes: stripesOf(c) })), since, title: `Kasten ${full + 1} ist voll` })
    setBusy(false)
    if (r === 'saved') toast({ icon: '🖼️', msg: 'Bild gespeichert' })
    if (r === 'failed') toast({ icon: '⚠️', msg: 'Bild ging nicht' })
    if (r !== 'failed') onClose()
  }
  return createPortal(
    <div className="tw-backdrop share" onClick={onClose}>
      <div className="tw-share" role="dialog" aria-label={`Kasten ${full + 1} ist voll`} onClick={(e) => e.stopPropagation()}>
        <div className="tw-poster" style={{ gap: posterH > 14 ? 3 : 2 }} aria-hidden="true">
          <b>{beers} Biere</b>
          <span className="tw-poster-next" style={{ height: posterH }} />
          {poster.map((c, k) => (
            <span key={k} className="tw-poster-band" style={{ height: posterH, padding: `${Math.max(2, Math.round(posterH / 4))}px 5px` }}>
              {stripesOf(c).map((col, s) => (
                <i key={s} style={{ background: col }} />
              ))}
            </span>
          ))}
          <span className="tw-poster-foot">
            <b>Plopp!</b>
            <span>seit {since}</span>
          </span>
        </div>
        <div className="tw-share-txt">
          <b>Kasten {full + 1} ist voll</b>
          <span>Dein Turm als Bild für die Story.</span>
          <button className="tw-share-go" onClick={share} disabled={busy}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
            </svg>
            Turm teilen
          </button>
          <button className="tw-share-later" onClick={onClose}>
            Später
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
