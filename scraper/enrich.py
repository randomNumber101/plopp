"""Reichert Wikipedia-Einträge an: geprüfte Wikidata-Daten, Koordinaten, Website, Logo."""

from __future__ import annotations

import math
import re
from collections import defaultdict
from urllib.parse import quote

from rapidfuzz import fuzz

from .util import key, tokens


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    d = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(d))


def wiki_file_url(name: str) -> str:
    return "https://de.wikipedia.org/wiki/Spezial:Dateipfad/" + quote(name.replace(" ", "_")) + "?width=128"


def place_city(place: str | None) -> str | None:
    """Anzeige-Ort: bei Adressen der Ort nach der PLZ, sonst der Eintrag selbst."""
    if not place:
        return None
    m = re.search(r"\b\d{5}\s+([^,]+)", place)
    city = m.group(1).strip() if m else place.strip()
    return city[:80]


def assign_qids(entries: list[dict], check: dict[str, dict], wd_breweries: list[dict]) -> dict:
    """Setzt e['wd'] (geprüftes Wikidata-Objekt) und e['parent_qid'] für weitere Braustätten desselben Unternehmens."""
    stats = {"qid_linked": 0, "qid_rejected": 0, "qid_from_name": 0, "sites_with_parent": 0}
    by_qid: dict[str, list[dict]] = defaultdict(list)
    for e in entries:
        e["wd"] = None
        e["parent_qid"] = None
        q = e.get("qid")
        if not q:
            continue
        info = check.get(q)
        if info and info["is_brewery"] and not info["dissolved"]:
            by_qid[q].append(e)
        else:
            stats["qid_rejected"] += 1
            e["qid_rejected"] = q
    for q, group in by_qid.items():
        info = check[q]
        label = key(info.get("label") or "")
        # Hauptstandort = Name passt am besten zum Wikidata-Objekt
        group.sort(key=lambda e: -fuzz.token_set_ratio(key(e["name"]), label))
        main = group[0]
        main["wd"] = {"qid": q, **info}
        stats["qid_linked"] += 1
        for other in group[1:]:
            other["parent_qid"] = q
            stats["sites_with_parent"] += 1

    # Einträge ohne Link: über Name + Ort mit Wikidata-Brauereien abgleichen
    used = {e["wd"]["qid"] for e in entries if e["wd"]}
    wd_index: dict[str, list[dict]] = defaultdict(list)
    for b in wd_breweries:
        wd_index[key(b["name"])].append(b)
    for e in entries:
        if e["wd"] or e["parent_qid"]:
            continue
        cands = [b for b in wd_index.get(key(e["name"]), [])
                 if b["ext_id"].removeprefix("wd:") not in used
                 and (not b.get("state") or b["state"] == e["state"])]
        if e.get("place"):
            pt = set(tokens(e["place"]))
            cands = [b for b in cands if not b.get("city") or pt & set(tokens(b["city"]))]
        if len(cands) == 1:
            b = cands[0]
            q = b["ext_id"].removeprefix("wd:")
            e["wd"] = {"qid": q, "is_brewery": True, "dissolved": False, "label": b["name"],
                       "coords": (b["lat"], b["lng"]) if b.get("lat") is not None else None,
                       "website": b.get("website"), "logo_url": b.get("logo_url")}
            used.add(q)
            stats["qid_from_name"] += 1
    return stats


def apply_coords(entries: list[dict], geocoder) -> dict:
    stats = {"coords_wikipedia": 0, "coords_wikidata": 0, "coords_geocoded": 0, "coords_missing": 0,
             "coords_wikidata_rejected": 0}
    for e in entries:
        e["lat"] = e["lng"] = e["geo_precision"] = None
        if e.get("coords"):
            e["lat"], e["lng"] = e["coords"]
            e["geo_precision"] = "koordinate"
            stats["coords_wikipedia"] += 1
            continue
        wd = e.get("wd")
        if wd and wd.get("coords"):
            e["lat"], e["lng"] = wd["coords"]
            e["geo_precision"] = "wikidata"
            stats["coords_wikidata"] += 1
            continue
    # Rest geokodieren (Bundesland wird gegengeprüft)
    for e in entries:
        if e["lat"] is not None:
            continue
        hit = geocoder.locate(e.get("place"), e.get("state"), e.get("district")) if geocoder else None
        if hit:
            e["lat"], e["lng"], e["geo_precision"] = hit
            stats["coords_geocoded"] += 1
        else:
            stats["coords_missing"] += 1
    return stats


def apply_websites_and_logos(entries: list[dict], logo_finder=None) -> dict:
    stats = {"logo_wikidata": 0, "logo_wikipedia": 0, "logo_website": 0, "logo_missing": 0, "website": 0}
    for e in entries:
        wd = e.get("wd") or {}
        e["website"] = wd.get("website") or e.get("website")
        if e["website"]:
            stats["website"] += 1
        if wd.get("logo_url"):
            e["logo_url"], e["logo_source"] = wd["logo_url"], "wikidata"
        elif e.get("logo_file"):
            e["logo_url"], e["logo_source"] = wiki_file_url(e["logo_file"]), "wikipedia"
        else:
            e["logo_url"], e["logo_source"] = None, None
    if logo_finder:
        sites = [e["website"] for e in entries if not e["logo_url"] and e["website"]]
        found = logo_finder(sites)
        for e in entries:
            if not e["logo_url"] and e["website"] and found.get(e["website"]):
                e["logo_url"], e["logo_source"] = found[e["website"]], "website"
    for e in entries:
        src = e.get("logo_source")
        stats[f"logo_{src}" if src else "logo_missing"] += 1
    return stats
