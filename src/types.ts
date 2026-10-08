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
}

export interface Beer {
  id: string
  brewery_id: string | null
  name: string
  style: string | null
  abv: number | null
  image_url: string | null
  brewery?: Brewery | null
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
