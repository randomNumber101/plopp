"""Brauereien aus der Open Brewery DB (https://www.openbrewerydb.org, Lizenz: MIT).

Der komplette Datensatz liegt als CSV auf GitHub. Wir nehmen die Einträge eines Landes und bringen sie in
dasselbe Format wie die OpenStreetMap-Objekte, damit der Abgleich (web.apply_osm) beides gleich behandelt:
Website, Adresse und genaue Lage für bekannte Brauereien, neue (ungeprüfte) Einträge für den Rest.
Websites sind das Wichtigste daran – von dort kommen die Bierkataloge.
"""

from __future__ import annotations

import csv
import io
import re

from .util import http_session

CSV_URL = "https://raw.githubusercontent.com/openbrewerydb/openbrewerydb/master/breweries.csv"

# Typen der Open Brewery DB → eigene Typen; alles andere (Bar, Biergarten, geschlossen, Planung …) wird übersprungen
TYPES = {"micro": "brauerei", "nano": "brauerei", "regional": "brauerei", "large": "brauerei",
         "brewpub": "brauerei", "contract": "marke", "proprietor": "marke"}


def _float(v: str | None) -> float | None:
    try:
        return float(v) if v not in (None, "") else None
    except ValueError:
        return None


def parse(text: str, country: str = "Germany") -> list[dict]:
    out = []
    for r in csv.DictReader(io.StringIO(text)):
        if (r.get("country") or "").strip() != country:
            continue
        kind = TYPES.get((r.get("brewery_type") or "").strip())
        lat, lng = _float(r.get("latitude")), _float(r.get("longitude"))
        name = (r.get("name") or "").strip()
        if not kind or kind == "marke" or lat is None or lng is None or len(name) < 2:
            continue
        web = (r.get("website_url") or "").strip() or None
        if web and re.search(r"facebook\.|instagram\.|twitter\.|untappd\.|tripadvisor\.", web):
            web = None  # keine eigene Website
        out.append({
            "osm_id": r["id"], "qid": None, "name": name, "aliases": [],
            "lat": lat, "lng": lng, "website": web,
            "street": (r.get("address_1") or "").strip() or None,
            "postcode": (r.get("postal_code") or "").strip() or None,
            "city": (r.get("city") or "").strip() or None,
            "state": (r.get("state_province") or "").strip() or None,
            "type": kind, "primary": True, "disused": False,
        })
    return out


def fetch(country: str = "Germany") -> list[dict]:
    r = http_session().get(CSV_URL, timeout=120)
    r.raise_for_status()
    r.encoding = "utf-8"
    return parse(r.text, country)
