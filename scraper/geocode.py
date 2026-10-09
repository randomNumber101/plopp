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

_ADDR = re.compile(r"\b\d{5}\b|(stra(ss|ß)e|str\.|weg|platz|gasse|allee|ring|damm)\s*\d|\s\d{1,4}\s?[a-z]?$",
                   re.IGNORECASE)
_PREFIX_WORDS = {"alt", "neu", "bad", "groß", "gross", "klein", "ober", "unter", "nieder", "hohen", "sankt", "st."}


def query_variants(place: str | None, state: str | None, district: str | None = None,
                   street: str | None = None) -> list[str]:
    """Mögliche Suchanfragen, vom genauesten zum gröbsten."""
    from .wikipedia import is_city_district

    st = f", {state}" if state else ""
    city_district = district if is_city_district(district) else None
    lk = re.sub(r"^(Landkreis|Kreis)\s+", "", district) if district and not city_district else None
    out: list[str] = []
    if not place:
        if street and city_district:
            out.append(f"{street}, {city_district}{st}")
        if city_district:
            out.append(f"{city_district}{st}")
        return out
    p = re.sub(r"\s+", " ", place).strip(" ,")
    p = p.split(" / ")[0].split("/")[0].strip()
    if _ADDR.search(p):
        out.append(f"{p}{st}")
        m = re.search(r"\b\d{5}\s+([^,]+)", p)
        if m:
            out.append(f"{m.group(1).strip()}{st}")
        return out
    parts = [x.strip() for x in p.split(",") if x.strip()]
    head = parts[0]
    if street:
        out.append(f"{street}, {city_district or head}{st}")
    if city_district and head != city_district:
        out.append(f"{head}, {city_district}{st}")  # Stadtteil einer kreisfreien Stadt
    # „Gemeinde – Ortsteil“ (Bayern) bzw. „Gemeinde-Ortsteil“
    m = re.match(r"^(.+?)\s+[–-]\s+(.+)$", head) or re.match(r"^([A-ZÄÖÜ][^-]+?)-([A-ZÄÖÜ].+)$", head)
    if m:
        gemeinde, ortsteil = m.group(1).strip(), m.group(2).strip()
        if gemeinde.lower() in _PREFIX_WORDS:  # „Alt-Hohenschönhausen“ ist ein Name, kein Ortsteil
            out.append(f"{head}{st}")
        else:
            out.append(f"{ortsteil}, {gemeinde}{st}")
            if " – " not in head and " - " not in head:
                out.append(f"{head}{st}")  # z. B. „Garmisch-Partenkirchen“
            out.append(f"{gemeinde}{st}")
    else:
        out.append(f"{', '.join(parts)}{st}")
        if len(parts) > 1:
            out.append(f"{parts[-1]}{st}")
            out.append(f"{parts[0]}{st}")
    if lk:
        out.append(f"{head}, {lk}{st}")
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

    def locate(self, place: str | None, state: str | None, district: str | None = None, street: str | None = None):
        """→ (lat, lng, precision) oder None"""
        for q in query_variants(place, state, district, street):
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

    def address(self, street: str, postcode: str, city: str | None):
        """Genaue Adresse → (lat, lng, precision) oder None"""
        res = self._search(f"{street}, {postcode} {city or ''}".strip())
        if res.get("skip") or res.get("lat") is None:
            return None
        return res["lat"], res["lng"], res["precision"]
