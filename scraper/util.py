"""Hilfsfunktionen: Normalisieren von Namen, Sorten erkennen, HTTP."""

from __future__ import annotations

import re
import time
import unicodedata

import requests

USER_AGENT = "BierApp/1.0 (https://github.com/randomNumber101/plopp)"

# Wörter, die beim Vergleich von Brauerei-/Markennamen ignoriert werden
STOPWORDS = {
    "brauerei", "privatbrauerei", "bierbrauerei", "familienbrauerei", "landbrauerei",
    "stadtbrauerei", "klosterbrauerei", "schlossbrauerei", "burgbrauerei", "hausbrauerei",
    "gasthausbrauerei", "dampfbrauerei", "bergbrauerei", "hofbrauerei", "brauhaus", "brau",
    "braeu", "brauereigasthof", "gmbh", "mbh", "co", "kg", "ag", "ohg", "gbr", "ek", "e", "k",
    "und", "the", "brewery", "brewing", "company", "inh", "beer",
}

_PACKAGING = [
    r"\b\d+\s*[x×]\s*\d+([.,]\d+)?\s*(l|ml|cl|liter)\b",
    r"\b\d+([.,]\d+)?\s*(l|ml|cl|liter)\b",
    r"\b(dose|dosen|flasche|flaschen|glasflasche|kasten|kiste|mehrweg|einweg|pfand|sixpack|"
    r"six pack|träger|tray|bügelflasche|longneck|steinie|fass|partyfass)\b",
    r"\b\d+\s*er(\s*-?\s*pack)?\b",
    r"\b\d+\s*-?\s*pack\b",
    r"\(\s*\)",
]


def fold(s: str) -> str:
    """Kleinschreibung, ß → ss, Akzente/Umlaute entfernen (ä → a)."""
    s = (s or "").lower().replace("ß", "ss")
    s = unicodedata.normalize("NFKD", s)
    return "".join(c for c in s if not unicodedata.combining(c))


def tokens(s: str) -> list[str]:
    s = re.sub(r"['’`´]s\b", "", fold(s))  # „Beck's“ → „beck“
    return [t for t in re.split(r"[^a-z0-9]+", s) if t and t not in STOPWORDS]


def key(s: str) -> str:
    """Vergleichsschlüssel für Namen, z. B. 'Krombacher Brauerei GmbH & Co. KG' → 'krombacher'."""
    return " ".join(tokens(s))


def clean_beer_name(name: str, brand: str | None = None) -> str:
    """Entfernt Gebindeangaben ('0,5 l', 'Dose', '6x0,33l') und stellt die Marke voran, falls sie fehlt."""
    n = name or ""
    for pat in _PACKAGING:
        n = re.sub(pat, " ", n, flags=re.IGNORECASE)
    n = re.sub(r"\s+", " ", n).strip(" -–,.;:/")
    if brand:
        bt = tokens(brand)
        if bt and bt[0] not in tokens(n):
            n = f"{brand.strip()} {n}".strip()
    return n


_STYLE_RULES: list[tuple[str, str]] = [
    (r"alkoholfrei|alcohol.?free|non.?alcoholic|\b0[.,]0\b|sans alcool", "Alkoholfrei"),
    (r"radler|alsterwasser|shandy|biermischgetrank|beer.?mix", "Radler"),
    (r"berliner weisse|\bgose\b|\bsour", "Sour"),
    (r"weizenbock|weissbock|weizen.?doppelbock", "Weizenbock"),
    (r"kristall", "Kristallweizen"),
    (r"dunkle[sr]? (hefe)?weiss|dunkle[sr]? (hefe)?weizen|(hefe)?weiss\w* dunkel|(hefe)?weizen\w* dunkel", "Dunkles Weizen"),
    (r"hefe.?weiss|hefe.?weizen|hefeweiz", "Hefeweizen"),
    (r"weizen|weissbier|weisse\b|wheat|weiss\b", "Weizen"),
    (r"doppelbock|\w+ator\b", "Doppelbock"),
    (r"\bbock", "Bock"),
    (r"pils|pilsner|pilsener", "Pils"),
    (r"\bhelle[sr]?\b|\bhell\b", "Helles"),
    (r"export", "Export"),
    (r"marzen|maerzen|festbier|oktoberfest|wiesn", "Märzen"),
    (r"kellerbier|\bkeller\b|ungespundet|landbier", "Kellerbier"),
    (r"zwickel", "Zwickel"),
    (r"schwarzbier|black lager", "Schwarzbier"),
    (r"rauchbier|smoked", "Rauchbier"),
    (r"kolsch|koelsch", "Kölsch"),
    (r"\balt\b|altbier", "Altbier"),
    (r"\bipa\b|india pale", "IPA"),
    (r"pale ale|\bapa\b", "Pale Ale"),
    (r"stout", "Stout"),
    (r"porter", "Porter"),
    (r"dunkel|dark.?beer|dark.?lager", "Dunkel"),
    (r"lager", "Lager"),
]


def guess_style(*texts: str | None) -> str | None:
    t = " ".join(fold(x).replace("-", " ") for x in texts if x)
    for pat, style in _STYLE_RULES:
        if re.search(pat, t):
            return style
    return None


def parse_abv(v) -> float | None:
    try:
        f = float(str(v).replace(",", "."))
    except (TypeError, ValueError):
        return None
    if 0 <= f < 70:
        return round(f, 1)
    return None


def http_session() -> requests.Session:
    s = requests.Session()
    s.headers["User-Agent"] = USER_AGENT
    return s


def get_with_retry(session: requests.Session, url: str, *, tries: int = 5, **kw) -> requests.Response:
    last = None
    timeout = kw.pop("timeout", 120)
    for i in range(tries):
        try:
            r = session.get(url, timeout=timeout, **kw)
            if r.status_code in (429, 500, 502, 503, 504):
                raise requests.HTTPError(f"HTTP {r.status_code}", response=r)
            r.raise_for_status()
            return r
        except requests.RequestException as e:  # noqa: PERF203
            last = e
            time.sleep(5 * (i + 1))
    raise RuntimeError(f"Abruf fehlgeschlagen: {url}: {last}")
