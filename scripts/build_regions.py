"""Erzeugt public/regions-de.json: Deutschland in ~45 Bier-Regionen (für „Karte freispielen“).

Grundlage: Kreisgrenzen VG250 des Bundesamts für Kartographie und Geodäsie (© GeoBasis-DE / BKG 2020,
Datenlizenz Deutschland – Namensnennung – Version 2.0), als GeoJSON z. B. aus
github.com/jgehrcke/covid-19-germany-gae/blob/master/geodata/DE-counties.geojson.
Zusammengefasst zu Regierungsbezirken bzw. Bundesländern, dazu einzelne bierreiche Städte/Gegenden
(München, Bamberger Land, Allgäu, Köln, Düsseldorf …). Vereinfacht auf ~1 km, damit die Datei klein bleibt.

Aufruf (einmalig, Ergebnis wird eingecheckt):  python scripts/build_regions.py <kreise.geo.json>
"""

import json
import sys

from shapely.geometry import mapping, shape
from shapely.ops import unary_union

# Regionen nach Amtlichem Gemeindeschlüssel (AGS) der Kreise: Präfix → (id, Anzeigename)
# (3 Stellen = Land + Regierungsbezirk, wo es ihn gibt; sonst 2 Stellen = Land)
BASE = {
    "091": ("oberbayern", "Oberbayern"), "092": ("niederbayern", "Niederbayern"), "093": ("oberpfalz", "Oberpfalz"),
    "094": ("oberfranken", "Oberfranken"), "095": ("mittelfranken", "Mittelfranken"),
    "096": ("unterfranken", "Unterfranken"), "097": ("schwaben", "Bayerisch-Schwaben"),
    "081": ("wuerttemberg", "Württemberg & Hohenlohe"), "082": ("nordbaden", "Nordbaden & Nordschwarzwald"),
    "083": ("suedbaden", "Südbaden & Schwarzwald"), "084": ("oberschwaben", "Oberschwaben & Schwäbische Alb"),
    "064": ("suedhessen", "Südhessen & Rhein-Main"), "065": ("mittelhessen", "Mittelhessen"),
    "066": ("nordhessen", "Nordhessen"),
    "053": ("rheinland", "Rheinland (Aachen, Bonn, Bergisches Land)"),
    "051": ("niederrhein", "Niederrhein & westliches Ruhrgebiet"),
    "055": ("muensterland", "Münsterland & nördliches Ruhrgebiet"), "057": ("owl", "Ostwestfalen-Lippe"),
    "059": ("sauerland", "Sauerland, Siegerland & östliches Ruhrgebiet"),
    "034": ("weser-ems", "Ostfriesland, Oldenburg & Emsland"), "033": ("lueneburg", "Lüneburger Heide & Elbe-Weser"),
    "032": ("hannover", "Hannover & Weserbergland"), "031": ("braunschweig", "Braunschweiger Land & Harz"),
    "071": ("mittelrhein", "Mittelrhein, Westerwald & Eifel"), "072": ("mosel", "Mosel & Trierer Land"),
    "073": ("pfalz", "Pfalz & Rheinhessen"),
    "145": ("erzgebirge", "Erzgebirge, Vogtland & Chemnitz"), "146": ("oberlausitz", "Elbland, Sächsische Schweiz & Oberlausitz"),
    "147": ("leipzig", "Leipziger Land"),
    "16": ("thueringen", "Thüringen"), "01": ("sh", "Schleswig-Holstein"), "02": ("hamburg", "Hamburg"),
    "04": ("bremen", "Bremen"), "11": ("berlin", "Berlin"), "12": ("brandenburg", "Brandenburg"),
    "13": ("mv", "Mecklenburg-Vorpommern"), "10": ("saarland", "Saarland"),
}
# Sachsen-Anhalt hat keine Bezirksstelle im Schlüssel → Kreise direkt
ST = {
    "15001": "anhalt", "15082": "anhalt", "15091": "anhalt",
    "15002": "saale", "15084": "saale", "15087": "saale", "15088": "saale",
    "15003": "altmark", "15081": "altmark", "15083": "altmark", "15085": "altmark", "15086": "altmark",
    "15089": "altmark", "15090": "altmark",
}
ST_NAMES = {"anhalt": "Anhalt & Wittenberg", "saale": "Halle & Saale-Unstrut", "altmark": "Magdeburg, Harz & Altmark"}

# bierreiche Städte/Gegenden als eigene Regionen (Kreis-AGS → id, Name)
SPECIAL = {
    "09162": ("muenchen", "München"),
    "09461": ("bamberg", "Bamberger Land"), "09471": ("bamberg", "Bamberger Land"),
    "09564": ("nuernberg", "Nürnberg & Fürth"), "09563": ("nuernberg", "Nürnberg & Fürth"),
    **{a: ("allgaeu", "Allgäu") for a in ("09780", "09777", "09778", "09776", "09763", "09762", "09764")},
    "05315": ("koeln", "Köln"), "05111": ("duesseldorf", "Düsseldorf"), "06412": ("frankfurt", "Frankfurt am Main"),
    "14713": ("leipzig-stadt", "Leipzig"), "14612": ("dresden", "Dresden"),
}
STATES = {"01": "Schleswig-Holstein", "02": "Hamburg", "03": "Niedersachsen", "04": "Bremen",
          "05": "Nordrhein-Westfalen", "06": "Hessen", "07": "Rheinland-Pfalz", "08": "Baden-Württemberg",
          "09": "Bayern", "10": "Saarland", "11": "Berlin", "12": "Brandenburg", "13": "Mecklenburg-Vorpommern",
          "14": "Sachsen", "15": "Sachsen-Anhalt", "16": "Thüringen"}


def region_of(ags: str) -> tuple[str, str]:
    if ags in SPECIAL:
        return SPECIAL[ags]
    if ags in ST:
        return ST[ags], ST_NAMES[ST[ags]]
    return BASE.get(ags[:3]) or BASE[ags[:2]]


def _drop_slivers(geom):
    """Winzige Löcher/Inseln aus dem Zusammenfügen der Kreise entfernen (große Löcher wie München bleiben)."""
    from shapely.geometry import MultiPolygon, Polygon

    polys = list(geom.geoms) if isinstance(geom, MultiPolygon) else [geom]
    keep = []
    for p in polys:
        if p.area < 0.0004:
            continue
        holes = [r for r in p.interiors if Polygon(r).area >= 0.002]
        keep.append(Polygon(p.exterior, holes))
    return MultiPolygon(keep) if len(keep) > 1 else keep[0]


def main(path: str, out: str):
    data = json.load(open(path, encoding="utf-8"))
    groups: dict[str, dict] = {}
    for f in data["features"]:
        p = f["properties"]
        if p.get("GF") != 4:  # nur Landflächen (keine Gewässer/Küstenstreifen)
            continue
        ags = p["AGS"]
        rid, name = region_of(ags)
        g = groups.setdefault(rid, {"name": name, "state": STATES[ags[:2]], "geoms": []})
        g["geoms"].append(shape(f["geometry"]).buffer(0))
    feats = []
    for rid, g in groups.items():
        geom = unary_union([x.buffer(0.002) for x in g["geoms"]]).buffer(-0.002)
        geom = _drop_slivers(geom).simplify(0.015, preserve_topology=True)
        gj = mapping(geom)

        def rnd(c):
            return [rnd(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], 3), round(c[1], 3)]

        gj = {"type": gj["type"], "coordinates": rnd(gj["coordinates"])}
        feats.append({"type": "Feature", "properties": {"id": rid, "name": g["name"], "state": g["state"]},
                      "geometry": gj})
    feats.sort(key=lambda x: (x["properties"]["state"], x["properties"]["name"]))
    json.dump({"type": "FeatureCollection", "attribution": "© GeoBasis-DE / BKG 2020 (dl-de/by-2-0), vereinfacht",
               "features": feats}, open(out, "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    print(len(feats), "Regionen")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "public/regions-de.json")
