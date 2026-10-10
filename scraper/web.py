"""OpenStreetMap-Abgleich und Auswahl der Adresse aus den Website-Ergebnissen."""

from __future__ import annotations

import math
from collections import defaultdict

from rapidfuzz import fuzz

from .enrich import haversine_km
from .util import fold, key, tokens

WEAK_GEO = (None, "ort", "gemeinde")


def domain(url: str | None) -> str | None:
    if not url:
        return None
    from urllib.parse import urlparse

    u = url if "://" in url else "https://" + url
    d = urlparse(u).netloc.lower()
    return d[4:] if d.startswith("www.") else d or None


class Grid:
    """Einfacher räumlicher Index (ca. 5 km Zellen)."""

    def __init__(self, items: list[dict], cell: float = 0.05):
        self.cell = cell
        self.g: dict[tuple[int, int], list[dict]] = defaultdict(list)
        for it in items:
            if it.get("lat") is not None and it.get("lng") is not None:
                self.g[self._k(it["lat"], it["lng"])].append(it)

    def _k(self, lat, lng):
        return math.floor(lat / self.cell), math.floor(lng / self.cell)

    def near(self, lat: float, lng: float, km: float):
        r = int(km / (self.cell * 70)) + 1
        ci, cj = self._k(lat, lng)
        for i in range(ci - r, ci + r + 1):
            for j in range(cj - r, cj + r + 1):
                for it in self.g.get((i, j), []):
                    d = haversine_km((lat, lng), (it["lat"], it["lng"]))
                    if d <= km:
                        yield it, d

    def add(self, it: dict):
        self.g[self._k(it["lat"], it["lng"])].append(it)


def _name_score(o: dict, b: dict) -> float:
    on = [key(o["name"])] + [key(a) for a in o.get("aliases") or []]
    bn = [key(b["name"])] + [key(a) for a in list(b.get("aliases") or [])[:12]]
    best = 0.0
    for x in on:
        for y in bn:
            if x and y:
                best = max(best, fuzz.token_set_ratio(x, y))
    return best


SOURCE_LABEL = {"osm": "openstreetmap", "obdb": "openbrewerydb"}


def apply_osm(breweries: dict[str, dict], osm: list[dict], src: str = "osm",
              country: str = "Deutschland") -> tuple[list[dict], dict]:
    """Ordnet Objekte aus OpenStreetMap bzw. Open Brewery DB (gleiches Format) vorhandenen Brauereien zu
    (Adresse, genaue Koordinaten, Website). → (neue Brauereien, Statistik)"""
    stats = {f"{src}_elements": len(osm), f"{src}_matched": 0, f"{src}_new": 0, f"{src}_coords_used": 0,
             f"{src}_websites": 0, f"addr_{src}": 0}
    located = [b for b in breweries.values() if b.get("lat") is not None]
    grid = Grid(located)
    by_qid = {b["sources"].get("wikidata"): b for b in breweries.values() if (b.get("sources") or {}).get("wikidata")}
    by_dom = defaultdict(list)
    for b in breweries.values():
        d = domain(b.get("website"))
        if d:
            by_dom[d].append(b)

    by_city = defaultdict(list)
    for b in breweries.values():
        if b.get("city") and b.get("brewery_type") != "marke":
            by_city[key(b["city"])].append(b)
    matches: dict[str, list[tuple[float, dict]]] = defaultdict(list)
    unmatched = []
    for o in sorted(osm, key=lambda x: not x["primary"]):
        best, best_s = None, 0.0
        if o.get("qid") and o["qid"] in by_qid:
            best, best_s = by_qid[o["qid"]], 200
        if best is None and domain(o.get("website")) in by_dom:
            for b in by_dom[domain(o["website"])]:
                if b.get("lat") is None or haversine_km((o["lat"], o["lng"]), (b["lat"], b["lng"])) < 25:
                    best, best_s = b, 150
                    break
        if best is None:
            for b, d in grid.near(o["lat"], o["lng"], 10):
                s = _name_score(o, b)
                weak = b.get("geo_precision") in WEAK_GEO
                ok = (s >= 85 and d <= 2) or (s >= 70 and d <= 0.4) or (s >= 95 and weak and d <= 10)
                score = s - d * 3
                if ok and score > best_s:
                    best, best_s = b, score
        if best is None and o.get("city"):
            # gleicher Ort, sehr ähnlicher Name (auch wenn eine der Positionen ungenau ist)
            for b in by_city.get(key(o["city"]), []):
                s = _name_score(o, b)
                if s >= 88 and s > best_s:
                    best, best_s = b, s
        if best is not None:
            matches[best["ext_id"]].append((best_s, o))
        else:
            unmatched.append(o)

    for ext, lst in matches.items():
        b = breweries[ext]
        lst.sort(key=lambda x: (-(x[1].get("street") is not None), -x[0]))
        o = lst[0][1]
        stats[f"{src}_matched"] += 1
        b["sources"][src] = o["osm_id"]
        b.setdefault("aliases", set())
        if isinstance(b["aliases"], set):
            b["aliases"].add(o["name"])
        if not b.get("website") and o.get("website"):
            b["website"] = o["website"]
            stats[f"{src}_websites"] += 1
        if b.get("geo_precision") in WEAK_GEO or b.get("lat") is None:
            b["lat"], b["lng"], b["geo_precision"] = o["lat"], o["lng"], src
            stats[f"{src}_coords_used"] += 1
        if o.get("street") and o.get("postcode") and not b.get("street"):
            b["street"], b["postcode"] = o["street"], o["postcode"]
            b["sources"]["adresse"] = src
            stats[f"addr_{src}"] += 1

    # Nicht zugeordnete OSM-Brauereien als neue (ungeprüfte) Einträge – Dubletten untereinander zusammenfassen
    new: list[dict] = []
    ngrid = Grid([])
    for o in sorted(unmatched, key=lambda x: (not x["primary"], x.get("street") is None)):
        dup = next((n for n, d in ngrid.near(o["lat"], o["lng"], 0.3)
                    if fuzz.token_set_ratio(key(o["name"]), key(n["name"])) >= 80), None)
        if dup:
            continue
        if len(key(o["name"])) < 3:
            continue
        near_state = o.get("state") or next((b.get("state") for b, d in sorted(grid.near(o["lat"], o["lng"], 30),
                                                                                 key=lambda x: x[1]) if b.get("state")), None)
        n = {
            "ext_id": f"{src}:{o['osm_id']}", "name": o["name"], "city": o.get("city"), "state": near_state,
            "country": country, "lat": o["lat"], "lng": o["lng"], "website": o.get("website"),
            "logo_url": None, "source": src, "trust": "unverified", "brewery_type": o["type"], "region": None,
            "district": None, "founded": None, "geo_precision": src, "parent_ext": None,
            "street": o.get("street"), "postcode": o.get("postcode"),
            "sources": {"liste": SOURCE_LABEL.get(src, src), src: o["osm_id"], **({"adresse": src} if o.get("street") else {})},
            "aliases": {o["name"], *(o.get("aliases") or [])},
        }
        new.append(n)
        ngrid.add(n)
    stats[f"{src}_new"] = len(new)
    stats[f"{src}_unmatched_samples"] = [f"{o['name']} ({o.get('city') or ''})" for o in unmatched[:30]]
    return new, stats


def _city_match(a: dict, b: dict) -> bool:
    c = fold(a.get("city") or "")
    for x in (b.get("city"), b.get("district"), b.get("name")):
        if x and c and (fuzz.partial_ratio(c, fold(x)) >= 85 or set(tokens(c)) & set(tokens(x))):
            return True
    return False


def choose_address(b: dict, cands: list[dict], geocoder=None) -> tuple[dict | None, tuple | None]:
    """Erste plausible Adresse: Ort passt oder geokodierte Adresse liegt ≤ 15 km von der bekannten Position.
    → (Adresse, (lat, lng, precision) | None)"""
    for a in cands:
        if a.get("foreign"):
            continue
        hit = geocoder.address(a["street"], a["postcode"], a.get("city")) if geocoder else None
        if b.get("lat") is not None and hit:
            if haversine_km((b["lat"], b["lng"]), (hit[0], hit[1])) <= 15:
                return a, hit
            continue
        if _city_match(a, b):
            return a, hit
        if b.get("lat") is None and not b.get("city") and len(cands) == 1:
            return a, hit
    return None, None
