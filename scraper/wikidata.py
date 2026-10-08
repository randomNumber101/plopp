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
  SERVICE wikibase:label { bd:serviceParam wikibase:language "de,en". }
}
"""

BEERS_QUERY = """
SELECT ?beer ?beerLabel ?brew ?abv ?classLabel ?isBeer ?gtin WHERE {
  ?brew wdt:P31/wdt:P279* wd:Q131734 ;
        wdt:P17 wd:Q183 .
  ?beer wdt:P176 ?brew .
  OPTIONAL { ?beer wdt:P2665 ?abv }
  OPTIONAL { ?beer wdt:P31 ?class }
  OPTIONAL { ?beer wdt:P31/wdt:P279* wd:Q44 . BIND(true AS ?isBeer) }
  OPTIONAL { ?beer wdt:P3962 ?gtin }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "de,en". }
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


def fetch() -> tuple[list[dict], list[dict]]:
    """Liefert (Brauereien, Biere). Schlüssel der Brauereien: ext_id 'wd:Q…'."""
    s = http_session()
    breweries = parse_breweries(query(BREWERIES_QUERY, s))
    beers = parse_beers(query(BEERS_QUERY, s), breweries)
    return list(breweries.values()), beers
