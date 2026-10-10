"""Fortschritt des Katalog-Aufbaus – im GitHub-Log und live in der App (Tabelle public.catalog_runs).

Im Log: eine Zeile pro Schritt und höchstens alle 15 s eine Fortschrittszeile mit Prozent und Restzeit.
In der Datenbank: höchstens alle 4 s ein Update über eine eigene Verbindung (unabhängig vom großen Laden).
Fehler beim Schreiben bremsen den Katalog nie – dann gibt es eben nur das Log.
"""

from __future__ import annotations

import json
import os
import time


def _fmt_s(s: float) -> str:
    s = int(max(0, s))
    return f"{s // 60} min {s % 60:02d} s" if s >= 60 else f"{s} s"


class Progress:
    def __init__(self, steps: list[str], db_url: str | None = None):
        self.steps = steps
        self.i = 0
        self.name = ""
        self.t0 = time.time()
        self.step_t0 = self.t0
        self.last_log = 0.0
        self.last_db = 0.0
        self.conn = None
        self.run_id = None
        self.state = {"done": None, "total": None, "detail": None}
        if db_url:
            try:
                import psycopg

                self.conn = psycopg.connect(db_url, autocommit=True, prepare_threshold=None, connect_timeout=15)
                url = None
                if os.environ.get("GITHUB_RUN_ID"):
                    url = (f"{os.environ.get('GITHUB_SERVER_URL', 'https://github.com')}/"
                           f"{os.environ.get('GITHUB_REPOSITORY')}/actions/runs/{os.environ['GITHUB_RUN_ID']}")
                with self.conn.cursor() as cur:
                    # alte, hängengebliebene Läufe abschließen
                    cur.execute("update public.catalog_runs set status = 'abgebrochen', finished_at = now() "
                                "where status = 'läuft' and updated_at < now() - interval '30 minutes'")
                    cur.execute("insert into public.catalog_runs (steps, run_url) values (%s, %s) returning id",
                                (len(steps), url))
                    self.run_id = cur.fetchone()[0]
            except Exception as e:  # noqa: BLE001
                print(f"(Fortschritt nur im Log: {str(e)[:120]})", flush=True)
                self.conn = None

    # ------------------------------------------------------------------ intern
    def _db(self, force: bool = False, **extra):
        if not self.conn or not self.run_id:
            return
        now = time.time()
        if not force and now - self.last_db < 4:
            return
        self.last_db = now
        try:
            with self.conn.cursor() as cur:
                cur.execute(
                    """update public.catalog_runs set step = %s, phase = %s, done = %s, total = %s, detail = %s,
                       updated_at = now(), status = coalesce(%s, status),
                       finished_at = case when %s::text is not null then now() else finished_at end,
                       stats = coalesce(%s::jsonb, stats)
                       where id = %s""",
                    (self.i, self.name, self.state["done"], self.state["total"], self.state["detail"],
                     extra.get("status"), extra.get("status"),
                     json.dumps(extra["stats"], default=list, ensure_ascii=False) if "stats" in extra else None,
                     self.run_id),
                )
        except Exception as e:  # noqa: BLE001
            print(f"(Fortschritt konnte nicht gespeichert werden: {str(e)[:120]})", flush=True)
            try:
                self.conn.close()
            except Exception:  # noqa: BLE001
                pass
            self.conn = None

    # ------------------------------------------------------------------ öffentlich
    def step(self, name: str):
        """Nächster Schritt beginnt."""
        if self.name:
            print(f"   ✓ {self.name} fertig nach {_fmt_s(time.time() - self.step_t0)}", flush=True)
        self.i = min(self.i + 1, len(self.steps))
        self.name = name
        self.step_t0 = time.time()
        self.state = {"done": None, "total": None, "detail": None}
        print(f"\n▶ [{self.i}/{len(self.steps)}] {name}  (Gesamtzeit {_fmt_s(time.time() - self.t0)})", flush=True)
        self._db(force=True)

    def update(self, done: int | None, total: int | None, detail: str | None = None):
        """Fortschritt innerhalb des Schritts (z. B. 450 von 1395 Websites)."""
        self.state = {"done": done, "total": total, "detail": detail}
        now = time.time()
        if now - self.last_log >= 15 or (total and done == total):
            self.last_log = now
            pct = f"{100 * done / total:.0f} %" if total else ""
            eta = ""
            if total and done and done < total:
                spent = now - self.step_t0
                eta = f" · noch ~{_fmt_s(spent / done * (total - done))}"
            print(f"   {self.name}: {done}/{total} {pct}{eta}" + (f" · {detail}" if detail else ""), flush=True)
        self._db()

    def note(self, detail: str):
        """Kurze Zwischeninfo ohne Zahlen."""
        self.state["detail"] = detail
        print(f"   {self.name}: {detail}", flush=True)
        self._db()

    def finish(self, ok: bool, stats: dict | None = None):
        if self.name:
            print(f"   ✓ {self.name} fertig nach {_fmt_s(time.time() - self.step_t0)}", flush=True)
        print(f"\n■ Katalog {'fertig' if ok else 'mit Fehlern beendet'} nach {_fmt_s(time.time() - self.t0)}", flush=True)
        self.i = len(self.steps)
        self.name = "Fertig" if ok else "Mit Fehlern beendet"
        self.state = {"done": None, "total": None, "detail": None}
        self._db(force=True, status="fertig" if ok else "fehler", stats=stats or {})
        if self.conn:
            try:
                self.conn.close()
            except Exception:  # noqa: BLE001
                pass

    def cb(self):
        """Funktion (done, total, detail) für Unterprogramme."""
        return lambda done, total, detail=None: self.update(done, total, detail)
