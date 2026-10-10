"""Katalog aktualisieren: python -m scraper.main  (Umgebungsvariable DB_URL nötig)

Ablauf:
  1. Wikipedia-Listen (Rückgrat, verifiziert) + Wikidata (Prüfung verlinkter Objekte, weitere Brauereien)
  2. Koordinaten (Wikipedia/Wikidata, sonst Nominatim mit Bundesland-Gegenprobe), Website, Logo
  3. OpenStreetMap + Open Brewery DB: genaue Lage, Adresse, Website; weitere (ungeprüfte) Brauereien
  4. Brauerei-Websites: Adresse aus Impressum/JSON-LD, Sortiment (Shop, JSON-LD, HTML-Regeln, optional KI)
  5. Open Food Facts zuordnen (Marke, Produktname, Bierkatalog, Markenwort, Ort, EAN-Präfix), Dubletten zusammenführen
  6. Laden + Aufräumen
Fortschritt: im Log und live in der App (Mehr → Katalog).

Optionen:
  --dry-run   nichts in die Datenbank schreiben, nur Bericht erzeugen
"""

from __future__ import annotations

import base64
from collections import Counter
import gzip
import json
import os
import subprocess
import sys
import tempfile
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

from . import enrich, merge, obdb, openfoodfacts, osm, sites, wikidata, wikipedia
from .geocode import Geocoder
from .progress import Progress

STEPS = ["Wikipedia-Listen", "Wikidata", "Koordinaten & Logos", "OpenStreetMap", "Open Brewery DB",
         "Open Food Facts", "Brauerei-Websites (Adressen & Bierkataloge)", "Biere zuordnen & zusammenführen",
         "Datenbank"]

if os.environ.get("GITHUB_ACTIONS") and os.environ.get("RUNNER_TEMP"):
    OUT_DIR = Path(os.environ["RUNNER_TEMP"]) / "catalog"
else:
    OUT_DIR = Path(__file__).resolve().parent.parent / "catalog"


def _annotate(level: str, title: str, text: str) -> None:
    if not os.environ.get("GITHUB_ACTIONS"):
        return
    msg = text.replace("%", "%25").replace("\r", "").replace("\n", "%0A")
    print(f"::{level} title={title}::{msg}", flush=True)


def publish_debug(files: dict[str, str]) -> str:
    """Rohdaten + Bericht auf den Branch „catalog-data“ legen (für die Fehlersuche lesbar über die GitHub-API)."""
    if not os.environ.get("GITHUB_ACTIONS"):
        return "übersprungen (lokal)"
    ws = os.environ.get("GITHUB_WORKSPACE", ".")
    try:
        header = subprocess.run(["git", "-C", ws, "config", "--get-regexp", r"http\..*\.extraheader"],
                                capture_output=True, text=True).stdout.strip()
        repo = f"https://github.com/{os.environ['GITHUB_REPOSITORY']}.git"
        with tempfile.TemporaryDirectory() as d:
            for name, content in files.items():
                (Path(d) / name).write_text(content, encoding="utf-8")
            cfg = []
            if header:
                k, v = header.split(" ", 1)
                cfg = ["-c", f"{k}={v}"]
            cmds = [
                ["git", "init", "-q", "-b", "catalog-data"],
                ["git", "add", "-A"],
                ["git", "-c", "user.name=katalog-bot", "-c",
                 "user.email=41898282+github-actions[bot]@users.noreply.github.com", "commit", "-q", "-m", "Katalog-Daten"],
                ["git", *cfg, "push", "-q", "-f", repo, "catalog-data"],
            ]
            for c in cmds:
                r = subprocess.run(c, cwd=d, capture_output=True, text=True)
                if r.returncode != 0:
                    return f"Fehler bei {' '.join(c[:3])}: {r.stderr.strip()[:500]}"
        return "ok"
    except Exception as e:  # noqa: BLE001
        return f"Fehler: {e}"


def write_report(stats: dict, errors: list[str], timings: dict) -> str:
    OUT_DIR.mkdir(exist_ok=True)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    g = stats.get
    lines = ["# Katalog-Bericht", "", f"Letzter Lauf: {now}", "", "| Kennzahl | Wert |", "| --- | ---: |"]
    for k, v in stats.items():
        if k in ("top_unmatched_brands", "samples", "geocode_failures", "qid_rejected_samples", "osm_unmatched_samples"):
            continue
        lines.append(f"| {k} | {json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else v} |")
    lines += ["", "## Häufigste Marken ohne Brauerei-Zuordnung", ""]
    lines += [f"- {b} ({n})" for b, n in g("top_unmatched_brands", []) or []]
    lines += ["", "## Nicht geokodiert (Auswahl)", ""] + [f"- {x}" for x in g("geocode_failures", []) or []]
    lines += ["", "## Abgelehnte Wikidata-Links (Auswahl)", ""] + [f"- {x}" for x in g("qid_rejected_samples", []) or []]
    lines += ["", "## OSM-Brauereien ohne Zuordnung (Auswahl, als neue Einträge übernommen)", ""] + \
        [f"- {x}" for x in g("osm_unmatched_samples", []) or []]
    lines += ["", "## Laufzeiten (s)", ""] + [f"- {k}: {v}" for k, v in timings.items()]
    if errors:
        lines += ["", "## Fehler", ""] + [f"```\n{e}\n```" for e in errors]
    report = "\n".join(lines) + "\n"
    (OUT_DIR / "report.md").write_text(report, encoding="utf-8")
    (OUT_DIR / "stats.json").write_text(json.dumps({"run_at": now, "stats": stats, "errors": errors,
                                                    "timings_s": timings}, ensure_ascii=False, indent=2, default=list),
                                        encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(report)
    compact = {k: v for k, v in stats.items() if k not in ("top_unmatched_brands", "samples", "osm_unmatched_samples",
                                                           "geocode_failures", "qid_rejected_samples")}
    compact["top_unmatched_brands"] = (stats.get("top_unmatched_brands") or [])[:20]
    compact["timings_s"] = timings
    _annotate("notice", "Katalog-Statistik", json.dumps(compact, ensure_ascii=False, default=list)[:60000])
    for e in errors:
        _annotate("warning", "Katalog-Fehler", e[-3500:])
    return report


def main() -> int:
    dry = "--dry-run" in sys.argv
    errors: list[str] = []
    timings: dict = {}
    stats: dict = {}
    raw_pages: dict = {}

    def timed(name, fn):
        t = time.time()
        try:
            return fn()
        finally:
            timings[name] = round(time.time() - t, 1)
            print(f"{name}: {timings[name]} s", flush=True)

    conn = None
    geo_cache, web_cache, overrides, site_cache, hidden = {}, {}, {}, {}, []
    if not dry and os.environ.get("DB_URL"):
        try:
            import psycopg

            from .load import load_caches

            conn = psycopg.connect(os.environ["DB_URL"], autocommit=False, prepare_threshold=None)
            geo_cache, web_cache, overrides, site_cache, hidden = load_caches(conn)
        except Exception:  # noqa: BLE001
            errors.append("Datenbank (Verbindung/Caches):\n" + traceback.format_exc())
    prog = Progress(STEPS, os.environ.get("DB_URL") if conn else None)

    def with_fallback(name: str, fn, minimum: int):
        """Quelle abrufen; klappt das nicht (oder kommt zu wenig), den letzten guten Stand nehmen."""
        from .load import source_cache_get, source_cache_put

        try:
            data = fn()
            if len(data) < minimum:
                raise RuntimeError(f"nur {len(data)} Einträge (erwartet ≥ {minimum})")
            if conn:
                source_cache_put(conn, name, data)
            return data
        except Exception:  # noqa: BLE001
            err = traceback.format_exc()
            old, when = source_cache_get(conn, name) if conn else (None, None)
            if old:
                prog.note(f"Abruf fehlgeschlagen – nutze Stand vom {when:%d.%m.%Y}")
                _annotate("warning", f"{name}: letzter guter Stand", err[-1500:])
                stats[f"{name}_aus_zwischenspeicher"] = f"{when:%Y-%m-%d}"
                return old
            raise

    # 1. Wikipedia
    wp_entries: list[dict] = []
    prog.step(STEPS[0])
    try:
        wp_entries, raw_pages = timed("wikipedia", wikipedia.fetch)
        stats["wp_entries"] = len(wp_entries)
        stats["wp_entries_by_state"] = dict(sorted(Counter(e["state"] for e in wp_entries).items()))
        stats["wp_with_link"] = sum(1 for e in wp_entries if e.get("qid"))
    except Exception:  # noqa: BLE001
        errors.append("Wikipedia:\n" + traceback.format_exc())

    # 2. Wikidata
    wd_breweries, wd_beers, wd_aliases, check = [], [], {}, {}
    prog.step(STEPS[1])
    try:
        wd_breweries, wd_beers, wd_aliases = timed("wikidata", wikidata.fetch)
        check = timed("wikidata_pruefung", lambda: wikidata.check_entities([e["qid"] for e in wp_entries if e.get("qid")]))
    except Exception:  # noqa: BLE001
        errors.append("Wikidata:\n" + traceback.format_exc())

    # 3. Anreicherung
    prog.step(STEPS[2])
    prog.note(f"{len(wd_breweries)} Brauereien und {len(wd_beers)} Biere aus Wikidata, {len(wp_entries)} Einträge aus Wikipedia")
    geocoder = Geocoder(cache=geo_cache, budget_s=float(os.environ.get("GEOCODE_BUDGET_S", "1500")))
    web_new: dict = {}
    if wp_entries:
        try:
            stats.update(enrich.assign_qids(wp_entries, check, wd_breweries))
            stats["qid_rejected_samples"] = [f"{e['name']} → {e.get('link_title')} ({e['qid_rejected']})"
                                             for e in wp_entries if e.get("qid_rejected")][:40]
            stats.update(timed("geokodierung", lambda: enrich.apply_coords(wp_entries, geocoder)))
            stats["geocode_requests"] = geocoder.requests
            stats["geocode_rejected_state"] = geocoder.rejected_state
            stats["geocode_failures"] = [f"{e['name']} | {e.get('place')} | {e.get('state')}"
                                         for e in wp_entries if e["lat"] is None][:60]

            def logos(sites):
                from .weblogo import find_logos

                found, new = find_logos(sites, web_cache, budget_s=float(os.environ.get("LOGO_BUDGET_S", "600")))
                web_new.update(new)
                return found

            stats.update(timed("logos", lambda: enrich.apply_websites_and_logos(wp_entries, logos)))
        except Exception:  # noqa: BLE001
            errors.append("Anreicherung:\n" + traceback.format_exc())

    # 3b. OpenStreetMap
    osm_elements: list[dict] = []
    prog.step(STEPS[3])
    try:
        osm_elements = timed("openstreetmap", lambda: with_fallback("openstreetmap", osm.fetch, 500))
        prog.note(f"{len(osm_elements)} Brauereien in OpenStreetMap")
    except Exception:  # noqa: BLE001
        errors.append("OpenStreetMap:\n" + traceback.format_exc())

    # 3b2. Open Brewery DB
    obdb_elements: list[dict] = []
    prog.step(STEPS[4])
    try:
        obdb_elements = timed("openbrewerydb", lambda: with_fallback("openbrewerydb", obdb.fetch, 300))
        prog.note(f"{len(obdb_elements)} Brauereien in der Open Brewery DB")
    except Exception:  # noqa: BLE001
        errors.append("Open Brewery DB:\n" + traceback.format_exc())

    # 3c. Brauerei-Websites (wird in merge.build aufgerufen, sobald alle Websites bekannt sind)
    site_new: dict = {}
    site_all: dict = {}
    addr_geocoder = Geocoder(cache=geo_cache, budget_s=float(os.environ.get("ADDRESS_GEOCODE_BUDGET_S", "900")))

    def crawl(by_site: dict) -> dict:
        def run():
            prog.step(STEPS[6])
            res, new = sites.crawl(list(by_site), site_cache, budget_s=float(os.environ.get("SITE_BUDGET_S", "2400")),
                                   progress=prog.cb())
            names = {s_: bs[0]["name"] for s_, bs in by_site.items()}
            calls, state = sites.llm_extract(res, names, max_calls=int(os.environ.get("LLM_MAX_CALLS", "120")),
                                             progress=prog.cb())
            stats["llm_calls"], stats["llm_state"] = calls, state
            for s_, d in res.items():
                if d.get("llm") and s_ not in new:
                    new[s_] = d
            site_new.update(new)
            site_all.update(res)
            stats["sites_crawled_now"] = len(new)
            prog.step(STEPS[7])
            return res

        try:
            return timed("websites", run)
        except Exception:  # noqa: BLE001
            errors.append("Websites:\n" + traceback.format_exc())
            return {}

    # 4. Open Food Facts
    off_products = []
    prog.step(STEPS[5])
    try:
        def off_fetch():
            prods, m = openfoodfacts.fetch(progress=prog.cb())
            stats["off_method"] = m
            return prods

        off_products = timed("openfoodfacts", lambda: with_fallback("openfoodfacts", off_fetch, 200))
    except Exception:  # noqa: BLE001
        errors.append("Open Food Facts:\n" + traceback.format_exc())

    # 5. Zusammenführen
    breweries, beers, mstats = merge.build(wp_entries, wd_breweries, wd_beers, off_products, overrides,
                                           osm=osm_elements, crawl=crawl if os.environ.get("CRAWL", "1") == "1" else None,
                                           geocoder=addr_geocoder, hidden=hidden, obdb=obdb_elements,
                                           wd_aliases=wd_aliases)
    if prog.name != STEPS[7]:
        prog.step(STEPS[7])
    prog.note(f"{len(breweries)} Brauereien, {len(beers)} Biere, {sum(len(b['eans']) for b in beers)} Barcodes")
    stats["address_geocode_requests"] = addr_geocoder.requests
    stats.update(mstats)
    stats["samples"] = [{k: b.get(k) for k in ("name", "city", "state", "trust", "brewery_type", "lat", "logo_url", "website")}
                        for b in breweries[:25]]
    print(json.dumps({k: v for k, v in stats.items() if k not in ("top_unmatched_brands", "samples")},
                     indent=1, ensure_ascii=False, default=list), flush=True)

    # 6. Laden – aufgeräumt wird nur, wenn alle Quellen geklappt haben
    prog.step(STEPS[8])
    if conn and (breweries or beers):
        try:
            from .load import load, save_caches

            complete = not errors and len(wp_entries) > 500 and len(off_products) > 200
            stats.update(timed("datenbank", lambda: load(conn, breweries, beers, prune=complete)))
            stats["pruned"] = complete
        except Exception:  # noqa: BLE001
            errors.append("Datenbank:\n" + traceback.format_exc())
        try:
            conn.rollback()
            save_caches(conn, {**geocoder.new, **addr_geocoder.new}, web_new, site_new)
        except Exception:  # noqa: BLE001
            errors.append("Caches:\n" + traceback.format_exc())
    if conn:
        conn.close()

    report = write_report(stats, errors, timings)
    keep = ("breweries_total", "breweries_on_map", "breweries_with_address", "beers_total", "beers_verified",
            "barcodes_total", "off_products", "off_match_methods", "off_unmatched", "beers_merged", "website_beers",
            "sites_total", "sites_with_beers", "obdb_matched", "obdb_new", "osm_matched", "osm_new", "wd_beers",
            "wd_brand_aliases", "db_breweries", "db_beers", "db_barcodes", "pruned")
    prog.finish(not errors, {**{k: stats.get(k) for k in keep if k in stats}, "fehler": len(errors),
                             "laufzeiten": timings})

    # Rohdaten für die Fehlersuche (Wikitext + geparste Einträge + Bericht)
    if raw_pages:
        files = {
            "report.md": report,
            "wiki_de.txt": raw_pages.get("de", ""),
            "wiki_by.txt": raw_pages.get("by", ""),
            **{f"wiki_{k.replace(':', '_').replace(' ', '_')}.txt": v for k, v in raw_pages.items() if k.startswith("land:")},
            "sites.json": json.dumps({s_: {k: v for k, v in d.items() if k != "text"} for s_, d in sorted(site_all.items())},
                                     ensure_ascii=False, indent=1, default=list),
            "sites_text.json": json.dumps({s_: d["text"] for s_, d in sorted(site_all.items()) if d.get("text")},
                                          ensure_ascii=False, indent=1),
            "breweries.json": json.dumps([{k: b.get(k) for k in ("ext_id", "name", "city", "street", "postcode", "lat",
                                                                 "lng", "geo_precision", "website", "trust", "sources")}
                                          for b in breweries], ensure_ascii=False, indent=0, default=list),
            # alle Biere mit Quelle, Brauerei und Barcodes – für die Qualitätsprüfung des Katalogs
            "beers.json": json.dumps([{k: b.get(k) for k in ("ext_id", "brewery_ext", "name", "style", "abv", "source",
                                                             "trust", "sources", "eans", "image_url")}
                                      for b in beers], ensure_ascii=False, indent=0, default=sorted),
            "off_products.json": json.dumps(off_products, ensure_ascii=False, indent=0, default=list),
            "entries.json": json.dumps([{k: v for k, v in e.items() if k != "wd"} | {"wd": (e.get("wd") or {}).get("qid")}
                                        for e in wp_entries], ensure_ascii=False, indent=1, default=list),
        }
        res = publish_debug(files)
        print(f"Rohdaten-Branch: {res}")
        if res != "ok":
            _annotate("warning", "Rohdaten-Branch", res)
            # Notlösung: Wikitext komprimiert als Annotationen
            blob = base64.b64encode(gzip.compress(json.dumps(raw_pages).encode())).decode()
            chunks = [blob[i:i + 45000] for i in range(0, len(blob), 45000)]
            if len(chunks) <= 8:
                for i, c in enumerate(chunks):
                    _annotate("notice", f"wikitext-{i + 1}-{len(chunks)}", c)

    print(f"Bericht: {OUT_DIR / 'report.md'}")
    return 1 if errors and not stats.get("db_beers") else 0


if __name__ == "__main__":
    sys.exit(main())
