/** Vorbelegung für das „Neues Bier“-Formular (vom Scanner, Katalog oder einer Brauerei-Seite) */
export interface NewBeerPrefill {
  ean?: string
  name?: string
  brand?: string
  breweryId?: string
  imageUrl?: string | null
  abv?: number | null
  fromOff?: boolean
}

let prefill: NewBeerPrefill = {}

export function setPrefill(p: NewBeerPrefill) {
  prefill = p
}

export function takePrefill(): NewBeerPrefill {
  const p = prefill
  prefill = {}
  return p
}
