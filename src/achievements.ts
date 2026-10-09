/** Statistik und Abzeichen – alles aus den eigenen Check-ins berechnet */
import { myCheckins } from './api'
import type { Beer, Checkin } from './types'
import { celebrate, load, save } from './ui/fx'

export interface BeerAgg {
  beer: Beer
  count: number
  last: string
  first: string
  avg: number | null
  rated: number
}

export interface Stats {
  checkins: number
  unique: number
  breweries: number
  states: Map<string, number>
  styles: Map<string, number>
  countries: Set<string>
  thisMonth: number
  thisYear: number
  months: { key: string; label: string; count: number }[]
  bestMonth: number
  rated: number
  avgRating: number | null
  avgAbv: number | null
  maxSame: number
  weizen: number
  pils: number
  dark: number
  alcFree: number
  bavaria: number
  topBeers: BeerAgg[]
  topBreweries: { name: string; id: string; count: number }[]
  firstDate: string | null
  aggs: BeerAgg[]
}

const has = (b: Beer, rx: RegExp) => rx.test(`${b.style ?? ''} ${b.name}`.toLowerCase())

export function computeStats(list: Checkin[]): Stats {
  const now = new Date()
  const map = new Map<string, BeerAgg & { sum: number }>()
  const breweries = new Map<string, { name: string; id: string; count: number; state: string | null }>()
  const styles = new Map<string, number>()
  const countries = new Set<string>()
  const monthCount = new Map<string, number>()
  let rated = 0
  let ratingSum = 0
  let abvSum = 0
  let abvN = 0
  let weizen = 0
  let pils = 0
  let dark = 0
  let alcFree = 0
  let thisMonth = 0
  let thisYear = 0
  let firstDate: string | null = null

  for (const c of list) {
    const b = c.beer
    if (!b) continue
    const d = new Date(c.drunk_at)
    const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    monthCount.set(mk, (monthCount.get(mk) ?? 0) + 1)
    if (d.getFullYear() === now.getFullYear()) {
      thisYear++
      if (d.getMonth() === now.getMonth()) thisMonth++
    }
    if (!firstDate || c.drunk_at < firstDate) firstDate = c.drunk_at
    const a = map.get(b.id) ?? { beer: b, count: 0, last: c.drunk_at, first: c.drunk_at, avg: null, rated: 0, sum: 0 }
    a.count++
    if (c.drunk_at > a.last) a.last = c.drunk_at
    if (c.drunk_at < a.first) a.first = c.drunk_at
    if (c.rating != null) {
      a.rated++
      a.sum += c.rating
      rated++
      ratingSum += c.rating
    }
    map.set(b.id, a)
    if (b.style) styles.set(b.style, (styles.get(b.style) ?? 0) + 1)
    if (b.abv != null) {
      abvSum += Number(b.abv)
      abvN++
    }
    if (has(b, /weiz|weiss|weiß|hefe/)) weizen++
    if (has(b, /pils/)) pils++
    if (has(b, /dunkel|schwarz|stout|porter|bock/)) dark++
    if (has(b, /alkoholfrei|0[,.]0/)) alcFree++
    const br = b.brewery
    if (br) {
      const x = breweries.get(br.id) ?? { name: br.name, id: br.id, count: 0, state: br.state }
      x.count++
      breweries.set(br.id, x)
      if (br.country && !/deutschland|germany/i.test(br.country)) countries.add(br.country)
    }
  }

  const states = new Map<string, number>()
  let bavaria = 0
  for (const br of breweries.values()) {
    if (br.state) states.set(br.state, (states.get(br.state) ?? 0) + 1)
    if (br.state === 'Bayern') bavaria++
  }

  const aggs = [...map.values()].map(({ sum, ...a }) => ({ ...a, avg: a.rated ? sum / a.rated : null }))
  const months: Stats['months'] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    months.push({ key, label: d.toLocaleDateString('de-DE', { month: 'narrow' }), count: monthCount.get(key) ?? 0 })
  }

  return {
    checkins: list.length,
    unique: map.size,
    breweries: breweries.size,
    states,
    styles,
    countries,
    thisMonth,
    thisYear,
    months,
    bestMonth: Math.max(0, ...monthCount.values()),
    rated,
    avgRating: rated ? ratingSum / rated : null,
    avgAbv: abvN ? abvSum / abvN : null,
    maxSame: Math.max(0, ...aggs.map((a) => a.count)),
    weizen,
    pils,
    dark,
    alcFree,
    bavaria,
    topBeers: [...aggs].sort((a, b) => b.count - a.count || (b.avg ?? 0) - (a.avg ?? 0)).slice(0, 5),
    topBreweries: [...breweries.values()].sort((a, b) => b.count - a.count).slice(0, 5),
    firstDate,
    aggs,
  }
}

export interface Achievement {
  id: string
  icon: string
  title: string
  desc: string
  goal: number
  value: (s: Stats) => number
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first', icon: '🍺', title: 'Der erste Schluck', desc: 'Erstes Bier eingetragen', goal: 1, value: (s) => s.checkins },
  { id: 'u10', icon: '🧺', title: 'Sammler', desc: '10 verschiedene Biere', goal: 10, value: (s) => s.unique },
  { id: 'u50', icon: '🎓', title: 'Kenner', desc: '50 verschiedene Biere', goal: 50, value: (s) => s.unique },
  { id: 'u100', icon: '📚', title: 'Bier-Lexikon', desc: '100 verschiedene Biere', goal: 100, value: (s) => s.unique },
  { id: 'b10', icon: '🏭', title: 'Brauerei-Hopper', desc: 'Biere aus 10 Brauereien', goal: 10, value: (s) => s.breweries },
  { id: 'b50', icon: '🚲', title: 'Brauerei-Tourist', desc: 'Biere aus 50 Brauereien', goal: 50, value: (s) => s.breweries },
  { id: 'st5', icon: '🧭', title: 'Länderspiel', desc: 'Brauereien aus 5 Bundesländern', goal: 5, value: (s) => s.states.size },
  { id: 'st16', icon: '🏆', title: 'Deutschland-Tour', desc: 'Alle 16 Bundesländer', goal: 16, value: (s) => s.states.size },
  { id: 'by10', icon: '🥨', title: 'Weißwurst-Äquator', desc: '10 bayerische Brauereien', goal: 10, value: (s) => s.bavaria },
  { id: 'sty5', icon: '🎨', title: 'Sortenvielfalt', desc: '5 verschiedene Sorten', goal: 5, value: (s) => s.styles.size },
  { id: 'sty12', icon: '🌈', title: 'Stilkunde', desc: '12 verschiedene Sorten', goal: 12, value: (s) => s.styles.size },
  { id: 'weizen', icon: '🌾', title: 'Weizenfreund', desc: '5× Weizen getrunken', goal: 5, value: (s) => s.weizen },
  { id: 'pils', icon: '🍻', title: 'Pils-Purist', desc: '10× Pils getrunken', goal: 10, value: (s) => s.pils },
  { id: 'dark', icon: '🌑', title: 'Die dunkle Seite', desc: '5 dunkle Biere oder Böcke', goal: 5, value: (s) => s.dark },
  { id: 'free', icon: '🚗', title: 'Klarer Kopf', desc: '3× alkoholfrei', goal: 3, value: (s) => s.alcFree },
  { id: 'same', icon: '❤️', title: 'Stammgast', desc: 'Ein Bier 10× getrunken', goal: 10, value: (s) => s.maxSame },
  { id: 'critic', icon: '⭐', title: 'Kritiker', desc: '20 Bewertungen abgegeben', goal: 20, value: (s) => s.rated },
  { id: 'month', icon: '📅', title: 'Durstiger Monat', desc: '15 Check-ins in einem Monat', goal: 15, value: (s) => s.bestMonth },
  { id: 'world', icon: '✈️', title: 'Über den Tellerrand', desc: 'Biere aus 3 anderen Ländern', goal: 3, value: (s) => s.countries.size },
  { id: 'c100', icon: '💯', title: 'Hundert Prost', desc: '100 Check-ins', goal: 100, value: (s) => s.checkins },
]

export function progress(a: Achievement, s: Stats) {
  const v = Math.min(a.value(s), a.goal)
  return { value: v, done: v >= a.goal, pct: Math.round((v / a.goal) * 100) }
}

const SEEN_KEY = 'bier-badges-seen'

/** Nach einem Check-in: neue Abzeichen feiern. Beim allerersten Aufruf nur merken. */
export async function checkNewAchievements() {
  try {
    const s = computeStats(await myCheckins())
    const done = ACHIEVEMENTS.filter((a) => progress(a, s).done).map((a) => a.id)
    const seen = load<string[] | null>(SEEN_KEY, null)
    save(SEEN_KEY, done)
    if (!seen) return
    const fresh = ACHIEVEMENTS.filter((a) => done.includes(a.id) && !seen.includes(a.id))
    if (fresh.length) {
      const a = fresh[fresh.length - 1]
      setTimeout(
        () =>
          celebrate({
            kind: 'badge',
            icon: a.icon,
            title: a.title,
            sub: fresh.length > 1 ? `${a.desc} · und ${fresh.length - 1} weitere` : a.desc,
          }),
        900,
      )
    }
  } catch {
    /* Statistik ist Nebensache */
  }
}

/** Beim Laden der Statistik: gesehene Abzeichen abgleichen, ohne zu feiern */
export function markSeen(s: Stats) {
  if (load<string[] | null>(SEEN_KEY, null) == null) {
    save(SEEN_KEY, ACHIEVEMENTS.filter((a) => progress(a, s).done).map((a) => a.id))
  }
}
