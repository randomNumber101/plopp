import { useCallback, useState } from 'react'

/**
 * Zustand einer Seite (Suchbegriff, Filter, „Mehr anzeigen“ …), der erhalten bleibt, wenn man
 * zu einem Eintrag wechselt und wieder zurückkommt – auch nach Neuladen im selben Tab.
 */
const mem = new Map<string, unknown>()
const PREFIX = 'plopp-page:'

function read<T>(key: string, initial: T): T {
  if (mem.has(key)) return mem.get(key) as T
  try {
    const v = sessionStorage.getItem(PREFIX + key)
    if (v != null) return JSON.parse(v) as T
  } catch {
    /* egal */
  }
  return initial
}

function write(key: string, value: unknown) {
  mem.set(key, value)
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    /* egal */
  }
}

export function usePageState<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => read(key, initial))
  const set = useCallback(
    (v: T | ((prev: T) => T)) =>
      setValue((prev) => {
        const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v
        write(key, next)
        return next
      }),
    [key],
  )
  return [value, set]
}

/** Zuletzt geladene Daten je Schlüssel – damit eine Liste beim Zurückkehren sofort dasteht */
const dataCache = new Map<string, unknown>()
export const cacheGet = <T>(key: string) => dataCache.get(key) as T | undefined
export const cacheSet = (key: string, v: unknown) => dataCache.set(key, v)

/** Beim Abmelden alles vergessen (anderes Konto im selben Tab) */
export function clearPageState() {
  mem.clear()
  dataCache.clear()
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith(PREFIX)) sessionStorage.removeItem(k)
  } catch {
    /* egal */
  }
}
