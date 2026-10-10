/**
 * Suche direkt auf dem Gerät.
 *
 * Die App lädt einmal einen kompakten Index aller sichtbaren Biere und Brauereien (RPC search_index,
 * inkl. Änderungen der eigenen Runde), merkt ihn sich lokal und sucht dann ohne Netz-Wartezeit:
 * - Teilwörter und Wortanfänge („alt“ → alle Altbiere, „weizen“ → auch „Hefeweizen“)
 * - mit oder ohne Leerzeichen/Bindestrich („alt bier“ = „Altbier“, „hefe weizen“ = „Hefe-Weizen“)
 * - Umlaute egal („weiss“ = „weiß“, „koelsch“ = „kölsch“)
 * - kleine Tippfehler („augstiner“ → Augustiner), wenn es sonst kaum Treffer gibt
 */
import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { Beer, Brewery, Trust } from './types'

export interface IndexBrewery {
  id: string
  name: string
  city: string | null
  logo_url: string | null
  trust: Trust
  brewery_type: string | null
  words: string[]
  compact: string
  beerCount: number
}

export interface IndexBeer {
  id: string
  name: string
  style: string | null
  abv: number | null
  brewery_id: string | null
  image_url: string | null
  trust: Trust
  words: string[]
  compact: string
  styleWords: string[]
  brewery: IndexBrewery | null
}

export interface SearchIndex {
  beers: IndexBeer[]
  breweries: Map<string, IndexBrewery>
  loadedAt: number
}

type Raw = {
  v: number
  breweries: [string, string, string | null, string | null, string, string | null][]
  beers: [string, string, string | null, number | null, string | null, string | null, string][]
}

const TRUST: Record<string, Trust> = { v: 'verified', u: 'unverified' }
const trustOf = (t: string): Trust => TRUST[t] ?? 'user'

// ------------------------------------------------------------------------------------ Normalisieren

/** Kleinbuchstaben, Umlaute/Akzente weg, ß → ss, ae/oe/ue → a/o/u (beides gleich behandelt) */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ae/g, 'a')
    .replace(/oe/g, 'o')
    .replace(/ue/g, 'u')
}

export function words(s: string | null | undefined): string[] {
  if (!s) return []
  return fold(s)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

// ------------------------------------------------------------------------------------ Index laden

const KEY = 'plopp-search-index-v1'
const MAX_AGE = 6 * 3600 * 1000
let current: SearchIndex | null = null
let loading: Promise<SearchIndex> | null = null
const listeners = new Set<(i: SearchIndex) => void>()

export function buildIndex(raw: Raw, loadedAt: number): SearchIndex {
  const breweries = new Map<string, IndexBrewery>()
  for (const [id, name, city, logo_url, trust, brewery_type] of raw.breweries) {
    const w = words(name)
    breweries.set(id, { id, name, city, logo_url, trust: trustOf(trust), brewery_type, words: w, compact: w.join(''), beerCount: 0 })
  }
  const beers: IndexBeer[] = raw.beers.map(([id, name, style, abv, brewery_id, image_url, trust]) => {
    const w = words(name)
    const br = brewery_id ? (breweries.get(brewery_id) ?? null) : null
    if (br) br.beerCount++
    return {
      id,
      name,
      style,
      abv: abv == null ? null : Number(abv),
      brewery_id,
      image_url,
      trust: trustOf(trust),
      words: w,
      compact: w.join(''),
      styleWords: words(style),
      brewery: br,
    }
  })
  return { beers, breweries, loadedAt }
}

async function uid(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id ?? ''
}

async function fetchIndex(): Promise<SearchIndex> {
  const res = await supabase.rpc('search_index')
  if (res.error) throw new Error(res.error.message)
  const raw = res.data as Raw
  const now = Date.now()
  const idx = buildIndex(raw, now)
  try {
    localStorage.setItem(KEY, JSON.stringify({ t: now, u: await uid(), raw }))
  } catch {
    /* zu groß oder gesperrt – dann nur im Speicher */
  }
  return idx
}

function publish(i: SearchIndex) {
  current = i
  for (const l of listeners) l(i)
}

/** Index holen: sofort aus dem Speicher/Gerät, im Hintergrund auffrischen, wenn er älter ist */
export function loadIndex(force = false): Promise<SearchIndex> {
  if (current && !force && Date.now() - current.loadedAt < MAX_AGE) return Promise.resolve(current)
  if (loading) return loading
  loading = (async () => {
    if (!current && !force) {
      try {
        const s = localStorage.getItem(KEY)
        if (s) {
          const c = JSON.parse(s) as { t: number; u: string; raw: Raw }
          if (c.u === (await uid()) && c.raw?.v === 1) {
            publish(buildIndex(c.raw, c.t))
            if (Date.now() - c.t < MAX_AGE) return current!
          }
        }
      } catch {
        /* egal */
      }
    }
    const fresh = await fetchIndex()
    publish(fresh)
    return fresh
  })().finally(() => {
    loading = null
  })
  return current && !force ? Promise.resolve(current) : loading
}

export function currentIndex(): SearchIndex | null {
  return current
}

export function onIndex(fn: (i: SearchIndex) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Nach eigenen Änderungen (Bier angelegt, umbenannt, ausgeblendet …) neu laden */
export function refreshIndex() {
  if (!current) return
  loadIndex(true).catch(() => {})
}

export function clearIndex() {
  current = null
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* egal */
  }
}

// ------------------------------------------------------------------------------------ Suchen

/** Damerau-freie Levenshtein-Distanz, früh abgebrochen ab max+1 */
function dist(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      cur.push(v)
      if (v < best) best = v
    }
    if (best > max) return max + 1
    prev = cur
  }
  return prev[b.length]
}

/** Wie gut passt ein Suchwort zu den Wörtern eines Feldes? 0 = gar nicht */
function matchWords(t: string, ws: string[], compact: string, fuzzy: boolean): number {
  let best = 0
  for (const w of ws) {
    if (w === t) return 100
    if (w.startsWith(t)) best = Math.max(best, 85)
    else if (t.length >= 4 && w.includes(t)) best = Math.max(best, 60) // „weizen“ in „hefeweizen“
  }
  if (best) return best
  // über Wortgrenzen hinweg: „altbier“ in „alt bier“, „hefeweizen“ in „hefe weizen“
  if (t.length >= 3) {
    const i = compact.indexOf(t)
    if (i >= 0) {
      let pos = 0
      for (const w of ws) {
        if (pos === i) return 80
        pos += w.length
      }
      if (t.length >= 4) return 55
    }
  }
  if (fuzzy && t.length >= 4) {
    const max = t.length >= 8 ? 2 : 1
    for (const w of ws) {
      // Präfix des Wortes in passender Länge vergleichen („augstin“ ~ „augustiner“)
      const cand = w.length > t.length + max ? w.slice(0, t.length) : w
      if (dist(t, cand, max) <= max) return 40
    }
  }
  return 0
}

export interface BeerHit {
  beer: IndexBeer
  score: number
}

export interface BreweryGroup {
  brewery: IndexBrewery | null
  /** passende Biere, beste zuerst */
  hits: BeerHit[]
  score: number
  /** Brauerei selbst passt zur Suche (dann lohnt „alle Biere“) */
  breweryMatch: boolean
}

function scoreBeer(b: IndexBeer, tokens: string[], whole: string, fuzzy: boolean): number {
  let total = 0
  let ok = true
  for (const t of tokens) {
    const n = matchWords(t, b.words, b.compact, fuzzy)
    const br = b.brewery ? matchWords(t, b.brewery.words, b.brewery.compact, fuzzy) * 0.8 : 0
    const st = matchWords(t, b.styleWords, b.styleWords.join(''), false) * 0.7
    const s = Math.max(n, br, st)
    if (!s) {
      ok = false
      break
    }
    total += s
  }
  if (!ok) {
    // ganze Eingabe ohne Leerzeichen („alt bier“ → „altbier“)
    if (tokens.length < 2 || whole.length < 4) return 0
    const n = matchWords(whole, b.words, b.compact, false)
    const st = matchWords(whole, b.styleWords, b.styleWords.join(''), false) * 0.7
    const s = Math.max(n, st)
    if (!s) return 0
    total = s * tokens.length
  }
  if (b.compact.startsWith(whole)) total += 25
  if (b.trust === 'verified') total += 4
  if (b.image_url) total += 2
  return total - Math.min(b.compact.length, 40) * 0.15
}

export function searchIndex(
  idx: SearchIndex,
  query: string,
  opts: { drunk?: Set<string>; maxGroups?: number } = {},
): BreweryGroup[] {
  const tokens = words(query)
  if (!tokens.length) return []
  const whole = tokens.join('')
  const drunk = opts.drunk ?? new Set<string>()

  const run = (fuzzy: boolean) => {
    const hits: BeerHit[] = []
    for (const b of idx.beers) {
      let s = scoreBeer(b, tokens, whole, fuzzy)
      if (s > 0) {
        if (drunk.has(b.id)) s += 12 // schon getrunken → oft gesucht für „nochmal“
        hits.push({ beer: b, score: s })
      }
    }
    return hits
  }
  let hits = run(false)
  if (hits.length < 5) {
    const seen = new Set(hits.map((h) => h.beer.id))
    for (const h of run(true)) if (!seen.has(h.beer.id)) hits.push({ ...h, score: h.score - 30 })
  }

  // Brauereien, deren Name passt (auch ohne passende Biere – z. B. um dort ein Bier anzulegen)
  const breweryScore = new Map<string, number>()
  for (const br of idx.breweries.values()) {
    let total = 0
    for (const t of tokens) {
      const s = matchWords(t, br.words, br.compact, hits.length < 5)
      if (!s) {
        total = 0
        break
      }
      total += s
    }
    if (!total && tokens.length > 1 && whole.length >= 4) total = matchWords(whole, br.words, br.compact, false) * tokens.length
    if (total) breweryScore.set(br.id, total)
  }

  const groups = new Map<string, BreweryGroup>()
  for (const h of hits.sort((a, b) => b.score - a.score)) {
    const key = h.beer.brewery_id ?? `-${h.beer.id}`
    let g = groups.get(key)
    if (!g) {
      g = { brewery: h.beer.brewery, hits: [], score: h.score, breweryMatch: breweryScore.has(key) }
      groups.set(key, g)
    }
    g.hits.push(h)
  }
  for (const [id, s] of breweryScore) {
    if (!groups.has(id)) {
      const br = idx.breweries.get(id)!
      groups.set(id, { brewery: br, hits: [], score: s - 20, breweryMatch: true })
    }
  }
  // Gruppe zählt nach bestem Treffer, mit kleinem Bonus für mehrere Treffer
  const out = [...groups.values()]
  for (const g of out) {
    g.score += Math.min(g.hits.length, 5) * 2 + (g.breweryMatch ? 10 : 0)
  }
  out.sort((a, b) => b.score - a.score)
  return out.slice(0, opts.maxGroups ?? 60)
}

// ------------------------------------------------------------------------------------ Umwandeln

export function toBrewery(b: IndexBrewery): Brewery {
  return {
    id: b.id,
    name: b.name,
    city: b.city,
    state: null,
    country: null,
    lat: null,
    lng: null,
    website: null,
    logo_url: b.logo_url,
    trust: b.trust,
  }
}

export function toBeer(b: IndexBeer): Beer {
  return {
    id: b.id,
    brewery_id: b.brewery_id,
    name: b.name,
    style: b.style,
    abv: b.abv,
    image_url: b.image_url,
    trust: b.trust,
    brewery: b.brewery ? toBrewery(b.brewery) : null,
  }
}

// ------------------------------------------------------------------------------------ React


/** Aktueller Suchindex (lädt bei Bedarf, aktualisiert sich bei neuem Stand) */
export function useSearchIndex(): { index: SearchIndex | null; error: string | null } {
  const [index, setIndex] = useState<SearchIndex | null>(current)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const off = onIndex(setIndex)
    loadIndex()
      .then(setIndex)
      .catch((e: Error) => setError(e.message))
    return () => {
      off()
    }
  }, [])
  return { index, error }
}
