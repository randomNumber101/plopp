/**
 * Abend-Challenges.
 *
 * Ein Abend läuft von 16 Uhr bis 4 Uhr. Man wählt eine von drei zufälligen Challenges; ist sie geschafft
 * (automatisch erkannt oder selbst bestätigt), darf man sofort die nächste wählen. Was um 4 Uhr nicht
 * geschafft ist, gilt als verpasst. Gezählt werden nur Check-ins ab dem Start der jeweiligen Challenge.
 *
 * Bewusst keine Mengen-Challenges über 3 Biere – alkoholfreie Biere zählen überall mit.
 */
import { useEffect, useState } from 'react'
import { myCheckins, wishlistIds } from './api'
import { loadRegions, regionAt, type Region } from './regions'
import { supabase } from './supabase'
import type { Beer, Checkin } from './types'
import { loadIndex } from './search'
import type { Question } from './quiz'
import { celebrate, haptic, load, save } from './ui/fx'

// ------------------------------------------------------------------------------------------ Zeitfenster

export interface Night {
  open: boolean
  /** Start (16 Uhr) des aktuellen bzw. nächsten Abends */
  start: Date
  /** Ende (4 Uhr) */
  end: Date
  /** Datum des Abends, z. B. 2026-10-13 */
  night: string
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function nightAt(now = new Date()): Night {
  const h = now.getHours()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 16)
  if (h < 4) start.setDate(start.getDate() - 1)
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1, 4)
  return { open: h >= 16 || h < 4, start, end, night: iso(start) }
}

export function fmtLeft(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000))
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`
}

// ------------------------------------------------------------------------------------------ Katalog

export interface EvalCtx {
  /** Check-ins seit Start der Challenge */
  tonight: Checkin[]
  /** alle Check-ins davor */
  before: Checkin[]
  data: Record<string, unknown>
  regions?: Region[]
  /** Ort (klein geschrieben) → Anzahl Brauereien im Katalog */
  cityCount?: Map<string, number>
  /** Brauerei-ID → Anzahl Biere im Katalog */
  beerCount?: Map<string, number>
}

export interface Progress {
  cur: number
  goal: number
  unit?: string
}

export interface ChallengeDef {
  id: string
  icon: string
  title: string
  desc: string
  /** auto = App erkennt es an den Check-ins, manual = selbst bestätigen, quiz = Bierquiz-Runde */
  kind: 'auto' | 'manual' | 'quiz'
  /** Quiz-Challenges: Fragen pro Runde, nötige richtige, optional nur bestimmte Fragen */
  quiz?: { count: number; need: number; filter?: (q: Question) => boolean }
  check?: (c: EvalCtx) => Progress
  /** Momentaufnahme beim Start (z. B. Merkliste) – null = gerade nicht möglich */
  prepare?: (p: PrepareCtx) => Promise<Record<string, unknown> | null> | Record<string, unknown> | null
}

interface PrepareCtx {
  before: Checkin[]
  regions?: Region[]
}

const beersOf = (cs: Checkin[]) => {
  const m = new Map<string, Beer>()
  for (const c of cs) if (c.beer) m.set(c.beer.id, c.beer)
  return [...m.values()]
}
const text = (b: Beer) => `${b.style ?? ''} ${b.name}`.toLowerCase()
const is = (b: Beer, rx: RegExp) => rx.test(text(b))
const FREE = /alkoholfrei|alcohol.?free|\b0[,.]0\b|null komma/
const DARK = /dunkel|schwarz|stout|porter|bock|rauch|braunbier/
const LIGHTCOL = /\bhell|pils|lager|kölsch|kolsch|export|weizen|weiss|weiß|zwickel|keller/
const any = (cs: Checkin[], f: (b: Beer) => boolean) => (beersOf(cs).some(f) ? 1 : 0)
const countBeers = (cs: Checkin[], f: (b: Beer) => boolean) => beersOf(cs).filter(f).length

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = Math.PI / 180
  const x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r)
  const y = (b.lat - a.lat) * r
  return Math.sqrt(x * x + y * y) * 6371
}

// Großstädte (> 100.000 Einwohner) – für „Großstadtkind“ und als Gegenstück für „Dorfkind“
const BIG_CITIES = [
  'berlin', 'hamburg', 'münchen', 'köln', 'frankfurt', 'stuttgart', 'düsseldorf', 'leipzig', 'dortmund', 'essen',
  'bremen', 'dresden', 'hannover', 'nürnberg', 'duisburg', 'bochum', 'wuppertal', 'bielefeld', 'bonn', 'münster',
  'mannheim', 'karlsruhe', 'augsburg', 'wiesbaden', 'mönchengladbach', 'gelsenkirchen', 'aachen', 'braunschweig',
  'kiel', 'chemnitz', 'halle', 'magdeburg', 'freiburg', 'krefeld', 'mainz', 'lübeck', 'erfurt', 'oberhausen',
  'rostock', 'kassel', 'hagen', 'potsdam', 'saarbrücken', 'hamm', 'ludwigshafen', 'oldenburg', 'mülheim',
  'osnabrück', 'leverkusen', 'darmstadt', 'heidelberg', 'solingen', 'herne', 'regensburg', 'neuss', 'paderborn',
  'ingolstadt', 'offenbach', 'fürth', 'würzburg', 'ulm', 'heilbronn', 'pforzheim', 'wolfsburg', 'göttingen',
  'bottrop', 'reutlingen', 'erlangen', 'bremerhaven', 'koblenz', 'bergisch gladbach', 'remscheid', 'trier',
  'recklinghausen', 'jena', 'moers', 'salzgitter', 'siegen', 'gütersloh', 'hildesheim', 'hanau', 'kaiserslautern',
  'cottbus',
]
const bigCity = (city: string | null | undefined) => {
  const c = (city ?? '').toLowerCase().trim()
  return c ? (BIG_CITIES.find((x) => c === x || c.startsWith(`${x} `) || c.startsWith(`${x}-`) || c.startsWith(`${x} (`)) ?? null) : null
}
const ISLAND = /sylt|westerland|föhr|wyk|amrum|helgoland|fehmarn|rügen|binz|sassnitz|putbus|usedom|heringsdorf|zinnowitz|ahlbeck|hiddensee|insel poel|norderney|borkum|juist|langeoog|spiekeroog|wangerooge|baltrum|reichenau|pellworm|\binsel\b/i
const COLOR = (b: Beer): number | null => {
  if (is(b, /schwarz|stout|porter|dunkel|doppelbock|rauch|braunbier/)) return 2
  if (is(b, /märzen|maerzen|kellerbier|rotbier|amber|bernstein|wiener|festbier|zwickel|bock\b/)) return 1
  if (is(b, /pils|\bhell|lager|kölsch|kolsch|export|weizen|weiss|weiß|radler/)) return 0
  return null
}

const founded = (b: Beer) => parseInt(String(b.brewery?.founded ?? '').match(/\d{3,4}/)?.[0] ?? '', 10)

export const CHALLENGES: ChallengeDef[] = [
  // ---------------------------------------------------------------- automatisch erkannt
  {
    id: 'trio', icon: '🏭', title: 'Brauerei-Trio', kind: 'auto',
    desc: '3 verschiedene Biere einer Brauerei',
    check: ({ tonight }) => {
      const per = new Map<string, number>()
      for (const b of beersOf(tonight)) if (b.brewery) per.set(b.brewery.id, (per.get(b.brewery.id) ?? 0) + 1)
      return { cur: Math.max(0, ...per.values()), goal: 3 }
    },
  },
  {
    id: 'null3', icon: '🧊', title: 'Null-Komma-Abend', kind: 'auto',
    desc: '3 alkoholfreie Biere',
    check: ({ tonight }) => ({ cur: tonight.filter((c) => c.beer && is(c.beer, FREE)).length, goal: 3 }),
  },
  {
    id: 'fern', icon: '🛫', title: 'Fernreise', kind: 'auto',
    desc: 'Zwei Biere von Brauereien, die mehr als 400 km auseinander liegen',
    check: ({ tonight }) => {
      const pts = beersOf(tonight)
        .map((b) => b.brewery)
        .filter((b): b is NonNullable<Beer['brewery']> => !!b && b.lat != null && b.lng != null)
        .map((b) => ({ lat: b.lat!, lng: b.lng! }))
      let max = 0
      for (const a of pts) for (const b of pts) max = Math.max(max, km(a, b))
      return { cur: Math.round(Math.min(max, 400)), goal: 400, unit: 'km' }
    },
  },
  {
    id: 'nordsued', icon: '🧭', title: 'Nord trifft Süd', kind: 'auto',
    desc: 'Ein Bier aus Bayern und eins aus dem Norden (nördlich von Kassel)',
    check: ({ tonight }) => {
      const bs = beersOf(tonight).map((b) => b.brewery).filter(Boolean)
      const south = bs.some((b) => b!.state === 'Bayern')
      const north = bs.some((b) => b!.lat != null && b!.lat > 51.4)
      return { cur: (south ? 1 : 0) + (north ? 1 : 0), goal: 2 }
    },
  },
  {
    id: 'neuland', icon: '🆕', title: 'Neuland', kind: 'auto',
    desc: 'Ein Bier, das du noch nie getrunken hast',
    check: ({ tonight, before }) => {
      const seen = new Set(before.map((c) => c.beer_id))
      return { cur: beersOf(tonight).filter((b) => !seen.has(b.id)).length >= 1 ? 1 : 0, goal: 1 }
    },
  },
  {
    id: 'entdecker', icon: '🔭', title: 'Entdeckerabend', kind: 'auto',
    desc: '2 neue Biere von 2 verschiedenen Brauereien',
    check: ({ tonight, before }) => {
      const seen = new Set(before.map((c) => c.beer_id))
      const brs = new Set(beersOf(tonight).filter((b) => !seen.has(b.id)).map((b) => b.brewery?.id ?? b.id))
      return { cur: Math.min(brs.size, 2), goal: 2 }
    },
  },
  {
    id: 'neuebrauerei', icon: '🤝', title: 'Neue Bekanntschaft', kind: 'auto',
    desc: 'Ein Bier einer Brauerei, von der du noch keins hattest',
    check: ({ tonight, before }) => {
      const seen = new Set(before.map((c) => c.beer?.brewery?.id).filter(Boolean))
      return { cur: any(tonight, (b) => !!b.brewery && !seen.has(b.brewery.id)), goal: 1 }
    },
  },
  {
    id: 'sorten3', icon: '🎠', title: 'Sortenkarussell', kind: 'auto',
    desc: '3 verschiedene Sorten',
    check: ({ tonight }) => ({ cur: new Set(beersOf(tonight).map((b) => b.style ?? b.name)).size, goal: 3 }),
  },
  {
    id: 'helldunkel', icon: '🌗', title: 'Hell & Dunkel', kind: 'auto',
    desc: 'Ein helles und ein dunkles Bier',
    check: ({ tonight }) => ({
      cur: any(tonight, (b) => is(b, LIGHTCOL) && !is(b, DARK)) + any(tonight, (b) => is(b, DARK)),
      goal: 2,
    }),
  },
  {
    id: 'grenze', icon: '🚧', title: 'Grenzgänger', kind: 'auto',
    desc: 'Biere aus 2 verschiedenen Bundesländern',
    check: ({ tonight }) => ({
      cur: Math.min(2, new Set(beersOf(tonight).map((b) => b.brewery?.state || b.brewery?.country).filter(Boolean)).size),
      goal: 2,
    }),
  },
  {
    id: 'kritiker', icon: '📝', title: 'Kritiker-Abend', kind: 'auto',
    desc: '2 Biere bewerten – mit Notiz',
    check: ({ tonight }) => ({ cur: Math.min(2, tonight.filter((c) => c.rating != null && c.note?.trim()).length), goal: 2 }),
  },
  {
    id: 'sterne', icon: '🍾', title: 'Korken-Kritiker', kind: 'auto',
    desc: 'Mindestens 2 Biere trinken und jedes davon bewerten',
    check: ({ tonight }) => {
      const all = tonight.length
      const rated = tonight.filter((c) => c.rating != null).length
      return { cur: all >= 2 && rated === all ? 2 : Math.min(rated, 1), goal: 2 }
    },
  },
  {
    id: 'juror', icon: '🧐', title: 'Strenger Juror', kind: 'auto',
    desc: 'Zwei Biere bewerten, die mindestens 1,5 Korken auseinander liegen',
    check: ({ tonight }) => {
      const r = tonight.map((c) => c.rating).filter((x): x is number => x != null)
      const diff = r.length >= 2 ? Math.max(...r) - Math.min(...r) : 0
      return { cur: diff >= 1.5 ? 1 : 0, goal: 1 }
    },
  },
  {
    id: 'volle', icon: '💎', title: 'Volle Punktzahl', kind: 'auto',
    desc: 'Finde heute ein Bier, das volle 5 Korken verdient',
    check: ({ tonight }) => ({ cur: tonight.some((c) => (c.rating ?? 0) >= 5) ? 1 : 0, goal: 1 }),
  },
  {
    id: 'kloster', icon: '⛪', title: 'Klostergang', kind: 'auto',
    desc: 'Ein Bier aus einer Kloster- oder Abteibrauerei',
    check: ({ tonight }) => ({ cur: any(tonight, (b) => /kloster|abtei|abbey|stift/i.test(b.brewery?.name ?? '')), goal: 1 }),
  },
  {
    id: 'zeitreise', icon: '⏳', title: 'Zeitreise', kind: 'auto',
    desc: 'Ein Bier einer Brauerei, die vor 1600 gegründet wurde',
    check: ({ tonight }) => ({ cur: any(tonight, (b) => founded(b) > 500 && founded(b) < 1600), goal: 1 }),
  },
  {
    id: 'jung', icon: '🌱', title: 'Frischer Wind', kind: 'auto',
    desc: 'Ein Bier einer Brauerei, die ab 2010 gegründet wurde',
    check: ({ tonight }) => ({ cur: any(tonight, (b) => founded(b) >= 2010), goal: 1 }),
  },
  {
    id: 'hopfen', icon: '🌿', title: 'Hopfen-Abend', kind: 'auto',
    desc: 'Ein IPA, Pale Ale oder Stout',
    check: ({ tonight }) => ({ cur: any(tonight, (b) => is(b, /\bipa\b|pale ale|india pale|stout|porter\b|\bale\b/)), goal: 1 }),
  },
  {
    id: 'weizen2', icon: '🌾', title: 'Weißbier-Abend', kind: 'auto',
    desc: '2 verschiedene Weizenbiere',
    check: ({ tonight }) => ({ cur: Math.min(2, countBeers(tonight, (b) => is(b, /weiz|weiss|weiß|hefe/))), goal: 2 }),
  },
  {
    id: 'leicht', icon: '🪶', title: 'Leichtgewicht', kind: 'auto',
    desc: 'Ein Bier unter 4 % – Radler und Leichtbier zählen, Alkoholfreies nicht',
    check: ({ tonight }) => ({
      cur: any(tonight, (b) => b.abv != null && Number(b.abv) > 0.5 && Number(b.abv) < 4),
      goal: 1,
    }),
  },
  {
    id: 'rauch', icon: '🔥', title: 'Rauchzeichen', kind: 'auto',
    desc: 'Ein Rauchbier',
    check: ({ tonight }) => ({ cur: any(tonight, (b) => is(b, /rauch|smoked/)), goal: 1 }),
  },
  {
    id: 'sauer', icon: '🍋', title: 'Säuerling', kind: 'auto',
    desc: 'Eine Gose, Berliner Weisse oder ein Sauerbier',
    check: ({ tonight }) => ({ cur: any(tonight, (b) => is(b, /\bgose\b|berliner weiss|\bsour\b|sauerbier/)), goal: 1 }),
  },
  {
    id: 'gasthaus', icon: '🍽️', title: 'Wirtshauskultur', kind: 'auto',
    desc: 'Ein Bier aus einer Gasthausbrauerei',
    check: ({ tonight }) => ({ cur: any(tonight, (b) => b.brewery?.brewery_type === 'gasthausbrauerei'), goal: 1 }),
  },
  {
    id: 'ausland', icon: '🌍', title: 'Blick über die Grenze', kind: 'auto',
    desc: 'Ein Bier aus einem anderen Land',
    check: ({ tonight }) => ({
      cur: any(tonight, (b) => !!b.brewery?.country && !/deutschland|germany/i.test(b.brewery.country)),
      goal: 1,
    }),
  },
  {
    id: 'alliteration', icon: '🔤', title: 'Alliteration', kind: 'auto',
    desc: 'Zwei Biere verschiedener Brauereien mit dem gleichen Anfangsbuchstaben',
    check: ({ tonight }) => {
      const by = new Map<string, Set<string>>()
      for (const b of beersOf(tonight)) {
        const ch = b.name.trim().charAt(0).toLowerCase()
        if (!by.has(ch)) by.set(ch, new Set())
        by.get(ch)!.add(b.brewery?.id ?? b.id)
      }
      return { cur: [...by.values()].some((s) => s.size >= 2) ? 1 : 0, goal: 1 }
    },
  },
  {
    id: 'treppe', icon: '📶', title: 'Prozent-Treppe', kind: 'auto',
    desc: 'Zwei Biere, deren Alkoholgehalt mindestens 2 Prozentpunkte auseinander liegt',
    check: ({ tonight }) => {
      const v = beersOf(tonight)
        .map((b) => (b.abv != null ? Number(b.abv) : is(b, FREE) ? 0 : null))
        .filter((x): x is number => x != null)
      return { cur: v.length >= 2 && Math.max(...v) - Math.min(...v) >= 2 ? 1 : 0, goal: 1 }
    },
  },
  {
    id: 'merkzettel', icon: '⭐', title: 'Merkzettel', kind: 'auto',
    desc: 'Ein Bier von deiner Merkliste',
    prepare: async () => {
      const ids = [...(await wishlistIds())]
      return ids.length ? { wish: ids } : null
    },
    check: ({ tonight, data }) => {
      const wish = new Set((data.wish as string[]) ?? [])
      return { cur: tonight.some((c) => wish.has(c.beer_id)) ? 1 : 0, goal: 1 }
    },
  },
  {
    id: 'wiedersehen', icon: '💛', title: 'Wiedersehen', kind: 'auto',
    desc: 'Eins deiner 5 bestbewerteten Biere nochmal',
    prepare: ({ before }) => {
      const m = new Map<string, number[]>()
      for (const c of before) if (c.rating != null) m.set(c.beer_id, [...(m.get(c.beer_id) ?? []), c.rating])
      const top = [...m.entries()]
        .map(([id, r]) => [id, r.reduce((a, x) => a + x, 0) / r.length] as const)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([id]) => id)
      return top.length >= 3 ? { top } : null
    },
    check: ({ tonight, data }) => {
      const top = new Set((data.top as string[]) ?? [])
      return { cur: tonight.some((c) => top.has(c.beer_id)) ? 1 : 0, goal: 1 }
    },
  },
  {
    id: 'revier', icon: '🗺️', title: 'Neues Revier', kind: 'auto',
    desc: 'Ein Bier aus einer Bier-Region, die du noch nicht erkundet hast',
    prepare: ({ before, regions }) => {
      if (!regions) return null
      const seen = new Set<string>()
      for (const b of beersOf(before)) {
        const r = regionAt(regions, b.brewery?.lat, b.brewery?.lng)
        if (r) seen.add(r.id)
      }
      return seen.size < regions.length ? { seen: [...seen] } : null
    },
    check: ({ tonight, data, regions }) => {
      if (!regions) return { cur: 0, goal: 1 }
      const seen = new Set((data.seen as string[]) ?? [])
      const hit = beersOf(tonight).some((b) => {
        const r = regionAt(regions, b.brewery?.lat, b.brewery?.lng)
        return !!r && !seen.has(r.id)
      })
      return { cur: hit ? 1 : 0, goal: 1 }
    },
  },

  {
    id: 'quer', icon: '🗺️', title: 'Quer durchs Land', kind: 'auto',
    desc: 'Biere aus 3 verschiedenen Bundesländern',
    check: ({ tonight }) => ({ cur: Math.min(3, new Set(beersOf(tonight).map((b) => b.brewery?.state).filter(Boolean)).size), goal: 3 }),
  },
  {
    id: 'ostwest', icon: '↔️', title: 'Ost-West-Achse', kind: 'auto',
    desc: 'Ein Bier aus dem Osten (östlich von Leipzig) und eins aus dem Westen (westlich von Köln)',
    check: ({ tonight }) => {
      const bs = beersOf(tonight).map((b) => b.brewery).filter((b) => b && b.lng != null)
      return { cur: (bs.some((b) => b!.lng! > 12.4) ? 1 : 0) + (bs.some((b) => b!.lng! < 7) ? 1 : 0), goal: 2 }
    },
  },
  {
    id: 'nachbarn', icon: '🏘️', title: 'Kurze Wege', kind: 'auto',
    desc: 'Zwei Biere von verschiedenen Brauereien, die weniger als 10 km auseinander liegen',
    check: ({ tonight }) => {
      const pts = new Map<string, { lat: number; lng: number }>()
      for (const b of beersOf(tonight)) if (b.brewery?.lat != null && b.brewery.lng != null) pts.set(b.brewery.id, { lat: b.brewery.lat, lng: b.brewery.lng })
      const l = [...pts.values()]
      let hit = false
      for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) if (km(l[i], l[j]) < 10) hit = true
      return { cur: hit ? 1 : 0, goal: 1 }
    },
  },
  {
    id: 'dorf', icon: '🐄', title: 'Dorfkind', kind: 'auto',
    desc: 'Biere von 2 Brauereien aus 2 verschiedenen kleinen Orten',
    check: ({ tonight, cityCount }) => {
      const towns = new Set<string>()
      for (const b of beersOf(tonight)) {
        const c = b.brewery?.city?.toLowerCase().trim()
        if (c && !bigCity(c) && (cityCount?.get(c) ?? 1) <= 2) towns.add(c)
      }
      return { cur: Math.min(2, towns.size), goal: 2 }
    },
  },
  {
    id: 'grossstadt', icon: '🏙️', title: 'Großstadtkind', kind: 'auto',
    desc: 'Biere aus 2 verschiedenen Großstädten',
    check: ({ tonight }) => ({
      cur: Math.min(2, new Set(beersOf(tonight).map((b) => bigCity(b.brewery?.city)).filter(Boolean)).size),
      goal: 2,
    }),
  },
  {
    id: 'insel', icon: '🏝️', title: 'Inselbier', kind: 'auto',
    desc: 'Ein Bier von einer Insel – Sylt, Rügen, Usedom, Fehmarn, Norderney …',
    check: ({ tonight }) => ({ cur: any(tonight, (b) => ISLAND.test(`${b.brewery?.city ?? ''} ${b.brewery?.name ?? ''}`)), goal: 1 }),
  },
  {
    id: 'luecke', icon: '🧩', title: 'Lückenfüller', kind: 'auto',
    desc: 'Ein neues Bier einer Brauerei, von der du schon etwas kennst',
    check: ({ tonight, before }) => {
      const seenBeer = new Set(before.map((c) => c.beer_id))
      const seenBr = new Set(before.map((c) => c.beer?.brewery?.id).filter(Boolean))
      return { cur: any(tonight, (b) => !seenBeer.has(b.id) && !!b.brewery && seenBr.has(b.brewery.id)), goal: 1 }
    },
  },
  {
    id: 'underdog', icon: '🐭', title: 'Underdog', kind: 'auto',
    desc: 'Ein Bier einer kleinen Brauerei mit höchstens 3 Bieren im Katalog',
    check: ({ tonight, beerCount }) => ({
      cur: beerCount ? any(tonight, (b) => !!b.brewery && (beerCount.get(b.brewery.id) ?? 99) <= 3) : 0,
      goal: 1,
    }),
  },
  {
    id: 'abc', icon: '🔠', title: 'ABC', kind: 'auto',
    desc: 'Drei Biere, deren Anfangsbuchstaben im Alphabet aufeinander folgen (z. B. A, B, C)',
    check: ({ tonight }) => {
      const letters = new Set(beersOf(tonight).map((b) => b.name.trim().charAt(0).toUpperCase()).filter((c) => /[A-Z]/.test(c)))
      let best = 0
      for (const c of letters) {
        let n = 1
        while (letters.has(String.fromCharCode(c.charCodeAt(0) + n))) n++
        best = Math.max(best, n)
      }
      return { cur: Math.min(3, best), goal: 3 }
    },
  },
  {
    id: 'glueck', icon: '🍀', title: 'Glückszahl', kind: 'auto',
    desc: 'Ein Bier mit genau 4,9 %, 5,0 % oder 5,5 %',
    check: ({ tonight }) => ({ cur: any(tonight, (b) => b.abv != null && [4.9, 5, 5.5].includes(Math.round(Number(b.abv) * 10) / 10)), goal: 1 }),
  },
  {
    id: 'heilig', icon: '😇', title: 'Heiliger Abend', kind: 'auto',
    desc: 'Ein Bier einer Brauerei mit „St.“, „Sankt“ oder „Heilig“ im Namen',
    check: ({ tonight }) => ({ cur: any(tonight, (b) => /\bst\.|\bsankt\b|heilig/i.test(b.brewery?.name ?? '')), goal: 1 }),
  },
  {
    id: 'zahl', icon: '🔢', title: 'Zahlenspiel', kind: 'auto',
    desc: 'Ein Bier mit einer Zahl im Namen – „1516“, „Nr. 7“, „1402“ …',
    check: ({ tonight }) => ({ cur: any(tonight, (b) => /\d/.test(b.name.replace(/\d+([.,]\d+)?\s*%/g, ''))), goal: 1 }),
  },
  {
    id: 'farbverlauf', icon: '🎨', title: 'Farbverlauf', kind: 'auto',
    desc: 'Drei Biere von hell nach dunkel – in dieser Reihenfolge eingetragen',
    check: ({ tonight }) => {
      const seq = [...tonight]
        .sort((a, b) => a.drunk_at.localeCompare(b.drunk_at))
        .map((c) => (c.beer ? COLOR(c.beer) : null))
        .filter((x): x is number => x != null)
      // längste streng steigende Folge hell → mittel → dunkel
      let best = 0
      for (let i = 0; i < seq.length; i++) {
        let n = 1
        let last = seq[i]
        for (let j = i + 1; j < seq.length; j++) if (seq[j] > last) (n++, (last = seq[j]))
        best = Math.max(best, n)
      }
      return { cur: Math.min(3, best), goal: 3 }
    },
  },
  {
    id: 'klassiker', icon: '🎼', title: 'Klassiker-Kombi', kind: 'auto',
    desc: 'Erst ein Pils, danach ein Weizen',
    check: ({ tonight }) => {
      const seq = [...tonight].sort((a, b) => a.drunk_at.localeCompare(b.drunk_at))
      const pils = seq.findIndex((c) => c.beer && is(c.beer, /pils/))
      const ok = pils >= 0 && seq.slice(pils + 1).some((c) => c.beer && is(c.beer, /weiz|weiss|weiß|hefe/))
      return { cur: ok ? 2 : pils >= 0 ? 1 : 0, goal: 2 }
    },
  },
  {
    id: 'stammgast', icon: '🪑', title: 'Wiederholungstäter', kind: 'auto',
    desc: 'Mindestens 2 Biere – und nur solche, die du schon kennst',
    check: ({ tonight, before }) => {
      const seen = new Set(before.map((c) => c.beer_id))
      const allKnown = tonight.every((c) => seen.has(c.beer_id))
      return { cur: allKnown ? Math.min(2, tonight.length) : 0, goal: 2 }
    },
  },
  {
    id: 'mutprobe', icon: '🦁', title: 'Mutprobe', kind: 'auto',
    desc: 'Ein Bier einer Sorte, die du noch nie getrunken hast',
    check: ({ tonight, before }) => {
      const styles = new Set(beersOf(before).map((b) => b.style).filter(Boolean))
      return { cur: any(tonight, (b) => !!b.style && !styles.has(b.style)), goal: 1 }
    },
  },
  {
    id: 'profi', icon: '👃', title: 'Geschmacksprofi', kind: 'auto',
    desc: '3 Biere bewerten – alle mit Notiz und alle unterschiedlich',
    check: ({ tonight }) => {
      const r = tonight.filter((c) => c.rating != null && c.note?.trim())
      return { cur: Math.min(3, new Set(r.map((c) => c.rating)).size), goal: 3 }
    },
  },

  // ---------------------------------------------------------------- Bierquiz
  { id: 'quiz', icon: '🧠', title: 'Bierquiz', kind: 'quiz', desc: 'Beantworte 3 von 5 Bierfragen richtig', quiz: { count: 5, need: 3 } },
  { id: 'quiz-master', icon: '🎓', title: 'Quizmaster', kind: 'quiz', desc: 'Beantworte 5 von 5 Bierfragen richtig', quiz: { count: 5, need: 5 } },
  {
    id: 'quiz-schaetzen', icon: '🎯', title: 'Schätzkönig', kind: 'quiz', desc: 'Liege bei 3 von 5 Schätzfragen im grünen Bereich',
    quiz: { count: 5, need: 3, filter: (q) => q.kind === 'num' },
  },
  {
    id: 'quiz-geschichte', icon: '📜', title: 'Geschichtsstunde', kind: 'quiz', desc: 'Beantworte 3 von 5 Fragen zur Biergeschichte richtig',
    quiz: { count: 5, need: 3, filter: (q) => q.cat === 'Geschichte' },
  },
  {
    id: 'quiz-geek', icon: '🔬', title: 'Brau-Geek', kind: 'quiz', desc: 'Beantworte 4 von 5 Fragen zu Brauen & Sorten richtig',
    quiz: { count: 5, need: 4, filter: (q) => q.cat === 'Brauen' || q.cat === 'Sorten' },
  },

  // ---------------------------------------------------------------- selbst bestätigen
  { id: 'runde', icon: '🍻', title: 'Runde geht auf mich', kind: 'manual', desc: 'Gib jemandem ein Bier aus' },
  { id: 'pyramide', icon: '🔺', title: 'Bierdeckel-Architekt', kind: 'manual', desc: 'Bau eine 3-stöckige Pyramide aus Bierdeckeln' },
  { id: 'hand', icon: '🫲', title: 'Falsche Hand', kind: 'manual', desc: 'Trink den ganzen Abend nur mit deiner schwächeren Hand' },
  { id: 'polyglott', icon: '🗣️', title: 'Polyglott', kind: 'manual', desc: 'Stoß in 3 verschiedenen Sprachen an – Prost, Cheers, Salute …' },
  { id: 'wasser', icon: '💧', title: 'Wasserträger', kind: 'manual', desc: 'Trink zu jedem Bier ein Glas Wasser' },
  { id: 'blind', icon: '🙈', title: 'Blindverkostung', kind: 'manual', desc: 'Erkenne ein Bier blind – oder lass jemanden raten' },
  { id: 'kronkorken', icon: '🪙', title: 'Kronkorken-Sammler', kind: 'manual', desc: 'Sammle 3 verschiedene Kronkorken' },
  { id: 'tresen', icon: '🧑‍🍳', title: 'Tresengespräch', kind: 'manual', desc: 'Frag Wirt oder Barkeeper nach dem Lieblingsbier – und probier es' },
  { id: 'ortswechsel', icon: '🚶', title: 'Ortswechsel', kind: 'manual', desc: 'Trink an zwei verschiedenen Orten ein Getränk' },
  { id: 'trinkspruch', icon: '🎤', title: 'Dichterlesung', kind: 'manual', desc: 'Dichte einen Trinkspruch und trag ihn vor' },
  { id: 'glas', icon: '🥂', title: 'Glaskunde', kind: 'manual', desc: 'Trink ein Bier aus dem passenden Glas – Weizenglas, Stange, Tulpe …' },
  { id: 'flip', icon: '🤹', title: 'Deckel-Flip', kind: 'manual', desc: 'Schnipp einen Bierdeckel von der Tischkante und fang ihn – 3× hintereinander' },
  { id: 'zapfen', icon: '🚰', title: 'Zapfmeister', kind: 'manual', desc: 'Zapf selbst ein Bier mit ordentlicher Schaumkrone' },
  { id: 'experte', icon: '🎓', title: 'Brauerei-Experte', kind: 'manual', desc: 'Erzähl jemandem etwas über die Brauerei deines Biers – Ort, Gründung, Geschichte' },
  { id: 'offline', icon: '📵', title: 'Offline-Stunde', kind: 'manual', desc: 'Eine Stunde kein Handy am Tisch – danach abhaken' },
  { id: 'probierschluck', icon: '🥄', title: 'Probierschluck', kind: 'manual', desc: 'Lass jemanden probieren, der dieses Bier noch nie hatte' },
  { id: 'spiegel', icon: '🪞', title: 'Spiegelbild', kind: 'manual', desc: 'Stoß mit jemandem an, der dasselbe Bier trinkt' },
  { id: 'etikett', icon: '🏷️', title: 'Etiketten-Kunst', kind: 'manual', desc: 'Lös ein Etikett komplett ab, ohne dass es reißt' },
  { id: 'deckelkritik', icon: '✍️', title: 'Bierdeckel-Kritik', kind: 'manual', desc: 'Schreib deine Bewertung auf einen Bierdeckel' },
  { id: 'leute', icon: '👋', title: 'Neue Leute', kind: 'manual', desc: 'Lern jemanden kennen und frag nach dem Lieblingsbier' },
  { id: 'sport', icon: '🎯', title: 'Kneipensport', kind: 'manual', desc: 'Gewinn eine Runde Kicker, Darts oder Billard' },
  { id: 'heimweg', icon: '🚕', title: 'Sicher heim', kind: 'manual', desc: 'Sorg für einen sicheren Heimweg – für dich und deine Leute' },
  { id: 'pate', icon: '🤵', title: 'Bier-Pate', kind: 'manual', desc: 'Empfiehl jemandem ein Bier – und er bestellt es' },
  { id: 'geschichte', icon: '📖', title: 'Geschichtenerzähler', kind: 'manual', desc: 'Lass dir von jemandem seinen legendärsten Bierabend erzählen' },
  { id: 'fremde', icon: '🥂', title: 'Fremde Tische', kind: 'manual', desc: 'Stoß mit jemandem an, den du heute zum ersten Mal siehst' },
  { id: 'kompliment', icon: '💐', title: 'Kompliment an die Küche', kind: 'manual', desc: 'Sag dem Personal, was dir heute besonders gefallen hat' },
  { id: 'foto', icon: '📸', title: 'Gruppenfoto', kind: 'manual', desc: 'Mach ein Foto mit allen am Tisch' },
  { id: 'trinkgeld', icon: '💶', title: 'Trinkgeld-König', kind: 'manual', desc: 'Gib heute großzügig Trinkgeld' },
  { id: 'wasserrunde', icon: '🚰', title: 'Ehrenrunde', kind: 'manual', desc: 'Hol eine Runde Wasser für den ganzen Tisch' },
  { id: 'turm', icon: '🗼', title: 'Bierdeckel-Turm', kind: 'manual', desc: 'Stapel 10 Bierdeckel hochkant zu einem Turm' },
  { id: 'wurf', icon: '🎳', title: 'Kronkorken-Wurf', kind: 'manual', desc: 'Wirf einen Kronkorken aus 2 m Entfernung in ein leeres Glas' },
  { id: 'schnipp', icon: '👌', title: 'Kronkorken-Schnippen', kind: 'manual', desc: 'Schnipp einen Kronkorken über den Tisch, sodass er genau an der Kante liegen bleibt' },
  { id: 'origami', icon: '🦢', title: 'Origami', kind: 'manual', desc: 'Falte aus einem Bierdeckel oder einer Serviette etwas Erkennbares' },
  { id: 'reinheit', icon: '📏', title: 'Reinheitsgebot', kind: 'manual', desc: 'Nenn die vier erlaubten Zutaten des Reinheitsgebots, ohne nachzuschauen' },
  { id: 'bierdeutsch', icon: '🗯️', title: 'Bierdeutsch', kind: 'manual', desc: 'Benutz heute dreimal ein regionales Bierwort – Halbe, Stange, Köbes, Seidla, Pfiff …' },
  { id: 'mundart', icon: '🎙️', title: 'Mundart-Prost', kind: 'manual', desc: 'Stoß im Dialekt an – Prosit, Prösterchen, Zum Wohl …' },
  { id: 'historiker', icon: '🏛️', title: 'Wirtshaus-Historiker', kind: 'manual', desc: 'Find heraus, wie alt das Lokal ist, in dem du sitzt' },
  { id: 'sommelier', icon: '🍷', title: 'Sommelier-Sprache', kind: 'manual', desc: 'Beschreib ein Bier mit drei Geschmackswörtern – „lecker“ zählt nicht' },
  { id: 'gutenacht', icon: '🛌', title: 'Gute Nacht', kind: 'manual', desc: 'Sei heute vor 1 Uhr zu Hause' },
]

export const byId = (id: string) => CHALLENGES.find((c) => c.id === id)

// ------------------------------------------------------------------------------------------ Datenbank

export interface ChallengeRow {
  id: number
  night: string
  challenge: string
  started_at: string
  ends_at: string
  completed_at: string | null
  status: 'aktiv' | 'geschafft' | 'abgebrochen' | 'verpasst'
  confirmed: boolean
  data: Record<string, unknown>
}

export async function myChallenges(): Promise<ChallengeRow[]> {
  const res = await supabase.from('challenges').select('*').order('started_at', { ascending: false }).limit(500)
  if (res.error) throw new Error(res.error.message)
  return res.data as ChallengeRow[]
}

// ------------------------------------------------------------------------------------------ Zustand

export interface ChallengeState {
  night: Night
  rows: ChallengeRow[]
  active: ChallengeRow | null
  progress: Progress | null
  tonight: ChallengeRow[]
  /** zur Auswahl angebotene IDs (nur wenn keine aktiv ist und der Abend läuft) */
  offer: string[]
  loaded: boolean
  error?: string
}

let state: ChallengeState = { night: nightAt(), rows: [], active: null, progress: null, tonight: [], offer: [], loaded: false }
const subs = new Set<(s: ChallengeState) => void>()
const emit = (s: ChallengeState) => {
  state = s
  subs.forEach((f) => f(s))
}

let checkinsCache: Checkin[] | null = null
let regionsCache: Region[] | undefined
let catalogCounts: { city: Map<string, number>; beers: Map<string, number> } | null = null

async function loadCatalogCounts() {
  if (catalogCounts) return
  try {
    const idx = await loadIndex()
    const city = new Map<string, number>()
    const beers = new Map<string, number>()
    for (const b of idx.breweries.values()) {
      const c = b.city?.toLowerCase().trim()
      if (c) city.set(c, (city.get(c) ?? 0) + 1)
      beers.set(b.id, b.beerCount)
    }
    catalogCounts = { city, beers }
  } catch {
    /* ohne Index fallen Dorfkind/Underdog eben weg */
  }
}

function evaluate(row: ChallengeRow, checkins: Checkin[]): Progress | null {
  const def = byId(row.challenge)
  if (!def?.check) return null
  const start = new Date(row.started_at).getTime()
  const end = new Date(row.ends_at).getTime()
  const tonight = checkins.filter((c) => {
    const t = new Date(c.drunk_at).getTime()
    return t >= start && t < end
  })
  const before = checkins.filter((c) => new Date(c.drunk_at).getTime() < start)
  return def.check({ tonight, before, data: row.data ?? {}, regions: regionsCache, cityCount: catalogCounts?.city, beerCount: catalogCounts?.beers })
}

const offerKey = async () => {
  const { data } = await supabase.auth.getSession()
  return `plopp-challenge-offer-${data.session?.user.id ?? ''}`
}

/** 3 zufällige Challenges: mindestens eine automatische und eine zum Selbst-Bestätigen, keine doppelt am Abend */
async function makeOffer(night: Night, used: Set<string>, before: Checkin[], fresh = false): Promise<string[]> {
  const key = await offerKey()
  const saved = load<{ night: string; ids: string[] } | null>(key, null)
  if (!fresh && saved && saved.night === night.night && saved.ids.every((id) => !used.has(id) && byId(id))) return saved.ids
  const prepCtx = { before, regions: regionsCache }
  const pool = CHALLENGES.filter((c) => !used.has(c.id))
  const ok: ChallengeDef[] = []
  for (const c of pool.sort(() => Math.random() - 0.5)) {
    if (c.prepare && !(await c.prepare(prepCtx))) continue
    ok.push(c)
    if (ok.length >= 12) break
  }
  const usable = ok.filter((c) => !((c.id === 'dorf' || c.id === 'underdog') && !catalogCounts))
  const auto = usable.filter((c) => c.kind === 'auto')
  const manual = usable.filter((c) => c.kind === 'manual')
  const quiz = usable.filter((c) => c.kind === 'quiz')
  const pick = [auto[0], manual[0]].filter(Boolean) as ChallengeDef[]
  // Das Bierquiz kommt oft dran: in gut der Hälfte der Auswahlen ist eine Quiz-Challenge dabei
  if (quiz.length && Math.random() < 0.6) pick.push(quiz[0])
  for (const c of usable) if (pick.length < 3 && !pick.includes(c)) pick.push(c)
  const ids = pick.sort(() => Math.random() - 0.5).map((c) => c.id)
  save(key, { night: night.night, ids })
  return ids
}

/** Alles neu laden und auswerten (auch: verpasste markieren, geschaffte automatisch abschließen) */
export async function refreshChallenges(opts: { reloadCheckins?: boolean } = {}): Promise<ChallengeState> {
  const night = nightAt()
  try {
    if (!regionsCache) regionsCache = await loadRegions().catch(() => undefined)
    await loadCatalogCounts()
    const [rows, checkins] = await Promise.all([
      myChallenges(),
      checkinsCache && !opts.reloadCheckins ? Promise.resolve(checkinsCache) : myCheckins(),
    ])
    checkinsCache = checkins
    let active = rows.find((r) => r.status === 'aktiv') ?? null
    // Zeit abgelaufen → verpasst (außer es ist doch geschafft)
    if (active && Date.now() >= new Date(active.ends_at).getTime()) {
      const p = evaluate(active, checkins)
      const done = !!p && p.cur >= p.goal
      await supabase
        .from('challenges')
        .update(done ? { status: 'geschafft', completed_at: active.ends_at } : { status: 'verpasst' })
        .eq('id', active.id)
      active.status = done ? 'geschafft' : 'verpasst'
      active = null
    }
    let progress = active ? evaluate(active, checkins) : null
    if (active && progress && progress.cur >= progress.goal) {
      await completeChallenge(active, false)
      return refreshChallenges()
    }
    const tonight = rows.filter((r) => r.night === night.night && r.status !== 'aktiv')
    const offer =
      night.open && !active
        ? await makeOffer(
            night,
            new Set(tonight.map((r) => r.challenge)),
            checkins,
          )
        : []
    if (!active) progress = null
    const s: ChallengeState = { night, rows, active, progress, tonight, offer, loaded: true }
    emit(s)
    return s
  } catch (e) {
    const s = { ...state, night, loaded: true, error: (e as Error).message }
    emit(s)
    return s
  }
}

export async function startChallenge(id: string) {
  const night = nightAt()
  if (!night.open) throw new Error('Challenges gibt es von 16 bis 4 Uhr.')
  const def = byId(id)
  if (!def) throw new Error('Unbekannte Challenge')
  const now = new Date()
  const before = (checkinsCache ?? []).filter((c) => new Date(c.drunk_at) < now)
  const data = (def.prepare ? await def.prepare({ before, regions: regionsCache }) : {}) ?? {}
  const res = await supabase.from('challenges').insert({
    night: night.night,
    challenge: id,
    ends_at: night.end.toISOString(),
    data,
  })
  if (res.error) throw new Error(res.error.message)
  haptic(20)
  save(await offerKey(), null)
  await refreshChallenges()
}

async function completeChallenge(row: ChallengeRow, confirmed: boolean) {
  const res = await supabase
    .from('challenges')
    .update({ status: 'geschafft', completed_at: new Date().toISOString(), confirmed })
    .eq('id', row.id)
    .eq('status', 'aktiv')
  if (res.error) throw new Error(res.error.message)
  const def = byId(row.challenge)
  save(await offerKey(), null)
  celebrate({ kind: 'challenge', icon: def?.icon ?? '🎯', title: def?.title ?? 'Challenge geschafft', sub: 'Such dir gleich die nächste aus!' })
  window.dispatchEvent(new Event('plopp-challenge-done'))
}

/** Quiz-Runde einer Quiz-Challenge beendet: geschafft, wenn genug richtig */
export async function finishQuizChallenge(correct: number): Promise<boolean> {
  const a = state.active
  const def = a ? byId(a.challenge) : null
  if (!a || !def?.quiz || correct < def.quiz.need) return false
  await completeChallenge(a, false)
  await refreshChallenges()
  return true
}

/** Manuelle Challenge (oder automatische, die die App nicht erkennen konnte) selbst bestätigen */
export async function confirmChallenge() {
  if (!state.active) return
  await completeChallenge(state.active, true)
  await refreshChallenges()
}

/** Aufgeben → neue Auswahl (die aufgegebene kommt heute nicht wieder) */
export async function abortChallenge() {
  if (!state.active) return
  const res = await supabase.from('challenges').update({ status: 'abgebrochen' }).eq('id', state.active.id)
  if (res.error) throw new Error(res.error.message)
  save(await offerKey(), null)
  await refreshChallenges()
}

/** Nach einem Check-in: aktive Challenge prüfen (wird von checkNewAchievements aufgerufen) */
export async function checkActiveChallenge() {
  checkinsCache = null
  await refreshChallenges({ reloadCheckins: true })
}

/** React: aktueller Zustand + Minutentakt für die Uhr */
export function useChallenges(): ChallengeState {
  const [s, setS] = useState(state)
  useEffect(() => {
    subs.add(setS)
    if (!state.loaded) refreshChallenges()
    const t = setInterval(() => {
      const n = nightAt()
      // Abend beginnt/endet → neu auswerten
      if (n.open !== state.night.open || n.night !== state.night.night) refreshChallenges()
      else setS({ ...state, night: n })
    }, 60_000)
    return () => {
      subs.delete(setS)
      clearInterval(t)
    }
  }, [])
  return s
}

export function resetChallenges() {
  checkinsCache = null
  state = { night: nightAt(), rows: [], active: null, progress: null, tonight: [], offer: [], loaded: false }
}
