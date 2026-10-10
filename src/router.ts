import { useEffect, useState } from 'react'

/**
 * Minimaler Hash-Router: #/pfad/param – funktioniert ohne Server-Konfiguration auf GitHub Pages.
 * Neue Seite (go) → nach oben scrollen. Zurück/Vor → dort weitermachen, wo man war.
 */
const parse = () => window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean)
const keyOf = (hash: string) => hash.replace(/^#\/?/, '') || '/'

const scrollPos = new Map<string, number>()
let pushing = false
let restoreToken = 0

try {
  history.scrollRestoration = 'manual'
} catch {
  /* egal */
}

// Position der aktuellen Seite laufend merken
if (typeof window !== 'undefined') {
  let ticking = false
  window.addEventListener(
    'scroll',
    () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        ticking = false
        scrollPos.set(keyOf(window.location.hash), window.scrollY)
      })
    },
    { passive: true },
  )
}

/** Scrollposition wiederherstellen, sobald die Seite hoch genug ist (Daten kommen evtl. erst noch) */
function restore(target: number) {
  const token = ++restoreToken
  const start = performance.now()
  let userMoved = false
  const stop = () => (userMoved = true)
  window.addEventListener('touchstart', stop, { once: true, passive: true })
  window.addEventListener('wheel', stop, { once: true, passive: true })
  const step = () => {
    if (token !== restoreToken || userMoved) return
    const max = document.documentElement.scrollHeight - window.innerHeight
    window.scrollTo(0, Math.min(target, Math.max(0, max)))
    if (max >= target || performance.now() - start > 3000) {
      window.removeEventListener('touchstart', stop)
      window.removeEventListener('wheel', stop)
      return
    }
    requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

export function useRoute(): string[] {
  const [route, setRoute] = useState<string[]>(parse)
  useEffect(() => {
    const on = () => {
      const wasPush = pushing
      pushing = false
      setRoute(parse())
      if (wasPush) {
        restoreToken++
        window.scrollTo(0, 0)
      } else restore(scrollPos.get(keyOf(window.location.hash)) ?? 0)
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}

export function go(path: string) {
  const next = path.startsWith('/') ? path : `/${path}`
  if (keyOf(window.location.hash) === keyOf(next)) return
  pushing = true
  scrollPos.delete(keyOf(next)) // neue Seite beginnt oben
  window.location.hash = next
}
