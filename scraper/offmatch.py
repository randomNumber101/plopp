"""Open-Food-Facts-Produkte der richtigen Brauerei zuordnen und Biere zusammenführen.

Reihenfolge der Zuordnung (erstes Verfahren mit eindeutigem Ergebnis gewinnt):
1. korrektur   – manuelle Zuordnung aus der App (match_overrides)
2. marke       – eine der Marken (alle, nicht nur die erste) ist Name/Alias einer Brauerei
3. produktname – das erste Wort bzw. die ersten zwei Wörter des Produktnamens sind ein Alias („Früh Kölsch“)
4. katalog     – der Produktname steht so im Bierkatalog genau einer Brauerei (Website, Wikipedia, Wikidata)
5. markenwort  – seltenes Wort aus der Marke kommt nur bei einer Brauerei vor („Rothaus“ → „Badische Staatsbrauerei Rothaus“)
6. ort         – Herstellungsort (Postleitzahl bzw. Ort) + ähnlicher Name
7. ean-praefix – gleiche GS1-Firmennummer wie sicher zugeordnete Produkte (9, 8 bzw. 7 Stellen)
Handelsmarken (Aldi, Lidl, Netto …) werden nicht über Marke/Ort einer Brauerei zugeordnet.
"""

from __future__ import annotations

import re
from collections import Counter, defaultdict

from rapidfuzz import fuzz

from .util import fold, guess_style, key, tokens

RETAILERS = {
    "aldi", "aldi nord", "aldi sud", "lidl", "netto", "netto md", "netto marken discount", "penny", "rewe",
    "rewe beste wahl", "ja", "edeka", "gut gunstig", "gut & gunstig", "k classic", "kaufland", "real", "norma",
    "globus", "marktkauf", "tegut", "famila", "combi", "nahkauf", "trinkgut", "getranke hoffmann", "flaschenpost",
}

# Wörter, die zwei Biere sicher unterscheiden – unterscheiden sich zwei Namen darin, sind es verschiedene Biere
DISTINCT = {
    "alkoholfrei", "alkoholfreies", "alkoholfreie", "00", "0", "dunkel", "dunkles", "dunkle", "hell", "helles", "helle",
    "leicht", "leichtes", "light", "radler", "naturradler", "weizen", "weisse", "weiss", "weissbier", "hefe", "kristall",
    "pils", "pilsner", "pilsener", "export", "bock", "doppelbock", "maibock", "weizenbock", "eisbock", "festbier",
    "kellerbier", "keller", "zwickel", "zwickl", "lager", "marzen", "schwarzbier", "schwarz", "alt", "altbier", "kolsch",
    "ipa", "stout", "porter", "rauch", "rauchbier", "rot", "rotbier", "natur", "naturtrub", "grapefruit", "zitrone",
    "lemon", "cola", "orange", "mango", "kirsch", "blutorange", "holunder", "ingwer", "spezial", "urtyp", "premium",
    "gold", "edel", "landbier", "vollbier", "winter", "sommer", "weihnacht", "weihnachtsbier", "oktoberfest", "wiesn",
    "bio", "ale", "pale", "red", "amber", "dry", "imperial", "double", "triple", "tripel", "dubbel", "sour", "gose",
}
_FILLER = {"bier", "beer", "biere", "brauerei", "original"}


_CANON = {"helles": "hell", "helle": "hell", "heller": "hell", "dunkles": "dunkel", "dunkle": "dunkel",
          "dunkler": "dunkel", "alkoholfreies": "alkoholfrei", "alkoholfreie": "alkoholfrei", "pilsner": "pils",
          "pilsener": "pils", "weisse": "weiss", "weizen": "weiss", "zwickl": "zwickel", "leichtes": "leicht",
          "leichte": "leicht", "naturtrub": "natur", "marzen": "marzen", "kolsch": "kolsch"}


def canon_tokens(name: str) -> list[str]:
    """Vergleichbare Wörter: „Kellerbier“ → keller, „Helles“ → hell, „Pilsener“ → pils, „Weißbier“ → weiss."""
    out = []
    for t in tokens(name):
        if t in _FILLER:
            continue
        if t.endswith("bier") and len(t) >= 7:
            t = t[:-4]
        t = _CANON.get(t, t)
        out.append(t)
    return out


def compact(name: str) -> str:
    return "".join(canon_tokens(name))


_DISTINCT_CANON = {_CANON.get(d[:-4] if d.endswith("bier") and len(d) >= 7 else d, d[:-4] if d.endswith("bier") and len(d) >= 7 else d)
                   for d in DISTINCT} | {"fest", "weihnacht"}


def distinct_diff(a: str, b: str) -> bool:
    """True, wenn sich die Namen in einem Sorten-/Geschmackswort unterscheiden („Pils“ ≠ „Pils alkoholfrei“)."""
    ta, tb = set(canon_tokens(a)), set(canon_tokens(b))
    return bool((ta ^ tb) & _DISTINCT_CANON)


def abv_ok(a, b) -> bool:
    return a is None or b is None or abs(float(a) - float(b)) <= 0.35


def same_beer(a: str, b: str, abv_a=None, abv_b=None) -> bool:
    """Gleiches Bier? Kompakte Schlüssel gleich bzw. sehr ähnlich, kein unterscheidendes Wort, Alkohol passt."""
    if not abv_ok(abv_a, abv_b) or distinct_diff(a, b):
        return False
    ca, cb = compact(a), compact(b)
    if not ca or not cb:
        return False
    if ca == cb:
        return True
    return min(len(ca), len(cb)) >= 6 and fuzz.ratio(ca, cb) >= 93


# --------------------------------------------------------------------------- Namen

_JUNK_NAME = re.compile(r"^(alk\.?|alc\.?|vol\.?|inhalt|ml|cl|l|liter|\d+([.,]\d+)?%?|x)$", re.IGNORECASE)


def meaningful(name: str, brand_tokens: set[str]) -> bool:
    """Bleibt nach Abzug von Marke, Zahlen, Einheiten noch ein echtes Wort übrig?"""
    for w in re.split(r"[\s,;/()]+", name or ""):
        t = fold(w).strip(".-:'\"")
        if len(t) >= 3 and not _JUNK_NAME.match(t) and t not in brand_tokens and re.search(r"[a-z]{3}", t):
            return True
    return False


def product_name(p: dict, brand: str) -> str | None:
    """Bester Name für ein OFF-Produkt: deutscher Name → andere Namen → Marke + Sorte aus den Kategorien."""
    from .sites import polish

    bt = set(tokens(brand))
    style = guess_style(" ".join(p.get("names") or []), p.get("categories"))
    brand_only = None
    for n in p.get("names") or [p.get("name")]:
        n = re.sub(r"\s*\(\s*\d+([.,]\d+)?\s*%[^)]*\)", "", n or "")
        n2 = polish(n)
        if not n2:
            continue
        if meaningful(n2, bt):
            return n2
        if meaningful(n2, set()):
            brand_only = brand_only or n2  # Name = Marke („Tannenzäpfle“, „Desperados“)
    if brand_only and not style:
        return brand_only
    if style and brand:
        return f"{brand} {style}"
    return brand_only


# --------------------------------------------------------------------------- Zuordnung

class BreweryLookup:
    """Hilfsindizes über alle Brauereien: seltene Wörter, Postleitzahlen, Orte."""

    def __init__(self, breweries: dict[str, dict], parent_of: dict[str, str]):
        self.breweries = breweries
        self.parent_of = parent_of
        self.word: dict[str, set[str]] = defaultdict(set)
        self.plz: dict[str, set[str]] = defaultdict(set)
        self.city: dict[str, set[str]] = defaultdict(set)
        for ext, b in breweries.items():
            if b.get("brewery_type") == "marke":
                continue
            top = parent_of.get(ext, ext)
            for a in [b["name"], *(b.get("aliases") or [])]:
                for t in tokens(a):
                    if len(t) >= 5 and not t.isdigit():
                        self.word[t].add(top)
            if b.get("postcode"):
                self.plz[str(b["postcode"]).strip()[:5]].add(ext)
            if b.get("city"):
                self.city[key(b["city"])].add(ext)

    def rare_word(self, texts: list[str]) -> str | None:
        """Ein Wort aus der Marke, das genau eine Brauerei hat (und kein Sorten-/Ortsallerweltswort ist)."""
        hits = set()
        for text in texts:
            for t in tokens(text):
                if len(t) < 5 or t in DISTINCT or t in self.city:
                    continue
                exts = self.word.get(t)
                if exts and len(exts) == 1:
                    hits |= exts
        return next(iter(hits)) if len(hits) == 1 else None

    def by_place(self, places: str, brand: str) -> str | None:
        if not places:
            return None
        cands: set[str] = set()
        for m in re.finditer(r"\b(\d{5})\b", places):
            cands |= self.plz.get(m.group(1), set())
        if len(cands) == 1:
            return next(iter(cands))  # Postleitzahl der Brauerei = Herstelleranschrift
        if not cands:
            for part in re.split(r"[,;/]", places):
                cands |= self.city.get(key(re.sub(r"\b\d{5}\b|\bd-\b", "", part, flags=re.IGNORECASE)), set())
        if not cands:
            return None
        bk = key(brand)
        scored = []
        for ext in cands:
            b = self.breweries[ext]
            names = [b["name"], *(b.get("aliases") or [])]
            s = max(fuzz.token_set_ratio(bk, key(n)) for n in names) if bk else 0
            scored.append((s, ext))
        scored.sort(reverse=True)
        if len(cands) == 1 and (scored[0][0] >= 50 or not bk):
            return scored[0][1]
        if scored[0][0] >= 75 and (len(scored) == 1 or scored[1][0] < scored[0][0] - 10):
            return scored[0][1]
        return None


def is_retailer(brand: str) -> bool:
    k = fold(brand).replace("&", " ").replace("-", " ")
    k = re.sub(r"\s+", " ", k).strip()
    return k in RETAILERS


def match_products(products: list[dict], index, lookup: BreweryLookup, overrides: dict, catalog: dict[str, set[str]],
                   breweries: dict[str, dict]) -> tuple[list[tuple[dict, str, str]], list[dict], Counter]:
    """→ (zugeordnet [(Produkt, Brauerei, Verfahren)], Rest, Statistik)"""
    how = Counter()
    assigned: list[tuple[dict, str, str]] = []
    pending: list[dict] = []

    def first_words(name: str) -> list[str]:
        w = re.split(r"\s+", (name or "").strip())
        return [" ".join(w[:2]), w[0]] if len(w) >= 2 else w[:1]

    for p in products:
        brands = p.get("brands") or ([p["brand"]] if p.get("brand") else [])
        retail = [b for b in brands if is_retailer(b)]
        own = [b for b in brands if not is_retailer(b)]
        ext, method = None, None
        # 1. Korrektur
        for b in brands:
            k = key(b)
            if k in overrides:
                ext, method = overrides[k], "korrektur"
                break
        if method == "korrektur":
            if ext and ext in breweries:
                assigned.append((p, ext, method))
                how[method] += 1
            else:
                p["_no_brewery"] = True  # „keine Brauerei / Handelsmarke“ bestätigt
                pending.append(p)
                how["korrektur_keine"] += 1
            continue
        # 2. Marke
        for b in own:
            e, m = index.find(b)
            if e:
                ext, method = e, f"marke:{m}"
                break
        # 3. Produktname
        if not ext:
            for w in first_words(p.get("name")):
                if len(key(w)) >= 4:
                    e, m = index.find(w)
                    if e and m == "alias":
                        ext, method = e, "produktname"
                        break
        # 4. Bierkatalog
        if not ext:
            for n in p.get("names") or []:
                for cand in {n, *(f"{b} {n}" for b in own[:1])}:
                    c = compact(cand)
                    if len(c) >= 8 and len(catalog.get(c, ())) == 1:
                        ext, method = next(iter(catalog[c])), "katalog"
                        break
                if ext:
                    break
        # 5. Seltenes Markenwort
        if not ext and own:
            e = lookup.rare_word(own)
            if e:
                ext, method = e, "markenwort"
        # 6. Herstellungsort
        if not ext and not retail:
            e = lookup.by_place(p.get("places") or "", own[0] if own else "")
            if e:
                ext, method = e, "ort"
        if ext:
            assigned.append((p, ext, method))
            how[method.split(":")[0]] += 1
        else:
            pending.append(p)

    # 7. EAN-Firmenpräfix: Mehrheit der sicher zugeordneten Produkte mit gleicher Firmennummer
    votes: dict[str, Counter] = defaultdict(Counter)
    for p, ext, m in assigned:
        if m in ("korrektur", "katalog") or m.startswith("marke:alias"):
            ean = p["ean"]
            if len(ean) == 13 and ean[:2] in ("40", "41", "42", "43", "44"):  # deutsche GS1-Nummern
                for n in (9, 8, 7):
                    votes[ean[:n]][ext] += 1
    rest = []
    for p in pending:
        ean = p["ean"]
        hit = None
        if len(ean) == 13 and not p.get("_no_brewery") and not any(is_retailer(b) for b in p.get("brands") or []):
            for n in (9, 8, 7):
                c = votes.get(ean[:n])
                if c:
                    (top, cnt), *others = c.most_common()
                    if cnt >= (1 if n == 9 else 2) and (not others or others[0][1] * 4 <= cnt):
                        hit = top
                    break
        if hit:
            assigned.append((p, hit, "ean-praefix"))
            how["ean-praefix"] += 1
        else:
            rest.append(p)
    return assigned, rest, how


# --------------------------------------------------------------------------- Dubletten zusammenführen

_SOURCE_RANK = {"wikipedia": 0, "website": 1, "wikidata": 2, "off": 3, "user": 4}


def _rank(b: dict) -> tuple:
    src = min((_SOURCE_RANK.get(s, 5) for s in (b.get("source") or "").split("+")), default=5)
    return (b.get("trust") != "verified", src, len(b["name"]))


def dedupe(beers: dict[str, dict]) -> int:
    """Gleiche Biere einer Brauerei zu einem zusammenfassen (Barcodes, Quellen, Daten vereinen). → Anzahl entfernt"""
    by_brewery: dict[str, list[dict]] = defaultdict(list)
    for b in beers.values():
        by_brewery[b["brewery_ext"]].append(b)
    removed = 0
    for lst in by_brewery.values():
        if len(lst) < 2:
            continue
        lst.sort(key=_rank)
        kept: list[dict] = []
        for b in lst:
            twin = next((k for k in kept if same_beer(k["name"], b["name"], k.get("abv"), b.get("abv"))), None)
            if not twin:
                kept.append(b)
                continue
            twin["eans"] |= b["eans"]
            twin["style"] = twin.get("style") or b.get("style")
            twin["abv"] = twin["abv"] if twin.get("abv") is not None else b.get("abv")
            twin["image_url"] = twin.get("image_url") or b.get("image_url")
            for s in (b.get("source") or "").split("+"):
                if s and s not in twin["source"].split("+"):
                    twin["source"] += f"+{s}"
            twin["sources"].update(b.get("sources") or {})
            del beers[b["ext_id"]]
            removed += 1
    return removed
