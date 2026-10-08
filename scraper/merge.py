"""Führt Wikidata und Open Food Facts zu einem Katalog zusammen."""

from __future__ import annotations

from collections import Counter, defaultdict

from .util import clean_beer_name, guess_style, key, tokens


class BreweryIndex:
    """Findet zu einem Markennamen (z. B. 'Krombacher') die passende Brauerei."""

    def __init__(self, breweries: list[dict]):
        self.exact: dict[str, list[str]] = defaultdict(list)
        self.by_first: dict[str, list[tuple[list[str], str]]] = defaultdict(list)
        for b in breweries:
            k = key(b["name"])
            if not k:
                continue
            self.exact[k].append(b["ext_id"])
            t = k.split()
            self.by_first[t[0]].append((t, b["ext_id"]))

    def find(self, brand: str) -> str | None:
        k = key(brand)
        if not k:
            return None
        hits = self.exact.get(k, [])
        if len(hits) == 1:
            return hits[0]
        if len(hits) > 1:
            return None  # mehrdeutig
        bt = k.split()
        if len(bt[0]) < 4:
            return None
        # Alle Wörter der Marke kommen im Brauereinamen vor, erstes Wort gleich
        cands = {ext for t, ext in self.by_first.get(bt[0], []) if set(bt) <= set(t)}
        if len(cands) == 1:
            return cands.pop()
        return None


def build(wd_breweries: list[dict], wd_beers: list[dict], off_products: list[dict]):
    """Gibt (breweries, beers, stats) zurück.

    breweries: Liste von Dicts mit ext_id, name, city, state, country, lat, lng, website, source
    beers:     Liste von Dicts mit ext_id, brewery_ext, name, style, abv, image_url, source, eans
    """
    stats: dict = {}
    breweries = {b["ext_id"]: dict(b) for b in wd_breweries}
    index = BreweryIndex(list(breweries.values()))

    beers: dict[str, dict] = {}

    def add_beer(brewery_ext: str, name: str, style, abv, image, source, eans):
        nk = key(name)
        if not nk:
            return
        ext = f"beer:{brewery_ext}:{nk}"
        b = beers.get(ext)
        if not b:
            b = beers[ext] = {
                "ext_id": ext, "brewery_ext": brewery_ext, "name": name, "style": style,
                "abv": abv, "image_url": image, "source": source, "eans": set(),
            }
        else:
            b["style"] = b["style"] or style
            b["abv"] = b["abv"] if b["abv"] is not None else abv
            b["image_url"] = b["image_url"] or image
            if source not in b["source"].split("+"):
                b["source"] += f"+{source}"
        b["eans"].update(eans)

    for wb in wd_beers:
        add_beer(wb["brewery_ext"], wb["name"], wb["style"], wb["abv"], None, "wikidata", wb["eans"])

    matched = unmatched = 0
    unmatched_brands: Counter = Counter()
    brand_cache: dict[str, str] = {}
    for p in off_products:
        bk = key(p["brand"])
        if not bk:
            continue
        ext = brand_cache.get(bk)
        if ext is None:
            ext = index.find(p["brand"])
            if ext is None:
                ext = f"off-brand:{bk.replace(' ', '-')}"
                if ext not in breweries:
                    breweries[ext] = {
                        "ext_id": ext, "name": p["brand"].strip(), "city": None, "state": None,
                        "country": None, "lat": None, "lng": None, "website": None, "logo_url": None,
                        "source": "off",
                    }
            brand_cache[bk] = ext
        if ext.startswith("off-brand:"):
            unmatched += 1
            unmatched_brands[p["brand"].strip()] += 1
        else:
            matched += 1
        brewery_name = breweries[ext]["name"]
        brand_for_name = p["brand"] if tokens(p["brand"]) else brewery_name
        name = clean_beer_name(p["name"], brand_for_name)
        style = guess_style(name, p["categories"])
        add_beer(ext, name, style, p["abv"], p["image_url"], "off", {p["ean"]})

    # Ein Barcode gehört genau zu einem Bier
    seen: set[str] = set()
    for b in beers.values():
        b["eans"] = {e for e in b["eans"] if e not in seen}
        seen |= b["eans"]

    # Brauereien ohne Biere aus OFF-Marken entfernen (gibt es nicht, aber sicher ist sicher)
    used = {b["brewery_ext"] for b in beers.values()}
    breweries = {k: v for k, v in breweries.items() if not k.startswith("off-brand:") or k in used}

    stats.update(
        wd_breweries=len(wd_breweries),
        wd_breweries_with_coords=sum(1 for b in wd_breweries if b["lat"] is not None),
        wd_beers=len(wd_beers),
        off_products=len(off_products),
        off_matched=matched,
        off_unmatched=unmatched,
        top_unmatched_brands=unmatched_brands.most_common(40),
        breweries_total=len(breweries),
        beers_total=len(beers),
        barcodes_total=sum(len(b["eans"]) for b in beers.values()),
    )
    return list(breweries.values()), list(beers.values()), stats
