/**
 * Startseite: die Sammlung als Getränkekasten.
 * Jedes neue (verschiedene) Bier ist ein Kronkorken in der Hausfarbe seiner Brauerei; 20 Fächer = ein Kasten.
 * Volle Kästen stapeln sich darunter und lassen sich durchblättern. Korken desselben Abends teilen sich
 * Fachfarbe und ein gelbes Band. Umschalter Tage/Wochen/Monate: die Korken fliegen aus den Fächern und
 * bilden Stapel je Zeitraum.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Checkin } from '../types'
import { go } from '../router'
import { usePageState } from '../pageState'
import { capMark, houseColor, inkOn, capBackground } from './kasten'
import { load, reducedMotion, save } from './fx'
import { IconBack, IconChevron } from './icons'

export const CRATE = 20

export interface CrateCap {
  beerId: string
  name: string
  brewery: string
  color: string
  mark: string
  first: number
}

const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
const MO = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.']
const MOL = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

/** Abend eines Zeitpunkts: bis 4 Uhr früh zählt noch zum Vortag (wie bei den Abend-Challenges) */
function evening(t: number) {
  const d = new Date(t)
  if (d.getHours() < 4) d.setDate(d.getDate() - 1)
  d.setHours(12, 0, 0, 0)
  return d
}

function isoWeek(d0: Date) {
  const d = new Date(d0)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const w1 = new Date(d.getFullYear(), 0, 4)
  return { year: d.getFullYear(), week: 1 + Math.round(((d.getTime() - w1.getTime()) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7) }
}

const dayLabel = (d: Date) => `${WD[d.getDay()]}, ${d.getDate()}. ${MO[d.getMonth()]}`
const shortDate = (d: Date) => `${d.getDate()}. ${MO[d.getMonth()]}`

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

type Mode = 'kasten' | 'tage' | 'wochen' | 'monate'
const MODES: { id: Mode; label: string }[] = [
  { id: 'kasten', label: 'Kasten' },
  { id: 'tage', label: 'Tage' },
  { id: 'wochen', label: 'Wochen' },
  { id: 'monate', label: 'Monate' },
]

interface Bucket {
  key: string
  label: string
  title: string
  items: number[]
}

function bucketsOf(caps: CrateCap[], mode: Mode): Bucket[] {
  const out: Bucket[] = []
  const map = new Map<string, Bucket>()
  const thisYear = new Date().getFullYear()
  caps.forEach((c, i) => {
    const d = evening(c.first)
    let key: string, label: string, title: string
    if (mode === 'wochen') {
      const w = isoWeek(d)
      key = `w${w.year}-${w.week}`
      label = `KW ${w.week}`
      title = `Kalenderwoche ${w.week}${w.year !== thisYear ? ` ${w.year}` : ''}`
    } else if (mode === 'monate') {
      key = `m${d.getFullYear()}-${d.getMonth()}`
      label = MO[d.getMonth()]
      title = `${MOL[d.getMonth()]}${d.getFullYear() !== thisYear ? ` ${d.getFullYear()}` : ''}`
    } else {
      key = `e${d.toDateString()}`
      label = `${WD[d.getDay()]} ${d.getDate()}.`
      title = dayLabel(d)
    }
    let b = map.get(key)
    if (!b) {
      b = { key, label, title, items: [] }
      map.set(key, b)
      out.push(b)
    }
    b.items.push(i)
  })
  return out
}

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

const SEEN = 'plopp-kasten-seen'

export default function KastenStapel({ caps }: { caps: CrateCap[] }) {
  const crates = useMemo(() => {
    const out: CrateCap[][] = []
    for (let i = 0; i < caps.length; i += CRATE) out.push(caps.slice(i, i + CRATE))
    if (!out.length || out[out.length - 1].length === CRATE) out.push([])
    return out
  }, [caps])
  const top = crates.length - 1

  const [mode, setMode] = usePageState<Mode>('kasten-mode', 'kasten')
  const [view, setView] = useState(top)
  const [sel, setSel] = useState<string | null>(null)
  const [phase, setPhase] = useState<null | 'full' | 'sink' | 'fall'>(null)
  const [dropIdx, setDropIdx] = useState<number | null>(null)
  const [ref, W] = useWidth()

  // Neues Bier seit dem letzten Besuch? Korken fallen lassen – und war der Kasten damit voll, einen neuen draufstellen.
  useEffect(() => {
    const seen = load<number | null>(SEEN, null)
    save(SEEN, caps.length)
    if (seen == null || caps.length <= seen || reducedMotion()) {
      setView(top)
      return
    }
    const crossed = Math.floor(caps.length / CRATE) > Math.floor(seen / CRATE)
    if (!crossed) {
      setView(top)
      setDropIdx((caps.length - 1) % CRATE)
      return
    }
    // gerade voll geworden: erst den vollen Kasten zeigen, dann wegsinken lassen, dann fällt der neue drauf
    const full = Math.floor((caps.length - 1) / CRATE)
    setView(Math.min(full, top))
    setDropIdx((caps.length - 1) % CRATE)
    setPhase('full')
    const t1 = window.setTimeout(() => setPhase('sink'), 1400)
    const t2 = window.setTimeout(() => {
      setView(top)
      setDropIdx(null)
      setPhase('fall')
    }, 1950)
    const t3 = window.setTimeout(() => setPhase(null), 2800)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.clearTimeout(t3)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caps.length])

  const crate = crates[Math.min(view, top)] ?? []
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

  // Maße
  const pad = 12
  const gap = 6
  const slot = Math.floor((W - pad * 2 - gap * 4) / 5)
  const H = 24 + slot * 4 + gap * 3 + pad
  const capSize = Math.round(slot * 0.84)
  const B = Math.max(1, buckets.length)
  const colW = W / B
  const discW = Math.max(12, Math.min(40, colW - 10))
  const base = H - 44
  const maxN = Math.max(1, ...buckets.map((b) => b.items.length))
  const step = Math.min(11, (base - 34) / maxN)

  const slotPos = (i: number) => ({ x: pad + (i % 5) * (slot + gap), y: 24 + Math.floor(i / 5) * (slot + gap) })
  const selBucket = sel ? [...(stackMode ? buckets : evenings)].find((b) => b.key === sel) : undefined

  const first = crate[0]
  const last = crate[crate.length - 1]
  const range = first ? `${shortDate(evening(first.first))} bis ${shortDate(evening(last.first))}` : 'noch leer'

  let infoTitle = ''
  let infoText: React.ReactNode = null
  if (selBucket) {
    const n = selBucket.items.length
    infoTitle = `${selBucket.title}: ${n} ${n === 1 ? 'neues Bier' : 'neue Biere'}`
    infoText = (
      <span className="ks-names">
        {selBucket.items.map((i) => (
          <button key={crate[i].beerId} className="ks-name" onClick={() => go(`/beer/${crate[i].beerId}`)}>
            {crate[i].name}
          </button>
        ))}
      </span>
    )
  } else if (!crate.length) {
    infoTitle = view === top && top > 0 ? 'Frischer Kasten' : 'Noch leer'
    infoText = 'Das nächste neue Bier kommt hier rein.'
  } else {
    const list = stackMode ? buckets : evenings
    const best = [...list].sort((a, b) => b.items.length - a.items.length)[0]
    const unitWord = { kasten: 'Abende', tage: 'Abende', wochen: 'Wochen', monate: 'Monate' }[mode]
    const bestWord = { kasten: 'Bester Abend', tage: 'Bester Abend', wochen: 'Beste Woche', monate: 'Bester Monat' }[mode]
    infoTitle = `${list.length} ${unitWord} in diesem Kasten`
    infoText = `${bestWord}: ${best.title} mit ${best.items.length} ${best.items.length === 1 ? 'neuen Bier' : 'neuen Bieren'}`
  }

  const bands = []
  for (let c = top; c >= 0; c--) {
    if (c === view || !crates[c].length) continue
    bands.push(c)
  }
  const shownBands = bands.slice(0, 5)

  return (
    <section className="ks" aria-label="Deine Kästen">
      <div className="ks-head">
        <button className="ks-arrow" disabled={view <= 0} onClick={() => (setView(view - 1), setSel(null), setDropIdx(null))} aria-label="Älterer Kasten">
          <IconBack size={20} />
        </button>
        <div className="ks-title">
          <b>Kasten {Math.min(view, top) + 1}</b>
          <span>{range}</span>
        </div>
        <div className="ks-fill">
          {crate.length}/{CRATE}
        </div>
        <button className="ks-arrow" disabled={view >= top} onClick={() => (setView(view + 1), setSel(null), setDropIdx(null))} aria-label="Neuerer Kasten">
          <IconChevron size={20} />
        </button>
      </div>

      <div ref={ref} className={`ks-stage ${phase === 'sink' ? 'sink' : phase === 'fall' ? 'fall' : ''} ${stackMode ? 'stacked' : ''}`} style={{ height: H }}>
        <div className="ks-crate">
          <i className="ks-grip" />
        </div>
        {Array.from({ length: CRATE }, (_, i) => {
          const p = slotPos(i)
          const c = crate[i]
          const on = !!c && !!sel && !stackMode && keyOfCap(i) === sel
          return (
            <span
              key={i}
              className={`ks-slot ${c && evOf[i] % 2 ? 'alt' : ''} ${on ? 'on' : ''}`}
              style={{ left: p.x, top: p.y, width: slot, height: slot }}
            />
          )
        })}
        {!stackMode &&
          crate.map((_, i) => {
            const n = crate[i + 1]
            if (!n || i % 5 === 4 || evOf[i] !== evOf[i + 1]) return null
            const p = slotPos(i)
            const dim = sel && keyOfCap(i) !== sel
            return <span key={`l${i}`} className="ks-link" style={{ left: p.x + slot - 3, top: p.y + slot / 2 - 3, opacity: dim ? 0.25 : 1 }} />
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
              <span className="ks-col-n" style={{ bottom: H - base + b.items.length * step + 8 }}>
                {b.items.length}
              </span>
              <span className="ks-col-label" style={{ top: base + 14 }}>
                {B > 12 && j % 2 ? '' : b.label}
              </span>
            </button>
          ))}
        {stackMode && <span className="ks-base" style={{ top: base + 10 }} />}
        {crate.map((c, i) => {
          const dim = sel && keyOfCap(i) !== sel
          let style: React.CSSProperties
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
              height: 10,
              background: c.color,
              color: 'transparent',
              fontSize: 0,
              transitionDelay: `${j * 50 + n * 25}ms`,
            }
          }
          return (
            <button
              key={c.beerId}
              className={`ks-cap ${stackMode ? 'disc' : ''} ${dropIdx === i ? 'drop' : ''}`}
              style={{ ...style, opacity: dim ? 0.28 : 1 }}
              onClick={() => {
                const k = keyOfCap(i) ?? null
                setSel(sel === k ? null : k)
              }}
              aria-label={`${c.name}, zuerst am ${dayLabel(evening(c.first))}`}
            >
              {c.mark}
            </button>
          )
        })}
        {phase === 'full' && (
          <div className="ks-voll" aria-hidden="true">
            <span>VOLL</span>
          </div>
        )}
      </div>

      {shownBands.length > 0 && (
        <div className="ks-bands">
          {shownBands.map((c, k) => {
            const cr = crates[c]
            return (
              <button
                key={c}
                className={`ks-band ${phase === 'fall' && k === 0 ? 'rise' : ''}`}
                onClick={() => (setView(c), setSel(null), setDropIdx(null))}
                aria-label={`Kasten ${c + 1} ansehen`}
              >
                <b>Kasten {c + 1}</b>
                <i className="ks-band-grip" />
                <span>
                  {shortDate(evening(cr[0].first))} bis {shortDate(evening(cr[cr.length - 1].first))}
                </span>
              </button>
            )
          })}
          {bands.length > shownBands.length && <div className="ks-more">und {bands.length - shownBands.length} weitere</div>}
        </div>
      )}

      <div className="ks-modes" role="tablist">
        {MODES.map((m) => (
          <button
            key={m.id}
            role="tab"
            aria-selected={mode === m.id}
            className={mode === m.id ? 'on' : ''}
            onClick={() => (setMode(m.id), setSel(null), setDropIdx(null))}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="ks-info">
        <b>{infoTitle}</b>
        <div>{infoText}</div>
      </div>
    </section>
  )
}
