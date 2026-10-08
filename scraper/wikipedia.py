"""Aktive Brauereien aus der deutschsprachigen Wikipedia (Quelltext über die MediaWiki-API).

- „Liste aktiver Brauereien in Deutschland“: Tabellen pro Bundesland
  (Unternehmen | Standort | Gründung | Marken | Sorten [| Anmerkungen]; Stadtstaaten ohne Standort)
- „Liste aktiver Brauereien in Bayern“: verschachtelte Listen nach Regierungsbezirk / Landkreis,
  Einträge im Format „Name, Gemeinde-Ortsteil (Anmerkung)“

Bundesland, Regierungsbezirk und Landkreis kommen aus den Abschnittsüberschriften.
"""

from __future__ import annotations

import re
from urllib.parse import urlparse

import mwparserfromhell as mwp

from .util import get_with_retry, http_session, key, tokens

API = "https://de.wikipedia.org/w/api.php"
PAGE_DE = "Liste aktiver Brauereien in Deutschland"
PAGE_BY = "Liste aktiver Brauereien in Bayern"

STATES = [
    "Baden-Württemberg", "Bayern", "Berlin", "Brandenburg", "Bremen", "Hamburg", "Hessen",
    "Mecklenburg-Vorpommern", "Niedersachsen", "Nordrhein-Westfalen", "Rheinland-Pfalz",
    "Saarland", "Sachsen", "Sachsen-Anhalt", "Schleswig-Holstein", "Thüringen",
]
CITY_STATES = {"Berlin", "Hamburg", "Bremen"}
BY_REGIONS = ["Oberbayern", "Niederbayern", "Oberpfalz", "Oberfranken", "Mittelfranken", "Unterfranken", "Schwaben"]

SKIP_SECTIONS = re.compile(
    r"ehemal|geschlossen|siehe auch|weblinks|einzelnachweis|literatur|quellen|^anmerkung|fußnote|statistik|legende",
    re.IGNORECASE,
)
FILE_PREFIX = re.compile(r"^\s*(datei|file|bild|image)\s*:", re.IGNORECASE)
HEADING = re.compile(r"^(={2,6})\s*(.*?)\s*\1\s*$")


# --------------------------------------------------------------------------- Abruf

def fetch_wikitext(title: str, session=None) -> str:
    s = session or http_session()
    r = get_with_retry(
        s, API,
        params={"action": "parse", "page": title, "prop": "wikitext", "format": "json",
                "formatversion": 2, "redirects": 1},
    )
    data = r.json()
    if "error" in data:
        raise RuntimeError(f"Wikipedia: {data['error']}")
    return data["parse"]["wikitext"]


def resolve_qids(titles: list[str], session=None) -> dict[str, str]:
    """Artikeltitel → Wikidata-ID (folgt Weiterleitungen)."""
    s = session or http_session()
    out: dict[str, str] = {}
    uniq = sorted({t for t in titles if t})
    for i in range(0, len(uniq), 50):
        batch = uniq[i:i + 50]
        data = get_with_retry(
            s, API,
            params={"action": "query", "prop": "pageprops", "ppprop": "wikibase_item", "redirects": 1,
                    "titles": "|".join(batch), "format": "json", "formatversion": 2},
        ).json()
        q = data.get("query", {})
        fwd: dict[str, str] = {}
        for n in q.get("normalized", []):
            fwd[n["from"]] = n["to"]
        for n in q.get("redirects", []):
            fwd[n["from"]] = n["to"]
        page_qid = {p["title"]: p.get("pageprops", {}).get("wikibase_item")
                    for p in q.get("pages", []) if not p.get("missing")}
        for t in batch:
            cur = t
            for _ in range(3):
                if cur in fwd:
                    cur = fwd[cur]
            if page_qid.get(cur):
                out[t] = page_qid[cur]
    return out


# --------------------------------------------------------------------------- Wikitext-Helfer

def _dms(v: str) -> float | None:
    """'48.137' oder '48/8/13.2/N' → Dezimalgrad"""
    v = (v or "").strip()
    try:
        return float(v)
    except ValueError:
        pass
    parts = v.split("/")
    try:
        nums = [float(p) for p in parts if re.fullmatch(r"[\d.]+", p)]
    except ValueError:
        return None
    if not nums:
        return None
    deg = nums[0] + (nums[1] if len(nums) > 1 else 0) / 60 + (nums[2] if len(nums) > 2 else 0) / 3600
    return -deg if parts[-1].strip().upper() in ("S", "W") else deg


def _coords_from(code) -> tuple[float, float] | None:
    for t in code.filter_templates(recursive=True):
        name = str(t.name).strip().lower()
        if name in ("coordinate", "coord", "koordinate"):
            ns = ew = None
            if t.has("NS") and t.has("EW"):
                ns, ew = _dms(str(t.get("NS").value)), _dms(str(t.get("EW").value))
            elif len(t.params) >= 2:
                ns, ew = _dms(str(t.params[0].value)), _dms(str(t.params[1].value))
            if ns is not None and ew is not None and 47 <= ns <= 55.5 and 5.5 <= ew <= 15.5:
                return ns, ew
    return None


def _urls_from(code) -> list[str]:
    urls = [str(l.url) for l in code.filter_external_links(recursive=True)]
    for t in code.filter_templates(recursive=True):
        if t.has("url"):
            urls.append(str(t.get("url").value).strip())
    return [u for u in urls if u.startswith("http")]


def _flatten(code) -> str:
    """Wikitext → Klartext (Refs, Dateien, Koordinaten raus; Sortier-Vorlagen auflösen)."""
    code = mwp.parse(re.sub(r"<br\s*/?>", ", ", str(code), flags=re.IGNORECASE))
    for tag in code.filter_tags(recursive=True, matches=lambda n: str(n.tag).lower() in ("ref", "references")):
        try:
            code.remove(tag)
        except ValueError:
            pass
    for t in code.filter_templates(recursive=True):
        name = str(t.name).strip().lower()
        try:
            if (name.startswith("sort") or name in ("nts", "lang", "nowrap", "nobr", "date", "dts")) and t.params:
                code.replace(t, str(t.params[-1].value))
            else:
                code.remove(t)
        except ValueError:
            pass
    for l in code.filter_wikilinks(recursive=True):
        if FILE_PREFIX.match(str(l.title)):
            try:
                code.remove(l)
            except ValueError:
                pass
    text = code.strip_code(normalize=True, collapse=True)
    text = re.sub(r"<br\s*/?>", ", ", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\[\d+\]", " ", text)
    return re.sub(r"\s+", " ", text).strip(" ,;")


def _first_link(code) -> tuple[str | None, str | None]:
    """(Artikeltitel, Anzeigetext) des ersten normalen Wikilinks"""
    for l in code.filter_wikilinks(recursive=False):
        title = str(l.title).strip()
        if FILE_PREFIX.match(title) or title.startswith((":", "#")) or ":" in title.split("#")[0][:12]:
            continue
        text = mwp.parse(str(l.text)).strip_code().strip() if l.text else title
        return title.split("#")[0].strip(), text
    return None, None


def _logo_file(code) -> str | None:
    for l in code.filter_wikilinks(recursive=True):
        t = str(l.title)
        if FILE_PREFIX.match(t):
            return FILE_PREFIX.sub("", t).strip()
    return None


def _split_list(text: str) -> list[str]:
    parts = re.split(r"\s*(?:,|;|/|<br\s*/?>|\n| und )\s*", text or "")
    return [p.strip(" .") for p in parts if 1 < len(p.strip(" .")) <= 60]


def pick_website(urls: list[str], name: str) -> str | None:
    """Wählt aus Belegen die Homepage, deren Domain zum Brauereinamen passt."""
    nt = [t for t in tokens(name) if len(t) >= 4]
    best = None
    for u in urls:
        try:
            p = urlparse(u)
        except ValueError:
            continue
        host = (p.hostname or "").lower().removeprefix("www.")
        if not host or any(x in host for x in ("wikipedia", "wikimedia", "archive.org", "google.", "facebook.",
                                                  "instagram.", "youtube.", "bier-index", "brauerei-verzeichnis")):
            continue
        dom = re.sub(r"[^a-z0-9]", "", host.rsplit(".", 1)[0].replace("ae", "a").replace("oe", "o").replace("ue", "u"))
        if any(t in dom or (len(dom) >= 5 and dom in t) for t in nt):
            root = f"{p.scheme}://{p.hostname}/"
            if best is None or len(root) < len(best):
                best = root
    return best


def brewery_type(name: str, note: str = "") -> str:
    t = f"{name} {note}".lower()
    if "kommunbrau" in t:
        return "kommunbrauhaus"
    if "museum" in t:
        return "museumsbrauerei"
    if re.search(r"gasthausbrauerei|hausbrauerei|brauereigasthof|braugasthof|gasthof|wirtshaus|bräustüberl|"
                 r"brauereigaststätte|gastst|restaurant|brewpub|brauhaus am|brauwirtschaft", t):
        return "gasthausbrauerei"
    return "brauerei"


def _entry(**kw) -> dict:
    e = {
        "name": None, "place": None, "state": None, "region": None, "district": None, "founded": None,
        "brands": [], "styles": [], "note": None, "link_title": None, "logo_file": None,
        "website": None, "coords": None, "type": None, "page": None,
    }
    e.update(kw)
    e["type"] = e["type"] or brewery_type(e["name"] or "", e["note"] or "")
    return e


# --------------------------------------------------------------------------- Abschnitte

def _sections(text: str):
    """Liefert (Überschriften-Stapel, Zeilen) je Abschnitt."""
    stack: list[tuple[int, str]] = []
    lines: list[str] = []
    for line in text.splitlines():
        m = HEADING.match(line.strip())
        if m:
            if lines:
                yield [h for _, h in stack], lines
            level = len(m.group(1))
            title = mwp.parse(m.group(2)).strip_code().strip()
            stack = [(l, h) for l, h in stack if l < level] + [(level, title)]
            lines = []
        else:
            lines.append(line)
    if lines:
        yield [h for _, h in stack], lines


def _tables(lines: list[str]) -> list[str]:
    out, buf, depth = [], [], 0
    for line in lines:
        s = line.strip()
        if s.startswith("{|"):
            depth += 1
        if depth:
            buf.append(line)
        if s.startswith("|}") and depth:
            depth -= 1
            if depth == 0:
                out.append("\n".join(buf))
                buf = []
    return out


def _table_rows(block: str) -> tuple[list[str], list[list]]:
    """(Spaltenköpfe, Zeilen als Liste von Wikicode-Zellen) – berücksichtigt rowspan."""
    code = mwp.parse(block)
    tables = code.filter_tags(matches=lambda n: str(n.tag) == "table", recursive=False)
    if not tables:
        return [], []
    table = tables[0]
    # Kopfzeile ohne vorangehendes „|-“ steht direkt in der Tabelle, nicht in einer Zeile
    headers: list[str] = [
        _flatten(c.contents).lower()
        for c in table.contents.filter_tags(matches=lambda n: str(n.tag) == "th", recursive=False)
    ]
    rows: list[list] = []
    pending: dict[int, tuple[int, object]] = {}  # Spalte → (verbleibende Zeilen, Zelle)
    for tr in table.contents.filter_tags(matches=lambda n: str(n.tag) == "tr", recursive=False):
        cells = tr.contents.filter_tags(matches=lambda n: str(n.tag) in ("td", "th"), recursive=False)
        if cells and all(str(c.tag) == "th" for c in cells):
            if not headers:
                headers = [_flatten(c.contents).lower() for c in cells]
            continue
        row = []
        ci = 0
        it = iter(cells)
        while True:
            if ci in pending:
                left, cell = pending[ci]
                row.append(cell)
                if left <= 1:
                    del pending[ci]
                else:
                    pending[ci] = (left - 1, cell)
                ci += 1
                continue
            c = next(it, None)
            if c is None:
                break
            span = 1
            for a in c.attributes:
                if str(a.name).strip().lower() == "rowspan":
                    try:
                        span = int(str(a.value).strip().strip('"'))
                    except ValueError:
                        pass
            row.append(c.contents)
            if span > 1:
                pending[ci] = (span - 1, c.contents)
            ci += 1
        if any(_flatten(x) for x in row):
            rows.append(row)
    return headers, rows


def _col(headers: list[str], *names: str) -> int | None:
    for i, h in enumerate(headers):
        if any(re.search(r"(^|[^a-zäöüß])" + re.escape(n), h) for n in names):
            return i
    return None


def parse_germany(text: str) -> list[dict]:
    out = []
    for heads, lines in _sections(text):
        if any(SKIP_SECTIONS.search(h) for h in heads):
            continue
        state = next((h for h in heads if h in STATES), None)
        if not state:
            continue
        for block in _tables(lines):
            headers, rows = _table_rows(block)
            ci_name = _col(headers, "unternehmen", "brauerei", "name")
            ci_place = _col(headers, "standort", "ort", "sitz")
            ci_found = _col(headers, "gründung", "gegründet")
            ci_brands = _col(headers, "marke")
            ci_styles = _col(headers, "sorte")
            ci_note = _col(headers, "anmerkung", "bemerkung")
            if ci_name is None:
                ci_name = 0
            for row in rows:
                def cell(i):
                    return row[i] if i is not None and i < len(row) else mwp.parse("")

                name_c = cell(ci_name)
                name = _flatten(name_c)
                if not name or len(name) > 120:
                    continue
                link_title, link_text = _first_link(mwp.parse(str(name_c)))
                if link_text and len(link_text) >= 3 and link_text.lower() in name.lower():
                    name = link_text if len(name) > len(link_text) + 25 else name
                place_c = cell(ci_place)
                place = _flatten(place_c) or (state if state in CITY_STATES else None)
                urls = _urls_from(name_c) + _urls_from(place_c) + _urls_from(cell(ci_note))
                out.append(_entry(
                    name=name, place=place, state=state, founded=_flatten(cell(ci_found)) or None,
                    brands=_split_list(_flatten(cell(ci_brands))), styles=_split_list(_flatten(cell(ci_styles))),
                    note=_flatten(cell(ci_note)) or None, link_title=link_title,
                    logo_file=_logo_file(mwp.parse(str(name_c))), website=pick_website(urls, name),
                    coords=_coords_from(mwp.parse(str(place_c))) or _coords_from(mwp.parse(str(name_c))),
                    page="de",
                ))
    return out


def parse_bavaria(text: str) -> list[dict]:
    out = []
    for heads, lines in _sections(text):
        if any(SKIP_SECTIONS.search(h) for h in heads):
            continue
        region = next((h for h in heads if h in BY_REGIONS), None)
        if not region:
            continue
        district = heads[-1] if heads and heads[-1] != region else None
        for line in lines:
            s = line.strip()
            if not s.startswith("*"):
                continue
            raw = s.lstrip("*:# ").strip()
            if not raw or re.match(r"(siehe|vgl\.|hinweis)", raw, re.IGNORECASE):
                continue
            code = mwp.parse(raw)
            urls = _urls_from(code)
            coords = _coords_from(code)
            link_title, link_text = (None, None)
            # Der Name steht vorne; ein Link am Anfang ist der Brauerei-Artikel
            first = code.nodes[0] if code.nodes else None
            if isinstance(first, mwp.nodes.Wikilink) and not FILE_PREFIX.match(str(first.title)):
                link_title = str(first.title).split("#")[0].strip()
                link_text = mwp.parse(str(first.text)).strip_code().strip() if first.text else link_title
            text = _flatten(code)
            notes = re.findall(r"\(([^()]*)\)", text)
            text_wo = re.sub(r"\s*\([^()]*\)", "", text).strip(" ,")
            parts = [p.strip() for p in text_wo.split(",") if p.strip()]
            if not parts:
                continue
            name = parts[0]
            if link_text and text.startswith(link_text):
                name = re.sub(r"\s*\([^()]*\)", "", link_text).strip()
                rest = text_wo[len(name):].strip(" ,")
                parts = [name] + [p.strip() for p in rest.split(",") if p.strip()]
            place = ", ".join(parts[1:]) or None
            if len(name) < 3 or len(name) > 120:
                continue
            note = "; ".join(n.strip() for n in notes if n.strip()) or None
            out.append(_entry(
                name=name, place=place, state="Bayern", region=region, district=district, note=note,
                link_title=link_title, website=pick_website(urls, name), coords=coords, page="by",
            ))
    return out


def fetch() -> tuple[list[dict], dict]:
    """Liefert (Einträge, Rohtexte) – Bayern aus der eigenen Liste, Rest aus der Deutschland-Liste."""
    s = http_session()
    raw = {"de": fetch_wikitext(PAGE_DE, s), "by": fetch_wikitext(PAGE_BY, s)}
    de = [e for e in parse_germany(raw["de"]) if e["state"] != "Bayern"]
    by = parse_bavaria(raw["by"])
    # Bayern-Einträge, die nur in der Deutschland-Liste stehen, trotzdem übernehmen
    by_keys = {key(e["name"]) for e in by}
    de_by = [e for e in parse_germany(raw["de"]) if e["state"] == "Bayern" and key(e["name"]) not in by_keys]
    entries = de + by + de_by
    qids = resolve_qids([e["link_title"] for e in entries if e["link_title"]], s)
    for e in entries:
        e["qid"] = qids.get(e["link_title"]) if e["link_title"] else None
    return entries, raw
