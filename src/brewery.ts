const SKIP =
  /^(brauerei|privatbrauerei|bierbrauerei|familienbrauerei|landbrauerei|brauhaus|bräu|brau|gmbh|co|kg|ag|und|&|die|der|das|zum|zur)$/i

/** Zwei Buchstaben als Ersatz-Logo, z. B. „Krombacher Brauerei“ → „KR“, „Uerige Obergärige“ → „UO“ */
export function initials(name: string) {
  const words = name.split(/[\s\-–/.,]+/).filter((w) => w && !SKIP.test(w))
  const w = words.length ? words : name.split(/\s+/)
  return ((w[0]?.[0] ?? '') + (w[1]?.[0] ?? w[0]?.[1] ?? '')).toUpperCase()
}
