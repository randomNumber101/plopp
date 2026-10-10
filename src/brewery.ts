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

// Wörter, die etwas über das Bier sagen – solche Präfixe nie ausblenden („Weißbier Hell“, „Bio Märzen“)
const BEERISH =
  /^(pils|pilsner|pilsener|hell|helles|dunkel|dunkles|weiß|weiss|weisse|weiße|weizen|hefe|hefeweizen|hefe-weizen|hefeweißbier|weißbier|weissbier|export|bock|bockbier|doppelbock|lager|lagerbier|radler|keller|kellerbier|märzen|zwickel|zwickl|alkoholfrei|alkoholfreies|alkoholfreie|bio|original|urtyp|fest|festbier|natur|naturtrüb|schwarzbier|rauchbier|landbier|vollbier|leicht|light|alt|altbier|kölsch|ipa|pale|stout|porter|ale|craft|premium|spezial|edel|winter|sommer|mai|maibock|weihnachtsbier|bier|das|der|die|unser|unsere|neu|limited|edition|alk|kristall|kristallweizen|schankbier|starkbier|malz|malzbier)$/i
const beerish = (w: string) => w.split(/[-–]/).some((p) => BEERISH.test(p))

/** erstes Wort eines Namens, auch bei Binnenmajuskel („PostWeizen“ → „Post“) */
function firstWord(name: string): string | null {
  const camel = name.match(/^([A-ZÄÖÜ][a-zäöüß]{2,})(?=[A-ZÄÖÜ][a-zäöüß])/)
  if (camel) return camel[1]
  const w = name.trim().split(/\s+/)[0]?.replace(/[-–:'’,.]+$/, '')
  return w && w.length >= 3 && /[a-zäöüß]/i.test(w) ? w : null
}

/**
 * Gemeinsame Präfixe vieler Biere einer Brauerei, meist eine Abwandlung des Brauereinamens oder eine Marke
 * („Förster Pils“, „Förster Hell“, „Förster Dunkel“ → „Förster“). Leer, wenn es keins gibt.
 */
export function commonPrefixes(names: string[]): string[] {
  if (names.length < 2) return []
  const groups = new Map<string, string[]>()
  for (const n of names) {
    const w = firstWord(n)
    if (!w || beerish(w)) continue
    const rest = n.slice(w.length).replace(SEP, '')
    if (rest.length < 2 || !/[a-zäöüß0-9]/i.test(rest)) continue
    const key = norm(w)
    groups.set(key, [...(groups.get(key) ?? []), n])
  }
  const sorted = [...groups.values()].sort((a, b) => b.length - a.length)
  const out: string[] = []
  sorted.forEach((g, i) => {
    const share = g.length / names.length
    const ok = i === 0 ? (g.length >= 3 && share >= 0.3) || (g.length >= 2 && share >= 0.5) : g.length >= 3 && share >= 0.15
    if (!ok) return
    let prefix = firstWord(g[0])!
    // zweites Wort mitnehmen, wenn ALLE Treffer es teilen („Sankt Georgen Pils“, „Sankt Georgen Hell“)
    if (g.length >= 3) {
      const tails = g.map((n) => n.slice(prefix.length).replace(SEP, '').split(/\s+/))
      const s0 = tails[0][0] ?? ''
      if (s0.length >= 3 && !beerish(s0) && tails.every((t) => t.length >= 2 && norm(t[0]) === norm(s0)))
        prefix = `${prefix} ${s0}`
    }
    out.push(prefix)
  })
  return out
}

const SEP = /^[\s\-–:'’·„“"»«]+/

/** Präfix abschneiden, wenn danach noch ein sinnvoller Name übrig bleibt */
function stripPrefix(name: string, prefix: string): string {
  if (!norm(name).startsWith(norm(prefix))) return name
  const after = name.slice(prefix.length)
  // nur an Wortgrenze oder Binnenmajuskel
  if (after && !SEP.test(after) && !/^[A-ZÄÖÜ]/.test(after)) return name
  const rest = after.replace(SEP, '')
  if (rest.length < 2 || !/[a-zäöüß]/i.test(rest)) return name
  return rest.charAt(0).toLocaleUpperCase('de') + rest.slice(1)
}

/**
 * Kurznamen für die Bierliste einer Brauerei: erst den Brauereinamen weglassen, dann Präfixe,
 * die viele Biere der Liste gemeinsam haben.
 */
export function beerNameShortener(names: string[], breweryName: string | null | undefined): (name: string) => string {
  const first = new Map(names.map((n) => [n, shortBeerName(n, breweryName)]))
  const prefixes = commonPrefixes([...first.values()]).sort((a, b) => b.length - a.length)
  return (name: string) => {
    const s = first.get(name) ?? shortBeerName(name, breweryName)
    for (const p of prefixes) {
      const r = stripPrefix(s, p)
      if (r !== s) return r
    }
    return s
  }
}
