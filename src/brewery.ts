const SKIP =
  /^(brauerei|privatbrauerei|bierbrauerei|familienbrauerei|landbrauerei|brauhaus|bräu|brau|gmbh|co|kg|ag|und|&|die|der|das|zum|zur)$/i

/** Zwei Buchstaben als Ersatz-Logo, z. B. „Krombacher Brauerei“ → „KR“, „Uerige Obergärige“ → „UO“ */
export function initials(name: string) {
  const words = name.split(/[\s\-–/.,]+/).filter((w) => w && !SKIP.test(w))
  const w = words.length ? words : name.split(/\s+/)
  return ((w[0]?.[0] ?? '') + (w[1]?.[0] ?? w[0]?.[1] ?? '')).toUpperCase()
}

const GENERIC = /^(brauerei|privatbrauerei|bierbrauerei|familienbrauerei|landbrauerei|stadtbrauerei|klosterbrauerei|schlossbrauerei|brauhaus|brauereigasthof|gasthausbrauerei|hausbrauerei|bräu|brau|bräuhaus|gmbh|co|kg|ag|ohg|e\.?k\.?|&|und|die|der|das|zum|zur|zu|inh\.?)$/i
const norm = (s: string) => s.toLocaleLowerCase('de').replace(/[\u2019'`´]/g, '')

/**
 * Biername ohne vorangestellten Brauereinamen – für Listen auf der Brauerei-Seite:
 * „Baisinger Helles“ bei „Baisinger BierManufaktur“ → „Helles“, „Augustiner Edelstoff“ bei „Augustiner-Bräu Wagner“ → „Edelstoff“.
 * Bleibt nichts Sinnvolles übrig, kommt der volle Name zurück.
 */
export function shortBeerName(beerName: string, breweryName: string | null | undefined): string {
  if (!breweryName) return beerName
  const words = breweryName.split(/[\s\-–/.,]+/).filter((w) => w && !GENERIC.test(w))
  const candidates = new Set<string>()
  for (let k = words.length; k >= 1; k--) candidates.add(words.slice(0, k).join(' '))
  for (const w of words) if (w.length >= 4) candidates.add(w)
  // Herkunftsform: „Warburg“ → „Warburger“, „Aying“ → „Ayinger“
  for (const w of [...candidates]) if (!/er$/i.test(w) && w.length >= 4) candidates.add(`${w}er`)
  const bn = beerName.trim()
  const lower = norm(bn).replace(/-/g, ' ')
  for (const c of [...candidates].sort((a, b) => b.length - a.length)) {
    const cl = norm(c).replace(/-/g, ' ')
    if (lower.startsWith(cl + ' ') || lower.startsWith(cl + 's ')) {
      const rest = bn.slice(lower.startsWith(cl + 's ') ? cl.length + 2 : cl.length + 1).replace(/^[\s\-–:·]+/, '')
      if (rest.length >= 2 && /[a-zäöüß]/i.test(rest)) return rest.charAt(0).toLocaleUpperCase('de') + rest.slice(1)
    }
  }
  return beerName
}
