/**
 * Das Zeichen neben „Plopp!“: ein fliegender Kronkorken mit Bewegungsstrichen und etwas Schaum.
 * Bei „Plopp“ (Start, Tippen, neuer Check-in) holt der Korken aus, fliegt kreiselnd hoch und landet wieder,
 * die Striche ziehen nach, der Schaum spritzt. Reine CSS-Animation.
 */
import { useEffect, useRef, useState } from 'react'

const CAP = '36.00,8.00 38.56,10.99 41.90,8.89 43.46,12.50 47.27,11.48 47.70,15.39 51.64,15.53 50.90,19.40 54.62,20.69 52.77,24.17 55.94,26.51 53.15,29.29 55.50,32.45 52.01,34.28 53.32,38.00 49.45,38.72 49.60,42.66 45.69,42.21 44.68,46.02 41.07,44.44 38.98,47.78 36.00,45.20 33.02,47.78 30.93,44.44 27.32,46.02 26.31,42.21 22.40,42.66 22.55,38.72 18.68,38.00 19.99,34.28 16.50,32.45 18.85,29.29 16.06,26.51 19.23,24.17 17.38,20.69 21.10,19.40 20.36,15.53 24.30,15.39 24.73,11.48 28.54,12.50 30.10,8.89 33.44,10.99'

/** „Plopp!“ auslösen – z. B. nach einem Check-in */
export const plopp = () => window.dispatchEvent(new Event('plopp-pop'))

export default function PloppMark({ size = 24 }: { size?: number }) {
  const [popping, setPopping] = useState(false)
  const busy = useRef(false)

  useEffect(() => {
    const pop = () => {
      if (busy.current) return
      busy.current = true
      setPopping(true)
      window.setTimeout(() => {
        busy.current = false
        setPopping(false)
      }, 1250)
    }
    window.addEventListener('plopp-pop', pop)
    const first = window.setTimeout(pop, 600)
    return () => {
      window.removeEventListener('plopp-pop', pop)
      window.clearTimeout(first)
    }
  }, [])

  return (
    <svg className={`plopp-mark ${popping ? 'pop' : ''}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <g className="pf-lines" stroke="#2a1a0d" strokeWidth="4" strokeLinecap="round">
        <path d="M20 42 L8 50" />
        <path d="M24 50 L14 59" />
        <path d="M14 35 L4 39" />
      </g>
      <g className="pf-foam" fill="#fffaf0" stroke="#2a1a0d" strokeWidth="1.6">
        <circle className="f1" cx="13.4" cy="58" r="3.6" />
        <circle className="f2" cx="17" cy="57.5" r="4.1" />
        <circle className="f3" cx="20.6" cy="58" r="3.6" />
      </g>
      <g className="pf-spark" fill="#fffaf0" stroke="#2a1a0d" strokeWidth="1.2">
        <circle cx="50" cy="48" r="2" />
        <circle cx="56" cy="40" r="1.5" />
        <circle cx="46" cy="56" r="1.4" />
      </g>
      <g transform="rotate(-18 36 28)">
        <g className="pf-cap">
          <polygon points={CAP} fill="#2a1a0d" />
          <circle cx="36" cy="28" r="12" fill="#ffe6a3" />
          <circle cx="36" cy="28" r="7.5" fill="none" stroke="#2a1a0d" strokeOpacity="0.18" strokeWidth="2" />
          <path d="M29 22.5 a9 9 0 0 1 6-3" fill="none" stroke="#fff" strokeOpacity="0.8" strokeWidth="2.2" strokeLinecap="round" />
        </g>
      </g>
    </svg>
  )
}
