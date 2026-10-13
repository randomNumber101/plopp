/**
 * Schwappendes Bier: Der Bierspiegel bleibt (ungefähr) waagerecht, wenn man das Handy neigt.
 * Ein einziger Sensor-Listener für die ganze App, eine kleine Feder-Simulation und
 * requestAnimationFrame nur, solange sich noch etwas bewegt. Abonnenten setzen eine
 * CSS-Variable (`--slosh`) an ihrem Element – kein React-Render pro Frame.
 */
import { reducedMotion } from './fx'

type Sub = (deg: number) => void

const MAX = 28 // Grad
let target = 0
let angle = 0
let vel = 0
let raf = 0
let listening = false
const subs = new Set<Sub>()

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

function screenAngle(): number {
  const so = typeof screen !== 'undefined' ? screen.orientation?.angle : undefined
  if (typeof so === 'number') return so
  const wo = (window as unknown as { orientation?: number }).orientation
  return typeof wo === 'number' ? wo : 0
}

function onOrient(e: DeviceOrientationEvent) {
  if (e.gamma == null || e.beta == null) return
  const so = screenAngle()
  // Neigung um die Achse, die gerade „nach vorne“ zeigt
  const roll = so === 90 ? e.beta : so === 270 || so === -90 ? -e.beta : so === 180 ? -e.gamma : e.gamma
  target = clamp(-roll, -MAX, MAX)
  kick()
}

function step() {
  // gedämpfte Feder: schwappt kurz über und beruhigt sich
  vel = (vel + (target - angle) * 0.07) * 0.88
  angle += vel
  subs.forEach((f) => f(angle))
  if (Math.abs(vel) < 0.02 && Math.abs(target - angle) < 0.05) {
    raf = 0
    return
  }
  raf = requestAnimationFrame(step)
}

function kick() {
  if (!raf && subs.size) raf = requestAnimationFrame(step)
}

function listen() {
  if (listening || typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return
  listening = true
  window.addEventListener('deviceorientation', onOrient)
}

type IOSOrientation = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> }

/** Braucht iOS eine Erlaubnis für den Bewegungssensor? */
export const needsTiltPermission = () =>
  typeof window !== 'undefined' &&
  'DeviceOrientationEvent' in window &&
  typeof (DeviceOrientationEvent as IOSOrientation).requestPermission === 'function' &&
  !listening

/** Auf iOS nur aus einem Tipp heraus aufrufbar; andere Geräte brauchen keine Erlaubnis. */
export async function requestTilt(): Promise<boolean> {
  const D = typeof window !== 'undefined' ? (window as unknown as { DeviceOrientationEvent?: IOSOrientation }).DeviceOrientationEvent : undefined
  if (!D) return false
  if (typeof D.requestPermission === 'function') {
    try {
      if ((await D.requestPermission()) !== 'granted') return false
    } catch {
      return false
    }
  }
  listen()
  return true
}

/** Einmal anstoßen – das Bier schwappt (z. B. beim „Plopp“) */
export function nudge(strength = 9) {
  if (reducedMotion()) return
  vel += (Math.random() < 0.5 ? -1 : 1) * strength
  kick()
}

/** Element abonnieren: setzt `--slosh` (Grad, mal `factor`). Gibt die Abmeldung zurück. */
export function subscribeSlosh(el: HTMLElement | SVGElement, factor = 1): () => void {
  if (reducedMotion()) return () => {}
  const f: Sub = (deg) => el.style.setProperty('--slosh', `${(deg * factor).toFixed(2)}deg`)
  subs.add(f)
  f(angle)
  // Android & Desktop: ohne Nachfrage zuhören
  if (!needsTiltPermission()) listen()
  return () => {
    subs.delete(f)
  }
}
