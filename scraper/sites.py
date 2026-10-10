"""Brauerei-Websites auslesen: Adresse (Impressum/JSON-LD) und Sortiment.

Ohne KI, nur Regeln – in dieser Reihenfolge:
  1. Shop-Schnittstellen: Shopify (/products.json), WooCommerce (Store-API)
  2. Strukturierte Daten (JSON-LD: Product, ItemList, PostalAddress)
  3. HTML-Heuristik auf Startseite + bis zu 3 „Unsere Biere“-Seiten. Gesucht werden *Gruppen* gleichartiger
     Elemente (Überschriften, Produktnamen, Links unter /produkte/…, Bilder einer Galerie). Eine Gruppe gilt als
     Sortiment, wenn mindestens die Hälfte der Einträge nach Bier aussieht (Sortenwort oder Gebinde).
  4. Optional: KI über GitHub Models (kostenlos mit dem GITHUB_TOKEN der Action), nur für Seiten, auf denen die
     Regeln nichts gefunden haben.

Höflich: robots.txt, eigener User-Agent, höchstens 8 Abrufe je Website, 1 s Pause zwischen den Abrufen.
"""

from __future__ import annotations

import json
import os
import re
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import unquote, urljoin, urlparse
from urllib.robotparser import RobotFileParser

from bs4 import BeautifulSoup

from .util import USER_AGENT, clean_beer_name, fold, http_session, parse_abv

MAX_REQUESTS = 8
EXTRACT_VERSION = 2  # erhöhen, wenn sich die Erkennung ändert → alte Cache-Einträge werden neu geholt
TTL_OK_DAYS = 30
TTL_FAIL_DAYS = 7

# ------------------------------------------------------------------------------------------------ Wortlisten
_STYLE = re.compile(
    r"\b(pils\w*|helle[snr]?|hell|\w*weiz\w*|\w*weiss\w*|hefe\w*|dunkel\w*|export\w*|\w*bock\w*|marzen\w*|"
    r"maerzen\w*|festbier|wiesn\w*|keller\w*|zwickel\w*|radler\w*|\w*lager|lagerbier|ipa|neipa|dipa|ale|stout|porter|"
    r"schwarzbier|rauchbier|kolsch|alt|altbier|landbier|urtyp|spezial|naturtrub\w*|alkoholfrei\w*|kristall\w*|"
    r"rotbier|zoigl|gose|dinkel\w*|leichte?s?|vollbier|edelstoff|maibock|weihnacht\w*|winterbier|sommerbier|saison|"
    r"amber|session|braunbier|schankbier|starkbier|dubbel|tripel|quadrupel|\w+bier|\w+pils)\b"
)
_PACK = re.compile(r"\b\d+([.,]\d+)?\s*(l|ltr|liter|cl|ml)\b|\b(flasche|dose|bugelflasche|longneck|steinie|kasten|fass|"
                   r"partyfass|\d+er(-?pack|-?kasten)?|sixpack|six-pack)\b")
_NONBEER = re.compile(
    r"\b(gin|\w*likor|\w*likoer|liqueur|\w*brand|schnaps|\w*geist|obstler|whiske?y|rum|vodka|wodka|\w*brause|limo\w*|"
    r"cola|spezi|schorle|\w*wasser|\w*saft|cider|cidre|secco|sekt|\w*wein|met|kaffee|tee|mate|energy|essig|senf|brot|"
    r"kase|kaese|wurst|\w*gutschein\w*|geschenk\w*|\w*paket\w*|box|set|abo|\w*glas|\w*glaser|\w*glaeser|krug|kruge|"
    r"seidel|\w*shirt|hoodie|pullover|kappe|cap|mutze|tasche|merch\w*|fanartikel|ticket\w*|seminar\w*|braukurs\w*|"
    r"kurs\w*|\w*fuhrung\w*|\w*fuehrung\w*|besichtigung|event\w*|veranstaltung\w*|zimmer|ubernachtung|uebernachtung|"
    r"speisekarte|mittagstisch|versand\w*|lieferung|pfand|bierdeckel|kronkorken|treber\w*|adventskalender|"
    r"verkostung\w*|tasting|jobs?|stellen\w*|ausbildung|\w*beutel|\w*kiste|\w*schorle|\w*limonade|praesent\w*|"
    r"prasent\w*|kalender|\w*kissen|schurze|schuerze|\w*offner|\w*oeffner|naehrwert\w*|nahrwert\w*|"
    r"auszeichnung\w*|europameister|award\w*|medaille\w*|siegel|urkunde|preistrager\w*|zutaten|allergene|"
    r"rezept\w*|gewinnspiel|\w*brot|honig|pralinen|schokolade|seife|kosmetik|grill\w*|\w*tasche|feiern|feier|"
    r"tagung\w*|hochzeit\w*|catering|reservier\w*|brotzeit|speisen|essen|kuche|kueche|menue|buffet|biergarten\w*|"
    r"anfahrt|offnungszeiten|oeffnungszeiten|impressionen|team|geschichte|historie)\b"
)
_NAV = re.compile(
    r"^(startseite|home|impressum|datenschutz\w*|kontakt|agb|warenkorb|anmelden|login|registrieren|newsletter|news|"
    r"aktuelles|blog|uber uns|ueber uns|geschichte|historie|team|karriere|presse|partner|handler|haendler|"
    r"bezugsquellen|anfahrt|offnungszeiten|oeffnungszeiten|biergarten|gasthof|restaurant|hotel|shop|onlineshop|"
    r"online shop|mehr erfahren|weiterlesen|mehr|details|zum shop|jetzt kaufen|in den warenkorb|kaufen|"
    r"kategorie anzeigen|filter|sortieren|zuruck|zurueck|weiter|tipp|neu|sale|brauerei|unternehmen|produkte|"
    r"sortiment|getranke|getraenke|bier|biere|unser bier|unsere biere|alle biere|alle produkte|"
    r"bierspezialitaten|bierspezialitaeten|spezialitaten|spezialitaeten|menu|menue|suche|english|deutsch)$"
)
_CATEGORY = re.compile(r"\b\w*biere\b|spezialitat|spezialitaet|sortiment|sorten\b|kategorie|ubersicht|uebersicht|"
                       r"\bunsere\b|\balle\b|saisonal\w*|klassiker\b|klassische\b")
_BAD_IMG = re.compile(r"slider|banner|header|hintergrund|background|logo|icon|chevron|arrow|pfeil|team|portrait|"
                      r"\bfoto|\bimg\b|image|dsc|whatsapp|screenshot|kachel|design ohne titel|placeholder|platzhalter|"
                      r"\bbg\b|hero|social|facebook|instagram|youtube|cookie|map|karte|siegel|award|medaille|urkunde")
_SKIP_ANCESTOR = re.compile(r"cookie|consent|borlabs|modal|popup|newsletter|breadcrumb", re.I)
_LINK_GOOD = re.compile(r"biere|bier|beer|sortiment|produkte|products?|unsere-biere|spezialit|craft|flaschen|"
                        r"brauspezial|getranke|getraenke")
_LINK_BAD = re.compile(r"paket|geschenk|merch|glas|glaeser|sale|abo|gutschein|event|ticket|seminar|kurs|fuhrung|"
                       r"fuehrung|news|blog|presse|karriere|job|zimmer|hotel|speise|kontakt|impressum|datenschutz|agb|"
                       r"warenkorb|login|konto|account|haendler|handler|bezugsquelle|garten|bierkultur|wissen|"
                       r"geschichte|historie|lexikon|rezept|\.pdf$|\.jpe?g$|\.png$|mailto:|tel:")
_IMPRESSUM = re.compile(r"impressum|imprint|legal-notice|anbieterkennzeichnung")
_FOREIGN_CTX = re.compile(r"schlichtung|verbraucher|webdesign|web-design|agentur|realisierung|umsetzung|hosting|"
                          r"gestaltung|programmierung|bildnachweis|fotos?:|fotograf|datenschutzbeauftrag|aufsichtsbeh|"
                          r"kammer|landesamt|bundesamt|ministerium|finanzamt|landratsamt|bundeszentral|konzeption|"
                          r"design by|realisiert|technische umsetzung|online-streit|registergericht")


def _f(s: str) -> str:
    return fold(s or "").replace("-", " ")


def is_beerish(name: str) -> bool:
    t = _f(name)
    return bool(_STYLE.search(t) or _PACK.search(t))


def is_nonbeer(name: str) -> bool:
    t = _f(name)
    return bool(_NONBEER.search(t) or _NAV.match(t.strip()) or _CATEGORY.search(t))


_UMLAUT = [(re.compile(r"(?<![aeiouq])ae"), "ä"), (re.compile(r"(?<![aeiouq])oe"), "ö"), (re.compile(r"(?<![aeiouq])ue"), "ü")]


def clean_item(text: str) -> str | None:
    """Rohtext eines Produktnamens → Biername (oder None, wenn es kein Name ist)."""
    t = re.sub(r"\s+", " ", text or "").strip()
    t = re.sub(r"\d+[.,]\d{2}\s*€\*?|€\s*\d+[.,]\d{2}|\*", " ", t)
    t = re.sub(r"^(tipp|neu!?|new|sale|top|bestseller|ausverkauft)\b[\s:!-]*", "", t, flags=re.I)
    t = re.sub(r"\s+(tipp|neu!?|ausverkauft)$", "", t, flags=re.I)
    t = clean_beer_name(t)
    t = re.sub(r"^(unser|unsere|das|der|die|the)\s+(?=\S+\s*\S*)", "", t, flags=re.I)
    t = re.sub(r"\s*[-–|:]\s*$", "", t).strip(" \"'„“”»«")
    t = re.sub(r"\s+", " ", t).strip()
    if len(t) < 2 or len(t) > 50 or len(t.split()) > 7:
        return None
    if re.search(r"[.?!]$", t) and not re.search(r"\b[A-Z]\.$|\bNr\.$", t):
        return None
    if not re.search(r"[A-Za-zÄÖÜäöüß]{2}", t) or re.fullmatch(r"[\d\s.,%/-]+", t):
        return None
    if t.isupper() and len(t) > 4:
        t = t.title()
    return t


def name_from_file(src: str) -> str | None:
    stem = unquote(urlparse(src).path.rsplit("/", 1)[-1])
    stem = re.sub(r"\.(jpe?g|png|webp|gif|avif)$", "", stem, flags=re.I)
    stem = re.sub(r"[-_]\d{2,4}x\d{2,4}$|[-_]scaled$|[-_]e\d{9,}$|[-_](copy|kopie|web|klein|gross|neu|final)$", "",
                  stem, flags=re.I)
    stem = re.sub(r"\b(flasche|etikett|bottle|label|freigestellt|0[,_.]?33|0[,_.]?5|05|033|l)\b", " ",
                  stem.replace("_", " ").replace("-", " "), flags=re.I)
    stem = re.sub(r"\b\d{3,}\b|\(\d+\)", " ", stem)
    stem = re.sub(r"\s+", " ", stem).strip()
    if len(re.sub(r"[^A-Za-z]", "", stem)) < 3 or _BAD_IMG.search(stem.lower()):
        return None
    s = stem.lower()
    for rx, rep in _UMLAUT:
        s = rx.sub(rep, s)
    return " ".join(w.capitalize() for w in s.split())


_JUNK_ANY = re.compile(r"^(teaser|detail\d*|csm|typo|thumb|thumbnail|preview|uai|hover|positiv|negativ|freisteller|"
                       r"mockup|packshot|render|neu|new|final|web|wide|key|relaunch|website|content|location|"
                       r"\d+x\d+(px)?|v\d+(\.\w+)?|[0-9a-f]{6,}|[a-z]*\d[a-z\d]{6,})$", re.I)
_JUNK_FILE = re.compile(r"^(\d+|[a-z]|home|start|startseite|labels?|etikett\w*|produkt\w*|product|bild|bierbild|flasche|bottle|img|image|"
                        r"foto|photo|dsc|sta|wb|fw|ci)$", re.I)
_LEAD_JUNK = re.compile(r"^(produkt(-?bild)?|product|labels?|etikett|bierbild|bild|foto)\b[\s_:'\"„-]*", re.I)
_SENTENCE = {"ist", "sind", "können", "konnen", "kann", "sie", "wir", "unsern", "unser", "unsere", "genießen", "geniessen",
             "entdecken", "erfahren", "hier", "jetzt", "mehr", "bei", "für", "fur", "zum", "zur", "aus", "und", "oder",
             "mit", "ihr", "ihre", "dein", "deine", "euer", "wird", "werden", "haben", "gibt", "noch", "der", "die",
             "das", "dem", "den", "des", "ein", "eine", "einen", "von", "vom", "im", "in", "auf", "an", "am"}
_GENERIC = {"das", "der", "die", "aktiv", "erlebnisse", "erlebnis", "location", "produkte", "produkt", "kontakt",
            "willkommen", "home", "start", "highlights", "neuheiten", "klassiker", "spezialitäten", "sortiment",
            "flaschen", "dosen", "fass", "fässer", "galerie", "bilder", "video", "info", "infos", "details"}


def _dedupe_words(words: list[str]) -> list[str]:
    """„Alkoholfrei Alkoholfrei“ → „Alkoholfrei“, „Helles Hefeweizen Helles Hefeweizen“ → „Helles Hefeweizen“"""
    changed = True
    while changed:
        changed = False
        low = [fold(w) for w in words]
        for n in range(min(4, len(words) // 2), 0, -1):
            for i in range(0, len(words) - 2 * n + 1):
                if low[i:i + n] == low[i + n:i + 2 * n]:
                    words = words[:i + n] + words[i + 2 * n:]
                    changed = True
                    break
            if changed:
                break
    return words


def polish(name: str | None, from_file: bool = False) -> str | None:
    """Letzter Schliff für Namen: Dopplungen, Bilddatei-Reste, Satzfetzen entfernen."""
    if not name:
        return None
    t = re.sub(r"[\u200b-\u200f\u00ad\ufeff]", "", name).strip()
    t = _LEAD_JUNK.sub("", t)
    if re.match(r"(?i)alk\.?\s*\d", t):
        return None  # „Alk. 4,7% vol“
    t = re.sub(r"\.(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{2,12}$", "", t)  # Bild-Hash: „Hell.feb89f“
    t = re.split(r"(?<=[a-zäöüß]{3})\.\s+(?=[A-ZÄÖÜ])", t)[0]  # „Gaffel Kölsch. Besonders Kölsch“
    if re.search(r"\b\d{1,2}\.\d{1,2}\.(\d{2,4})?\b|\s\+\s|\b\d+\s*[x×]\s", t):
        return None  # Termine („21.11.2026“) und Bündel („+ 6 Pils“, „6 x“)
    t = clean_beer_name(t)
    t = re.sub(r"[\s–-]+\d+\s*[/x×]\s*\d+([.,]\d+)?\s*\w{0,2}$", "", t)  # „Wiesener Helles – 6 / 12“
    words = [w for w in re.split(r"\s+", t) if w]
    words = [w for w in words if not _JUNK_ANY.match(w.strip(".,'\"„“"))]
    if from_file:
        words = [re.sub(r"(?<=[a-zäöüß])\d+$", "", w) for w in words]  # „Dunkel2“
        words = [w for w in words if w and not _JUNK_FILE.match(w.strip(".,'\"„“"))]
    words = _dedupe_words(words)
    t = " ".join(words).strip(" -–_,.:;'\"„“")
    if len(t) < 2 or not re.search(r"[A-Za-zÄÖÜäöüß]{2}", t):
        return None
    low = [fold(w) for w in words]
    if sum(1 for w in low if w in {fold(x) for x in _SENTENCE}) >= (1 if len(words) >= 3 else 2):
        return None
    if len(words) == 1 and (fold(t) in {fold(x) for x in _GENERIC} or (t[:1].islower() and not is_beerish(t))):
        return None
    if len(t) > 50 or len(words) > 7:
        return None
    return t


def img_key(src: str | None) -> str | None:
    """Gleiches Produktbild in verschiedenen Varianten (teaser-1/-2, Hover, Größen) → ein Schlüssel"""
    if not src:
        return None
    path = unquote(urlparse(src).path).lower()
    d, _, f = path.rpartition("/")
    stem = re.sub(r"\.(jpe?g|png|webp|gif|avif)$", "", f)
    prev = None
    while prev != stem:
        prev = stem
        stem = re.sub(r"[-_ ]+(teaser|detail|hover|positiv|negativ|neu|new|klein|gross|small|large|thumb|preview|scaled|"
                      r"copy|kopie|gelb|v?\d{1,2}|\d+x\d+)_*$", "", stem)
        stem = re.sub(r"(detail|teaser)\d+$", "", stem)
    stem = re.sub(r"_+$", "", stem)
    return f"{d}/{stem}" if stem else None


_PRIO = {"jsonld": 5, "shopify": 5, "woocommerce": 5, "txt": 4, "linktitle": 4, "link": 3, "alt": 2, "ki": 2, "file": 0}


def cluster_items(items: list[dict]) -> list[dict]:
    """Einträge, die dasselbe Produkt meinen (gleicher Link, gleiches Bild oder gleicher Name), zusammenfassen
    und den besten Namen wählen (Überschrift vor Linktext vor alt-Text vor Dateiname)."""
    parent = list(range(len(items)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    seen: dict[tuple, int] = {}
    for i, it in enumerate(items):
        keys = [("n", re.sub(r"[^a-z0-9]", "", fold(it["name"])))]
        if it.get("href"):
            keys.append(("h", it["href"].rstrip("/").lower()))
        k = img_key(it.get("image"))
        if k:
            keys.append(("i", k))
        for key in keys:
            if key in seen:
                parent[find(i)] = find(seen[key])
            else:
                seen[key] = i
    groups: dict[int, list[dict]] = defaultdict(list)
    for i, it in enumerate(items):
        groups[find(i)].append(it)
    out = []
    for members in groups.values():
        best = max(members, key=lambda m: (_PRIO.get(m.get("src_kind", "txt"), 1), -len(m["name"])))
        merged = dict(best)
        # „Baisinger Helles“ mit Untertitel „Alkoholfrei“: den wichtigen Unterschied nicht verlieren
        if not re.search(r"alkoholfrei|0[,.]0", fold(best["name"])) and any(
                re.search(r"alkoholfrei|0[,.]0", fold(m.get("sub") or m["name"])) for m in members):
            merged["name"] = f"{best['name']} alkoholfrei"
        merged["abv"] = next((m["abv"] for m in members if m.get("abv") is not None), None)
        merged["image"] = best.get("image") or next((m["image"] for m in members if m.get("image")), None)
        if any(m.get("conf") == "hoch" for m in members):
            merged["conf"] = "hoch"
        out.append(merged)
    return out


def postprocess(beers: list[dict]) -> list[dict]:
    """Auch auf ältere Cache-Einträge anwendbar: Namen säubern, Dubletten zusammenfassen."""
    cleaned = []
    for b in beers or []:
        name = polish(b.get("name"), from_file=b.get("src_kind") == "file")
        if name and not is_nonbeer(name):
            cleaned.append({**b, "name": name})
    return cluster_items(cleaned)


# ------------------------------------------------------------------------------------------------ Adressen
_STREET_SUFFIX = re.compile(r"(stra(ss|ß)e|str\.?|weg|platz|pl\.|gasse|allee|ring|damm|markt|berg|ufer|steig|pfad|hof|"
                            r"graben|wall|chaussee|stieg|zeile|leite|anger|winkel|tor|brücke|bruecke|garten|feld|park|"
                            r"rain|höhe|hoehe|siedlung|kamp|horst|kehre|bogen|grund|tal|au|dorf|reuth|wiese|wiesen|"
                            r"gässchen|steg|promenade|kai|deich|hütte|mühle|muehle|brunnen|bach)$", re.I)
_PREPS = {"am", "an", "auf", "im", "in", "zum", "zur", "hinter", "unter", "vor", "bei", "beim", "über", "ueber", "alte",
          "alter", "altes", "obere", "oberer", "untere", "unterer", "neue", "neuer", "große", "großer", "kleine",
          "kleiner", "hohe", "hoher", "lange", "langer", "st.", "sankt"}
_ARTICLES = {"der", "dem", "den", "des", "die", "das"}
_STREET_BAD = re.compile(r"\b(tel|telefon|fax|hrb|hra|ust|postfach|amtsgericht|registergericht|steuer\w*|mobil|"
                         r"handy|iban|bic|blz|konto|gmbh|kg|ag|e\.k\.|inh|inhaber|geschäftsführ\w*|vertreten)\b", re.I)
_CITY_STOP = {"telefon", "tel", "tel.", "fax", "e-mail", "email", "mail", "deutschland", "germany", "geschäftsführer",
              "geschaeftsfuehrer", "inhaber", "vertreten", "registergericht", "amtsgericht", "ust", "ust-id", "internet",
              "web", "mobil", "handy", "phone", "öffnungszeiten", "kontakt", "info", "www", "de", "hrb", "hra",
              "steuernummer", "vertretungsberechtigt", "vertretungsberechtigter", "verantwortlich", "telefax"}
_ADDR = re.compile(
    r"(?P<words>(?:[A-ZÄÖÜa-zäöüß][\wäöüßÄÖÜ.'’\-]*\s){0,5}?[A-ZÄÖÜa-zäöüß][\wäöüßÄÖÜ.'’\-]*\.?)\s"
    r"(?P<num>\d{1,4}\s?[a-zA-Z]?(?:\s?[-–/+]\s?\d{1,4}\s?[a-zA-Z]?)?)"
    r"\s*(?:[,|·•–\-]\s*)?(?:¶\s*)?(?:(?:D|DE)\s?-\s?)?"
    r"(?P<plz>\d{5})\s+"
    r"(?P<city>[A-ZÄÖÜ][\wäöüß.\-/()]+(?:[ \t]+(?:an der|am|im|in der|bei|ob der|vor der|a\.\s?d\.|i\.\s?d\.)?"
    r"[ \t]*[A-ZÄÖÜ(][\wäöüß.\-()]+){0,3})"
)


def _street_from_words(words: list[str]) -> str | None:
    if not words:
        return None
    idx = None
    for i in range(len(words) - 1, -1, -1):
        if _STREET_SUFFIX.search(words[i].lower().rstrip(",")):
            idx = i
            break
    if idx is None:
        # „An der Brauerei“, „Am Deich“
        for i in range(len(words) - 1, -1, -1):
            if words[i].lower() in _PREPS:
                idx = i
                break
        start = idx if idx is not None else len(words) - 1
    else:
        start = idx
        generic = re.fullmatch(r"(stra(ss|ß)e|str\.?|weg|platz|allee|ring|gasse|damm|markt|berg|ufer|steig|pfad|hof|"
                               r"graben|wall|chaussee|tor|brücke|bruecke|garten|feld|park|steg|kai|deich)", words[idx].lower())
        while start > 0:
            prev = words[start - 1]
            pl = prev.lower()
            if pl in _ARTICLES or pl in _PREPS or (generic and prev[:1].isupper()
                                                   and re.search(r"(er|sche[rn]?|ische)$", pl) and idx - start < 2):
                start -= 1
                continue
            break
    street = " ".join(words[start:]).strip(" ,")
    return street if 3 <= len(street) <= 60 else None


def find_addresses(text: str) -> list[dict]:
    """Postadressen im Fließtext (Impressum, Fußzeile) – in der Reihenfolge des Auftretens."""
    t = re.sub(r"[ \t ]+", " ", text or "")
    t = re.sub(r"\s*\n\s*", " ¶ ", t)
    out, seen = [], set()
    for m in _ADDR.finditer(t):
        before = t[max(0, m.start() - 160):m.start()].lower()
        words = [w for w in m.group("words").split() if w != "¶"]
        street_core = _street_from_words(words)
        if not street_core or _STREET_BAD.search(street_core):
            continue
        num = re.sub(r"\s+", "", m.group("num"))
        city_words = []
        for w in m.group("city").split():
            if w.lower().strip(":,.") in _CITY_STOP:
                break
            city_words.append(w)
        city = " ".join(city_words).strip(" ,.-/")
        if not city:
            continue
        key = (street_core.lower(), num, m.group("plz"))
        if key in seen:
            continue
        seen.add(key)
        out.append({"street": f"{street_core} {num}", "postcode": m.group("plz"), "city": city,
                    "foreign": bool(_FOREIGN_CTX.search(before))})
    return out


# ------------------------------------------------------------------------------------------------ JSON-LD
def _walk(o):
    if isinstance(o, dict):
        yield o
        for v in o.values():
            yield from _walk(v)
    elif isinstance(o, list):
        for v in o:
            yield from _walk(v)


def jsonld(soup: BeautifulSoup) -> list:
    out = []
    for s in soup.find_all("script", attrs={"type": re.compile("ld\\+json", re.I)}):
        try:
            out.append(json.loads(s.string or s.get_text() or ""))
        except Exception:  # noqa: BLE001
            continue
    return out


def _first(v):
    if isinstance(v, list):
        return v[0] if v else None
    return v


def jsonld_addresses(docs: list) -> list[dict]:
    out = []
    for d in docs:
        for o in _walk(d):
            a = o.get("address") if isinstance(o.get("address"), dict) else (o if o.get("@type") == "PostalAddress" else None)
            if not isinstance(a, dict):
                continue
            st, plz, city = a.get("streetAddress"), a.get("postalCode"), a.get("addressLocality")
            if st and plz and re.fullmatch(r"\d{5}", str(plz).strip()) and re.search(r"\d", str(st)):
                out.append({"street": re.sub(r"\s+", " ", str(st)).strip(), "postcode": str(plz).strip(),
                            "city": (str(city).strip() if city else None), "foreign": False})
    return out


def jsonld_products(docs: list, base: str) -> list[dict]:
    out = []
    for d in docs:
        for o in _walk(d):
            typ = o.get("@type")
            typ = " ".join(typ) if isinstance(typ, list) else str(typ or "")
            if "Product" not in typ or not o.get("name"):
                continue
            name = clean_item(str(o["name"]))
            if not name or is_nonbeer(name):
                continue
            text = " ".join(str(o.get(k) or "") for k in ("description", "category"))
            if not (is_beerish(name) or re.search(r"\bbier|beer\b", _f(text))):
                continue
            img = _first(o.get("image"))
            if isinstance(img, dict):
                img = img.get("url")
            out.append({"name": name, "abv": find_abv(text), "image": urljoin(base, img) if img else None,
                        "method": "jsonld"})
    return out


# ------------------------------------------------------------------------------------------------ Alkoholgehalt
def find_abv(text: str) -> float | None:
    t = (text or "").replace(" ", " ")
    for rx in (r"(\d{1,2}(?:[.,]\d{1,2})?)\s*%\s*(?:vol|alk|alc|abv)", r"alk(?:ohol)?(?:gehalt)?\.?\s*[:\-]?\s*(\d{1,2}[.,]\d{1,2})",
               r"(\d{1,2}[.,]\d{1,2})\s*%"):
        for m in re.finditer(rx, t, re.IGNORECASE):
            ctx = t[max(0, m.start() - 30):m.start()].lower()
            bad = max(ctx.rfind(w) for w in ("stammw", "wurze", "würze", "plato", "°p", "rabatt", "sparen", "reduziert"))
            good = max(ctx.rfind(w) for w in ("alk", "alc", "vol"))
            if bad > good:
                continue
            v = parse_abv(m.group(1))
            if v is not None and v <= 16:
                return v
    return None


# ------------------------------------------------------------------------------------------------ HTML-Heuristik
def _in_skipped(el, tags=("header", "footer", "nav", "aside")) -> bool:
    for p in el.parents:
        if p.name in tags:
            return True
        cls = " ".join(p.get("class") or []) + " " + (p.get("id") or "")
        if _SKIP_ANCESTOR.search(cls):
            return True
    return False


def _img_src(img) -> str | None:
    for a in ("data-src", "data-lazy-src", "data-original", "src"):
        v = img.get(a)
        if v and not v.startswith("data:"):
            return v
    ss = img.get("srcset") or img.get("data-srcset")
    if ss:
        return ss.split(",")[0].strip().split(" ")[0]
    return None


def _card(el, group_ids: set[int]):
    card = el
    for _ in range(5):
        p = card.parent
        if p is None or p.name in ("body", "html", "main", "[document]"):
            break
        if len(p.get_text(" ", strip=True)) > 700:
            break
        others = sum(1 for d in p.find_all(True) if id(d) in group_ids and d is not el)
        if others:
            break
        card = p
    return card


def extract_items(html: str, url: str) -> tuple[list[dict], dict]:
    soup = BeautifulSoup(html, "html.parser")
    docs = jsonld(soup)
    for t in soup(["script", "style", "noscript", "svg", "template", "iframe", "form", "select"]):
        t.decompose()
    host = urlparse(url).netloc.replace("www.", "")
    groups: dict[tuple, list] = defaultdict(list)

    # a) Überschriften und Produktnamen im Inhaltsbereich
    for el in soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6", "a", "span", "div", "p", "strong", "b", "td", "li"]):
        cls = " ".join(el.get("class") or [])
        is_head = el.name in ("h1", "h2", "h3", "h4", "h5", "h6")
        is_prod = re.search(r"(product|produkt|item|card|beer|bier|artikel|teaser|tile)[-_ ]?(name|title|titel|heading|"
                            r"headline)|^(name|title|titel)$|woocommerce-loop-product__title", cls, re.I)
        if not (is_head or is_prod or el.name in ("strong", "b")):
            continue
        if el.name in ("strong", "b") and len(el.parent.get_text(" ", strip=True)) > 3 * len(el.get_text(" ", strip=True)) + 40:
            continue  # Hervorhebung mitten im Fließtext
        if _in_skipped(el):
            continue
        raw = el.get_text(" ", strip=True)
        name = polish(clean_item(raw))
        if not name:
            continue
        a = el if el.name == "a" else el.find_parent("a")
        sib = el.find_next_sibling(class_=re.compile(r"sub-?title|untertitel|subline", re.I))
        sig = ("txt", el.name, re.sub(r"\d+", "", cls)[:60])
        groups[sig].append({"name": name, "el": el, "raw": raw, "kind": "txt",
                            "sub": sib.get_text(" ", strip=True) if sib is not None else None,
                            "href": urljoin(url, a["href"]) if a is not None and a.get("href") else None})

    # b) Linkgruppen (z. B. /de/produkte/warburger-pils) – auch in der Navigation
    seen_href = set()
    for a in soup.find_all("a", href=True):
        href = urljoin(url, a["href"])
        p = urlparse(href)
        if p.netloc.replace("www.", "") != host or href in seen_href:
            continue
        seen_href.add(href)
        segs = [s for s in p.path.split("/") if s]
        if len(segs) < 2 or re.search(r"\.(pdf|jpe?g|png)$", p.path, re.I):
            continue
        parent = "/".join(segs[:-1]).lower()
        if re.search(r"(^|/)(tag|category|kategorie|news|blog|aktuelles|events?|veranstaltungen|presse|jobs|"
                     r"karriere|author|page|seite|wp-content|media|uploads)(/|$)", parent):
            continue
        text = a.get_text(" ", strip=True)
        kind = "link"
        # Produktkarten: <a title="Helles"><div class="title">Helles</div><div class="subtitle">Mild süffig</div></a>
        head = a.find(["h1", "h2", "h3", "h4", "h5", "h6", "strong"]) or a.find(
            class_=re.compile(r"(^|[-_])(title|name|titel|heading)($|[-_])", re.I))
        name = None
        if a.get("title"):
            name, kind = polish(clean_item(a["title"])), "linktitle"
        if not name and head is not None:
            name, kind = polish(clean_item(head.get_text(" ", strip=True))), "linktitle"
        sub_el = a.find(class_=re.compile(r"sub-?title|untertitel|subline", re.I))
        sub = sub_el.get_text(" ", strip=True) if sub_el is not None else None
        if not name:
            kind = "link"
            name = polish(clean_item(text)) if text else None
        if not name:
            slug = re.sub(r"\.(html?|php)$", "", segs[-1])
            slug = re.sub(r"[-_]+", " ", unquote(slug)).strip()
            for rx, rep in _UMLAUT:
                slug = rx.sub(rep, slug)
            name = polish(clean_item(" ".join(w.capitalize() for w in slug.split())), from_file=True)
        if name:
            groups[("link", parent)].append({"name": name, "el": a, "raw": text, "href": href, "kind": kind, "sub": sub})

    # c) Bildergalerien (Name aus alt-Text oder Dateiname)
    for img in soup.find_all("img"):
        if _in_skipped(img):
            continue
        src = _img_src(img)
        if not src or src.lower().endswith(".svg"):
            continue
        alt = (img.get("alt") or img.get("title") or "").strip()
        name = polish(clean_item(alt)) if alt and not _BAD_IMG.search(alt.lower()) else None
        kind = "alt"
        if not name:
            name, kind = polish(name_from_file(src), from_file=True), "file"
        if not name:
            continue
        a = img.find_parent("a")
        box = img.find_parent(["article", "section", "main", "ul", "table"])
        groups[("img", id(box) if box is not None else 0)].append({
            "name": name, "el": img, "raw": alt, "src": src, "kind": kind,
            "href": urljoin(url, a["href"]) if a is not None and a.get("href") else None})

    # Gruppen bewerten
    items: list[dict] = []
    diag = {"groups": []}
    for sig, members in groups.items():
        uniq, seen = [], set()
        for m in members:
            k = _f(m["name"])
            if k not in seen:
                seen.add(k)
                uniq.append(m)
        valid = [m for m in uniq if not is_nonbeer(m["name"])]
        beerish = [m for m in valid if is_beerish(m["name"]) or is_beerish(m.get("raw") or "")]
        if len(valid) < 2 or len(beerish) < 2 or len(beerish) < 0.5 * len(valid):
            continue
        conf = "hoch" if len(beerish) >= 3 and len(beerish) >= 0.75 * len(valid) else "mittel"
        diag["groups"].append({"sig": str(sig[0]) + ":" + str(sig[1])[:40], "n": len(valid), "beerish": len(beerish),
                               "conf": conf})
        ids = {id(m["el"]) for m in valid}
        for m in valid[:60]:
            card = _card(m["el"], ids)
            ctext = card.get_text(" ", strip=True)
            img = m.get("src")
            if not img:
                im = card.find("img") if card is not m["el"] else None
                img = _img_src(im) if im else None
            if img and (img.lower().endswith(".svg") or _BAD_IMG.search(img.lower().rsplit("/", 1)[-1])):
                img = None
            href = m.get("href")
            if href and href.rstrip("/") in (url.rstrip("/"), urljoin(url, "/").rstrip("/")):
                href = None
            items.append({"name": m["name"], "abv": find_abv(ctext) or find_abv(m.get("raw") or ""),
                          "image": urljoin(url, img) if img else None, "method": f"html-{sig[0]}", "conf": conf,
                          "page": url, "href": href, "src_kind": m.get("kind", "txt"), "sub": m.get("sub")})
    items += [{**p, "conf": "hoch", "page": url, "src_kind": "jsonld"} for p in jsonld_products(docs, url)]
    # Gibt es echte Textnamen, werden reine Dateinamen-Funde nicht gebraucht
    if any(i["src_kind"] != "file" for i in items):
        keep_keys = {img_key(i.get("image")) for i in items if i["src_kind"] != "file"} - {None}
        items = [i for i in items if i["src_kind"] != "file" or img_key(i.get("image")) in keep_keys]
    return cluster_items(items), {"docs": docs, **diag}


def page_links(html: str, url: str) -> tuple[list[str], str | None]:
    """→ (Kandidaten für Sortiment-Seiten, Impressum-Link)"""
    soup = BeautifulSoup(html, "html.parser")
    host = urlparse(url).netloc.replace("www.", "")
    scored: dict[str, int] = {}
    impressum = None
    for a in soup.find_all("a", href=True):
        href = urljoin(url, a["href"]).split("#")[0]
        p = urlparse(href)
        if p.scheme not in ("http", "https"):
            continue
        text = _f(a.get_text(" ", strip=True))
        hay = (_f(unquote(p.path)) + " " + text).lower()
        same = p.netloc.replace("www.", "") == host or p.netloc.replace("www.", "").endswith("." + host)
        if not same:
            continue
        if _IMPRESSUM.search(hay) and not impressum:
            impressum = href
            continue
        if _LINK_BAD.search(hay) or re.search(r"\.(pdf|jpe?g|png|gif|webp|zip)$", p.path, re.I) \
                or href.rstrip("/") == url.rstrip("/"):
            continue
        if not _LINK_GOOD.search(hay):
            continue
        s = 1
        if re.search(r"unsere\s?biere|unser\s?bier|bier\s?sortiment|our beers|unsere produkte|biersorten", hay):
            s += 4
        if re.search(r"\bbiere\b|sortiment|beers\b|produkte\b|flaschen", hay):
            s += 2
        if len([x for x in p.path.split("/") if x]) <= 2:
            s += 1
        scored[href] = max(scored.get(href, 0), s)
    best = sorted(scored, key=lambda h: (-scored[h], len(h)))[:3]
    return best, impressum


def main_text(html: str, limit: int = 12000) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for t in soup(["script", "style", "noscript", "svg", "template", "iframe", "header", "footer", "nav", "form"]):
        t.decompose()
    root = soup.find("main") or soup.body or soup
    txt = root.get_text("\n", strip=True)
    return re.sub(r"\n{2,}", "\n", txt)[:limit]


def full_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for t in soup(["script", "style", "noscript", "svg", "template", "iframe"]):
        t.decompose()
    return soup.get_text("\n", strip=True)


# ------------------------------------------------------------------------------------------------ Shops
def shopify_items(data: dict) -> list[dict]:
    out = []
    for p in data.get("products") or []:
        title = p.get("title") or ""
        ptype = p.get("product_type") or ""
        tags = " ".join(p.get("tags") or []) if isinstance(p.get("tags"), list) else str(p.get("tags") or "")
        name = clean_item(title)
        if not name or is_nonbeer(name) or _NONBEER.search(_f(ptype)):
            continue
        if not (is_beerish(title) or re.search(r"bier|beer", _f(ptype + " " + tags))):
            continue
        body = BeautifulSoup(p.get("body_html") or "", "html.parser").get_text(" ", strip=True)
        imgs = p.get("images") or []
        out.append({"name": name, "abv": find_abv(title + " " + body), "method": "shopify", "src_kind": "shopify", "conf": "hoch",
                    "image": imgs[0].get("src") if imgs and isinstance(imgs[0], dict) else None})
    return out


def woo_items(data: list) -> list[dict]:
    out = []
    for p in data or []:
        title = BeautifulSoup(p.get("name") or "", "html.parser").get_text(" ", strip=True)
        cats = " ".join(c.get("name", "") for c in p.get("categories") or [])
        name = clean_item(title)
        if not name or is_nonbeer(name):
            continue
        if not (is_beerish(title) or re.search(r"bier|beer", _f(cats))) or re.search(r"geschenk|merch|gutschein", _f(cats)):
            continue
        desc = BeautifulSoup((p.get("short_description") or "") + " " + (p.get("description") or ""),
                             "html.parser").get_text(" ", strip=True)
        imgs = p.get("images") or []
        out.append({"name": name, "abv": find_abv(title + " " + desc), "method": "woocommerce", "src_kind": "woocommerce", "conf": "hoch",
                    "image": imgs[0].get("src") if imgs else None})
    return out


# ------------------------------------------------------------------------------------------------ Crawler
class _Site:
    def __init__(self, session, site: str):
        self.s = session
        self.site = site
        p = urlparse(site if re.match(r"https?://", site) else "https://" + site)
        self.root = f"{p.scheme}://{p.netloc}/"
        self.start = site if re.match(r"https?://", site) else self.root
        self.n = 0
        self.rp = RobotFileParser()
        self.log: list[str] = []

    def robots(self):
        try:
            r = self.s.get(urljoin(self.root, "/robots.txt"), timeout=10)
            self.n += 1
            self.rp.parse(r.text.splitlines() if r.status_code == 200 else [])
        except Exception:  # noqa: BLE001
            self.rp.parse([])

    def get(self, url: str, accept_json=False):
        if self.n >= MAX_REQUESTS:
            return None
        if not self.rp.can_fetch(USER_AGENT, url):
            self.log.append(f"robots: {url}")
            return None
        if self.n:
            time.sleep(1)
        self.n += 1
        try:
            r = self.s.get(url, timeout=15, headers={"Accept-Language": "de-DE,de;q=0.9"})
        except Exception as e:  # noqa: BLE001
            self.log.append(f"{url}: {type(e).__name__}")
            return None
        ct = r.headers.get("content-type", "")
        if r.status_code != 200:
            self.log.append(f"{url}: HTTP {r.status_code}")
            return None
        if accept_json:
            return r if "json" in ct else None
        if "html" not in ct and ct:
            return None
        if len(r.content) > 3_000_000:
            return None
        r.encoding = r.encoding if r.encoding and r.encoding.lower() != "iso-8859-1" else r.apparent_encoding
        return r


def crawl_site(session, site: str) -> dict:
    c = _Site(session, site)
    data: dict = {"site": site, "status": 0, "beers": [], "addresses": [], "pages": [], "platform": None}
    c.robots()
    home = c.get(c.start)
    if home is None and c.start != c.root:
        home = c.get(c.root)
    if home is None:
        data["status"] = -1
        data["log"] = c.log
        return data
    data["status"] = 200
    base = home.url
    html = home.text
    data["pages"].append(base)
    low = html[:300_000].lower()
    items: list[dict] = []

    # 1. Shops
    if "cdn.shopify.com" in low or "shopify.theme" in low:
        data["platform"] = "shopify"
        r = c.get(urljoin(base, "/products.json?limit=250"), accept_json=True)
        if r is not None:
            try:
                items += shopify_items(r.json())
            except Exception:  # noqa: BLE001
                pass
    elif "woocommerce" in low or "wc-block" in low:
        data["platform"] = "woocommerce"
        r = c.get(urljoin(base, "/wp-json/wc/store/v1/products?per_page=100"), accept_json=True)
        if r is not None:
            try:
                items += woo_items(r.json())
            except Exception:  # noqa: BLE001
                pass
    elif "shopware" in low:
        data["platform"] = "shopware"

    # 2. Startseite
    found, diag = extract_items(html, base)
    items += found
    data["addresses"] += [{**a, "src": "jsonld"} for a in jsonld_addresses(diag["docs"])]
    data["addresses"] += [{**a, "src": "startseite"} for a in find_addresses(full_text(html))[:3]]
    cands, impressum = page_links(html, base)

    # 3. Impressum
    if impressum:
        r = c.get(impressum)
        if r is not None:
            data["pages"].append(r.url)
            soup = BeautifulSoup(r.text, "html.parser")
            data["addresses"] = [{**a, "src": "impressum"} for a in jsonld_addresses(jsonld(soup))] + \
                [{**a, "src": "impressum"} for a in find_addresses(full_text(r.text))] + data["addresses"]

    # 4. Sortiment-Seiten
    texts = []
    for u in cands:
        r = c.get(u)
        if r is None:
            continue
        data["pages"].append(r.url)
        found, diag = extract_items(r.text, r.url)
        items += found
        texts.append(main_text(r.text, 6000))
        if len(items) >= 40:
            break
    data["sortiment"] = cands

    # Zusammenfassen: gleicher Link, gleiches Bild oder gleicher Name = ein Produkt
    data["beers"] = postprocess(items)[:80]
    data["v"] = EXTRACT_VERSION
    # Für die KI bzw. die Fehlersuche: Text der Sortiment-Seiten, wenn die Regeln wenig gefunden haben
    if len(data["beers"]) < 2 and texts:
        data["text"] = "\n---\n".join(texts)[:9000]
    # Doppelte Adressen entfernen
    seen, addrs = set(), []
    for a in data["addresses"]:
        k = (a["street"].lower(), a["postcode"])
        if k not in seen:
            seen.add(k)
            addrs.append(a)
    data["addresses"] = addrs[:6]
    data["requests"] = c.n
    if c.log:
        data["log"] = c.log[:10]
    return data


def crawl(sites: list[str], cache: dict[str, dict], budget_s: float = 1200, workers: int = 16, progress=None):
    """→ (Ergebnisse {site: data}, neue Cache-Einträge)"""
    out: dict[str, dict] = {}
    new: dict[str, dict] = {}
    todo = []
    for s in sorted(set(sites)):
        if s in cache and cache[s].get("v") == EXTRACT_VERSION:
            out[s] = cache[s]
        else:
            todo.append(s)
    # Websites mit gleicher Domain nicht gleichzeitig abfragen
    deadline = time.time() + budget_s
    session = http_session()
    session.headers["Accept"] = "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8"
    cached = len(out)
    if progress:
        progress(0, len(todo), f"{cached} aus dem Zwischenspeicher, {len(todo)} neu abzurufen")
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(crawl_site, session, s): s for s in todo}
        for i, f in enumerate(as_completed(futs), 1):
            s = futs[f]
            try:
                d = f.result()
            except Exception as e:  # noqa: BLE001
                d = {"site": s, "status": -2, "error": str(e)[:200], "beers": [], "addresses": []}
            out[s] = d
            new[s] = d
            if progress:
                found = sum(len(x.get("beers") or []) for x in new.values())
                progress(i, len(todo), f"{i} von {len(todo)} Websites neu abgerufen · {found} Biere gefunden")
            if time.time() > deadline:
                for g in futs:
                    g.cancel()
                break
    return out, new


# ------------------------------------------------------------------------------------------------ KI (optional)
_LLM_URL = "https://models.github.ai/inference/chat/completions"


def llm_extract(results: dict[str, dict], names: dict[str, str], max_calls: int = 100,
                progress=None) -> tuple[int, str | None]:
    """Fragt GitHub Models nach den Bieren auf Seiten, auf denen die Regeln nichts gefunden haben.
    Nur aktiv mit USE_GITHUB_MODELS=1 und GITHUB_TOKEN (Workflow-Berechtigung „models: read“)."""
    token = os.environ.get("GITHUB_TOKEN")
    if os.environ.get("USE_GITHUB_MODELS") != "1" or not token:
        return 0, "aus"
    model = os.environ.get("GITHUB_MODELS_MODEL", "openai/gpt-4.1-mini")
    session = http_session()
    calls = 0
    for site, d in results.items():
        if calls >= max_calls:
            break
        if not d.get("text") or d.get("llm") or len(d.get("beers") or []) >= 2:
            continue
        prompt = (
            f"Hier ist der Text der Sortiment-Seite(n) der Brauerei „{names.get(site, site)}“.\n"
            "Liste alle Biere auf, die diese Brauerei selbst braut und anbietet. Keine anderen Getränke "
            "(Limonade, Schnaps, Wein), keine Geschenkpakete, Gläser oder Merch, keine Biere anderer Brauereien.\n"
            'Antworte nur mit JSON: {"biere":[{"name":"…","alkohol":4.9,"sorte":"Pils"}]} – unbekannte Werte null, '
            'keine Biere gefunden → {"biere":[]}.\n\n' + d["text"][:7000]
        )
        try:
            r = session.post(_LLM_URL, timeout=60, headers={"Authorization": f"Bearer {token}",
                                                            "Content-Type": "application/json"},
                             json={"model": model, "temperature": 0, "max_tokens": 1500,
                                   "messages": [{"role": "user", "content": prompt}]})
        except Exception as e:  # noqa: BLE001
            return calls, f"Fehler: {e}"
        calls += 1
        if r.status_code in (401, 403):
            return calls, f"kein Zugriff (HTTP {r.status_code}) – Workflow braucht „permissions: models: read“"
        if r.status_code == 429:
            return calls, "Tageslimit erreicht"
        if r.status_code != 200:
            continue
        try:
            content = r.json()["choices"][0]["message"]["content"]
            m = re.search(r"\{.*\}", content, re.S)
            beers = json.loads(m.group(0)).get("biere", []) if m else []
        except Exception:  # noqa: BLE001
            beers = []
        d["llm"] = True
        if progress:
            progress(calls, max_calls, f"KI-Hilfe: {calls} Websites ausgewertet")
        for b in beers[:60]:
            name = clean_item(str(b.get("name") or ""))
            if name and not is_nonbeer(name):
                d["beers"].append({"name": name, "abv": parse_abv(b.get("alkohol")), "image": None, "method": "ki", "src_kind": "ki",
                                   "conf": "mittel", "style": b.get("sorte")})
        time.sleep(4.5)  # max. 15 Anfragen pro Minute
    return calls, "ok"
