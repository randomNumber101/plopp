import { supabase } from './supabase'
import type { Beer, Brewery, BreweryProgress, Checkin, OffSuggestion } from './types'

const BEER_SELECT = '*, brewery:breweries(*)'

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message)
  return res.data as T
}

// ---------------------------------------------------------------- Katalog

export async function findBeerByEan(ean: string): Promise<Beer | null> {
  const res = await supabase
    .from('beer_barcodes')
    .select(`beer:beers(${BEER_SELECT})`)
    .eq('ean', ean)
    .maybeSingle()
  const row = check(res) as unknown as { beer: Beer } | null
  return row?.beer ?? null
}

export async function getBeer(id: string): Promise<Beer> {
  return check(await supabase.from('beers').select(BEER_SELECT).eq('id', id).single()) as Beer
}

export async function searchBeers(q: string, limit = 30): Promise<Beer[]> {
  const term = q.trim()
  if (term) {
    // Suche über Bier- UND Brauereinamen (Datenbankfunktion); Fallback: nur Biername
    const res = await supabase.rpc('search_beers', { q: term }).select(BEER_SELECT).limit(limit)
    if (!res.error) return res.data as unknown as Beer[]
  }
  let query = supabase.from('beers').select(BEER_SELECT).order('name').limit(limit)
  if (term) query = query.ilike('name', `%${term}%`)
  return check(await query) as Beer[]
}

export async function beersOfBrewery(breweryId: string): Promise<Beer[]> {
  return check(
    await supabase.from('beers').select(BEER_SELECT).eq('brewery_id', breweryId).order('name'),
  ) as Beer[]
}

export async function getBrewery(id: string): Promise<Brewery> {
  return check(await supabase.from('breweries').select('*').eq('id', id).single()) as Brewery
}

export async function searchBreweries(q: string, limit = 10): Promise<Brewery[]> {
  let query = supabase.from('breweries').select('*').order('name').limit(limit)
  if (q.trim()) query = query.ilike('name', `%${q.trim()}%`)
  return check(await query) as Brewery[]
}

export async function breweryProgress(): Promise<BreweryProgress[]> {
  return check(await supabase.rpc('brewery_progress')) as BreweryProgress[]
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

export async function updateBrewery(id: string, patch: Partial<Brewery>): Promise<void> {
  if (patch.city !== undefined && patch.city) {
    const coords = await geocode(patch.city, patch.country ?? 'Deutschland')
    if (coords) Object.assign(patch, coords)
  }
  check(await supabase.from('breweries').update(patch).eq('id', id))
}

export async function createBeer(b: {
  brewery_id: string | null
  name: string
  style: string | null
  abv: number | null
  image_url: string | null
  source?: string
}): Promise<Beer> {
  return check(await supabase.from('beers').insert(b).select(BEER_SELECT).single()) as Beer
}

export async function updateBeer(id: string, patch: Partial<Beer>): Promise<void> {
  check(await supabase.from('beers').update(patch).eq('id', id))
}

export async function addBarcode(ean: string, beerId: string): Promise<void> {
  const res = await supabase.from('beer_barcodes').insert({ ean, beer_id: beerId })
  // Barcode schon vorhanden → ignorieren
  if (res.error && !res.error.message.includes('duplicate')) throw new Error(res.error.message)
}

// ---------------------------------------------------------------- Persönlich

export async function addCheckin(beerId: string, rating: number | null, note: string | null, drunkAt?: string) {
  check(
    await supabase
      .from('checkins')
      .insert({ beer_id: beerId, rating, note: note || null, ...(drunkAt ? { drunk_at: drunkAt } : {}) }),
  )
  // getrunken → von der Merkliste nehmen
  await supabase.from('wishlist').delete().eq('beer_id', beerId)
}

export async function deleteCheckin(id: string) {
  check(await supabase.from('checkins').delete().eq('id', id))
}

export async function myCheckins(): Promise<Checkin[]> {
  return check(
    await supabase
      .from('checkins')
      .select(`*, beer:beers(${BEER_SELECT})`)
      .order('drunk_at', { ascending: false }),
  ) as Checkin[]
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
  ) as unknown as { beer: Beer }[]
  return rows.map((r) => r.beer)
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
