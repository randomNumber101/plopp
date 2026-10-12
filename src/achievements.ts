/** Statistik und Abzeichen – aus den eigenen Check-ins berechnet, dazu Brauerei-Daten (Typ, Gründung, Lage)
 * und – wenn geladen – Regionen und Sortimentsgrößen aus dem Katalog. */
import { useEffect, useState } from 'react'
import { breweryProgress, myCheckins } from './api'
import { myChallenges, type ChallengeRow } from './challenges'
import { QUESTIONS, myAnswers, quizStats, type Answer } from './quiz'
import { cacheGet } from './pageState'
import { loadRegions, regionAt, type Region } from './regions'
import type { Beer, BreweryProgress, Checkin } from './types'
import { celebrate, load, save } from './ui/fx'

export interface BeerAgg {
  beer: Beer
  count: number
  last: string
  first: string
  avg: number | null
  rated: number
}

export interface StatsContext {
  regions?: Region[]
  /** Brauerei-ID → Anzahl Biere im Katalog */
  totals?: Map<string, number>
  /** eigene Abend-Challenges */
  challenges?: ChallengeRow[]
  /** Antworten im Bierquiz */
  quiz?: Answer[]
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
  /** bestbewertete Biere (mit Bewertung), beste zuerst */
  bestRated: BeerAgg[]
  firstDate: string | null
  aggs: BeerAgg[]
  // ---- für die erweiterten Abzeichen
  /** Brauereien, deren ganzes Sortiment (≥ 3 Biere) probiert ist */
  complete: number
  /** meiste verschiedene Biere einer Brauerei */
  maxPerBrewery: number
  /** Biere, die genau einmal getrunken wurden */
  onceOnly: number
  regions: Map<string, number>
  oberfranken: number
  coast: number
  rheinDuell: number
  berlin: number
  heimat: number
  kloster: number
  kommun: number
  gasthaus: number
  schloss: number
  oldestFounded: number | null
  young: number
  bocks: number
  rauch: number
  sour: number
  ipa: number
  helles: number
  weizenTrio: number
  light: number
  strong: number
  alcFreeUnique: number
  perfect: number
  harsh: number
  notes: number
  changedMind: number
  seasons: number
  bestYearMonths: number
  daysSinceFirst: number
  beerDay: number
  chDone: number
  chKinds: number
  chManual: number
  chNights: number
  quizCorrect: number
  quizExact: number
  quizStreak: number
  quizCats: number
  quizUnique: number
}

const has = (b: Beer, rx: RegExp) => rx.test(`${b.style ?? ''} ${b.name}`.toLowerCase())
const COAST = new Set(['Schleswig-Holstein', 'Hamburg', 'Bremen', 'Niedersachsen', 'Mecklenburg-Vorpommern'])

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = Math.PI / 180
  const x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r)
  const y = (b.lat - a.lat) * r
  return Math.sqrt(x * x + y * y) * 6371
}

export function computeStats(list: Checkin[], ctx: StatsContext = {}): Stats {
  const now = new Date()
  const map = new Map<string, BeerAgg & { sum: number; min: number; max: number }>()
  const breweries = new Map<
    string,
    { name: string; id: string; count: number; state: string | null; beers: Set<string>; b: NonNullable<Beer['brewery']> }
  >()
  const styles = new Map<string, number>()
  const countries = new Set<string>()
  const monthCount = new Map<string, number>()
  const yearMonths = new Map<number, Set<number>>()
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
  let notes = 0
  let beerDay = 0
  const season = new Set<string>()

  for (const c of list) {
    const b = c.beer
    if (!b) continue
    const d = new Date(c.drunk_at)
    const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    monthCount.set(mk, (monthCount.get(mk) ?? 0) + 1)
    if (!yearMonths.has(d.getFullYear())) yearMonths.set(d.getFullYear(), new Set())
    yearMonths.get(d.getFullYear())!.add(d.getMonth())
    if (d.getMonth() === 3 && d.getDate() === 23) beerDay = 1
    if (d.getFullYear() === now.getFullYear()) {
      thisYear++
      if (d.getMonth() === now.getMonth()) thisMonth++
    }
    if (!firstDate || c.drunk_at < firstDate) firstDate = c.drunk_at
    const a = map.get(b.id) ?? {
      beer: b, count: 0, last: c.drunk_at, first: c.drunk_at, avg: null, rated: 0, sum: 0, min: 99, max: -1,
    }
    a.count++
    if (c.drunk_at > a.last) a.last = c.drunk_at
    if (c.drunk_at < a.first) a.first = c.drunk_at
    if (c.rating != null) {
      a.rated++
      a.sum += c.rating
      a.min = Math.min(a.min, c.rating)
      a.max = Math.max(a.max, c.rating)
      rated++
      ratingSum += c.rating
      if (c.note?.trim()) notes++
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
    // Saisonbiere zur richtigen Zeit
    const m = d.getMonth()
    if (m === 4 && has(b, /maibock/)) season.add('mai')
    if ((m === 8 || m === 9) && has(b, /festbier|oktoberfest|wiesn|märzen|maerzen/)) season.add('herbst')
    if (m === 11 && has(b, /weihnacht|christmas|xmas|advent/)) season.add('weihnacht')
    const br = b.brewery
    if (br) {
      const x = breweries.get(br.id) ?? { name: br.name, id: br.id, count: 0, state: br.state, beers: new Set(), b: br }
      x.count++
      x.beers.add(b.id)
      breweries.set(br.id, x)
      if (br.country && !/deutschland|germany/i.test(br.country)) countries.add(br.country)
    }
  }

  const states = new Map<string, number>()
  const regions = new Map<string, number>()
  let bavaria = 0
  let oberfranken = 0
  let berlin = 0
  let kloster = 0
  let kommun = 0
  let gasthaus = 0
  let schloss = 0
  let young = 0
  let oldestFounded: number | null = null
  let complete = 0
  let maxPerBrewery = 0
  const located: { lat: number; lng: number }[] = []
  for (const x of breweries.values()) {
    const br = x.b
    if (br.state) states.set(br.state, (states.get(br.state) ?? 0) + 1)
    if (br.state === 'Bayern') bavaria++
    if (br.state === 'Berlin') berlin++
    const n = br.name.toLowerCase()
    if (/kloster|abtei|abbey|stift/.test(n)) kloster++
    if (/schlo(ss|ß)/.test(n)) schloss++
    if (br.brewery_type === 'gasthausbrauerei') gasthaus++
    if (br.brewery_type === 'kommunbrauhaus' || [...x.beers].some((id) => /zoigl/i.test(map.get(id)?.beer.name ?? ''))) kommun++
    const year = parseInt(String(br.founded ?? '').match(/\d{3,4}/)?.[0] ?? '', 10)
    if (year > 500 && year <= now.getFullYear()) {
      if (oldestFounded == null || year < oldestFounded) oldestFounded = year
      if (year >= 2010) young++
    }
    maxPerBrewery = Math.max(maxPerBrewery, x.beers.size)
    const total = ctx.totals?.get(br.id)
    if (total != null && total >= 3 && x.beers.size >= total) complete++
    if (br.lat != null && br.lng != null) {
      located.push({ lat: br.lat, lng: br.lng })
      if (ctx.regions) {
        const r = regionAt(ctx.regions, br.lat, br.lng)
        if (r) {
          regions.set(r.id, (regions.get(r.id) ?? 0) + 1)
          if (r.id === 'oberfranken' || r.id === 'bamberg') oberfranken++
        }
      }
    }
  }
  // Heimatliebe: meiste probierte Brauereien im Umkreis von 30 km um eine davon
  let heimat = 0
  if (located.length <= 600)
    for (const a of located) {
      let c = 0
      for (const b of located) if (km(a, b) <= 30) c++
      heimat = Math.max(heimat, c)
    }

  const aggs = [...map.values()].map(({ sum, min: _min, max: _max, ...a }) => ({ ...a, avg: a.rated ? sum / a.rated : null }))
  const all = [...map.values()]
  const months: Stats['months'] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    months.push({ key, label: d.toLocaleDateString('de-DE', { month: 'narrow' }), count: monthCount.get(key) ?? 0 })
  }
  const uniq = (rx: RegExp, not?: RegExp) => aggs.filter((a) => has(a.beer, rx) && !(not && has(a.beer, not))).length
  const weizenHell = uniq(/weiz|weiss|weiß|hefe/, /dunkel|kristall|alkoholfrei/) > 0
  const weizenDunkel = uniq(/(weiz|weiss|weiß|hefe).*dunkel|dunkel.*(weiz|weiss|weiß)/) > 0
  const weizenKristall = uniq(/kristall/) > 0
  const abvs = aggs.map((a) => (a.beer.abv == null ? null : Number(a.beer.abv)))

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
    topBreweries: [...breweries.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map(({ name, id, count }) => ({ name, id, count })),
    bestRated: aggs
      .filter((a) => a.avg != null)
      .sort((a, b) => b.avg! - a.avg! || b.rated - a.rated || b.count - a.count),
    firstDate,
    aggs,
    complete,
    maxPerBrewery,
    onceOnly: aggs.filter((a) => a.count === 1).length,
    regions,
    oberfranken,
    coast: [...states.keys()].filter((s) => COAST.has(s)).length,
    rheinDuell: (uniq(/kölsch|koelsch|kolsch/) > 0 ? 1 : 0) + (uniq(/\balt(bier)?\b|düsseldorfer alt/) > 0 ? 1 : 0),
    berlin,
    heimat,
    kloster,
    kommun,
    gasthaus,
    schloss,
    oldestFounded,
    young,
    bocks: (uniq(/maibock/) > 0 ? 1 : 0) + (uniq(/doppelbock|\w+ator\b/) > 0 ? 1 : 0) + (uniq(/eisbock/) > 0 ? 1 : 0),
    rauch: uniq(/rauch/),
    sour: uniq(/\bgose\b|berliner weiss|berliner weisse|\bsour\b|sauerbier/),
    ipa: uniq(/\bipa\b|india pale/),
    helles: uniq(/\bhell(es)?\b|lagerbier hell/, /weiz|weiss|weiß|hefe|bock|radler/),
    weizenTrio: (weizenHell ? 1 : 0) + (weizenDunkel ? 1 : 0) + (weizenKristall ? 1 : 0),
    light: abvs.some((v) => v != null && v > 0.5 && v < 3) ? 1 : 0,
    strong: abvs.some((v) => v != null && v > 8) ? 1 : 0,
    alcFreeUnique: uniq(/alkoholfrei|alcohol.?free|\b0[,.]0\b/),
    perfect: all.some((a) => a.max >= 5) ? 1 : 0,
    harsh: all.some((a) => a.rated && a.min < 1.5) ? 1 : 0,
    notes,
    changedMind: all.some((a) => a.rated >= 2 && a.max - a.min >= 1.5) ? 1 : 0,
    seasons: season.size,
    bestYearMonths: Math.max(0, ...[...yearMonths.values()].map((s) => s.size)),
    daysSinceFirst: firstDate ? Math.floor((now.getTime() - new Date(firstDate).getTime()) / 86400000) : 0,
    beerDay,
    ...(() => {
      const q = quizStats(ctx.quiz ?? [])
      return {
        quizCorrect: q.correct,
        quizExact: q.exact,
        quizStreak: q.bestStreak,
        quizCats: [...q.cats.values()].filter((n) => n >= 3).length,
        quizUnique: new Set((ctx.quiz ?? []).filter((a) => a.correct).map((a) => a.question)).size,
      }
    })(),
    ...(() => {
      const done = (ctx.challenges ?? []).filter((c) => c.status === 'geschafft')
      return {
        chDone: done.length,
        chKinds: new Set(done.map((c) => c.challenge)).size,
        chManual: done.filter((c) => c.confirmed).length,
        chNights: Math.max(0, ...[...done.reduce((m, c) => m.set(c.night, (m.get(c.night) ?? 0) + 1), new Map<string, number>()).values()]),
      }
    })(),
  }
}

export type AchievementGroup =
  | 'Sammeln'
  | 'Entdecken'
  | 'Regionen'
  | 'Brauereien'
  | 'Sorten'
  | 'Bewerten'
  | 'Kalender'
  | 'Challenges'
  | 'Bierquiz'
export const GROUPS: AchievementGroup[] = ['Sammeln', 'Entdecken', 'Regionen', 'Brauereien', 'Sorten', 'Bewerten', 'Kalender', 'Challenges', 'Bierquiz']

export interface Achievement {
  id: string
  icon: string
  title: string
  desc: string
  goal: number
  group: AchievementGroup
  value: (s: Stats) => number
}

type A = Omit<Achievement, 'group'>
const g = (group: AchievementGroup, list: A[]): Achievement[] => list.map((a) => ({ ...a, group }))

export const ACHIEVEMENTS: Achievement[] = [
  ...g('Sammeln', [
    { id: 'first', icon: '🍺', title: 'Der erste Schluck', desc: 'Erstes Bier eingetragen', goal: 1, value: (s) => s.checkins },
    { id: 'u10', icon: '🧺', title: 'Sammler', desc: '10 verschiedene Biere', goal: 10, value: (s) => s.unique },
    { id: 'u50', icon: '🎓', title: 'Kenner', desc: '50 verschiedene Biere', goal: 50, value: (s) => s.unique },
    { id: 'u100', icon: '📚', title: 'Bier-Lexikon', desc: '100 verschiedene Biere', goal: 100, value: (s) => s.unique },
    { id: 'c100', icon: '💯', title: 'Hundert Prost', desc: '100 Check-ins', goal: 100, value: (s) => s.checkins },
    { id: 'same', icon: '❤️', title: 'Stammgast', desc: 'Ein Bier 10× getrunken', goal: 10, value: (s) => s.maxSame },
    { id: 'once', icon: '🦋', title: 'Eintagsfliege', desc: '25 Biere, die du genau einmal getrunken hast', goal: 25, value: (s) => s.onceOnly },
  ]),
  ...g('Entdecken', [
    { id: 'b10', icon: '🏭', title: 'Brauerei-Hopper', desc: 'Biere aus 10 Brauereien', goal: 10, value: (s) => s.breweries },
    { id: 'b50', icon: '🚲', title: 'Brauerei-Tourist', desc: 'Biere aus 50 Brauereien', goal: 50, value: (s) => s.breweries },
    { id: 'house5', icon: '🏡', title: 'Hausbesuch', desc: '5 verschiedene Biere einer Brauerei', goal: 5, value: (s) => s.maxPerBrewery },
    { id: 'full1', icon: '✅', title: 'Komplettist', desc: 'Das ganze Sortiment einer Brauerei probiert (mind. 3 Biere)', goal: 1, value: (s) => s.complete },
    { id: 'full5', icon: '🧾', title: 'Komplettist II', desc: 'Das ganze Sortiment von 5 Brauereien', goal: 5, value: (s) => s.complete },
    { id: 'full10', icon: '🏅', title: 'Komplettist III', desc: 'Das ganze Sortiment von 10 Brauereien', goal: 10, value: (s) => s.complete },
    { id: 'world', icon: '✈️', title: 'Über den Tellerrand', desc: 'Biere aus 3 anderen Ländern', goal: 3, value: (s) => s.countries.size },
  ]),
  ...g('Regionen', [
    { id: 'st5', icon: '🧭', title: 'Länderspiel', desc: 'Brauereien aus 5 Bundesländern', goal: 5, value: (s) => s.states.size },
    { id: 'st16', icon: '🏆', title: 'Deutschland-Tour', desc: 'Alle 16 Bundesländer', goal: 16, value: (s) => s.states.size },
    { id: 'reg10', icon: '🗺️', title: 'Kartograf', desc: '10 Bier-Regionen erkundet', goal: 10, value: (s) => s.regions.size },
    { id: 'reg25', icon: '🧳', title: 'Fernwanderer', desc: '25 Bier-Regionen erkundet', goal: 25, value: (s) => s.regions.size },
    { id: 'regall', icon: '👑', title: 'Ganz Deutschland', desc: 'Alle 49 Bier-Regionen erkundet', goal: 49, value: (s) => s.regions.size },
    { id: 'by10', icon: '🥨', title: 'Weißwurst-Äquator', desc: '10 bayerische Brauereien', goal: 10, value: (s) => s.bavaria },
    { id: 'ofr15', icon: '🍂', title: 'Frankens Bierstraße', desc: '15 Brauereien aus Oberfranken', goal: 15, value: (s) => s.oberfranken },
    { id: 'coast', icon: '⚓', title: 'Norddeutsche Brise', desc: 'Biere aus allen 5 Küstenländern', goal: 5, value: (s) => s.coast },
    { id: 'rhein', icon: '🥊', title: 'Rhein-Duell', desc: 'Kölsch und Altbier probiert', goal: 2, value: (s) => s.rheinDuell },
    { id: 'berlin10', icon: '🐻', title: 'Hauptstadt-Hopper', desc: '10 Berliner Brauereien', goal: 10, value: (s) => s.berlin },
    { id: 'home10', icon: '📍', title: 'Heimatliebe', desc: '10 Brauereien im Umkreis von 30 km', goal: 10, value: (s) => s.heimat },
  ]),
  ...g('Brauereien', [
    { id: 'kloster5', icon: '⛪', title: 'Klosterbruder', desc: '5 Kloster- oder Abteibrauereien', goal: 5, value: (s) => s.kloster },
    { id: 'kommun', icon: '⭐', title: 'Kommunbräu', desc: 'Ein Zoigl oder Bier aus einem Kommunbrauhaus', goal: 1, value: (s) => s.kommun },
    { id: 'gasthaus10', icon: '🍽️', title: 'Gasthaus-Gänger', desc: '10 Gasthausbrauereien', goal: 10, value: (s) => s.gasthaus },
    { id: 'schloss5', icon: '🏰', title: 'Schlossherr', desc: '5 Schlossbrauereien', goal: 5, value: (s) => s.schloss },
    { id: 'old', icon: '⏳', title: 'Zeitreisender', desc: 'Bier einer Brauerei, die vor 1500 gegründet wurde', goal: 1, value: (s) => (s.oldestFounded != null && s.oldestFounded < 1500 ? 1 : 0) },
    { id: 'young5', icon: '🌱', title: 'Jungspund', desc: '5 Brauereien, gegründet ab 2010', goal: 5, value: (s) => s.young },
  ]),
  ...g('Sorten', [
    { id: 'sty5', icon: '🎨', title: 'Sortenvielfalt', desc: '5 verschiedene Sorten', goal: 5, value: (s) => s.styles.size },
    { id: 'sty12', icon: '🌈', title: 'Stilkunde', desc: '12 verschiedene Sorten', goal: 12, value: (s) => s.styles.size },
    { id: 'weizen', icon: '🌾', title: 'Weizenfreund', desc: '5× Weizen getrunken', goal: 5, value: (s) => s.weizen },
    { id: 'weizen3', icon: '🎭', title: 'Weizen-Trilogie', desc: 'Helles, dunkles und Kristallweizen', goal: 3, value: (s) => s.weizenTrio },
    { id: 'pils', icon: '🍻', title: 'Pils-Purist', desc: '10× Pils getrunken', goal: 10, value: (s) => s.pils },
    { id: 'hell20', icon: '☀️', title: 'Hell ist nicht gleich Hell', desc: '20 verschiedene Helle', goal: 20, value: (s) => s.helles },
    { id: 'dark', icon: '🌑', title: 'Die dunkle Seite', desc: '5 dunkle Biere oder Böcke', goal: 5, value: (s) => s.dark },
    { id: 'bock3', icon: '🐐', title: 'Bock-Saison', desc: 'Maibock, Doppelbock und Eisbock', goal: 3, value: (s) => s.bocks },
    { id: 'ipa5', icon: '🌿', title: 'Hopfenkopf', desc: '5 verschiedene IPAs', goal: 5, value: (s) => s.ipa },
    { id: 'free', icon: '🚗', title: 'Klarer Kopf', desc: '3× alkoholfrei', goal: 3, value: (s) => s.alcFree },
    { id: 'free10', icon: '🧊', title: 'Null-Komma-Profi', desc: '10 verschiedene alkoholfreie Biere', goal: 10, value: (s) => s.alcFreeUnique },
  ]),
  ...g('Bewerten', [
    { id: 'critic', icon: '📝', title: 'Kritiker', desc: '20 Bewertungen abgegeben', goal: 20, value: (s) => s.rated },
    { id: 'notes10', icon: '👅', title: 'Feinschmecker', desc: '10 Bewertungen mit Notiz', goal: 10, value: (s) => s.notes },
    { id: 'mind', icon: '🔄', title: 'Sinneswandel', desc: 'Ein Bier später um 1,5 Sterne anders bewertet', goal: 1, value: (s) => s.changedMind },
  ]),
  ...g('Kalender', [
    { id: 'season3', icon: '🍁', title: 'Saisonkenner', desc: 'Maibock im Mai, Festbier im Herbst, Weihnachtsbier im Dezember', goal: 3, value: (s) => s.seasons },
    { id: 'year12', icon: '🔁', title: 'Jahreskreis', desc: 'In jedem Monat eines Jahres etwas eingetragen', goal: 12, value: (s) => s.bestYearMonths },
    { id: 'jubi', icon: '🎂', title: 'Jubiläum', desc: 'Seit einem Jahr dabei', goal: 365, value: (s) => s.daysSinceFirst },
    { id: 'beerday', icon: '📜', title: 'Tag des Bieres', desc: 'Ein Check-in am 23. April', goal: 1, value: (s) => s.beerDay },
  ]),
  ...g('Challenges', [
    { id: 'ch1', icon: '🎯', title: 'Herausforderer', desc: 'Die erste Abend-Challenge geschafft', goal: 1, value: (s) => s.chDone },
    { id: 'ch10', icon: '🏹', title: 'Challenge-Profi', desc: '10 Abend-Challenges geschafft', goal: 10, value: (s) => s.chDone },
    { id: 'ch50', icon: '🌙', title: 'Abendlegende', desc: '50 Abend-Challenges geschafft', goal: 50, value: (s) => s.chDone },
    { id: 'chkinds', icon: '🎲', title: 'Allrounder', desc: '15 verschiedene Challenges geschafft', goal: 15, value: (s) => s.chKinds },
    { id: 'chmanual', icon: '🤲', title: 'Mitmacher', desc: '10 Mitmach-Challenges (Bierdeckel, Runde ausgeben …)', goal: 10, value: (s) => s.chManual },
    { id: 'chnight', icon: '🎆', title: 'Hattrick', desc: '3 Challenges an einem Abend', goal: 3, value: (s) => s.chNights },
  ]),
  ...g('Bierquiz', [
    { id: 'q10', icon: '💡', title: 'Bierschlau', desc: '10 Quizfragen richtig beantwortet', goal: 10, value: (s) => s.quizCorrect },
    { id: 'q50', icon: '📗', title: 'Bier-Gelehrter', desc: '50 Quizfragen richtig', goal: 50, value: (s) => s.quizCorrect },
    { id: 'q150', icon: '🎓', title: 'Bierprofessor', desc: '150 Quizfragen richtig', goal: 150, value: (s) => s.quizCorrect },
    { id: 'q300', icon: '🔮', title: 'Bier-Orakel', desc: '300 Quizfragen richtig', goal: 300, value: (s) => s.quizCorrect },
    { id: 'qstreak', icon: '🔥', title: 'Lauf', desc: '10 Quizfragen in Folge richtig', goal: 10, value: (s) => s.quizStreak },
    { id: 'qexact', icon: '🎯', title: 'Volltreffer', desc: '10 Schätzfragen auf den Punkt genau', goal: 10, value: (s) => s.quizExact },
    { id: 'qcats', icon: '🧭', title: 'Alleswisser', desc: 'In allen 8 Quiz-Kategorien je 3 richtige Antworten', goal: 8, value: (s) => s.quizCats },
    { id: 'qall', icon: '📚', title: 'Bier-Enzyklopädie', desc: `Jede der ${QUESTIONS.length} Quizfragen mindestens einmal richtig`, goal: QUESTIONS.length, value: (s) => s.quizUnique },
  ]),
]

// ------------------------------------------------------------------------------------------ Kontext laden

let ctxPromise: Promise<StatsContext> | null = null
let ctxAt = 0

/** Regionen + Sortimentsgrößen (für Regionen- und Komplettist-Abzeichen); 30 min zwischengespeichert */
export function loadStatsContext(): Promise<StatsContext> {
  if (ctxPromise && Date.now() - ctxAt < 30 * 60_000) return ctxPromise
  ctxAt = Date.now()
  ctxPromise = (async () => {
    const [regions, progress, challenges, quiz] = await Promise.all([
      loadRegions().catch(() => undefined),
      Promise.resolve(cacheGet<BreweryProgress[]>('brewery_progress') ?? null).then((c) => c ?? breweryProgress()).catch(() => null),
      myChallenges().catch(() => undefined),
      myAnswers().catch(() => undefined),
    ])
    return { regions, totals: progress ? new Map(progress.map((b) => [b.id, b.total])) : undefined, challenges, quiz }
  })()
  ctxPromise.catch(() => (ctxPromise = null))
  return ctxPromise
}

/** React: Kontext (anfangs leer, dann gefüllt) */
export function useStatsContext(): StatsContext {
  const [ctx, setCtx] = useState<StatsContext>({})
  useEffect(() => {
    let alive = true
    loadStatsContext().then((c) => alive && setCtx(c)).catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  return ctx
}

export function progress(a: Achievement, s: Stats) {
  const v = Math.min(a.value(s), a.goal)
  return { value: v, done: v >= a.goal, pct: Math.round((v / a.goal) * 100) }
}

const SEEN_KEY = 'bier-badges-seen'

/** Nach einem Check-in: neue Abzeichen feiern. Beim allerersten Aufruf nur merken. */
export async function checkNewAchievements() {
  try {
    import('./challenges').then((m) => m.checkActiveChallenge()).catch(() => {})
    const [list, ctx] = await Promise.all([myCheckins(), loadStatsContext().catch(() => ({}))])
    const s = computeStats(list, ctx)
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

// ------------------------------------------------------------------------------------------ Rückblick

export type Unit = 'day' | 'week' | 'month' | 'year'

export interface Bucket {
  key: string
  /** kurz unter dem Balken */
  label: string
  /** ausführlich, z. B. „KW 41 · 6.–12. Oktober“ */
  long: string
  start: Date
  end: Date
  checkins: Checkin[]
}

const startOf = (d: Date, unit: Unit): Date => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  if (unit === 'week') x.setDate(x.getDate() - ((x.getDay() + 6) % 7)) // Montag
  if (unit === 'month') x.setDate(1)
  if (unit === 'year') x.setMonth(0, 1)
  return x
}

const add = (d: Date, unit: Unit, n: number): Date => {
  const x = new Date(d)
  if (unit === 'day') x.setDate(x.getDate() + n)
  if (unit === 'week') x.setDate(x.getDate() + 7 * n)
  if (unit === 'month') x.setMonth(x.getMonth() + n)
  if (unit === 'year') x.setFullYear(x.getFullYear() + n)
  return x
}

/** ISO-Kalenderwoche */
export function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return Math.ceil(((t.getTime() - y.getTime()) / 86400000 + 1) / 7)
}

const COUNT: Record<Unit, number> = { day: 14, week: 12, month: 12, year: 6 }

/** Check-ins in Zeitabschnitte einteilen (letzte 14 Tage / 12 Wochen / 12 Monate / Jahre) */
export function timeline(list: Checkin[], unit: Unit, now = new Date()): Bucket[] {
  let n = COUNT[unit]
  if (unit === 'year' && list.length) {
    const first = Math.min(...list.map((c) => new Date(c.drunk_at).getFullYear()))
    n = Math.min(10, Math.max(1, now.getFullYear() - first + 1))
  }
  const cur = startOf(now, unit)
  const out: Bucket[] = []
  for (let i = n - 1; i >= 0; i--) {
    const start = add(cur, unit, -i)
    const end = add(start, unit, 1)
    const last = new Date(end.getTime() - 1)
    let label = ''
    let long = ''
    if (unit === 'day') {
      label = start.toLocaleDateString('de-DE', { weekday: 'narrow' })
      long = i === 0 ? 'Heute' : i === 1 ? 'Gestern' : start.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })
    } else if (unit === 'week') {
      label = String(isoWeek(start))
      const fmt = (d: Date) => d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })
      long = `${i === 0 ? 'Diese Woche' : i === 1 ? 'Letzte Woche' : `KW ${isoWeek(start)}`} · ${fmt(start)} – ${fmt(last)}`
    } else if (unit === 'month') {
      label = start.toLocaleDateString('de-DE', { month: 'narrow' })
      long = start.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })
    } else {
      label = `'${String(start.getFullYear()).slice(2)}`
      long = String(start.getFullYear())
    }
    out.push({ key: start.toISOString(), label, long, start, end, checkins: [] })
  }
  const from = out[0].start.getTime()
  for (const c of list) {
    const t = new Date(c.drunk_at).getTime()
    if (t < from) continue
    const b = out.find((x) => t >= x.start.getTime() && t < x.end.getTime())
    b?.checkins.push(c)
  }
  return out
}

/** Nach einer geschafften Challenge: Kontext neu laden und neue Abzeichen prüfen */
if (typeof window !== 'undefined') {
  window.addEventListener('plopp-challenge-done', () => {
    ctxPromise = null
    setTimeout(async () => {
      try {
        const [list, ctx] = await Promise.all([myCheckins(), loadStatsContext()])
        const s = computeStats(list, ctx)
        const done = ACHIEVEMENTS.filter((a) => progress(a, s).done).map((a) => a.id)
        const seen = load<string[] | null>(SEEN_KEY, null)
        save(SEEN_KEY, done)
        const fresh = seen ? ACHIEVEMENTS.filter((a) => done.includes(a.id) && !seen.includes(a.id)) : []
        if (fresh.length) celebrate({ kind: 'badge', icon: fresh[0].icon, title: fresh[0].title, sub: fresh[0].desc })
      } catch {
        /* egal */
      }
    }, 2600)
  })
}
