"""Brauereien in Deutschland und ihre Biere aus Wikidata (Lizenz: CC0)."""

from __future__ import annotations

import re
import time

from .util import guess_style, http_session, parse_abv

ENDPOINT = "https://query.wikidata.org/sparql"

# wd:Q131734 = Brauerei, wd:Q183 = Deutschland, wd:Q1221156 = Land (Bundesland), wd:Q44 = Bier
BREWERIES_QUERY = """
SELECT ?b ?bLabel ?coord ?website ?logo ?dissolved ?place ?placeLabel ?placeCoord ?stateLabel WHERE {
  ?b wdt:P31/wdt:P279* wd:Q131734 ;
     wdt:P17 wd:Q183 .
  OPTIONAL { ?b wdt:P625 ?coord }
  OPTIONAL { ?b wdt:P856 ?website }
  OPTIONAL { ?b wdt:P154 ?logo }
  OPTIONAL { ?b wdt:P576 ?dissolved }
  OPTIONAL {
    ?b wdt:P131 ?place .
    OPTIONAL { ?place wdt:P625 ?placeCoord }
  }
  OPTIONAL { ?b wdt:P131* ?state . ?state wdt:P31 wd:Q1221156 . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "de,mul,en". }
}
"""

BEERS_QUERY = """
SELECT ?beer ?beerLabel ?brew ?abv ?classLabel ?isBeer ?gtin WHERE {
  ?brew wdt:P31/wdt:P279* wd:Q131734 ;
        wdt:P17 wd:Q183 .
  ?beer wdt:P176|wdt:P127 ?brew .
  OPTIONAL { ?beer wdt:P2665 ?abv }
  OPTIONAL { ?beer wdt:P31 ?class }
  OPTIONAL { ?beer wdt:P31/wdt:P279* wd:Q44 . BIND(true AS ?isBeer) }
  OPTIONAL { ?beer wdt:P3962 ?gtin }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "de,mul,en". }
}
"""


def _qid(uri: str) -> str:
    return uri.rsplit("/", 1)[-1]


def _val(row: dict, k: str) -> str | None:
    v = row.get(k)
    return v["value"] if v else None


def _point(s: str | None) -> tuple[float, float] | None:
    """'Point(11.57 48.13)' → (lat, lng)"""
    if not s:
        return None
    m = re.match(r"Point\(([-\d.eE]+) ([-\d.eE]+)\)", s)
    if not m:
        return None
    lng, lat = float(m.group(1)), float(m.group(2))
    return lat, lng


def _logo_url(commons: str) -> str:
    """Commons-Datei als kleines PNG-Vorschaubild (funktioniert auch für SVG-Logos)."""
    return commons.replace("http://", "https://", 1) + "?width=128"


def _is_label_missing(label: str | None, qid: str) -> bool:
    # Der Label-Service liefert die Q-ID, wenn kein Name existiert
    return not label or label == qid


def query(sparql: str, session=None) -> list[dict]:
    s = session or http_session()
    last = None
    for i in range(4):
        try:
            r = s.post(
                ENDPOINT,
                data={"query": sparql},
                headers={"Accept": "application/sparql-results+json"},
                timeout=180,
            )
            if r.status_code in (429, 500, 502, 503, 504):
                raise RuntimeError(f"HTTP {r.status_code}")
            r.raise_for_status()
            return r.json()["results"]["bindings"]
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(15 * (i + 1))
    raise RuntimeError(f"Wikidata-Abfrage fehlgeschlagen: {last}")


def parse_breweries(rows: list[dict]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for row in rows:
        qid = _qid(_val(row, "b"))
        name = _val(row, "bLabel")
        if _is_label_missing(name, qid):
            continue
        b = out.setdefault(
            qid,
            {
                "ext_id": f"wd:{qid}",
                "name": name,
                "city": None,
                "state": None,
                "country": "Deutschland",
                "lat": None,
                "lng": None,
                "website": None,
                "logo_url": None,
                "source": "wikidata",
                "dissolved": False,
                "_place_coord": None,
            },
        )
        if _val(row, "dissolved"):
            b["dissolved"] = True
        c = _point(_val(row, "coord"))
        if c and b["lat"] is None:
            b["lat"], b["lng"] = c
        if not b["website"] and _val(row, "website"):
            b["website"] = _val(row, "website")
        if not b["logo_url"] and _val(row, "logo"):
            b["logo_url"] = _logo_url(_val(row, "logo"))
        place = _val(row, "placeLabel")
        if place and not b["city"] and not _is_label_missing(place, _qid(_val(row, "place") or "")):
            b["city"] = place
            b["_place_coord"] = _point(_val(row, "placeCoord"))
        state = _val(row, "stateLabel")
        if state and not b["state"]:
            b["state"] = state
    for b in out.values():
        # Keine eigenen Koordinaten → Koordinaten des Ortes verwenden
        if b["lat"] is None and b["_place_coord"]:
            b["lat"], b["lng"] = b["_place_coord"]
        b.pop("_place_coord", None)
    # Geschlossene Brauereien weglassen
    return {k: v for k, v in out.items() if not v.pop("dissolved")}


_BEER_HINT = re.compile(r"bier|beer|pils|lager|weizen|bock|ale\b|stout|porter|kolsch|kölsch|radler|helles|dunkel")


def parse_beers(rows: list[dict], breweries: dict[str, dict]) -> list[dict]:
    beers: dict[str, dict] = {}
    for row in rows:
        qid = _qid(_val(row, "beer"))
        brew = _qid(_val(row, "brew"))
        if brew not in breweries:
            continue
        name = _val(row, "beerLabel")
        if _is_label_missing(name, qid):
            continue
        cls = _val(row, "classLabel") or ""
        is_beer = bool(_val(row, "isBeer")) or bool(_BEER_HINT.search(cls.lower()))
        b = beers.setdefault(
            qid,
            {
                "wd": qid,
                "brewery_ext": f"wd:{brew}",
                "name": name,
                "style": None,
                "abv": None,
                "image_url": None,
                "source": "wikidata",
                "eans": set(),
                "_is_beer": False,
                "_classes": [],
            },
        )
        b["_is_beer"] = b["_is_beer"] or is_beer
        if cls:
            b["_classes"].append(cls)
        if b["abv"] is None:
            b["abv"] = parse_abv(_val(row, "abv"))
        g = _val(row, "gtin")
        if g and re.fullmatch(r"\d{8,14}", g):
            b["eans"].add(g)
    out = []
    for b in beers.values():
        if not b.pop("_is_beer"):
            continue
        b["style"] = guess_style(b["name"], *b.pop("_classes"))
        out.append(b)
    return out


_BRAND_HINT = re.compile(r"marke|brand|trademark|warenzeichen")


def parse_brands(rows: list[dict], breweries: dict[str, dict]) -> dict[str, set[str]]:
    """Marken (keine einzelnen Biere, keine Tochterbrauereien) mit Hersteller/Eigentümer = Brauerei
    → zusätzliche Namen der Brauerei. So findet die Zuordnung „Mönchshof“ → Kulmbacher."""
    items: dict[str, dict] = {}
    for row in rows:
        brew = _qid(_val(row, "brew"))
        if brew not in breweries:
            continue
        qid = _qid(_val(row, "beer"))
        it = items.setdefault(qid, {"name": _val(row, "beerLabel"), "brews": set(), "cls": set()})
        it["brews"].add(brew)
        it["cls"].add((_val(row, "classLabel") or "").lower())
    out: dict[str, set[str]] = {}
    for qid, it in items.items():
        cls = " ".join(it["cls"])
        name = it["name"]
        if _is_label_missing(name, qid) or len(name) > 40 or len(it["brews"]) != 1:
            continue
        name = re.sub(r"\s*\([^)]*\)$", "", name).strip()
        if not _BRAND_HINT.search(cls) or re.search(r"brewery|brauerei|unternehmen|company|business|enterprise", cls):
            continue
        out.setdefault(f"wd:{next(iter(it['brews']))}", set()).add(name)
    return out


def fetch() -> tuple[list[dict], list[dict], dict[str, set[str]]]:
    """Liefert (Brauereien, Biere, Marken je Brauerei). Schlüssel der Brauereien: ext_id 'wd:Q…'."""
    s = http_session()
    breweries = parse_breweries(query(BREWERIES_QUERY, s))
    rows = query(BEERS_QUERY, s)
    beers = parse_beers(rows, breweries)
    return list(breweries.values()), beers, parse_brands(rows, breweries)


# --------------------------------------------------------------------------- Prüfung verlinkter Objekte

# Unternehmen (allgemein) – zählt nur als Brauerei, wenn der Name danach klingt
_COMPANY_CLASSES = "wd:Q4830453 wd:Q783794 wd:Q6881511 wd:Q891723 wd:Q167037"

CHECK_QUERY = """
SELECT ?item ?itemLabel ?isBrewery ?isCompany ?coord ?website ?logo ?dissolved WHERE {
  VALUES ?item { %s }
  OPTIONAL { ?item wdt:P31/wdt:P279* wd:Q131734 . BIND(true AS ?isBrewery) }
  OPTIONAL { ?item wdt:P31 ?c . VALUES ?c { %s } BIND(true AS ?isCompany) }
  OPTIONAL { ?item wdt:P625 ?coord }
  OPTIONAL { ?item wdt:P856 ?website }
  OPTIONAL { ?item wdt:P154 ?logo }
  OPTIONAL { ?item wdt:P576 ?dissolved }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "de,mul,en". }
}
"""

_BREWERY_WORDS = re.compile(r"brauerei|bräu|brau|brauhaus|brewery|brewing", re.IGNORECASE)
# Links, die auf Orte/Gebäude zeigen, nicht auf die Brauerei
_NOT_BREWERY = re.compile(r"kloster|abtei|schloss|bahnhof|zoo|museum|kirche|palais|postamt|lebenshilfe|malzfabrik|"
                          r"freilicht|kirchweih|mauthalle|\(bier\)|\(marke\)|stadtpalais|ratskeller", re.IGNORECASE)


def parse_check(rows: list[dict]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for row in rows:
        qid = _qid(_val(row, "item"))
        d = out.setdefault(qid, {"is_brewery": False, "coords": None, "website": None, "logo_url": None,
                                 "dissolved": False, "label": _val(row, "itemLabel")})
        if _val(row, "isBrewery"):
            d["is_brewery"] = True
        label = d["label"] or ""
        # Viele Brauereien sind in Wikidata nur als Unternehmen/Gebäude erfasst – dann entscheidet der Name
        if _BREWERY_WORDS.search(label) and not _NOT_BREWERY.search(label):
            d["is_brewery"] = True
        if _val(row, "dissolved"):
            d["dissolved"] = True
        c = _point(_val(row, "coord"))
        if c and not d["coords"]:
            d["coords"] = c
        if not d["website"] and _val(row, "website"):
            d["website"] = _val(row, "website")
        if not d["logo_url"] and _val(row, "logo"):
            d["logo_url"] = _logo_url(_val(row, "logo"))
    return out


def check_entities(qids: list[str], session=None) -> dict[str, dict]:
    """Prüft verlinkte Wikidata-Objekte: Ist es wirklich eine Brauerei? Plus Koordinaten, Website, Logo."""
    s = session or http_session()
    out: dict[str, dict] = {}
    uniq = sorted(set(q for q in qids if q and re.fullmatch(r"Q\d+", q)))
    for i in range(0, len(uniq), 150):
        values = " ".join(f"wd:{q}" for q in uniq[i:i + 150])
        out.update(parse_check(query(CHECK_QUERY % (values, _COMPANY_CLASSES), s)))
    return out
