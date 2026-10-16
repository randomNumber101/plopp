import { useCallback, useState } from 'react'
/** Kleine Effekte: Vibration, Feier-Animation */

export function haptic(ms = 12) {
  try {
    if (navigator.vibrate) navigator.vibrate(ms)
  } catch {
    /* egal */
  }
}

export interface CelebrateOpts {
  kind?: 'prost' | 'badge' | 'challenge'
  icon?: string
  title: string
  sub?: string
  /** Kronkorken-Farbe beim Prost */
  color?: string
}

export function celebrate(o: CelebrateOpts) {
  window.dispatchEvent(new CustomEvent<CelebrateOpts>('bier-celebrate', { detail: o }))
  // die Flasche im Kopf macht „Plopp“
  window.dispatchEvent(new Event('plopp-pop'))
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

/** Gewählte Zeitskala (Rückblick in der Statistik und Sammlungskarte auf der Startseite) */
const UNIT_KEY = 'bier-unit'
type TimeUnit = 'day' | 'week' | 'month' | 'year'
export function useUnit(): [TimeUnit, (u: TimeUnit) => void] {
  const [unit, setUnit] = useState<TimeUnit>(() => load<TimeUnit>(UNIT_KEY, 'month'))
  const set = useCallback((u: TimeUnit) => {
    setUnit(u)
    save(UNIT_KEY, u)
  }, [])
  return [unit, set]
}

/** Rummel-Vorhang beim Start einer Abend-Challenge auslösen */
export function startRummel(id: string) {
  window.dispatchEvent(new CustomEvent('rummel-start', { detail: id }))
}
