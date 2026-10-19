/**
 * Reine Logik für den Kasten auf der Startseite: Kästen schneiden, Abende/Wochen/Monate bündeln,
 * laufender Abend, Farbleisten und die Kamera der „Kasten voll“-Fahrt auf den Turm.
 */
export const CRATE = 20

export interface CrateCap {
  /** Check-in – jeder Check-in ist ein eigener Korken */
  id: string
  beerId: string
  name: string
  brewery: string
  color: string
  mark: string
  /** Zeitpunkt dieses Check-ins */
  first: number
  /** das wievielte Mal dieses Bier (1 = zum ersten Mal) */
  nth: number
  /** Bewertung dieses Check-ins */
  rating: number | null
}

export const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
export const MO = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.']
const MOL = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

/** Abend eines Zeitpunkts: bis 4 Uhr früh zählt noch zum Vortag (wie bei den Abend-Challenges) */
export function evening(t: number) {
  const d = new Date(t)
  if (d.getHours() < 4) d.setDate(d.getDate() - 1)
  d.setHours(12, 0, 0, 0)
  return d
}

/** Läuft gerade ein Abend (16 bis 4 Uhr)? Dann sein Schlüssel, sonst null */
export function liveEveningKey(now = Date.now()) {
  const h = new Date(now).getHours()
  if (h < 16 && h >= 4) return null
  return `e${evening(now).toDateString()}`
}

function isoWeek(d0: Date) {
  const d = new Date(d0)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const w1 = new Date(d.getFullYear(), 0, 4)
  return { year: d.getFullYear(), week: 1 + Math.round(((d.getTime() - w1.getTime()) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7) }
}

const yr = (d: Date) => (d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : '')
export const dayLabel = (d: Date) => `${WD[d.getDay()]}, ${d.getDate()}. ${MO[d.getMonth()]}${yr(d)}`
export const shortDate = (d: Date) => `${d.getDate()}. ${MO[d.getMonth()]}${yr(d)}`
export const numDate = (d: Date) =>
  `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear() !== new Date().getFullYear() ? String(d.getFullYear()).slice(2) : ''}`

/** Kästen à 20; ist der letzte voll, steht schon ein leerer neuer darauf */
export function splitCrates(caps: CrateCap[]): CrateCap[][] {
  const out: CrateCap[][] = []
  for (let i = 0; i < caps.length; i += CRATE) out.push(caps.slice(i, i + CRATE))
  if (!out.length || out[out.length - 1].length === CRATE) out.push([])
  return out
}

export type Mode = 'kasten' | 'tage' | 'wochen' | 'monate'

export interface Bucket {
  key: string
  label: string
  title: string
  items: number[]
}

export function bucketsOf(caps: CrateCap[], mode: Mode): Bucket[] {
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

/** 20 Hausfarben eines Kastens als Farbleiste; leere Fächer bleiben hell */
export function stripesOf(crate: CrateCap[], empty = 'rgb(255 255 255 / 0.16)') {
  return Array.from({ length: CRATE }, (_, i) => crate[i]?.color ?? empty)
}

export interface CrateInfo {
  index: number
  num: number
  full: boolean
  range: string
  since: string
  month: string
  stripes: string[]
}

export function crateInfo(crates: CrateCap[][], index: number, now = Date.now()): CrateInfo {
  const c = crates[index] ?? []
  const first = c[0] ? evening(c[0].first) : evening(now)
  const last = c.length ? evening(c[c.length - 1].first) : evening(now)
  return {
    index,
    num: index + 1,
    full: c.length === CRATE,
    range: c.length ? `${numDate(first)} bis ${numDate(last)}` : 'noch leer',
    since: shortDate(first),
    month: `${MO[last.getMonth()]}${last.getFullYear() !== new Date(now).getFullYear() ? ` ${String(last.getFullYear()).slice(2)}` : ''}`,
    stripes: stripesOf(c),
  }
}

// ------------------------------------------------------------------------------------------ Turm-Kamera

/** so viele volle Kästen unter dem gerade vollen zeigt die Kamerafahrt in 3D, der Rest verschwindet im Dunst */
export const TOWER_MAX_BELOW = 5

export function cam(y: number, s: number, rx: number, rz: number, tz: number) {
  return `translateY(${y}px) scale3d(${s},${s},${s}) rotateX(${rx}deg) rotateZ(${rz}deg) translateZ(${tz}px)`
}

/**
 * Kamera, die den sichtbaren Turm (höchstens TOWER_MAX_BELOW Kästen) plus den neuen Kasten in den Rahmen bringt –
 * für jede Turmhöhe. Abgestimmt auf eine Bühne von 358 px Breite, skaliert mit der echten Breite W.
 */
export function towerCamera(fullBelow: number, W: number) {
  const f = W / 358
  const D = Math.round(120 * f)
  const below = Math.min(fullBelow, TOWER_MAX_BELOW)
  const v = below + 1
  const span = v * D + D
  const s = Math.min(0.42, (380 * f) / (215 * f + 0.883 * span))
  const zc = (D - v * D) / 2
  return { D, below, deep: fullBelow > TOWER_MAX_BELOW, pull: cam(Math.round(16 * f), +s.toFixed(3), 62, -36, -zc), back: cam(0, 1, 0, 0, -D) }
}

/** Ablauf der Fahrt: Phase → Startzeit in ms */
export const TOWER_STEPS: [TowerPhase, number][] = [
  ['voll', 800],
  ['pull', 1700],
  ['fall', 3300],
  ['land', 3860],
  ['back', 4500],
  ['done', 5650],
]
export type TowerPhase = 'drop' | 'voll' | 'pull' | 'fall' | 'land' | 'back' | 'done'
