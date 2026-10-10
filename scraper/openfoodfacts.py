"""Biere eines Landes aus Open Food Facts (Lizenz: ODbL, Bilder CC BY-SA).

Primär die Such-API v2 (Seiten à 100 Produkte, ~20 Anfragen – innerhalb des Limits von 10/Minute),
weil sie deutsche Namen, Herstellungsort und alle Marken liefert. Rückfall: der tägliche CSV-Export.

Jedes Produkt: ean, name (deutsch, sonst irgendein Name), names (alle Namensvarianten), brands (alle Marken,
bereinigt), brand (erste brauchbare Marke), places (Herstellungsort, z. B. „Krombacher Brauerei 57223 Krombach“),
categories, image_url, abv.
"""

from __future__ import annotations

import csv
import gzip
import io
import re
import sys
import time

from .util import fold, get_with_retry, http_session, parse_abv

DUMP_URL = "https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz"
API_URL = "https://world.openfoodfacts.org/api/v2/search"

# Land → (Tag in OFF, Name in der Datenbank)
COUNTRIES = {"de": ("en:germany", "germany")}

API_FIELDS = ["code", "product_name", "product_name_de", "product_name_en", "generic_name_de", "generic_name",
              "brands", "brand_owner", "manufacturing_places", "categories_tags", "image_front_small_url",
              "image_small_url", "nutriments"]

FIELDS = [
    "code", "product_name", "generic_name", "brands", "brand_owner", "manufacturing_places", "categories_tags",
    "countries_tags", "image_small_url", "image_url", "alcohol_100g",
]

# Wörter, die keine Marke sind („Bier, Veltins“ → „Veltins“)
_NOT_A_BRAND = {"bier", "beer", "biere", "pils", "pilsner", "pilsener", "weizen", "weissbier", "lager", "radler",
                "alkoholfrei", "export", "helles", "dunkel", "craft", "craft beer", "bio", "premium", "original",
                "deutschland", "germany", "made in germany", "brauerei", "brewery", "sans marque", "no brand",
                "unknown", "unbekannt", "diverse", "keine"}


def clean_brands(raw: str | list | None) -> list[str]:
    items = raw if isinstance(raw, list) else re.split(r"[,;]", raw or "")
    out = []
    for b in items:
        b = (b or "").strip()
        if not b:
            continue
        if "-" in b and " " not in b and b.lower() == b:  # Tag-Schreibweise „privatbrauerei-herrenhausen-gmbh“
            b = b.replace("-", " ")
        if fold(b) in _NOT_A_BRAND or len(b) < 2:
            continue
        if b not in out:
            out.append(b)
    return out


def _product(code, names, brands, categories, image, alcohol, places=None, owner=None) -> dict | None:
    code = (code or "").strip()
    names = [n.strip() for n in names if n and n.strip()]
    bl = clean_brands(brands)
    if owner:
        bl += [b for b in clean_brands(owner) if b not in bl]
    if not code.isdigit() or not (8 <= len(code) <= 14) or not (names or bl):
        return None
    return {
        "ean": code,
        "name": names[0] if names else "",
        "names": names,
        "brand": bl[0] if bl else "",
        "brands": bl,
        "places": (places or "").strip(),
        "categories": categories or "",
        "image_url": (image or "").strip() or None,
        "abv": parse_abv(alcohol),
    }


# --------------------------------------------------------------------------- API v2

def fetch_api(country: str = "de", page_size: int = 100, max_pages: int = 60, progress=None) -> list[dict]:
    tag = COUNTRIES[country][1]
    s = http_session()
    out, page, total, seen = [], 1, None, 0
    while page <= max_pages:
        params = {"categories_tags_en": "beers", "countries_tags_en": tag, "page_size": page_size, "page": page,
                  "fields": ",".join(API_FIELDS)}
        data = get_with_retry(s, API_URL, params=params).json()
        total = total or data.get("count") or 0
        products = data.get("products") or []
        seen += len(products)
        for p in products:
            nut = p.get("nutriments") or {}
            prod = _product(
                p.get("code"),
                [p.get("product_name_de"), p.get("product_name"), p.get("product_name_en"),
                 p.get("generic_name_de"), p.get("generic_name")],
                p.get("brands"), ",".join(p.get("categories_tags") or []),
                p.get("image_front_small_url") or p.get("image_small_url"),
                nut.get("alcohol_100g", nut.get("alcohol")), p.get("manufacturing_places"), p.get("brand_owner"),
            )
            if prod:
                out.append(prod)
        if progress:
            progress(min(seen, total or seen), total or seen, f"{len(out)} Biere")
        if not products or seen >= (total or 0):
            break
        page += 1
        time.sleep(6.5)  # Such-Limit: 10 Anfragen pro Minute
    if total and len(out) < 0.5 * total:
        raise RuntimeError(f"OFF-API unvollständig: {len(out)} von {total}")
    return out


# --------------------------------------------------------------------------- CSV-Export (Rückfall)

def iter_dump(lines, country: str = "de") -> list[dict]:
    """Filtert Zeilen des CSV-Exports (Tab-getrennt, erste Zeile = Spaltennamen)."""
    tag = COUNTRIES[country][0]
    csv.field_size_limit(sys.maxsize)
    header = next(lines).rstrip("\n").split("\t")
    idx = {name: header.index(name) for name in FIELDS if name in header}
    missing = [f for f in ("code", "product_name", "brands", "categories_tags", "countries_tags") if f not in idx]
    if missing:
        raise RuntimeError(f"Spalten fehlen im OFF-Export: {missing}")

    def col(parts, name):
        i = idx.get(name)
        return parts[i] if i is not None and i < len(parts) else ""

    out = []
    for line in lines:
        if "en:beers" not in line or tag not in line:  # schneller Vorfilter
            continue
        parts = line.rstrip("\n").split("\t")
        if "en:beers" not in col(parts, "categories_tags") or tag not in col(parts, "countries_tags"):
            continue
        p = _product(
            col(parts, "code"), [col(parts, "product_name"), col(parts, "generic_name")], col(parts, "brands"),
            col(parts, "categories_tags"), col(parts, "image_small_url") or col(parts, "image_url"),
            col(parts, "alcohol_100g"), col(parts, "manufacturing_places"), col(parts, "brand_owner"),
        )
        if p:
            out.append(p)
    return out


def fetch_dump(country: str = "de") -> list[dict]:
    s = http_session()
    with s.get(DUMP_URL, stream=True, timeout=300) as r:
        r.raise_for_status()
        r.raw.decode_content = False
        gz = gzip.GzipFile(fileobj=r.raw)
        text = io.TextIOWrapper(gz, encoding="utf-8", errors="replace", newline="\n")
        return iter_dump(iter(text), country)


def fetch(country: str = "de", progress=None) -> tuple[list[dict], str]:
    """Liefert (Produkte, verwendete Methode)."""
    try:
        return fetch_api(country, progress=progress), "API"
    except Exception as e:  # noqa: BLE001
        print(f"OFF-API fehlgeschlagen ({e}), nutze CSV-Export", flush=True)
        return fetch_dump(country), "CSV-Export"
