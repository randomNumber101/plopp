export interface Brewery {
  id: string
  name: string
  city: string | null
  state: string | null
  country: string | null
  lat: number | null
  lng: number | null
  website: string | null
  logo_url?: string | null
  source?: string
  trust?: Trust
  brewery_type?: BreweryType | null
  region?: string | null
  district?: string | null
  founded?: string | null
  geo_precision?: string | null
  parent_id?: string | null
  street?: string | null
  postcode?: string | null
}

export type Trust = 'verified' | 'unverified' | 'user'
export type BreweryType = 'brauerei' | 'gasthausbrauerei' | 'kommunbrauhaus' | 'museumsbrauerei' | 'marke'

export const BREWERY_TYPES: Record<BreweryType, string> = {
  brauerei: 'Brauerei',
  gasthausbrauerei: 'Gasthausbrauerei',
  kommunbrauhaus: 'Kommunbrauhaus',
  museumsbrauerei: 'Museumsbrauerei',
  marke: 'Marke (Brauerei unbekannt)',
}

export interface Beer {
  id: string
  brewery_id: string | null
  name: string
  style: string | null
  abv: number | null
  image_url: string | null
  trust?: Trust
  brewery?: Brewery | null
  sources?: Record<string, unknown> | null
}

export interface Checkin {
  id: string
  beer_id: string
  drunk_at: string
  rating: number | null
  note: string | null
  beer?: Beer
}

export interface BreweryProgress {
  id: string
  name: string
  city: string | null
  state: string | null
  country: string | null
  lat: number | null
  lng: number | null
  logo_url?: string | null
  image_url?: string | null
  trust?: Trust
  brewery_type?: BreweryType | null
  parent_id?: string | null
  total: number
  drunk: number
  wished?: number
}

/** Vorschlag aus Open Food Facts */
export interface OffSuggestion {
  name: string
  brand: string
  imageUrl: string | null
  abv: number | null
}

export const STYLES = [
  'Pils', 'Helles', 'Export', 'Lager', 'Märzen', 'Kellerbier', 'Zwickel',
  'Weizen', 'Hefeweizen', 'Kristallweizen', 'Dunkles Weizen', 'Weizenbock',
  'Dunkel', 'Schwarzbier', 'Bock', 'Doppelbock', 'Altbier', 'Kölsch',
  'Rauchbier', 'Radler', 'Alkoholfrei', 'IPA', 'Pale Ale', 'Stout', 'Porter',
  'Sour', 'Sonstiges',
]

export const STATES = [
  'Baden-Württemberg', 'Bayern', 'Berlin', 'Brandenburg', 'Bremen', 'Hamburg',
  'Hessen', 'Mecklenburg-Vorpommern', 'Niedersachsen', 'Nordrhein-Westfalen',
  'Rheinland-Pfalz', 'Saarland', 'Sachsen', 'Sachsen-Anhalt',
  'Schleswig-Holstein', 'Thüringen',
]
