"""Geokodierung über Nominatim (OpenStreetMap) mit Gegenprobe des Bundeslands und Cache.

Nutzungsregeln: max. 1 Anfrage/Sekunde, eigener User-Agent, Ergebnisse cachen.
"""

from __future__ import annotations

import re
import time

from .util import http_session

URL = "https://nominatim.openstreetmap.org/search"

ADDRESS_TYPES = {"house", "building", "amenity", "shop", "craft", "tourism", "office", "industrial", "commercial"}
PLACE_TYPES = {"hamlet", "village", "suburb", "neighbourhood", "quarter", "town", "city", "isolated_dwelling",
               "city_district", "borough", "locality", "farm", "allotments", "croft"}

_ADDR = re.compile(r"\b\d{5}\b|(stra(ss|ß)e|str\.|weg|platz|gasse|allee|ring|damm)\s*\d", re.IGNORECASE)


def query_variants(place: str | None, state: str | None, district: str | None = None) -> list[str]:
    """Mögliche Suchanfragen, vom genauesten zum gröbsten."""
    if not place:
        return []
    p = re.sub(r"\s+", " ", place).strip(" ,")
    out: list[str] = []
    st = f", {state}" if state else ""
    if _ADDR.search(p):
        out.append(f"{p}{st}")
        # Nur Ort aus der Adresse („60314 Frankfurt am Main“)
        m = re.search(r"\b\d{5}\s+([^,]+)", p)
        if m:
            out.append(f"{m.group(1).strip()}{st}")
        return out
    parts = [x.strip() for x in p.split(",") if x.strip()]
    head = parts[0]
    # „Gemeinde-Ortsteil“ → „Ortsteil, Gemeinde“ (nur wenn beide Teile mit Großbuchstaben beginnen)
    m = re.match(r"^([A-ZÄÖÜ][^-]+?)-([A-ZÄÖÜ].+)$", head)
    if m:
        gemeinde, ortsteil = m.group(1).strip(), m.group(2).strip()
        out.append(f"{ortsteil}, {gemeinde}{st}")
        out.append(f"{head}{st}")  # z. B. „Garmisch-Partenkirchen“
        out.append(f"{gemeinde}{st}")
    else:
        out.append(f"{', '.join(parts)}{st}")
        if len(parts) > 1:
            out.append(f"{parts[0]}{st}")
    if district and not district.startswith(("München", "Nürnberg")):
        out.append(f"{head}, {district}{st}")
    seen, uniq = set(), []
    for q in out:
        if q not in seen:
            seen.add(q)
            uniq.append(q)
    return uniq


def precision(addresstype: str | None, cls: str | None) -> str:
    if (addresstype or "") in ADDRESS_TYPES or (cls or "") in ADDRESS_TYPES:
        return "adresse"
    if (addresstype or "") in PLACE_TYPES:
        return "ort"
    return "gemeinde"


def same_state(a: str, b: str) -> bool:
    def norm(x: str) -> str:
        x = re.sub(r"freie und hansestadt|freie hansestadt|freistaat|land ", "", x.lower())
        return re.sub(r"[^a-zäöüß]", "", x)
    na, nb = norm(a), norm(b)
    return bool(na) and bool(nb) and (na in nb or nb in na)


class Geocoder:
    def __init__(self, cache: dict[str, dict] | None = None, budget_s: float = 1500, session=None):
        self.cache = cache if cache is not None else {}
        self.new: dict[str, dict] = {}
        self.s = session or http_session()
        self.deadline = time.time() + budget_s
        self.last = 0.0
        self.requests = 0
        self.rejected_state = 0

    def _search(self, q: str) -> dict:
        if q in self.cache:
            return self.cache[q]
        if time.time() > self.deadline:
            return {"skip": True}
        wait = 1.1 - (time.time() - self.last)
        if wait > 0:
            time.sleep(wait)
        self.last = time.time()
        self.requests += 1
        res: dict = {"lat": None, "lng": None, "state": None, "precision": None}
        try:
            r = self.s.get(URL, params={"q": q, "format": "jsonv2", "limit": 1, "countrycodes": "de",
                                        "addressdetails": 1, "accept-language": "de"}, timeout=30)
            if r.status_code == 200 and r.json():
                hit = r.json()[0]
                addr = hit.get("address") or {}
                res = {
                    "lat": float(hit["lat"]), "lng": float(hit["lon"]),
                    "state": addr.get("state") or addr.get("city"),
                    "precision": precision(hit.get("addresstype"), hit.get("category") or hit.get("class")),
                }
            elif r.status_code in (429, 503):
                time.sleep(30)
                return {"skip": True}
        except Exception:  # noqa: BLE001
            return {"skip": True}
        self.cache[q] = res
        self.new[q] = res
        return res

    def locate(self, place: str | None, state: str | None, district: str | None = None):
        """→ (lat, lng, precision) oder None"""
        for q in query_variants(place, state, district):
            res = self._search(q)
            if res.get("skip"):
                return None
            if res.get("lat") is None:
                continue
            if state and res.get("state") and not same_state(res["state"], state):
                self.rejected_state += 1
                continue
            return res["lat"], res["lng"], res["precision"]
        return None
