/**
 * Das Zeichen neben „Plopp!“: eine kleine Flasche mit Kronkorken.
 * – Bierspiegel schwappt mit der Neigung des Handys (tilt.ts)
 * – Kohlensäure steigt auf, Wellen laufen
 * – bei „Plopp“ (Start, Tippen, neuer Check-in) fliegt der Kronkorken hoch und Schaum spritzt
 * Alles reine CSS-Transforms; ohne Bewegung läuft kein JavaScript.
 */
import { useEffect, useRef, useState } from 'react'
import { nudge, subscribeSlosh } from './tilt'

const BOTTLE = 'M13.4 5.5h5.2v8c0 2.3 5.6 3.1 5.6 7.6V34a3 3 0 0 1-3 3H10.8a3 3 0 0 1-3-3V21.1c0-4.5 5.6-5.3 5.6-7.6Z'
const CAP =
  'M16.00 -0.50L16.88 0.32L18.05 0.05L18.40 1.20L19.55 1.55L19.28 2.72L20.10 3.60L19.28 4.48L19.55 5.65L18.40 6.00L18.05 7.15L16.88 6.88L16.00 7.70L15.12 6.88L13.95 7.15L13.60 6.00L12.45 5.65L12.72 4.48L11.90 3.60L12.72 2.72L12.45 1.55L13.60 1.20L13.95 0.05L15.12 0.32Z'
// Welle mit Periode 16 – wird endlos um 16 verschoben
const WAVE = (y: number) => `M-16 ${y} q4 -1.5 8 0 t8 0 t8 0 t8 0 t8 0 t8 0 t8 0 t8 0 V62 H-16Z`

/** „Plopp!“ auslösen – z. B. nach einem Check-in */
export const plopp = () => window.dispatchEvent(new Event('plopp-pop'))

export default function PloppMark({ size = 24 }: { size?: number }) {
  const ref = useRef<SVGSVGElement>(null)
  const [popping, setPopping] = useState(false)
  const busy = useRef(false)

  useEffect(() => (ref.current ? subscribeSlosh(ref.current) : undefined), [])

  useEffect(() => {
    const pop = () => {
      if (busy.current) return
      busy.current = true
      setPopping(true)
      nudge(11)
      window.setTimeout(() => {
        busy.current = false
        setPopping(false)
      }, 1100)
    }
    window.addEventListener('plopp-pop', pop)
    const first = window.setTimeout(pop, 700)
    return () => {
      window.removeEventListener('plopp-pop', pop)
      window.clearTimeout(first)
    }
  }, [])

  return (
    <svg
      ref={ref}
      className={`plopp-mark ${popping ? 'pop' : ''}`}
      width={size * 0.8}
      height={size}
      viewBox="0 -1 32 40"
      aria-hidden="true"
    >
      <defs>
        <clipPath id="pm-clip">
          <path d={BOTTLE} />
        </clipPath>
      </defs>
      <g clipPath="url(#pm-clip)">
        <rect x="0" y="0" width="32" height="40" fill="rgb(255 255 255 / 0.5)" />
        <g className="pm-liquid">
          <g className="pm-wave">
            <path d={WAVE(20.5)} fill="#fffaf0" />
            <path d={WAVE(23)} fill="#d98a00" />
          </g>
        </g>
        <circle className="pm-bubble" cx="13" cy="35" r="1.1" />
        <circle className="pm-bubble b2" cx="18.5" cy="35" r="0.8" />
        <circle className="pm-bubble b3" cx="15.5" cy="35" r="0.9" />
      </g>
      <path d={BOTTLE} fill="none" stroke="#2a1a0d" strokeWidth="2.3" strokeLinejoin="round" />
      <path d="M10.6 24.5v6" stroke="#fff" strokeOpacity="0.55" strokeWidth="1.6" strokeLinecap="round" />
      <g className="pm-spurt" fill="#fffaf0" stroke="#2a1a0d" strokeWidth="0.8">
        <circle cx="16" cy="3" r="2.6" />
        <circle cx="12.8" cy="0.6" r="1.5" />
        <circle cx="19.2" cy="-0.2" r="1.2" />
      </g>
      <path className="pm-cap" d={CAP} fill="#2a1a0d" />
    </svg>
  )
}
