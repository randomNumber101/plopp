"""Offline-Tests ohne Internet: python -m scraper.tests.test_offline
Mit TEST_DB_URL wird zusätzlich der Import in eine Test-Datenbank geprüft."""

from __future__ import annotations

import os

from scraper import merge, openfoodfacts, wikidata
from scraper.util import clean_beer_name, guess_style, key


def b(v):
    return {"value": v}


WD_BREWERY_ROWS = [
    # Krombacher mit eigenen Koordinaten, zwei Zeilen (zwei Orte) → wird zusammengefasst
    {"b": b("http://www.wikidata.org/entity/Q1"), "bLabel": b("Krombacher Brauerei"),
     "coord": b("Point(7.93 50.98)"), "website": b("https://krombacher.de"),
     "logo": b("http://commons.wikimedia.org/wiki/Special:FilePath/Krombacher%20Logo.svg"),
     "place": b("http://www.wikidata.org/entity/Q100"), "placeLabel": b("Kreuztal"),
     "stateLabel": b("Nordrhein-Westfalen")},
    {"b": b("http://www.wikidata.org/entity/Q1"), "bLabel": b("Krombacher Brauerei"),
     "place": b("http://www.wikidata.org/entity/Q101"), "placeLabel": b("Krombach")},
    # Augustiner: keine eigenen Koordinaten → Koordinaten des Ortes
    {"b": b("http://www.wikidata.org/entity/Q2"), "bLabel": b("Augustiner-Bräu Wagner"),
     "place": b("http://www.wikidata.org/entity/Q102"), "placeLabel": b("München"),
     "placeCoord": b("Point(11.57 48.14)"), "stateLabel": b("Bayern")},
    # geschlossen → raus
    {"b": b("http://www.wikidata.org/entity/Q3"), "bLabel": b("Alte Brauerei"),
     "dissolved": b("1990-01-01T00:00:00Z")},
    # ohne Label → raus
    {"b": b("http://www.wikidata.org/entity/Q4"), "bLabel": b("Q4")},
    # Uerige (Nutzer hat sie schon angelegt)
    {"b": b("http://www.wikidata.org/entity/Q5"), "bLabel": b("Uerige"),
     "coord": b("Point(6.77 51.23)"), "place": b("http://www.wikidata.org/entity/Q103"),
     "placeLabel": b("Düsseldorf"), "stateLabel": b("Nordrhein-Westfalen")},
]

WD_BEER_ROWS = [
    {"beer": b("http://www.wikidata.org/entity/Q10"), "beerLabel": b("Augustiner Edelstoff"),
     "brew": b("http://www.wikidata.org/entity/Q2"), "abv": b("5.6"), "classLabel": b("Helles"),
     "isBeer": b("true")},
    {"beer": b("http://www.wikidata.org/entity/Q11"), "beerLabel": b("Krombacher Pils"),
     "brew": b("http://www.wikidata.org/entity/Q1"), "abv": b("4.8"), "classLabel": b("Pilsner"),
     "gtin": b("4008287051025")},
    # kein Bier (z. B. Limonade der Brauerei) → raus
    {"beer": b("http://www.wikidata.org/entity/Q12"), "beerLabel": b("Krombacher Limo"),
     "brew": b("http://www.wikidata.org/entity/Q1"), "classLabel": b("Limonade")},
]

OFF_DUMP = [
    "code\tproduct_name\tbrands\tcategories_tags\tcountries_tags\timage_small_url\talcohol_100g\n",
    "4008287051025\tKrombacher Pils 0,5l\tKrombacher\ten:beverages,en:beers,en:pilsner-beers\ten:germany\thttps://img/k.jpg\t4.8\n",
    "4008287051026\tPils Dose 6x0,33l\tKrombacher\ten:beverages,en:beers\ten:germany\t\t4.8\n",
    "4008287900019\tKrombacher Weizen\tKrombacher\ten:beers,en:wheat-beers\ten:germany,en:france\t\t5,3\n",
    "4066600000001\tEdelstoff\tAugustiner\ten:beers\ten:germany\t\t\n",
    "4000000000099\tGut & Günstig Pilsener\tGut & Günstig, Edeka\ten:beers\ten:germany\t\t4.9\n",
    "4000000000100\tFranzösisches Bier\tKronenbourg\ten:beers\ten:france\t\t5\n",  # nicht Deutschland
    "4000000000101\tApfelsaft\tKrombacher\ten:juices\ten:germany\t\t\n",  # kein Bier
    "abc\tKaputt\tX\ten:beers\ten:germany\t\t\n",  # ungültiger Code
]


def test_util():
    assert key("Krombacher Brauerei GmbH & Co. KG") == "krombacher"
    assert key("Augustiner-Bräu Wagner") == "augustiner wagner"
    assert clean_beer_name("Pils Dose 6x0,33l", "Krombacher") == "Krombacher Pils"
    assert clean_beer_name("Krombacher Pils 0,5l", "Krombacher") == "Krombacher Pils"
    assert guess_style("Erdinger Weißbier Alkoholfrei") == "Alkoholfrei"
    assert guess_style("Krombacher Weizen") == "Weizen"
    assert guess_style("Paulaner Hefe-Weißbier Dunkel") == "Dunkles Weizen"
    assert guess_style("Augustiner Lagerbier Hell") == "Helles"
    assert guess_style("Paulaner Salvator") == "Doppelbock"
    assert guess_style("Früh Kölsch") == "Kölsch"
    assert guess_style("Uerige Alt") == "Altbier"
    assert guess_style("x", "en:beers,en:pilsner-beers") == "Pils"
    assert guess_style("Berliner Weisse") == "Sour"


def build_catalog():
    wd_b = wikidata.parse_breweries(WD_BREWERY_ROWS)
    assert set(wd_b) == {"Q1", "Q2", "Q5"}, wd_b.keys()
    assert wd_b["Q1"]["city"] == "Kreuztal" and wd_b["Q1"]["lat"] == 50.98
    assert wd_b["Q2"]["lat"] == 48.14 and wd_b["Q2"]["state"] == "Bayern"
    assert wd_b["Q1"]["logo_url"] == "https://commons.wikimedia.org/wiki/Special:FilePath/Krombacher%20Logo.svg?width=128"
    assert wd_b["Q2"]["logo_url"] is None
    wd_beers = wikidata.parse_beers(WD_BEER_ROWS, wd_b)
    assert {x["name"] for x in wd_beers} == {"Augustiner Edelstoff", "Krombacher Pils"}
    off = openfoodfacts.iter_dump(iter(OFF_DUMP))
    assert len(off) == 5, off
    breweries, beers, stats = merge.build(list(wd_b.values()), wd_beers, off)
    return breweries, beers, stats


def test_merge():
    breweries, beers, stats = build_catalog()
    by_name = {x["name"]: x for x in beers}
    # Pils aus Wikidata + zwei OFF-Produkte → ein Bier mit zwei Barcodes
    kp = by_name["Krombacher Pils"]
    assert kp["brewery_ext"] == "wd:Q1"
    assert kp["eans"] == {"4008287051025", "4008287051026"}, kp["eans"]
    assert kp["source"] == "wikidata+off" and kp["image_url"] == "https://img/k.jpg"
    assert by_name["Krombacher Weizen"]["abv"] == 5.3
    # „Edelstoff“ von Marke Augustiner → Augustiner-Bräu Wagner, gleiches Bier wie aus Wikidata
    assert by_name["Augustiner Edelstoff"]["brewery_ext"] == "wd:Q2"
    # Handelsmarke ohne Brauerei → eigene „Brauerei“ aus der Marke
    gg = by_name["Gut & Günstig Pilsener"]
    assert gg["brewery_ext"].startswith("off-brand:")
    assert stats["off_matched"] == 4 and stats["off_unmatched"] == 1, stats
    assert stats["beers_total"] == 4, [x["name"] for x in beers]


def test_db(url: str):
    import psycopg

    from scraper.load import load

    breweries, beers, _ = build_catalog()
    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            # Nutzer hat Uerige + ein Bier vorher selbst angelegt
            cur.execute("delete from public.beer_barcodes; delete from public.checkins; delete from public.wishlist;"
                        " delete from public.beers; delete from public.breweries;")
            cur.execute("insert into public.breweries (name, city, source) values ('Uerige', 'Düsseldorf', 'user') returning id")
            uid = cur.fetchone()[0]
            cur.execute("insert into public.beers (brewery_id, name, source) values (%s, 'Uerige Alt', 'user')", (uid,))
        conn.commit()
        s1 = load(conn, breweries, beers)
        s2 = load(conn, breweries, beers)
        with conn.cursor() as cur:
            cur.execute("select name, city, lat, ext_id, source from public.breweries order by name")
            rows = cur.fetchall()
            cur.execute("select count(*) from public.beers where name = 'Uerige Alt'")
            uerige_alt = cur.fetchone()[0]
    print("Lauf 1:", s1)
    print("Lauf 2:", s2)
    print(rows)
    assert s1["breweries_inserted"] == 3 and s1["breweries_linked"] == 1, s1
    assert s1["beers_inserted"] == 4 and s1["barcodes_inserted"] == 5, s1
    assert s2["breweries_inserted"] == 0 and s2["beers_inserted"] == 0 and s2["barcodes_inserted"] == 0, s2
    assert s2["breweries_updated"] == 0 and s2["beers_updated"] == 0, s2
    ue = [r for r in rows if r[0] == "Uerige"][0]
    assert ue[2] == 51.23 and ue[3] == "wd:Q5" and ue[4] == "user", ue  # ergänzt, nicht überschrieben
    assert uerige_alt == 1


if __name__ == "__main__":
    test_util()
    test_merge()
    print("Offline-Tests OK")
    if os.environ.get("TEST_DB_URL"):
        test_db(os.environ["TEST_DB_URL"])
        print("DB-Test OK")
