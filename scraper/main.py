"""Katalog aktualisieren: python -m scraper.main  (Umgebungsvariable DB_URL nötig)

Optionen:
  --dry-run   nichts in die Datenbank schreiben, nur Bericht erzeugen
"""

from __future__ import annotations

import json
import os
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

from . import merge, openfoodfacts, wikidata

# In GitHub Actions landet der Bericht im Temp-Ordner (nicht im Repo) und zusätzlich
# als Zusammenfassung des Laufs + Annotation (über die API ohne Login lesbar).
if os.environ.get("GITHUB_ACTIONS") and os.environ.get("RUNNER_TEMP"):
    OUT_DIR = Path(os.environ["RUNNER_TEMP"]) / "catalog"
else:
    OUT_DIR = Path(__file__).resolve().parent.parent / "catalog"


def _annotate(level: str, title: str, text: str) -> None:
    if not os.environ.get("GITHUB_ACTIONS"):
        return
    msg = text.replace("%", "%25").replace("\r", "").replace("\n", "%0A")
    print(f"::{level} title={title}::{msg}", flush=True)


def write_report(stats: dict, errors: list[str], timings: dict) -> None:
    OUT_DIR.mkdir(exist_ok=True)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    (OUT_DIR / "stats.json").write_text(
        json.dumps({"run_at": now, "stats": stats, "errors": errors, "timings_s": timings},
                   ensure_ascii=False, indent=2, default=list),
        encoding="utf-8",
    )
    g = stats.get
    lines = [
        "# Katalog-Bericht",
        "",
        f"Letzter Lauf: {now}",
        "",
        "| | Anzahl |",
        "| --- | ---: |",
        f"| Brauereien aus Wikidata | {g('wd_breweries', '–')} |",
        f"| … davon mit Standort | {g('wd_breweries_with_coords', '–')} |",
        f"| Biere aus Wikidata | {g('wd_beers', '–')} |",
        f"| Produkte aus Open Food Facts ({g('off_method', '–')}) | {g('off_products', '–')} |",
        f"| … einer Wikidata-Brauerei zugeordnet | {g('off_matched', '–')} |",
        f"| … ohne Brauerei-Zuordnung (Marke als Brauerei angelegt) | {g('off_unmatched', '–')} |",
        f"| Katalog: Brauereien / Biere / Barcodes | {g('breweries_total', '–')} / {g('beers_total', '–')} / {g('barcodes_total', '–')} |",
        "",
        "## Datenbank",
        "",
        "| | Anzahl |",
        "| --- | ---: |",
    ]
    for k in ("breweries_inserted", "breweries_updated", "breweries_linked", "beers_inserted",
              "beers_updated", "beers_linked", "barcodes_inserted", "db_breweries",
              "db_breweries_on_map", "db_beers", "db_barcodes"):
        lines.append(f"| {k} | {g(k, '–')} |")
    lines += ["", "## Häufigste Marken ohne Brauerei-Zuordnung", ""]
    for brand, n in g("top_unmatched_brands", []) or []:
        lines.append(f"- {brand} ({n})")
    lines += ["", "## Laufzeiten (s)", ""] + [f"- {k}: {v}" for k, v in timings.items()]
    if errors:
        lines += ["", "## Fehler", ""] + [f"```\n{e}\n```" for e in errors]
    report = "\n".join(lines) + "\n"
    (OUT_DIR / "report.md").write_text(report, encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(report)
    compact = {k: v for k, v in stats.items() if k != "top_unmatched_brands"}
    compact["top_unmatched_brands"] = (stats.get("top_unmatched_brands") or [])[:25]
    compact["timings_s"] = timings
    _annotate("notice", "Katalog-Statistik", json.dumps(compact, ensure_ascii=False, default=list))
    for e in errors:
        _annotate("warning", "Katalog-Fehler", e[-3500:])


def main() -> int:
    dry = "--dry-run" in sys.argv
    errors: list[str] = []
    timings: dict = {}
    stats: dict = {}

    def timed(name, fn):
        t = time.time()
        try:
            return fn()
        finally:
            timings[name] = round(time.time() - t, 1)
            print(f"{name}: {timings[name]} s", flush=True)

    wd_breweries, wd_beers = [], []
    try:
        wd_breweries, wd_beers = timed("wikidata", wikidata.fetch)
    except Exception:  # noqa: BLE001
        errors.append("Wikidata:\n" + traceback.format_exc())

    off_products = []
    try:
        off_products, method = timed("openfoodfacts", openfoodfacts.fetch)
        stats["off_method"] = method
    except Exception:  # noqa: BLE001
        errors.append("Open Food Facts:\n" + traceback.format_exc())

    breweries, beers, mstats = merge.build(wd_breweries, wd_beers, off_products)
    stats.update(mstats)
    print(json.dumps({k: v for k, v in stats.items() if k != "top_unmatched_brands"}, indent=1), flush=True)

    if not dry and (breweries or beers):
        try:
            import psycopg

            url = os.environ["DB_URL"]
            with psycopg.connect(url, autocommit=False, prepare_threshold=None) as conn:
                from .load import load

                stats.update(timed("datenbank", lambda: load(conn, breweries, beers)))
        except Exception:  # noqa: BLE001
            errors.append("Datenbank:\n" + traceback.format_exc())

    write_report(stats, errors, timings)
    print(f"Bericht: {OUT_DIR / 'report.md'}")
    # Fehler nur dann als Fehlschlag melden, wenn gar nichts geladen wurde
    return 1 if errors and not stats.get("db_beers") else 0


if __name__ == "__main__":
    sys.exit(main())
