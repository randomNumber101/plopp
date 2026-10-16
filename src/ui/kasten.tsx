/**
 * Bausteine im Kasten-Design: Kronkorken in der Hausfarbe der Brauerei und Ersatzflaschen je Biersorte.
 */
import type { CSSProperties } from 'react'

/** gedämpfte Kronkorken-Farben, falls eine Brauerei (noch) keine eigene Hausfarbe hat */
const HOUSE = [
  '#c8102e', '#123b6b', '#0e5a3a', '#1f4e9a', '#6b1e2e', '#2c2c64', '#b5122b', '#0f3c2e', '#7a1e2b', '#1d3c78',
  '#8c1d2c', '#14243f', '#5a2a1a', '#0b6b3a', '#a51c30', '#1a1a1a', '#b4121b', '#0f5f3c', '#3a2a1a', '#4a2a6a',
]

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

const HEX = /^#[0-9a-f]{6}$/i

/** Hausfarbe einer Brauerei: gepflegte Farbe, sonst stabil aus dem Namen abgeleitet */
export function houseColor(b: { cap_color?: string | null; name?: string | null; id?: string | null } | null | undefined): string {
  if (b?.cap_color && HEX.test(b.cap_color)) return b.cap_color
  const key = b?.name || b?.id || ''
  if (!key) return '#5e7a67'
  return HOUSE[hash(key.toLowerCase()) % HOUSE.length]
}

/** lesbare Schriftfarbe auf einer Hintergrundfarbe */
export function inkOn(hex: string) {
  const m = HEX.test(hex) ? hex : '#000000'
  const r = parseInt(m.slice(1, 3), 16)
  const g = parseInt(m.slice(3, 5), 16)
  const b = parseInt(m.slice(5, 7), 16)
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#12261a' : '#ffffff'
}

/** Kürzel für den Kronkorken: zwei Buchstaben aus dem Brauerei- (oder Bier-)namen */
const NOISE = /^(brauerei|brauhaus|bräu|braeu|privatbrauerei|klosterbrauerei|hausbrauerei|bierbrauerei|brewery|brasserie|birra|the|der|die|das|zum|zur|st\.?)$/i
export function capMark(name: string | null | undefined) {
  const words = (name ?? '')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/[\s-]+/)
    .filter((w) => w && !NOISE.test(w))
  if (!words.length) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

export function capBackground(color: string) {
  return `radial-gradient(circle, ${color} 0 55%, rgb(0 0 0 / 0.24) 56% 60%, ${color} 61%)`
}

/** Kronkorken (21 Zacken) mit Ring und Kürzel */
export function Cap({
  color,
  mark,
  size = 44,
  className = '',
  ghost,
  style,
  title,
}: {
  color: string
  mark?: string
  size?: number
  className?: string
  ghost?: boolean
  style?: CSSProperties
  title?: string
}) {
  return (
    <span
      className={`kk ${ghost ? 'kk-ghost' : ''} ${className}`}
      title={title}
      aria-hidden={title ? undefined : true}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, Math.round(size * 0.34)),
        background: ghost ? undefined : capBackground(color),
        color: ghost ? undefined : inkOn(color),
        ...style,
      }}
    >
      {mark}
    </span>
  )
}

// ------------------------------------------------------------------------------------------ Ersatzflaschen

type Shape = 'euro' | 'longneck' | 'weizen' | 'buegel' | 'bauch' | 'stange' | 'steinie' | 'dose'

const SHAPES: Record<Shape, { d: string; label: [number, number, number, number]; neck: [number, number, number] }> = {
  euro: { d: 'M24 4h12v40c0 8 16 12 16 30v116a6 6 0 0 1-6 6H14a6 6 0 0 1-6-6V74c0-18 16-22 16-30Z', label: [8, 112, 44, 46], neck: [22, 0, 16] },
  longneck: { d: 'M25 2h10v60c0 6 14 10 14 24v104a6 6 0 0 1-6 6H17a6 6 0 0 1-6-6V86c0-14 14-18 14-24Z', label: [11, 120, 38, 42], neck: [23, 0, 14] },
  weizen: { d: 'M25 2h10v30c0 20 16 30 16 60v100a6 6 0 0 1-6 6H15a6 6 0 0 1-6-6V92c0-30 16-40 16-60Z', label: [9, 120, 42, 44], neck: [23, 0, 14] },
  buegel: { d: 'M24 14h12v32c0 8 16 12 16 30v114a6 6 0 0 1-6 6H14a6 6 0 0 1-6-6V76c0-18 16-22 16-30Z', label: [8, 114, 44, 44], neck: [21, 4, 18] },
  bauch: { d: 'M24 4h12v34c0 10 20 16 20 44v108a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6V82c0-28 20-34 20-44Z', label: [4, 116, 52, 46], neck: [22, 0, 16] },
  stange: { d: 'M25 20h10v30c0 6 8 8 8 16v124a5 5 0 0 1-5 5H22a5 5 0 0 1-5-5V66c0-8 8-10 8-16Z', label: [17, 116, 26, 50], neck: [23, 18, 14] },
  steinie: { d: 'M24 50h12v22c0 6 14 8 14 20v96a6 6 0 0 1-6 6H16a6 6 0 0 1-6-6V92c0-12 14-14 14-20Z', label: [10, 120, 40, 44], neck: [22, 48, 16] },
  dose: { d: 'M14 70h32l4 6v114a6 6 0 0 1-6 6H16a6 6 0 0 1-6-6V76Z', label: [10, 100, 40, 70], neck: [16, 66, 28] },
}

/** Sorte → Flaschenform, Glas und Etikettfarbe */
export function bottleFor(style: string | null | undefined): { shape: Shape; glass: string; label: string } {
  const s = (style ?? '').toLowerCase()
  if (/weiz|weiß|weiss|hefe/.test(s)) return { shape: 'weizen', glass: '#6b4416', label: '#f08a24' }
  if (/pils/.test(s)) return { shape: 'longneck', glass: '#2e6b3a', label: '#eef1ee' }
  if (/keller|zwickel|landbier|ungespundet/.test(s)) return { shape: 'buegel', glass: '#4a2e10', label: '#e8d9a8' }
  if (/bock|dunkel|schwarz|stout|porter|rauch/.test(s)) return { shape: 'bauch', glass: '#3d250c', label: '#6b3a1e' }
  if (/kölsch|koelsch|alt/.test(s)) return { shape: 'stange', glass: '#7a5a2a', label: '#ffe89a' }
  if (/ipa|pale|ale|sour|craft/.test(s)) return { shape: 'steinie', glass: '#5a3a12', label: '#2f80c9' }
  if (/radler|alkoholfrei/.test(s)) return { shape: 'longneck', glass: '#2e6b3a', label: '#cfe9a8' }
  return { shape: 'euro', glass: '#5a3a12', label: '#f4c430' }
}

/** Ersatzflasche für Biere ohne Foto – Form und Glas nach Sorte, Banderole und Korken in der Hausfarbe */
export function Bottle({ style, color, height = 120, className = '' }: { style?: string | null; color: string; height?: number; className?: string }) {
  const b = bottleFor(style)
  const sh = SHAPES[b.shape]
  const [lx, ly, lw, lh] = sh.label
  const [nx, ny, nw] = sh.neck
  return (
    <svg className={`bottle ${className}`} width={(height * 60) / 200} height={height} viewBox="0 0 60 200" aria-hidden="true">
      <path d={sh.d} fill={b.glass} />
      <rect x={lx} y={ly} width={lw} height={lh} rx="2" fill={b.label} />
      <rect x={lx} y={ly + 10} width={lw} height="6" fill={color} />
      <rect x={nx} y={ny} width={nw} height="7" rx="1.5" fill={b.shape === 'buegel' ? '#f2f2f2' : color} />
      <path d={`M${lx + 6} ${ly - 26}v${lh + 40}`} stroke="#fff" strokeOpacity=".28" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
