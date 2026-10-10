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
  /** gesetzt = Eintrag existiert nur in einer Runde (noch nicht im Katalog) */
  circle_id?: string | null
  /** in der eigenen Runde geändert (Vorschlag) */
  _edited?: boolean
  hidden_at?: string | null
  hidden_reason?: string | null
  _hiddenInCircle?: boolean
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
  hidden_at?: string | null
  hidden_reason?: HideReason | null
  circle_id?: string | null
  _edited?: boolean
  /** Ausblenden/Einblenden gilt nur in der eigenen Runde */
  _hiddenInCircle?: boolean
}

export type HideReason = 'kein_bier' | 'doppelt' | 'falsch'
export const HIDE_REASONS: Record<HideReason, string> = {
  kein_bier: 'Kein Bier (Merch, Gutschein, Limo …)',
  doppelt: 'Doppelt vorhanden',
  falsch: 'Falsch / gibt es nicht mehr',
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

export type SuggestionKind =
  | 'beer_edit'
  | 'brewery_edit'
  | 'beer_hide'
  | 'beer_unhide'
  | 'beer_new'
  | 'brewery_new'
  | 'barcode'
  | 'brewery_hide'
  | 'brewery_unhide'

export interface Suggestion {
  id: number
  circle_id: string | null
  created_by: string | null
  created_by_email: string | null
  created_at: string
  updated_at: string
  kind: SuggestionKind
  target_id: string | null
  target_name: string | null
  payload: Record<string, unknown>
  previous: Record<string, unknown>
  status: 'offen' | 'übernommen' | 'abgelehnt' | 'zurückgezogen'
  decided_at: string | null
  note: string | null
}

export const SUGGESTION_KINDS: Record<SuggestionKind, { label: string; icon: string }> = {
  beer_edit: { label: 'Bier geändert', icon: '✏️' },
  brewery_edit: { label: 'Brauerei geändert', icon: '🏭' },
  beer_hide: { label: 'Ausblenden', icon: '🙈' },
  beer_unhide: { label: 'Wieder einblenden', icon: '👀' },
  beer_new: { label: 'Neues Bier', icon: '🍺' },
  brewery_new: { label: 'Neue Brauerei', icon: '🆕' },
  barcode: { label: 'Barcode zugeordnet', icon: '🏷️' },
  brewery_hide: { label: 'Brauerei ausblenden', icon: '🙈' },
  brewery_unhide: { label: 'Brauerei einblenden', icon: '👀' },
}

export type BreweryHideReason = 'keine_brauerei' | 'doppelt' | 'geschlossen'
export const BREWERY_HIDE_REASONS: Record<string, string> = {
  keine_brauerei: 'Keine Brauerei (Händler, Gaststätte …)',
  doppelt: 'Doppelt vorhanden',
  geschlossen: 'Geschlossen / gibt es nicht mehr',
}
