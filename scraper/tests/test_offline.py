"""Offline-Tests ohne Internet: python -m scraper.tests.test_offline
Mit TEST_DB_URL wird zusätzlich der Import in eine Test-Datenbank geprüft."""

from __future__ import annotations

import os
from pathlib import Path

from scraper import enrich, merge, openfoodfacts, wikidata, wikipedia
from scraper.util import clean_beer_name, guess_style, key

FIX = Path(__file__).parent / "fixtures"


def b(v):
    return {"value": v}


def ent(q):
    return b(f"http://www.wikidata.org/entity/{q}")


# Wikidata: alle Brauereien in Deutschland (für ungeprüfte Ergänzungen und Namensabgleich)
WD_BREWERY_ROWS = [
    {"b": ent("Q1"), "bLabel": b("Krombacher Brauerei"), "coord": b("Point(7.93 50.98)"),
     "website": b("https://krombacher.de"), "logo": b("http://commons.wikimedia.org/wiki/Special:FilePath/Krombacher%20Logo.svg"),
     "place": ent("Q100"), "placeLabel": b("Kreuztal"), "stateLabel": b("Nordrhein-Westfalen")},
    {"b": ent("Q2"), "bLabel": b("Brauerei Meister"), "place": ent("Q102"), "placeLabel": b("Pretzfeld"),
     "placeCoord": b("Point(11.17 49.75)"), "stateLabel": b("Bayern")},
    {"b": ent("Q3"), "bLabel": b("Alte Brauerei"), "dissolved": b("1990-01-01T00:00:00Z")},
    {"b": ent("Q4"), "bLabel": b("Q4")},
    {"b": ent("Q50"), "bLabel": b("Brauerei Aying"), "coord": b("Point(11.78 47.97)"), "stateLabel": b("Bayern")},
]

WD_BEER_ROWS = [
    {"beer": ent("Q11"), "beerLabel": b("Krombacher Pils"), "brew": ent("Q1"), "abv": b("4.8"),
     "classLabel": b("Pilsner"), "gtin": b("4008287051025")},
    {"beer": ent("Q12"), "beerLabel": b("Krombacher Limo"), "brew": ent("Q1"), "classLabel": b("Limonade")},
]

# Prüfung der in Wikipedia verlinkten Objekte
CHECK = {
    "Q50": {"is_brewery": True, "coords": (47.97, 11.78), "website": "https://www.ayinger.de/", "dissolved": False,
            "logo_url": "https://commons.wikimedia.org/wiki/Special:FilePath/Ayinger.svg?width=128", "label": "Brauerei Aying"},
    "Q60": {"is_brewery": False, "coords": (47.57, 11.09), "website": None, "dissolved": False, "logo_url": None,
            "label": "Kloster Ettal"},  # Link zeigt auf das Kloster → ablehnen
    "Q70": {"is_brewery": True, "coords": (48.12, 11.55), "website": "https://www.paulaner.de/", "dissolved": False,
            "logo_url": None, "label": "Paulaner Brauerei"},
    "Q80": {"is_brewery": True, "coords": (47.83, 8.17), "website": "https://www.rothaus.de/", "dissolved": False,
            "logo_url": None, "label": "Badische Staatsbrauerei Rothaus"},
}
QIDS = {"Brauerei Aying": "Q50", "Klosterbrauerei Ettal": "Q60", "Paulaner Brauerei": "Q70",
        "Badische Staatsbrauerei Rothaus": "Q80"}

OFF_DUMP = [
    "code\tproduct_name\tbrands\tcategories_tags\tcountries_tags\timage_small_url\talcohol_100g\n",
    "4008287051025\tKrombacher Pils 0,5l\tKrombacher\ten:beverages,en:beers,en:pilsner-beers\ten:germany\thttps://img/k.jpg\t4.8\n",
    "4008287051026\tPils Dose 6x0,33l\tKrombacher\ten:beverages,en:beers\ten:germany\t\t4.8\n",
    "4104231000011\tRothaus Pils 0,33l\tRothaus\ten:beers\ten:germany\thttps://img/r.jpg\t5.1\n",
    "4104231000028\tTannenzäpfle\tTannenzäpfle\ten:beers\ten:germany\t\t5.1\n",
    "4104231000035\tMärzen Export\tStaatsbrauerei Baden\ten:beers\ten:germany\t\t5.6\n",  # Marke unklar → EAN-Präfix
    "4066600000001\tUrhell\tAyinger\ten:beers\ten:germany\t\t\n",
    "4066600000002\tHefe-Weißbier\tPaulaner\ten:beers,en:wheat-beers\ten:germany\t\t5.5\n",
    "4000000000099\tGut & Günstig Pilsener\tGut & Günstig, Edeka\ten:beers\ten:germany\t\t4.9\n",
    "4000000000100\tFranzösisches Bier\tKronenbourg\ten:beers\ten:france\t\t5\n",
    "abc\tKaputt\tX\ten:beers\ten:germany\t\t\n",
]


class FakeGeocoder:
    requests = 0
    rejected_state = 0
    new: dict = {}

    def locate(self, place, state, district=None):
        table = {"Pretzfeld-Unterzaunsbach": (49.76, 11.18, "ort"), "Hallerndorf-Willersdorf": (49.75, 10.95, "ort"),
                 "Forchheim": (49.72, 11.06, "ort"), "Stuttgart": (48.78, 9.18, "ort")}
        return table.get(place)


def test_util():
    assert key("Krombacher Brauerei GmbH & Co. KG") == "krombacher"
    assert clean_beer_name("Pils Dose 6x0,33l", "Krombacher") == "Krombacher Pils"
    assert guess_style("Erdinger Weißbier Alkoholfrei") == "Alkoholfrei"
    assert guess_style("Paulaner Hefe-Weißbier Dunkel") == "Dunkles Weizen"
    assert guess_style("Paulaner Salvator") == "Doppelbock"
    assert guess_style("x", "en:beers,en:pilsner-beers") == "Pils"
    assert merge.short_name("Privatbrauerei Gebr. Gatzweiler GmbH") == "Gebr. Gatzweiler"


def test_wikipedia():
    de = wikipedia.parse_germany((FIX / "de_sample.wiki").read_text(encoding="utf-8"))
    by = wikipedia.parse_bavaria((FIX / "by_sample.wiki").read_text(encoding="utf-8"))
    names = [e["name"] for e in de]
    assert names == ["Alpirsbacher Klosterbräu", "Rothaus", "Brauerei Schmid", "Dinkelacker-Schwaben Bräu",
                     "Dinkelacker-Schwaben Bräu", "Berliner Kindl-Schultheiss-Brauerei", "Usedomer Brauhaus"], names
    roth = de[1]
    assert roth["state"] == "Baden-Württemberg" and roth["place"] == "Grafenhausen-Rothaus"
    assert roth["brands"] == ["Rothaus", "Tannenzäpfle"] and roth["founded"] == "1791"
    assert roth["website"] == "https://www.rothaus.de/" and roth["link_title"] == "Badische Staatsbrauerei Rothaus"
    assert de[0]["logo_file"] == "Alpirsbacher Logo.svg"
    assert de[2]["website"] == "https://www.brauerei-schmid.de/"
    assert de[4]["place"] == "Stuttgart-Vaihingen"  # rowspan
    assert de[5]["place"] == "Berlin"  # Stadtstaat ohne Standort-Spalte
    us = de[6]
    assert us["coords"] == (53.955, 14.164) and us["styles"] == ["Pils", "Dunkel"]
    assert us["type"] == "gasthausbrauerei"

    assert len(by) == 10, [e["name"] for e in by]
    ay = by[0]
    assert ay["name"] == "Ayinger Privatbrauerei" and ay["place"] == "Aying" and ay["region"] == "Oberbayern"
    assert ay["district"] == "Landkreis München" and ay["website"] == "https://www.ayinger.de/"
    assert by[1]["type"] == "museumsbrauerei"
    assert by[3]["type"] == "gasthausbrauerei" and by[3]["place"] == "München-Ludwigsvorstadt"
    assert by[7]["type"] == "kommunbrauhaus" and by[7]["place"] == "Neuhaus an der Pegnitz"
    assert by[8]["name"] == "Brauerei Hebendanz"  # verschachtelte Liste
    return de, by


def build_catalog():
    de, by = test_wikipedia()
    entries = de + by
    for e in entries:
        e["qid"] = QIDS.get(e["link_title"])
    wd_b = list(wikidata.parse_breweries(WD_BREWERY_ROWS).values())
    wd_beers = wikidata.parse_beers(WD_BEER_ROWS, {x["ext_id"].removeprefix("wd:"): x for x in wd_b})
    s1 = enrich.assign_qids(entries, CHECK, wd_b)
    s2 = enrich.apply_coords(entries, FakeGeocoder())
    s3 = enrich.apply_websites_and_logos(entries, lambda sites: {"http://www.rittmayer.de/": "http://www.rittmayer.de/logo.png"})
    off = openfoodfacts.iter_dump(iter(OFF_DUMP))
    breweries, beers, stats = merge.build(entries, wd_b, wd_beers, off, {})
    return entries, breweries, beers, {**s1, **s2, **s3, **stats}


def test_pipeline():
    entries, breweries, beers, st = build_catalog()
    by_name = {e["name"]: e for e in entries}
    # Ettal: Link zeigt aufs Kloster → nicht übernommen
    assert by_name["Ettaler Klosterbrauerei"]["wd"] is None and st["qid_rejected"] == 1
    # Paulaner: Hauptstandort bekommt das Wikidata-Objekt, Bräuhaus wird Unterstandort
    assert by_name["Paulaner Brauerei"]["wd"]["qid"] == "Q70"
    assert by_name["Paulaner Bräuhaus"]["parent_qid"] == "Q70"
    assert by_name["Paulaner Bräuhaus"]["lat"] is None  # keine Koordinaten vom Hauptsitz übernehmen
    # Brauerei Meister: ohne Link, aber über Name + Ort mit Wikidata gefunden
    assert by_name["Brauerei Meister"]["wd"]["qid"] == "Q2" and st["qid_from_name"] == 1
    # Koordinaten
    assert by_name["Usedomer Brauhaus"]["geo_precision"] == "koordinate"
    assert by_name["Ayinger Privatbrauerei"]["geo_precision"] == "wikidata"
    assert by_name["Brauerei Rittmayer"]["geo_precision"] == "ort"
    # Logos
    assert by_name["Ayinger Privatbrauerei"]["logo_source"] == "wikidata"
    assert by_name["Alpirsbacher Klosterbräu"]["logo_source"] == "wikipedia"
    assert by_name["Brauerei Rittmayer"]["logo_url"] == "http://www.rittmayer.de/logo.png"

    bx = {b["ext_id"]: b for b in breweries}
    assert bx["wd:Q50"]["trust"] == "verified" and bx["wd:Q50"]["brewery_type"] == "brauerei"
    assert bx["wd:Q1"]["trust"] == "unverified"  # Krombacher nur aus Wikidata
    assert "wd:Q2" in bx and bx["wd:Q2"]["trust"] == "verified"  # Meister: Wikipedia + Wikidata zusammengeführt
    pb = next(b for b in breweries if b["name"] == "Paulaner Bräuhaus")
    assert pb["parent_ext"] == "wd:Q70" and pb["brewery_type"] == "gasthausbrauerei"
    assert bx["wd:Q80"]["trust"] == "verified" and "Tannenzäpfle" in bx["wd:Q80"]["aliases"]

    beer = {(x["brewery_ext"], x["name"]): x for x in beers}
    # Sorten-Spalte → verifizierte Biere; OFF-Produkt landet im selben Bier (mit Barcode + Bild)
    rp = beer[("wd:Q80", "Rothaus Pils")]
    assert rp["trust"] == "verified" and rp["eans"] == {"4104231000011"} and rp["image_url"] == "https://img/r.jpg"
    assert rp["source"] == "wikipedia+off"
    # Marke „Tannenzäpfle“ → Rothaus über Alias
    assert any(x["brewery_ext"] == "wd:Q80" and "4104231000028" in x["eans"] for x in beers)
    # unbekannte Marke, aber gleiches EAN-Firmenpräfix wie Rothaus
    assert any(x["brewery_ext"] == "wd:Q80" and "4104231000035" in x["eans"] for x in beers), st["off_match_methods"]
    # Ayinger (Marke = Kurzname) und Paulaner (Unternehmen, nicht Bräuhaus)
    assert any(x["brewery_ext"] == "wd:Q50" and "4066600000001" in x["eans"] for x in beers)
    assert any(x["brewery_ext"] == "wd:Q70" and "4066600000002" in x["eans"] for x in beers)
    # Krombacher: Wikidata-Bier + 2 OFF-Barcodes, ungeprüft
    kp = beer[("wd:Q1", "Krombacher Pils")]
    assert kp["eans"] == {"4008287051025", "4008287051026"} and kp["trust"] == "unverified"
    # Handelsmarke ohne Brauerei
    gg = next(x for x in beers if x["name"] == "Gut & Günstig Pilsener")
    assert gg["brewery_ext"].startswith("off-brand:") and bx[gg["brewery_ext"]]["brewery_type"] == "marke"
    assert st["off_unmatched"] == 1, st
    # Limonade aus Wikidata ist kein Bier
    assert not any("Limo" in x["name"] for x in beers)


def test_db(url: str):
    import psycopg

    from scraper.load import load, load_caches, save_caches

    _, breweries, beers, _ = build_catalog()
    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            cur.execute("delete from public.beer_barcodes; delete from public.checkins; delete from public.wishlist;"
                        " delete from public.beers; delete from public.brewery_aliases; delete from public.breweries;")
            # Nutzer hat Uerige selbst angelegt; ein alter Katalog-Eintrag (OFF-Marke) mit Check-in existiert
            cur.execute("insert into public.breweries (name, city, source) values ('Uerige', 'Düsseldorf', 'user')")
            cur.execute("insert into public.breweries (name, ext_id, source, trust) values ('Rothaus', 'off-brand:rothaus', 'off', 'unverified') returning id")
            old_br = cur.fetchone()[0]
            cur.execute("insert into public.beers (brewery_id, name, ext_id, source, trust) values (%s, 'Rothaus Pils', 'beer:off-brand:rothaus:pils', 'off', 'unverified') returning id", (old_br,))
            old_beer = cur.fetchone()[0]
            cur.execute("insert into public.beer_barcodes values ('4104231000011', %s)", (old_beer,))
            cur.execute("insert into public.checkins (user_id, beer_id) values ('11111111-1111-1111-1111-111111111111', %s)", (old_beer,))
        conn.commit()
        s1 = load(conn, breweries, beers, prune=True)
        save_caches(conn, {"Aying, Bayern": {"lat": 1.0, "lng": 2.0, "state": "Bayern", "precision": "ort"}},
                    {"https://x.de/": {"logo_url": None, "status": 404}})
        geo, web, over = load_caches(conn)
        s2 = load(conn, breweries, beers, prune=True)
        with conn.cursor() as cur:
            cur.execute("select b.name, b.trust from public.checkins c join public.beers b on b.id = c.beer_id")
            moved = cur.fetchall()
            cur.execute("select count(*) from public.breweries where ext_id = 'off-brand:rothaus'")
            old_left = cur.fetchone()[0]
            cur.execute("select p.name from public.breweries c join public.breweries p on p.id = c.parent_id where c.name = 'Paulaner Bräuhaus'")
            parent = cur.fetchone()
            cur.execute("select count(*) from public.brewery_aliases")
            aliases = cur.fetchone()[0]
            cur.execute("set role authenticated")
            cur.execute("select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false)")
            cur.execute("select name, trust, brewery_type, total, drunk from public.brewery_progress() where name = 'Rothaus'")
            prog = cur.fetchall()
            cur.execute("reset role")
    print("Lauf 1:", s1)
    print("Lauf 2:", s2)
    assert moved == [("Rothaus Pils", "verified")], moved  # Check-in ist zum geprüften Bier umgezogen
    assert old_left == 0  # alte Pseudo-Brauerei aufgeräumt
    assert s1["checkins_moved"] == 1 and s1["barcodes_moved"] == 1, s1
    assert parent and parent[0] == "Paulaner Brauerei", parent
    assert aliases > 10
    assert s2["breweries_inserted"] == 0 and s2["beers_inserted"] == 0 and s2["barcodes_inserted"] == 0, s2
    assert s2.get("beers_pruned", 0) == 0 and s2.get("breweries_pruned", 0) == 0, s2
    assert geo["Aying, Bayern"]["lat"] == 1.0 and web["https://x.de/"]["status"] == 404
    assert prog and prog[0][1] == "verified" and prog[0][4] == 1, prog


if __name__ == "__main__":
    test_util()
    test_wikipedia()
    test_pipeline()
    print("Offline-Tests OK")
    if os.environ.get("TEST_DB_URL"):
        test_db(os.environ["TEST_DB_URL"])
        print("DB-Test OK")
