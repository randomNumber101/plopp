"""OpenStreetMap (Overpass): Brauereien mit genauen Koordinaten, Adressen und Websites.

Daten © OpenStreetMap-Mitwirkende, ODbL. Abfrage einmal pro Lauf (ca. 2000 Objekte).
"""

from __future__ import annotations

import re
import time

from .util import http_session

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

QUERY = """
[out:json][timeout:240];
area["ISO3166-1"="DE"][admin_level=2]->.de;
(
  nwr["craft"="brewery"](area.de);
  nwr["industrial"="brewery"](area.de);
  nwr["microbrewery"="yes"](area.de);
);
out center tags;
"""


def _website(t: dict) -> str | None:
    w = t.get("website") or t.get("contact:website") or t.get("url")
    if not w:
        return None
    w = w.split(";")[0].strip()
    if not re.match(r"https?://", w):
        w = "https://" + w.lstrip("/")
    return w


def parse(data: dict) -> list[dict]:
    out = []
    for el in data.get("elements", []):
        t = el.get("tags") or {}
        name = (t.get("name") or t.get("brand") or t.get("operator") or "").strip()
        if not name:
            continue
        lat = el.get("lat", (el.get("center") or {}).get("lat"))
        lng = el.get("lon", (el.get("center") or {}).get("lon"))
        if lat is None or lng is None:
            continue
        street = None
        if t.get("addr:street") and t.get("addr:housenumber"):
            street = f"{t['addr:street']} {t['addr:housenumber']}"
        if t.get("craft") == "brewery" or t.get("industrial") == "brewery":
            kind = "gasthausbrauerei" if t.get("amenity") in ("pub", "restaurant", "biergarten", "bar") else "brauerei"
        else:
            kind = "gasthausbrauerei"  # Gaststätte mit eigener Brauerei (microbrewery=yes)
        out.append({
            "osm_id": f"{el['type'][0]}{el['id']}",
            "name": name,
            "aliases": sorted({x.strip() for x in (t.get("brand"), t.get("operator"), t.get("old_name"),
                                                   t.get("alt_name"), t.get("official_name")) if x and x.strip()}),
            "lat": float(lat), "lng": float(lng),
            "street": street, "postcode": t.get("addr:postcode"), "city": t.get("addr:city"),
            "website": _website(t), "qid": t.get("wikidata") or t.get("brand:wikidata"),
            "type": kind, "primary": t.get("craft") == "brewery" or t.get("industrial") == "brewery",
            "disused": any(k.startswith(("disused:", "abandoned:")) for k in t) or t.get("disused") == "yes",
        })
    return [o for o in out if not o["disused"]]


def fetch() -> list[dict]:
    s = http_session()
    last = None
    for attempt in range(2):
        for url in ENDPOINTS:
            try:
                r = s.post(url, data={"data": QUERY}, timeout=300)
                if r.status_code == 200 and r.headers.get("content-type", "").startswith("application/json"):
                    return parse(r.json())
                last = f"{url}: HTTP {r.status_code}"
            except Exception as e:  # noqa: BLE001
                last = f"{url}: {e}"
            time.sleep(10)
        time.sleep(30 * (attempt + 1))
    raise RuntimeError(f"Overpass nicht erreichbar: {last}")
