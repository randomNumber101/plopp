"""Führt Wikipedia (Rückgrat), Wikidata und Open Food Facts zu einem Katalog zusammen.

Vertrauensstufen:
- verified:   Brauerei steht in der Wikipedia-Liste; Biere aus der Sorten-Spalte (bzw. später von der Website)
              und alles, was eindeutig einem solchen Bier zugeordnet wurde
- unverified: nur aus Wikidata oder Open Food Facts, unscharfe Treffer, Marken ohne Brauerei
"""

from __future__ import annotations

import re
from collections import Counter, defaultdict

from rapidfuzz import fuzz, process

from .enrich import haversine_km, place_city
from .util import STOPWORDS, clean_beer_name, fold, guess_style, key, tokens
from .sites import is_beerish, postprocess
from .web import WEAK_GEO, apply_osm, choose_address
from .offmatch import BreweryLookup, compact, dedupe, is_retailer, match_products, product_name

_BAD_STYLE = re.compile(r"verschied|saison|weitere|u\.\s?a\.|diverse|etc|sowie|wechselnd|spezialit|biere\b|sorten",
                        re.IGNORECASE)


def short_name(name: str) -> str:
    """„Privatbrauerei Gebr. Gatzweiler GmbH“ → „Gebr. Gatzweiler“"""
    words = [w for w in re.split(r"\s+", name) if fold(w).strip(".,&-") not in STOPWORDS and w not in ("&", "-")]
    return " ".join(words) or name


def _slug(s: str) -> str:
    return key(s).replace(" ", "-")[:50]


class AliasIndex:
    """Markenname → Brauerei (ext_id). Mehrere Braustätten eines Unternehmens zählen als eins (Eltern)."""

    def __init__(self, parent_of: dict[str, str], breweries: dict[str, dict] | None = None):
        self.map: dict[str, set[str]] = defaultdict(set)
        self.parent_of = parent_of
        self.trust: dict[str, str] = {}
        self.breweries = breweries or {}

    def add(self, alias: str, ext: str, trust: str):
        k = key(alias)
        if len(k) >= 3:
            self.map[k].add(ext)
            self.trust[ext] = trust

    def _resolve(self, exts: set[str], alias_key: str | None = None) -> str | None:
        top = {self.parent_of.get(e, e) for e in exts}
        if len(top) == 1:
            return top.pop()
        cands = {e for e in top if self.trust.get(e) == "verified"} or top
        # Gleichstand auflösen: eigentliche Brauerei vor Gasthausbrauerei, Wikidata-Objekt, exakter Name
        for rule in (
            lambda e: self.breweries.get(e, {}).get("brewery_type") == "brauerei",
            lambda e: e.startswith("wd:"),
            lambda e: alias_key is not None and key(self.breweries.get(e, {}).get("name", "")) == alias_key,
        ):
            if len(cands) == 1:
                break
            narrowed = {e for e in cands if rule(e)}
            if narrowed:
                cands = narrowed
        return next(iter(cands)) if len(cands) == 1 else None

    def find(self, brand: str) -> tuple[str | None, str]:
        k = key(brand)
        if not k:
            return None, "leer"
        if k in self.map:
            return self._resolve(self.map[k], k), "alias"
        bt = k.split()
        if len(bt[0]) >= 4:
            cands = set()
            for ak, exts in self.map.items():
                at = ak.split()
                if at and at[0] == bt[0] and set(bt) <= set(at):
                    cands |= exts
            if cands:
                r = self._resolve(cands)
                if r:
                    return r, "wortteil"
        if len(k) >= 5:
            hit = process.extractOne(k, list(self.map.keys()), scorer=fuzz.ratio, score_cutoff=92)
            if hit:
                r = self._resolve(self.map[hit[0]])
                if r:
                    return r, "unscharf"
        return None, "kein Treffer"


def brand_word(name: str) -> str:
    """Kurzer Markenname für Biere ohne Marke im Namen: „Brauerei Rittmayer“ → „Rittmayer“."""
    words = [w for w in re.split(r"\s+", short_name(name)) if len(re.sub(r"[^\wäöüß]", "", w.lower())) >= 4]
    return words[0].strip(",.") if words else short_name(name)


def build(wp_entries: list[dict], wd_breweries: list[dict], wd_beers: list[dict], off_products: list[dict],
          brand_overrides: dict[str, str | None] | None = None, osm: list[dict] | None = None,
          crawl=None, geocoder=None, hidden: list[tuple[str, str]] | None = None, obdb: list[dict] | None = None,
          wd_aliases: dict[str, set[str]] | None = None, progress=None):
    """→ (breweries, beers, stats). brand_overrides: Markenschlüssel → ext_id (Zuordnung) bzw. None (ablehnen).
    osm: Objekte aus OpenStreetMap; crawl: Funktion {website: [Brauereien]} → {website: Ergebnis}."""
    brand_overrides = brand_overrides or {}
    stats: dict = {}
    breweries: dict[str, dict] = {}
    parent_of: dict[str, str] = {}

    # ------------------------------------------------------------ 1. Wikipedia-Brauereien (verifiziert)
    for e in wp_entries:
        wd = e.get("wd")
        if wd:
            ext = f"wd:{wd['qid']}"
        else:
            ext = f"wp:{_slug(e['state'] or '')}:{_slug(e['name'])}@{_slug(e.get('place') or '')}"
        if ext in breweries:  # doppelter Eintrag (z. B. in beiden Listen)
            continue
        b = {
            "ext_id": ext, "name": e["name"], "city": place_city(e.get("place")), "state": e.get("state"),
            "country": "Deutschland", "lat": e.get("lat"), "lng": e.get("lng"), "website": e.get("website"),
            "logo_url": e.get("logo_url"), "source": "wikipedia", "trust": "verified",
            "brewery_type": e.get("type") or "brauerei", "region": e.get("region"), "district": e.get("district"),
            "founded": e.get("founded"), "geo_precision": e.get("geo_precision"),
            "parent_ext": f"wd:{e['parent_qid']}" if e.get("parent_qid") else None,
            "sources": {
                "liste": f"wikipedia:{e.get('page')}",
                "wikidata": wd["qid"] if wd else None,
                "koordinaten": e.get("geo_precision"),
                "logo": e.get("logo_source"),
            },
            "aliases": {e["name"], short_name(e["name"]), *(e.get("brands") or [])} | ({wd["label"]} if wd and wd.get("label") else set()),
        }
        breweries[ext] = b
        if b["parent_ext"]:
            parent_of[ext] = b["parent_ext"]
    stats["wp_breweries"] = len(breweries)

    # ------------------------------------------------------------ 2. Weitere Brauereien nur aus Wikidata (ungeprüft)
    # Dubletten (gleiche Brauerei unter anderem Namen/ohne Link in Wikipedia) über Nähe + Namensähnlichkeit erkennen
    wp_by_state: dict[str, list[dict]] = defaultdict(list)
    for b in breweries.values():
        wp_by_state[b["state"] or ""].append(b)

    def duplicate_of(wb: dict) -> dict | None:
        nk = key(wb["name"])
        best, best_score = None, 0
        for b in wp_by_state.get(wb.get("state") or "", []) if wb.get("state") else breweries.values():
            score = fuzz.token_set_ratio(nk, key(b["name"]))
            if score < 75:
                continue
            if wb.get("lat") is not None and b.get("lat") is not None:
                if haversine_km((wb["lat"], wb["lng"]), (b["lat"], b["lng"])) > 3:
                    continue
            elif not (score >= 90 and wb.get("city") and b.get("city")
                      and set(tokens(wb["city"])) & set(tokens(b["city"]))):
                continue
            if score > best_score:
                best, best_score = b, score
        return best

    extra = dupes = 0
    for wb in wd_breweries:
        if wb["ext_id"] in breweries:
            continue
        twin = duplicate_of(wb)
        if twin:
            twin["aliases"].add(wb["name"])
            twin["logo_url"] = twin["logo_url"] or wb.get("logo_url")
            twin["website"] = twin["website"] or wb.get("website")
            dupes += 1
            continue
        breweries[wb["ext_id"]] = {
            **{k: wb.get(k) for k in ("ext_id", "name", "city", "state", "country", "lat", "lng", "website", "logo_url")},
            "source": "wikidata", "trust": "unverified", "brewery_type": "brauerei", "region": None,
            "district": None, "founded": None, "geo_precision": "wikidata" if wb.get("lat") is not None else None,
            "parent_ext": None, "sources": {"liste": "wikidata"}, "aliases": {wb["name"], short_name(wb["name"])},
        }
        extra += 1
    stats["wd_only_breweries"] = extra
    stats["wd_duplicates_merged"] = dupes
    # Eltern, die selbst nicht im Katalog sind, ignorieren
    for b in breweries.values():
        if b["parent_ext"] and b["parent_ext"] not in breweries:
            b["parent_ext"] = None
            parent_of.pop(b["ext_id"], None)

    # ------------------------------------------------------------ 2b. OpenStreetMap: Adresse, genaue Lage, Website
    if osm:
        new, ostats = apply_osm(breweries, osm)
        stats.update(ostats)
        for n in new:
            breweries.setdefault(n["ext_id"], n)

    # ------------------------------------------------------------ 2b2. Open Brewery DB: Websites, Adressen, weitere Brauereien
    if obdb:
        new, ostats = apply_osm(breweries, obdb, src="obdb")
        stats.update(ostats)
        for n in new:
            breweries.setdefault(n["ext_id"], n)

    # Marken aus Wikidata (Biermarken/Produkte mit Hersteller = Brauerei) als zusätzliche Namen
    wd_alias_n = 0
    for ext, names in (wd_aliases or {}).items():
        if ext in breweries:
            for n in names:
                if n not in breweries[ext]["aliases"]:
                    breweries[ext]["aliases"].add(n)
                    wd_alias_n += 1
    stats["wd_brand_aliases"] = wd_alias_n

    # ------------------------------------------------------------ 2c. Brauerei-Websites: Adresse + Sortiment
    by_site: dict[str, list[dict]] = defaultdict(list)
    for b in breweries.values():
        if b.get("website") and b["brewery_type"] != "marke":
            by_site[b["website"]].append(b)
    site_results: dict[str, dict] = {}
    if crawl and by_site:
        site_results = crawl(by_site) or {}
        addr_how = Counter()
        for site, bs in by_site.items():
            d = site_results.get(site) or {}
            for b in bs:
                if b.get("street"):
                    continue
                a, hit = choose_address(b, d.get("addresses") or [], geocoder)
                if not a:
                    if d.get("addresses"):
                        addr_how["abgelehnt"] += 1
                    continue
                b["street"], b["postcode"] = a["street"], a["postcode"]
                b["city"] = b.get("city") or a.get("city")
                b["sources"]["adresse"] = a.get("src") or "website"
                addr_how[a.get("src") or "website"] += 1
                if hit and hit[2] == "adresse" and b.get("geo_precision") in WEAK_GEO:
                    b["lat"], b["lng"], b["geo_precision"] = hit
                    addr_how["koordinaten_genauer"] += 1
        stats["addr_website"] = dict(addr_how)
        stats["sites_total"] = len(by_site)
        stats["sites_ok"] = sum(1 for d in site_results.values() if d.get("status") == 200)
        stats["sites_with_beers"] = sum(1 for d in site_results.values() if d.get("beers"))
    stats["breweries_with_address"] = sum(1 for b in breweries.values() if b.get("street"))

    # Herkunftsform als Markenname: „Brauerei Aying“ in Aying → „Ayinger“, „Lübz“ → „Lübzer“
    for b in breweries.values():
        city_t = set(tokens(b.get("city") or ""))
        for t in tokens(b["name"]):
            if len(t) >= 4 and t in city_t and not t.endswith("er"):
                b["aliases"].add(t + "er")
    index = AliasIndex(parent_of, breweries)
    for b in breweries.values():
        for a in b["aliases"]:
            index.add(a, b["ext_id"], b["trust"])

    # ------------------------------------------------------------ 3. Biere
    beers: dict[str, dict] = {}
    alias_tokens: dict[str, set[str]] = defaultdict(set)
    for b in breweries.values():
        for a in b["aliases"]:
            alias_tokens[b["ext_id"]] |= set(tokens(a))

    def beer_key(brewery_ext: str, name: str) -> str:
        t = [x for x in tokens(name) if x not in alias_tokens[brewery_ext]]
        t = list(dict.fromkeys(t))  # „alkoholfrei alkoholfrei“ → „alkoholfrei“
        return " ".join(t) or key(name)

    # In der App ausgeblendete Biere (Merch, Dubletten …) nicht wieder anlegen
    hidden_keys = {(e, beer_key(e, n)) for e, n in (hidden or [])}
    stats["hidden_skipped"] = 0

    def add_beer(brewery_ext, name, style, abv, image, source, trust, eans, create=True):
        bk = beer_key(brewery_ext, name)
        if not bk:
            return None
        if (brewery_ext, bk) in hidden_keys:
            stats["hidden_skipped"] += 1
            return None
        ext = f"beer:{brewery_ext}:{bk.replace(' ', '-')}"
        b = beers.get(ext)
        if not b:
            if not create:
                return None
            b = beers[ext] = {"ext_id": ext, "brewery_ext": brewery_ext, "name": name, "style": style, "abv": abv,
                              "image_url": image, "source": source, "trust": trust, "eans": set(), "sources": {}}
        else:
            b["style"] = b["style"] or style
            b["abv"] = b["abv"] if b["abv"] is not None else abv
            b["image_url"] = b["image_url"] or image
            if source not in b["source"].split("+"):
                b["source"] += f"+{source}"
        b["sources"][source] = True
        b["eans"].update(eans)
        return b

    # 3a. Sorten-Spalte der Wikipedia-Liste (verifiziert)
    wp_beers = 0
    for e in wp_entries:
        ext = f"wd:{e['wd']['qid']}" if e.get("wd") else f"wp:{_slug(e['state'] or '')}:{_slug(e['name'])}@{_slug(e.get('place') or '')}"
        if ext not in breweries:
            continue
        brands = e.get("brands") or []
        brand = brands[0] if len(brands) == 1 else short_name(e["name"])
        for s in e.get("styles") or []:
            if _BAD_STYLE.search(s) or len(s) > 40:
                continue
            name = s if set(tokens(brand)) & set(tokens(s)) else f"{brand} {s}"
            if add_beer(ext, name, guess_style(s), None, None, "wikipedia", "verified", set()):
                wp_beers += 1
    stats["wp_beers"] = wp_beers

    # 3a2. Sortiment von der Brauerei-Website (Shop/JSON-LD/eindeutige Liste = geprüft, sonst ungeprüft)
    web_beers, web_how = 0, Counter()
    for site, bs in by_site.items():
        d = site_results.get(site) or {}
        if not d.get("beers"):
            continue
        site_beers = postprocess(d["beers"])  # auch ältere Cache-Einträge säubern
        # Mehrere Braustätten mit derselben Website → Biere zum Unternehmen bzw. zur Hauptbrauerei
        owner = next((breweries[b["parent_ext"]] for b in bs if b.get("parent_ext") in breweries), None) or \
            sorted(bs, key=lambda b: (b["trust"] != "verified", b["brewery_type"] != "brauerei", len(b["name"])))[0]
        oext = owner["ext_id"]
        brand = brand_word(owner["name"])
        own = ({oext, owner.get("parent_ext")} | {b["ext_id"] for b in bs}) - {None}
        for it in site_beers:
            name = it["name"]
            # Biere anderer Brauereien (Getränkekarte, Handel) überspringen: „Augustiner Hell“ auf fremder Seite
            first = name.split()[0]
            if len(first) >= 5 and not is_beerish(first):
                other, _ = index.find(first)
                if other and other not in own and parent_of.get(other) not in own:
                    web_how["fremd"] += 1
                    continue
            if not set(tokens(name)) & alias_tokens[oext]:
                name = f"{brand} {name}"
            trust = "verified" if it.get("conf") == "hoch" and it.get("method") != "ki" else "unverified"
            style = guess_style(name) or it.get("style")
            if add_beer(oext, name, style, it.get("abv"), it.get("image"), "website", trust, set()):
                web_beers += 1
                web_how[(it.get("method") or "?").split("-")[0]] += 1
    stats["website_beers"] = web_beers
    stats["website_methods"] = dict(web_how)

    # 3b. Biere aus Wikidata
    for wb in wd_beers:
        ext = wb["brewery_ext"]
        if ext in breweries:
            name = re.sub(r"\s*\([^)]*\)$", "", wb["name"]).strip()  # „Oettinger (beer)“
            if not set(tokens(name)) & alias_tokens[ext]:
                name = f"{brand_word(breweries[ext]['name'])} {name}"
            add_beer(ext, name, wb["style"], wb["abv"], None, "wikidata", "verified", wb["eans"])

    # 3c. Open Food Facts: Produkt → Brauerei (Marke, Produktname, Bierkatalog, seltenes Wort, Ort, EAN-Präfix)
    catalog: dict[str, set[str]] = defaultdict(set)
    for b in beers.values():
        c = compact(b["name"])
        if c:
            catalog[c].add(b["brewery_ext"])
    lookup = BreweryLookup(breweries, parent_of)
    assigned, rest, how = match_products(off_products, index, lookup, brand_overrides, catalog, breweries)

    # Rest: Marke als eigener (ungeprüfter) Eintrag ohne Ort – erscheint in der App unter „Marken ohne Brauerei“
    unmatched_brands = Counter()
    for p in rest:
        brand = next((b for b in p.get("brands") or [] if len(key(b)) >= 3), None)
        if not brand:
            how["ohne_marke"] += 1
            continue
        bk = key(brand)
        ext = f"off-brand:{bk.replace(' ', '-')}"
        if ext not in breweries:
            breweries[ext] = {
                "ext_id": ext, "name": brand.strip(), "city": None, "state": None, "country": None,
                "lat": None, "lng": None, "website": None, "logo_url": None, "source": "off", "trust": "unverified",
                "brewery_type": "marke", "region": None, "district": None, "founded": None, "geo_precision": None,
                "parent_ext": None, "sources": {"liste": "openfoodfacts"}, "aliases": {brand.strip()},
            }
        assigned.append((p, ext, "marke_ohne_brauerei"))
        unmatched_brands[brand.strip()] += 1

    merged_verified = off_named = off_skipped = 0
    for p, ext, method in assigned:
        own = [b for b in p.get("brands") or [] if not is_retailer(b)]
        brand = own[0] if own else brand_word(breweries[ext]["name"])
        raw = product_name(p, brand)
        if not raw:
            off_skipped += 1
            continue
        if raw != p.get("name"):
            off_named += 1
        name = clean_beer_name(raw, brand)
        style = guess_style(name, p["categories"])
        bext = f"beer:{ext}:{beer_key(ext, name).replace(' ', '-')}"
        was_verified = bext in beers and beers[bext]["trust"] == "verified"
        b = add_beer(ext, name, style, p["abv"], p["image_url"], "off", "unverified", {p["ean"]})
        if b is not None:
            b["sources"]["off_match"] = method
        if was_verified:
            merged_verified += 1

    # 3f. Gleiche Biere einer Brauerei aus verschiedenen Quellen zusammenführen
    stats["beers_merged"] = dedupe(beers)

    # Ein Barcode gehört genau zu einem Bier
    seen: set[str] = set()
    for b in beers.values():
        b["eans"] = {e for e in b["eans"] if e not in seen}
        seen |= b["eans"]

    for b in breweries.values():
        b["aliases"] = sorted(a for a in b["aliases"] if a and len(key(a)) >= 3)

    stats.update(
        wd_breweries=len(wd_breweries),
        wd_beers=len(wd_beers),
        off_products=len(off_products),
        off_match_methods=dict(how),
        off_renamed=off_named,
        off_without_name=off_skipped,
        off_unmatched=sum(unmatched_brands.values()),
        off_merged_into_verified=merged_verified,
        top_unmatched_brands=unmatched_brands.most_common(40),
        breweries_total=len(breweries),
        breweries_verified=sum(1 for b in breweries.values() if b["trust"] == "verified"),
        breweries_on_map=sum(1 for b in breweries.values() if b["lat"] is not None),
        beers_total=len(beers),
        beers_verified=sum(1 for b in beers.values() if b["trust"] == "verified"),
        barcodes_total=sum(len(b["eans"]) for b in beers.values()),
    )
    return list(breweries.values()), list(beers.values()), stats
