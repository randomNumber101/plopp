"""In Deutschland verkaufte Biere aus Open Food Facts (Lizenz: ODbL).

Primär wird der tägliche CSV-Export gestreamt (so wünscht es OFF für größere Datenmengen),
nur wenn das scheitert, die Such-API (max. 10 Anfragen/Minute).
"""

from __future__ import annotations

import csv
import gzip
import io
import sys
import time

from .util import get_with_retry, http_session, parse_abv

DUMP_URL = "https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz"
SEARCH_URL = "https://world.openfoodfacts.org/cgi/search.pl"

FIELDS = [
    "code", "product_name", "brands", "categories_tags", "countries_tags",
    "image_small_url", "image_url", "alcohol_100g",
]


def _is_german_beer(categories: str, countries: str) -> bool:
    return "en:beers" in (categories or "") and "en:germany" in (countries or "")


def _product(code, name, brands, categories, image, alcohol) -> dict | None:
    code = (code or "").strip()
    name = (name or "").strip()
    brand = (brands or "").split(",")[0].strip()
    if not code.isdigit() or not (8 <= len(code) <= 14) or not name or not brand:
        return None
    return {
        "ean": code,
        "name": name,
        "brand": brand,
        "categories": categories or "",
        "image_url": (image or "").strip() or None,
        "abv": parse_abv(alcohol),
    }


def iter_dump(lines) -> list[dict]:
    """Filtert Zeilen des CSV-Exports (Tab-getrennt, erste Zeile = Spaltennamen)."""
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
        # schneller Vorfilter ohne Zerlegen
        if "en:beers" not in line or "en:germany" not in line:
            continue
        parts = line.rstrip("\n").split("\t")
        if not _is_german_beer(col(parts, "categories_tags"), col(parts, "countries_tags")):
            continue
        p = _product(
            col(parts, "code"), col(parts, "product_name"), col(parts, "brands"),
            col(parts, "categories_tags"), col(parts, "image_small_url") or col(parts, "image_url"),
            col(parts, "alcohol_100g"),
        )
        if p:
            out.append(p)
    return out


def fetch_dump() -> list[dict]:
    s = http_session()
    with s.get(DUMP_URL, stream=True, timeout=300) as r:
        r.raise_for_status()
        r.raw.decode_content = False
        gz = gzip.GzipFile(fileobj=r.raw)
        text = io.TextIOWrapper(gz, encoding="utf-8", errors="replace", newline="\n")
        return iter_dump(iter(text))


def fetch_api(max_pages: int = 200) -> list[dict]:
    s = http_session()
    out = []
    for page in range(1, max_pages + 1):
        params = {
            "action": "process",
            "tagtype_0": "categories", "tag_contains_0": "contains", "tag_0": "beers",
            "tagtype_1": "countries", "tag_contains_1": "contains", "tag_1": "germany",
            "fields": ",".join(["code", "product_name", "product_name_de", "brands",
                                "categories_tags", "image_small_url", "nutriments"]),
            "page_size": 100, "page": page, "json": 1,
        }
        data = get_with_retry(s, SEARCH_URL, params=params).json()
        products = data.get("products") or []
        for p in products:
            prod = _product(
                p.get("code"), p.get("product_name_de") or p.get("product_name"), p.get("brands"),
                ",".join(p.get("categories_tags") or []), p.get("image_small_url"),
                (p.get("nutriments") or {}).get("alcohol_100g"),
            )
            if prod:
                out.append(prod)
        if len(products) < 100:
            break
        time.sleep(7)  # Rate-Limit: 10 Suchanfragen pro Minute
    return out


def fetch() -> tuple[list[dict], str]:
    """Liefert (Produkte, verwendete Methode)."""
    try:
        return fetch_dump(), "CSV-Export"
    except Exception as e:  # noqa: BLE001
        print(f"OFF-Export fehlgeschlagen ({e}), nutze Such-API", flush=True)
        return fetch_api(), "Such-API"
