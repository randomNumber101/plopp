/** Kleine Effekte: Vibration, Feier-Animation */

export function haptic(ms = 12) {
  try {
    if (navigator.vibrate) navigator.vibrate(ms)
  } catch {
    /* egal */
  }
}

export interface CelebrateOpts {
  kind?: 'prost' | 'badge'
  icon?: string
  title: string
  sub?: string
}

export function celebrate(o: CelebrateOpts) {
  window.dispatchEvent(new CustomEvent<CelebrateOpts>('bier-celebrate', { detail: o }))
}

export const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Wert aus localStorage lesen/schreiben – darf scheitern (privater Modus usw.) */
export function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v == null ? fallback : (JSON.parse(v) as T)
  } catch {
    return fallback
  }
}

export function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* egal */
  }
}
