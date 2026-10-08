"""Logo von der Brauerei-Website: apple-touch-icon → <img> mit „logo“ → og:image → großes Favicon.

Höflich: robots.txt wird beachtet, pro Website höchstens 2 Anfragen, eigener User-Agent.
"""

from __future__ import annotations

import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

from .util import USER_AGENT, http_session


class _Collector(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.touch: list[tuple[int, str]] = []
        self.icons: list[tuple[int, str]] = []
        self.logo_imgs: list[str] = []
        self.og: str | None = None
        self._in_header = 0

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag in ("header", "nav"):
            self._in_header += 1
        if tag == "link":
            rel = a.get("rel", "").lower()
            href = a.get("href")
            if not href:
                return
            size = 0
            m = re.search(r"(\d+)x\d+", a.get("sizes", ""))
            if m:
                size = int(m.group(1))
            if "apple-touch-icon" in rel:
                self.touch.append((size or 180, href))
            elif "icon" in rel and (size >= 96 or href.lower().endswith(".svg")):
                self.icons.append((size or 256, href))
        elif tag == "meta":
            if a.get("property", "").lower() == "og:image" or a.get("name", "").lower() == "og:image":
                self.og = self.og or a.get("content")
        elif tag == "img":
            src = a.get("src") or a.get("data-src") or a.get("data-lazy-src")
            hay = " ".join([src or "", a.get("class", ""), a.get("id", ""), a.get("alt", "")]).lower()
            if src and "logo" in hay and not src.startswith("data:"):
                # Logos im Kopfbereich bevorzugen
                if self._in_header:
                    self.logo_imgs.insert(0, src)
                else:
                    self.logo_imgs.append(src)

    def handle_endtag(self, tag):
        if tag in ("header", "nav") and self._in_header:
            self._in_header -= 1


def extract_logo(html: str, base: str) -> str | None:
    c = _Collector()
    try:
        c.feed(html[:400_000])
    except Exception:  # noqa: BLE001
        pass
    cand: list[str] = []
    if c.touch:
        cand.append(max(c.touch)[1])
    cand += c.logo_imgs[:1]
    if c.og:
        cand.append(c.og)
    if c.icons:
        cand.append(max(c.icons)[1])
    for u in cand:
        u = u.strip()
        if u:
            full = urljoin(base, u)
            if full.startswith("https://") or full.startswith("http://"):
                return full
    return None


def _one(session, site: str) -> tuple[str, str | None, int]:
    try:
        p = urlparse(site)
        root = f"{p.scheme}://{p.netloc}/"
        rp = RobotFileParser()
        try:
            r = session.get(urljoin(root, "/robots.txt"), timeout=10)
            rp.parse(r.text.splitlines() if r.status_code == 200 else [])
        except Exception:  # noqa: BLE001
            rp.parse([])
        if not rp.can_fetch(USER_AGENT, root):
            return site, None, 999
        time.sleep(1)
        r = session.get(root, timeout=15)
        if r.status_code != 200 or "html" not in r.headers.get("content-type", "html"):
            return site, None, r.status_code
        return site, extract_logo(r.text, r.url), 200
    except Exception:  # noqa: BLE001
        return site, None, 0


def find_logos(sites: list[str], cache: dict[str, dict], budget_s: float = 600, workers: int = 12):
    """→ (Ergebnisse {site: logo_url|None}, neue Cache-Einträge)"""
    out: dict[str, str | None] = {}
    new: dict[str, dict] = {}
    todo = []
    for s in sorted(set(sites)):
        if s in cache:
            out[s] = cache[s].get("logo_url")
        else:
            todo.append(s)
    deadline = time.time() + budget_s
    session = http_session()
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(_one, session, s) for s in todo]
        for f in as_completed(futs):
            site, logo, status = f.result()
            out[site] = logo
            new[site] = {"logo_url": logo, "status": status}
            if time.time() > deadline:
                for g in futs:
                    g.cancel()
                break
    return out, new
