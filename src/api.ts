import { supabase } from './supabase'
import { clearIndex, refreshIndex } from './search'
import type { Beer, Brewery, BreweryHideReason, BreweryProgress, Checkin, HideReason, OffSuggestion, Suggestion } from './types'
import { codeVariants } from './scanner'

const BEER_SELECT = '*, brewery:breweries(*)'

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message)
  return res.data as T
}

// ---------------------------------------------------------------- Runde & Änderungen der Runde
//
// Änderungen am Katalog gelten nur für die eigene Runde (du + eingeladene Freunde). Sie liegen in
// circle_overrides und werden hier über die Katalogdaten gelegt. Gleichzeitig entsteht ein Vorschlag
// (catalog_suggestions), über den ein Admin entscheidet.

type Overlay = { beer: Map<string, Record<string, unknown>>; brewery: Map<string, Record<string, unknown>> }
let overlayPromise: Promise<Overlay> | null = null

function loadOverlay(): Promise<Overlay> {
  overlayPromise ??= (async () => {
    const o: Overlay = { beer: new Map(), brewery: new Map() }
    const res = await supabase.from('circle_overrides').select('kind, target_id, data')
    if (!res.error) {
      for (const r of res.data as { kind: 'beer' | 'brewery'; target_id: string; data: Record<string, unknown> }[]) {
        o[r.kind].set(r.target_id, r.data)
      }
    }
    return o
  })().catch((e) => {
    overlayPromise = null
    throw e
  })
  return overlayPromise
}

function invalidateOverlay() {
  overlayPromise = null
  refreshIndex()
}

/** Nach Kontowechsel: Runden-Änderungen neu laden */
export function resetSessionCaches() {
  overlayPromise = null
  clearIndex()
}

const BEER_FIELDS = ['name', 'style', 'abv'] as const
const BREWERY_FIELDS = ['name', 'city', 'state', 'country', 'website', 'lat', 'lng'] as const

function applyBrewery<T extends Brewery | null | undefined>(b: T, o: Overlay): T {
  if (!b) return b
  const d = o.brewery.get(b.id)
  if (!d) return b
  const x: Brewery = { ...b }
  let edited = false
  for (const f of BREWERY_FIELDS)
    if (f in d) {
      ;(x as unknown as Record<string, unknown>)[f] = d[f]
      edited = true
    }
  if ('hidden_at' in d) {
    x.hidden_at = (d.hidden_at as string | null) ?? null
    x.hidden_reason = (d.hidden_reason as string | null) ?? null
    x._hiddenInCircle = true
  }
  x._edited = edited
  return x as T
}

function applyBeer(b: Beer, o: Overlay): Beer {
  const d = o.beer.get(b.id)
  let x = b
  if (d) {
    x = { ...b }
    let edited = false
    for (const f of BEER_FIELDS)
      if (f in d) {
        ;(x as unknown as Record<string, unknown>)[f] = d[f]
        edited = true
      }
    if ('hidden_at' in d) {
      x.hidden_at = (d.hidden_at as string | null) ?? null
      x.hidden_reason = (d.hidden_reason as Beer['hidden_reason']) ?? null
      x._hiddenInCircle = true
    }
    x._edited = edited
  }
  if (x.brewery) x = { ...x, brewery: applyBrewery(x.brewery, o) }
  return x
}

async function overlayBeers(list: Beer[]): Promise<Beer[]> {
  const o = await loadOverlay()
  return list.map((b) => applyBeer(b, o))
}

/** Beim Start: Konto ohne Runde bekommt eine eigene (Gründerkonto) */
export async function ensureCircle() {
  await supabase.rpc('ensure_circle')
}

export async function isAdmin(): Promise<boolean> {
  const res = await supabase.rpc('is_admin')
  return !res.error && res.data === true
}

// ---------------------------------------------------------------- Katalog

export async function findBeerByEan(ean: string): Promise<Beer | null> {
  // auch andere Schreibweisen finden (UPC-A mit/ohne führende 0); eigene Zuordnung der Runde zuerst
  const res = await supabase
    .from('beer_barcodes')
    .select(`circle_id, beer:beers(${BEER_SELECT})`)
    .in('ean', codeVariants(ean))
    .limit(5)
  const rows = (check(res) as unknown as { circle_id: string | null; beer: Beer | null }[] | null) ?? []
  rows.sort((a, b) => Number(!a.circle_id) - Number(!b.circle_id))
  const beer = rows.find((r) => r.beer)?.beer
  return beer ? (await overlayBeers([beer]))[0] : null
}

export async function getBeer(id: string): Promise<Beer> {
  const b = check(await supabase.from('beers').select(BEER_SELECT).eq('id', id).single()) as Beer
  return (await overlayBeers([b]))[0]
}

export async function searchBeers(q: string, limit = 30): Promise<Beer[]> {
  const term = q.trim()
  if (term) {
    // Suche über Bier- UND Brauereinamen (Datenbankfunktion, kennt die Änderungen der Runde); Fallback: nur Biername
    const res = await supabase.rpc('search_beers', { q: term }).select(BEER_SELECT).limit(limit)
    if (!res.error) return overlayBeers(res.data as unknown as Beer[])
  }
  let query = supabase.from('beers').select(BEER_SELECT).order('name').limit(limit * 2)
  if (term) query = query.ilike('name', `%${term}%`)
  return (await overlayBeers(check(await query) as Beer[])).filter((b) => !b.hidden_at).slice(0, limit)
}

async function allBeersOfBrewery(breweryId: string): Promise<Beer[]> {
  const rows = check(await supabase.from('beers').select(BEER_SELECT).eq('brewery_id', breweryId).order('name')) as Beer[]
  return (await overlayBeers(rows)).sort((a, b) => a.name.localeCompare(b.name, 'de'))
}

export async function beersOfBrewery(breweryId: string): Promise<Beer[]> {
  return (await allBeersOfBrewery(breweryId)).filter((b) => !b.hidden_at)
}

export async function hiddenBeersOfBrewery(breweryId: string): Promise<Beer[]> {
  try {
    return (await allBeersOfBrewery(breweryId)).filter((b) => b.hidden_at)
  } catch {
    return []
  }
}

/** Für die eigene Runde ausblenden (Merch, Dubletten …) – zusätzlich als Vorschlag für den Katalog */
export async function hideBeers(ids: string[], reason: HideReason) {
  check(await supabase.rpc('hide_beers', { p_ids: ids, p_reason: reason }))
  invalidateOverlay()
}

export async function unhideBeers(ids: string[]) {
  check(await supabase.rpc('unhide_beers', { p_ids: ids }))
  invalidateOverlay()
}

/** Brauerei für die eigene Runde ausblenden – zusätzlich als Vorschlag für den Katalog */
export async function hideBreweries(ids: string[], reason: BreweryHideReason) {
  check(await supabase.rpc('hide_breweries', { p_ids: ids, p_reason: reason }))
  invalidateOverlay()
}

export async function unhideBreweries(ids: string[]) {
  check(await supabase.rpc('unhide_breweries', { p_ids: ids }))
  invalidateOverlay()
}

export interface HiddenBrewery {
  id: string
  name: string
  city: string | null
  state: string | null
  hidden_reason: string | null
  /** true = im ganzen Katalog ausgeblendet, false = nur in deiner Runde */
  in_catalog: boolean
}

export async function hiddenBreweries(): Promise<HiddenBrewery[]> {
  return check(await supabase.rpc('hidden_breweries')) as HiddenBrewery[]
}

export async function getBrewery(id: string): Promise<Brewery> {
  const b = check(await supabase.from('breweries').select('*').eq('id', id).single()) as Brewery
  return applyBrewery(b, await loadOverlay())
}

export async function sitesOfBrewery(id: string): Promise<Brewery[]> {
  const res = await supabase.from('breweries').select('*').eq('parent_id', id).order('name')
  if (res.error) return []
  const o = await loadOverlay()
  return (res.data as Brewery[]).map((b) => applyBrewery(b, o))
}

export async function searchBreweries(q: string, limit = 10): Promise<Brewery[]> {
  let query = supabase.from('breweries').select('*').order('trust', { ascending: false }).order('name').limit(limit)
  if (q.trim()) query = query.ilike('name', `%${q.trim()}%`)
  const o = await loadOverlay()
  return (check(await query) as Brewery[]).map((b) => applyBrewery(b, o))
}

/** Supabase liefert pro Anfrage höchstens 1000 Zeilen – daher seitenweise laden */
export async function breweryProgress(): Promise<BreweryProgress[]> {
  const out: BreweryProgress[] = []
  const seen = new Set<string>()
  const page = 1000
  for (let from = 0; from < 50000; ) {
    const rows = check(await supabase.rpc('brewery_progress').range(from, from + page - 1)) as BreweryProgress[]
    if (!rows.length) break
    for (const r of rows) {
      if (!seen.has(r.id)) {
        seen.add(r.id)
        out.push(r)
      }
    }
    from += rows.length
    if (rows.length < page) break
  }
  return out
}

export async function createBrewery(b: {
  name: string
  city: string | null
  state: string | null
  country: string
}): Promise<Brewery> {
  const coords = b.city ? await geocode(b.city, b.country) : null
  return check(
    await supabase
      .from('breweries')
      .insert({ ...b, lat: coords?.lat ?? null, lng: coords?.lng ?? null })
      .select('*')
      .single(),
  ) as Brewery
}

/** Brauerei ändern – gilt für die eigene Runde und geht als Vorschlag an den Katalog */
export async function updateBrewery(id: string, patch: Partial<Brewery>): Promise<void> {
  if (patch.city !== undefined && patch.city) {
    const coords = await geocode(patch.city, patch.country ?? 'Deutschland')
    if (coords) Object.assign(patch, coords)
  }
  const changes = Object.fromEntries(
    Object.entries(patch).filter(([k]) => (BREWERY_FIELDS as readonly string[]).includes(k)),
  )
  check(await supabase.rpc('edit_brewery', { p_brewery: id, p_changes: changes }))
  invalidateOverlay()
}

export async function createBeer(b: {
  brewery_id: string | null
  name: string
  style: string | null
  abv: number | null
  image_url: string | null
  source?: string
}): Promise<Beer> {
  const beer = check(await supabase.from('beers').insert(b).select(BEER_SELECT).single()) as Beer
  refreshIndex()
  return beer
}

/** Bier ändern – gilt für die eigene Runde und geht als Vorschlag an den Katalog */
export async function updateBeer(id: string, patch: Partial<Beer>): Promise<void> {
  const changes = Object.fromEntries(Object.entries(patch).filter(([k]) => (BEER_FIELDS as readonly string[]).includes(k)))
  check(await supabase.rpc('edit_beer', { p_beer: id, p_changes: changes }))
  invalidateOverlay()
}

export async function addBarcode(ean: string, beerId: string): Promise<void> {
  const res = await supabase.from('beer_barcodes').insert({ ean, beer_id: beerId })
  // Barcode schon vorhanden → ignorieren
  if (res.error && !res.error.message.includes('duplicate')) throw new Error(res.error.message)
}

// ---------------------------------------------------------------- Persönlich

/** Check-in anlegen → ID (für „Rückgängig“ und nachträgliches Bewerten) */
export async function addCheckin(
  beerId: string,
  rating: number | null = null,
  note: string | null = null,
  drunkAt?: string,
): Promise<string> {
  const row = check(
    await supabase
      .from('checkins')
      .insert({ beer_id: beerId, rating, note: note || null, ...(drunkAt ? { drunk_at: drunkAt } : {}) })
      .select('id')
      .single(),
  ) as { id: string }
  // getrunken → von der Merkliste nehmen
  await supabase.from('wishlist').delete().eq('beer_id', beerId)
  return row.id
}

export async function updateCheckin(id: string, patch: Partial<Pick<Checkin, 'rating' | 'note' | 'drunk_at'>>) {
  check(await supabase.from('checkins').update(patch).eq('id', id))
}

export async function deleteCheckin(id: string) {
  check(await supabase.from('checkins').delete().eq('id', id))
}

/** Gelöschten Check-in wiederherstellen (Rückgängig) */
export async function restoreCheckin(c: Checkin) {
  check(
    await supabase
      .from('checkins')
      .insert({ id: c.id, beer_id: c.beer_id, drunk_at: c.drunk_at, rating: c.rating, note: c.note }),
  )
}

export async function myCheckins(): Promise<Checkin[]> {
  const rows = check(
    await supabase
      .from('checkins')
      .select(`*, beer:beers(${BEER_SELECT})`)
      .order('drunk_at', { ascending: false }),
  ) as Checkin[]
  const o = await loadOverlay()
  return rows.map((c) => (c.beer ? { ...c, beer: applyBeer(c.beer, o) } : c))
}

export async function checkinsForBeer(beerId: string): Promise<Checkin[]> {
  return check(
    await supabase
      .from('checkins')
      .select('*')
      .eq('beer_id', beerId)
      .order('drunk_at', { ascending: false }),
  ) as Checkin[]
}

export async function drunkBeerIds(): Promise<Set<string>> {
  const rows = check(await supabase.from('checkins').select('beer_id')) as { beer_id: string }[]
  return new Set(rows.map((r) => r.beer_id))
}

export async function myWishlist(): Promise<Beer[]> {
  const rows = check(
    await supabase
      .from('wishlist')
      .select(`beer:beers(${BEER_SELECT})`)
      .order('created_at', { ascending: false }),
  ) as unknown as { beer: Beer | null }[]
  return overlayBeers(rows.map((r) => r.beer).filter((b): b is Beer => !!b))
}

export async function wishlistIds(): Promise<Set<string>> {
  const rows = check(await supabase.from('wishlist').select('beer_id')) as { beer_id: string }[]
  return new Set(rows.map((r) => r.beer_id))
}

export async function setWishlist(beerId: string, on: boolean) {
  if (on) check(await supabase.from('wishlist').upsert({ beer_id: beerId }, { ignoreDuplicates: true }))
  else check(await supabase.from('wishlist').delete().eq('beer_id', beerId))
}

export async function exportAll() {
  const [checkins, wishlist] = await Promise.all([myCheckins(), myWishlist()])
  return { exportiert_am: new Date().toISOString(), checkins, merkliste: wishlist }
}

// ---------------------------------------------------------------- Einladungen

export interface Invite {
  code: string
  created_at: string
  expires_at: string
  used_email: string | null
  used_at: string | null
}

export type InviteStatus = 'ok' | 'used' | 'expired' | 'unknown'

export function inviteLink(code: string) {
  return `${location.origin}${location.pathname}#/invite/${code}`
}

export async function createInvite(): Promise<Invite> {
  return check(await supabase.rpc('create_invite').single()) as Invite
}

export async function myInvites(): Promise<Invite[]> {
  return check(
    await supabase
      .from('invites')
      .select('code, created_at, expires_at, used_email, used_at')
      .order('created_at', { ascending: false })
      .limit(50),
  ) as Invite[]
}

export async function deleteInvite(code: string) {
  check(await supabase.from('invites').delete().eq('code', code))
}

export async function inviteStatus(code: string): Promise<InviteStatus> {
  const res = await supabase.rpc('invite_status', { invite_code: code })
  if (res.error) throw new Error(res.error.message)
  return res.data as InviteStatus
}

/** Link über das Teilen-Menü des Handys verschicken, sonst in die Zwischenablage */
export async function shareInvite(code: string): Promise<'shared' | 'copied' | 'cancelled'> {
  const url = inviteLink(code)
  const text = 'Komm zu Plopp!, meinem Biertracker! Mit diesem Link kannst du dir ein Konto anlegen (14 Tage gültig, nur einmal nutzbar):'
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Einladung zu Plopp! – Der Biertracker', text, url })
      return 'shared'
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled'
    }
  }
  try {
    await navigator.clipboard.writeText(url)
  } catch {
    window.prompt('Link kopieren:', url)
  }
  return 'copied'
}

// ---------------------------------------------------------------- Änderungsvorschläge

/** Vorschläge der eigenen Runde – Admins sehen alle */
export async function listSuggestions(status: 'offen' | 'alle' = 'offen', limit = 200): Promise<Suggestion[]> {
  let q = supabase.from('catalog_suggestions').select('*').order('created_at', { ascending: false }).limit(limit)
  if (status === 'offen') q = q.eq('status', 'offen')
  return check(await q) as Suggestion[]
}

export async function applySuggestion(id: number): Promise<string> {
  const res = await supabase.rpc('apply_suggestion', { p_id: id })
  if (res.error) throw new Error(res.error.message)
  return res.data as string
}

export async function rejectSuggestion(id: number, note?: string) {
  check(await supabase.rpc('reject_suggestion', { p_id: id, p_note: note ?? null }))
}

// ---------------------------------------------------------------- Externe Dienste

/** Gebindeangaben aus Produktnamen entfernen: „Pils 0,5l Dose“ → „Pils“ */
export function cleanProductName(name: string) {
  return name
    .replace(/\b\d+\s*[x×]\s*\d+([.,]\d+)?\s*(l|ml|cl|liter)\b/gi, ' ')
    .replace(/\b\d+([.,]\d+)?\s*(l|ml|cl|liter)\b/gi, ' ')
    .replace(/\b(dose|dosen|flasche|flaschen|glasflasche|kasten|kiste|mehrweg|einweg|pfand|sixpack|träger|tray|bügelflasche|longneck)\b/gi, ' ')
    .replace(/\b\d+\s*er(\s*-?\s*pack)?\b/gi, ' ')
    .replace(/\(\s*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[-–,.;:/\s]+|[-–,.;:/\s]+$/g, '')
}

/** Open Food Facts: Produkt zu einem Barcode nachschlagen */
export async function offLookup(ean: string): Promise<OffSuggestion | null> {
  try {
    const url =
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(ean)}.json` +
      '?fields=product_name,product_name_de,brands,image_front_small_url,image_front_url,nutriments'
    const res = await fetch(url)
    if (!res.ok) return null
    const json = await res.json()
    if (json.status !== 1 || !json.product) return null
    const p = json.product
    const alc = Number(p.nutriments?.alcohol_100g ?? p.nutriments?.alcohol)
    return {
      name: cleanProductName(p.product_name_de || p.product_name || ''),
      brand: String(p.brands || '').split(',')[0].trim(),
      imageUrl: p.image_front_url || p.image_front_small_url || null,
      abv: Number.isFinite(alc) && alc > 0 && alc < 70 ? Math.round(alc * 10) / 10 : null,
    }
  } catch {
    return null
  }
}

/** Nominatim (OpenStreetMap): Ort → Koordinaten */
export async function geocode(city: string, country: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const params = new URLSearchParams({
      format: 'json',
      limit: '1',
      city,
      country,
      'accept-language': 'de',
    })
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`)
    if (!res.ok) return null
    const json = (await res.json()) as { lat: string; lon: string }[]
    if (!json.length) return null
    return { lat: Number(json[0].lat), lng: Number(json[0].lon) }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- Katalog-Pflege (Admin)

export interface CatalogRun {
  id: number
  started_at: string
  updated_at: string
  finished_at: string | null
  status: 'läuft' | 'fertig' | 'fehler' | 'abgebrochen'
  step: number
  steps: number
  phase: string | null
  done: number | null
  total: number | null
  detail: string | null
  stats: Record<string, unknown> | null
  run_url: string | null
}

export async function catalogRuns(limit = 5): Promise<CatalogRun[]> {
  const res = await supabase.from('catalog_runs').select('*').order('started_at', { ascending: false }).limit(limit)
  return res.error ? [] : (res.data as CatalogRun[])
}

export interface UnassignedBrand {
  id: string
  name: string
  beers: number
  examples: string[] | null
  eans: string[] | null
}

export async function unassignedBrands(): Promise<UnassignedBrand[]> {
  const res = await supabase.rpc('unassigned_brands')
  if (res.error) throw new Error(res.error.message)
  return res.data as UnassignedBrand[]
}

/** Marke einer Brauerei zuordnen (target) oder als „keine Brauerei / Handelsmarke“ bestätigen (null) */
export async function assignBrand(brandId: string, target: string | null): Promise<number> {
  const res = await supabase.rpc('assign_brand', { p_brand: brandId, p_target: target })
  if (res.error) throw new Error(res.error.message)
  refreshIndex()
  return res.data as number
}
