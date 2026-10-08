"""
Bier-App – einmaliges Setup (Windows, macOS, Linux).

Was das Skript macht:
  1. Supabase: Tabellen/Regeln anlegen, Login konfigurieren, dein App-Konto erstellen,
     danach Registrierung für Fremde sperren.
  2. GitHub: Code in dein Repo hochladen, GitHub Pages einschalten, auf das Deployment warten.

Benötigt nur Python 3.8+ (keine Zusatzpakete). Start unter Windows: Doppelklick auf setup.bat.
Kann gefahrlos mehrfach ausgeführt werden.
"""

import base64
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

PROJECT_REF = "mrbsjnhvwugzujdblfof"
GITHUB_USER = "randomnumber101"
DEFAULT_REPO = "plopp"

ROOT = Path(__file__).resolve().parent
# (Überschreibbar nur für Tests)
SUPABASE_API = os.environ.get("TEST_SUPABASE_API", "https://api.supabase.com/v1")
SUPABASE_URL = os.environ.get("TEST_SUPABASE_URL", f"https://{PROJECT_REF}.supabase.co")
GITHUB_API = os.environ.get("TEST_GITHUB_API", "https://api.github.com")
UA = "bier-app-setup/1.0"

SKIP_DIRS = {"node_modules", "dist", ".git", "__pycache__", ".vite"}
SKIP_FILES = {".DS_Store", "Thumbs.db"}


# --------------------------------------------------------------------------- Hilfen

class ApiError(Exception):
    def __init__(self, status, body, url):
        super().__init__(f"HTTP {status} bei {url}: {body[:500]}")
        self.status = status
        self.body = body


def request(method, url, token=None, body=None, headers=None, auth_scheme="Bearer"):
    h = {"User-Agent": UA, "Accept": "application/json"}
    if token:
        h["Authorization"] = f"{auth_scheme} {token}"
    if headers:
        h.update(headers)
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        h["Content-Type"] = "application/json"
    # Kurze Netzwerkaussetzer (z. B. während Supabase den Auth-Dienst neu startet) abfangen
    for attempt in range(8):
        req = urllib.request.Request(url, data=data, method=method, headers=h)
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                raw = res.read().decode("utf-8")
                return json.loads(raw) if raw.strip() else None
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", "replace")
            if e.code in (429, 502, 503, 504) and attempt < 7:
                print(f"    ... Server antwortet {e.code}, neuer Versuch in {5 + attempt * 3}s")
                time.sleep(5 + attempt * 3)
                continue
            raise ApiError(e.code, err_body, url) from None
        except (urllib.error.URLError, ConnectionError, TimeoutError, OSError) as e:
            if attempt < 7:
                print(f"    ... Verbindung unterbrochen ({getattr(e, 'reason', e)}), neuer Versuch in {5 + attempt * 3}s")
                time.sleep(5 + attempt * 3)
                continue
            raise ApiError(0, f"Netzwerkfehler: {e}", url) from None


def step(msg):
    print(f"\n==> {msg}")


def ok(msg):
    print(f"    OK  {msg}")


def fail(msg):
    print(f"\n    FEHLER: {msg}")
    sys.exit(1)


def ask(prompt, default=None, env=None):
    if env and os.environ.get(env):
        return os.environ[env].strip()
    suffix = f" [{default}]" if default else ""
    val = input(f"{prompt}{suffix}: ").strip()
    return val or (default or "")


# --------------------------------------------------------------------------- Supabase

def sb(method, path, token, body=None):
    return request(method, f"{SUPABASE_API}{path}", token, body)


def supabase_setup(token, app_email, app_password):
    step("Supabase-Projekt prüfen")
    try:
        proj = sb("GET", f"/projects/{PROJECT_REF}", token)
    except ApiError as e:
        if e.status in (401, 403):
            fail("Supabase-Token ungültig oder ohne Zugriff auf das Projekt.")
        raise
    status = proj.get("status")
    ok(f"Projekt '{proj.get('name')}' ({proj.get('region')}), Status {status}")
    if status and status != "ACTIVE_HEALTHY":
        fail(f"Projekt ist nicht aktiv (Status {status}). Im Supabase-Dashboard wiederherstellen und erneut starten.")

    step("Datenbank-Tabellen anlegen")
    for f in sorted((ROOT / "supabase" / "migrations").glob("*.sql")):
        sb("POST", f"/projects/{PROJECT_REF}/database/query", token, {"query": f.read_text(encoding="utf-8")})
        ok(f.name)
    rows = sb(
        "POST",
        f"/projects/{PROJECT_REF}/database/query",
        token,
        {"query": "select table_name from information_schema.tables where table_schema='public' "
                  "and table_name in ('breweries','beers','beer_barcodes','checkins','wishlist') order by 1"},
    )
    names = [r["table_name"] for r in rows or []]
    if len(names) != 5:
        fail(f"Es fehlen Tabellen, gefunden: {names}")
    ok("Tabellen vorhanden: " + ", ".join(names))

    step("API-Schlüssel holen")
    keys = sb("GET", f"/projects/{PROJECT_REF}/api-keys", token)
    public_key = None
    for k in keys:
        if k.get("type") == "publishable" and k.get("api_key"):
            public_key = k["api_key"]
            break
    if not public_key:
        for k in keys:
            if k.get("name") == "anon" and k.get("api_key"):
                public_key = k["api_key"]
                break
    if not public_key:
        fail("Kein öffentlicher API-Schlüssel (publishable/anon) gefunden.")
    ok(f"öffentlicher Schlüssel: {public_key[:18]}...")
    return public_key


def supabase_auth(token, public_key, site_url, app_email, app_password):
    step("Login konfigurieren")
    sb(
        "PATCH",
        f"/projects/{PROJECT_REF}/config/auth",
        token,
        {
            "site_url": site_url,
            "uri_allow_list": site_url + "**",
            "external_email_enabled": True,
            "mailer_autoconfirm": True,  # keine Bestätigungs-Mail nötig
            "password_min_length": 8,
            "disable_signup": False,
        },
    )
    # Warten, bis die Auth-Konfiguration aktiv ist (der Auth-Dienst startet dafür kurz neu)
    for _ in range(12):
        cfg = sb("GET", f"/projects/{PROJECT_REF}/config/auth", token) or {}
        if cfg.get("mailer_autoconfirm") is True:
            break
        time.sleep(5)
    time.sleep(5)
    ok("E-Mail + Passwort aktiv, ohne Bestätigungs-Mail")

    wait_for_auth(public_key)

    step(f"App-Konto für {app_email} anlegen")
    try:
        request(
            "POST",
            f"{SUPABASE_URL}/auth/v1/signup",
            body={"email": app_email, "password": app_password},
            headers={"apikey": public_key},
        )
        ok("Konto angelegt")
    except ApiError as e:
        if "already" in e.body.lower() or e.status == 422:
            ok("Konto existiert bereits")
        else:
            raise

    # E-Mail sicherheitshalber direkt als bestätigt markieren (falls die Bestätigungspflicht noch aktiv war)
    confirm_email(token, app_email)

    # Anmeldung testen (mit ein paar Wiederholungen)
    res = None
    for attempt in range(4):
        try:
            res = request(
                "POST",
                f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
                body={"email": app_email, "password": app_password},
                headers={"apikey": public_key},
            )
            break
        except ApiError as e:
            body = e.body.lower()
            if "invalid" in body and "credentials" in body:
                fail("Konto existiert, aber das Passwort stimmt nicht. Bitte das richtige Passwort angeben.")
            if "not_confirmed" in body and attempt < 3:
                confirm_email(token, app_email, admin_fallback=True)
                time.sleep(3)
                continue
            raise
    ok("Anmeldung funktioniert")
    # Tabellen-Zugriff mit echtem Login prüfen
    request(
        "GET",
        f"{SUPABASE_URL}/rest/v1/breweries?select=id&limit=1",
        token=res["access_token"],
        headers={"apikey": public_key},
    )
    ok("Datenzugriff mit Login funktioniert")

    step("Registrierung für andere sperren")
    sb("PATCH", f"/projects/{PROJECT_REF}/config/auth", token, {"disable_signup": True})
    ok("Nur noch dein Konto kann sich anmelden")


def wait_for_auth(public_key):
    """Nach einer Konfigurationsänderung startet der Auth-Dienst neu – warten, bis er antwortet."""
    for _ in range(24):
        try:
            req = urllib.request.Request(
                f"{SUPABASE_URL}/auth/v1/health", headers={"apikey": public_key, "User-Agent": UA}
            )
            with urllib.request.urlopen(req, timeout=15) as res:
                if res.status == 200:
                    return
        except Exception:
            pass
        print("    ... warte auf den Auth-Dienst")
        time.sleep(5)


def confirm_email(token, email, admin_fallback=False):
    """Markiert die E-Mail des App-Kontos als bestätigt."""
    esc = email.replace("'", "''")
    try:
        sb(
            "POST",
            f"/projects/{PROJECT_REF}/database/query",
            token,
            {"query": "update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) "
                      f"where lower(email) = lower('{esc}')"},
        )
        ok("E-Mail als bestätigt markiert")
        return
    except ApiError as e:
        if not admin_fallback:
            print(f"    Hinweis: direkte Bestätigung per SQL nicht möglich ({e.status}), versuche Admin-API ...")
    # Fallback: Auth-Admin-API mit geheimem Schlüssel
    keys = sb("GET", f"/projects/{PROJECT_REF}/api-keys?reveal=true", token)
    secret = next((k["api_key"] for k in keys if k.get("type") == "secret" and k.get("api_key")), None) \
        or next((k["api_key"] for k in keys if k.get("name") == "service_role" and k.get("api_key")), None)
    if not secret:
        fail("Konnte die E-Mail nicht bestätigen (kein geheimer Schlüssel gefunden).")
    hdr = {"apikey": secret}
    users = request("GET", f"{SUPABASE_URL}/auth/v1/admin/users?per_page=1000", token=secret, headers=hdr)
    user = next((u for u in users.get("users", []) if (u.get("email") or "").lower() == email.lower()), None)
    if not user:
        fail("App-Konto nicht gefunden.")
    request("PUT", f"{SUPABASE_URL}/auth/v1/admin/users/{user['id']}", token=secret,
            body={"email_confirm": True}, headers=hdr)
    ok("E-Mail über Admin-API bestätigt")


# --------------------------------------------------------------------------- GitHub

def gh(method, path, token, body=None):
    return request(
        method,
        f"{GITHUB_API}{path}",
        token,
        body,
        headers={"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"},
    )


def pick_repo(token):
    step("GitHub-Repo finden")
    try:
        repos = gh("GET", "/user/repos?per_page=100&affiliation=owner", token)
    except ApiError as e:
        if e.status == 401:
            fail("GitHub-Token ungültig.")
        repos = []
    mine = [r for r in repos if r["owner"]["login"].lower() == GITHUB_USER.lower()]
    if len(mine) == 1:
        repo = mine[0]
    else:
        names = [r["name"] for r in mine]
        if names:
            print("    Gefundene Repos: " + ", ".join(names))
        default = DEFAULT_REPO if DEFAULT_REPO in names or not names else names[0]
        name = ask("    Name des Repos", default, env="BIER_REPO")
        repo = gh("GET", f"/repos/{GITHUB_USER}/{name}", token)
    ok(f"{repo['full_name']} (öffentlich: {not repo['private']})")
    if repo["private"]:
        print("    Hinweis: GitHub Pages ist im Gratis-Plan nur für öffentliche Repos verfügbar.")
    return repo


def collect_files():
    files = []
    for p in sorted(ROOT.rglob("*")):
        if p.is_dir():
            continue
        rel = p.relative_to(ROOT)
        if any(part in SKIP_DIRS for part in rel.parts) or p.name in SKIP_FILES:
            continue
        files.append((rel.as_posix(), p.read_bytes()))
    return files


def push_code(token, repo):
    full = repo["full_name"]
    branch = repo.get("default_branch") or "main"

    step("Code hochladen")
    head_sha = None
    try:
        ref = gh("GET", f"/repos/{full}/git/ref/heads/{branch}", token)
        head_sha = ref["object"]["sha"]
    except ApiError as e:
        if e.status not in (404, 409):
            raise
    if head_sha is None:
        # Leeres Repo: erst eine Datei über die Contents-API anlegen, damit der Branch existiert
        gh(
            "PUT",
            f"/repos/{full}/contents/.keepalive",
            token,
            {"message": "init", "content": base64.b64encode(b"init\n").decode(), "branch": branch},
        )
        head_sha = gh("GET", f"/repos/{full}/git/ref/heads/{branch}", token)["object"]["sha"]
        ok(f"Branch {branch} angelegt")

    enable_pages(token, full)

    files = collect_files()
    tree = []
    for i, (path, data) in enumerate(files, 1):
        blob = gh("POST", f"/repos/{full}/git/blobs", token,
                  {"content": base64.b64encode(data).decode(), "encoding": "base64"})
        mode = "100755" if path.endswith(".sh") else "100644"
        tree.append({"path": path, "mode": mode, "type": "blob", "sha": blob["sha"]})
        print(f"\r    {i}/{len(files)} Dateien", end="", flush=True)
    print()
    new_tree = gh("POST", f"/repos/{full}/git/trees", token, {"tree": tree})
    commit = gh(
        "POST",
        f"/repos/{full}/git/commits",
        token,
        {"message": "Bier-App: Setup", "tree": new_tree["sha"], "parents": [head_sha]},
    )
    try:
        gh("PATCH", f"/repos/{full}/git/refs/heads/{branch}", token, {"sha": commit["sha"], "force": False})
    except ApiError as e:
        if "workflow" in e.body.lower() or e.status == 403:
            fail("Der GitHub-Token darf keine Workflow-Dateien schreiben. Bitte beim Token unter "
                 "'Repository permissions' -> 'Workflows' auf 'Read and write' stellen "
                 "(https://github.com/settings/personal-access-tokens) und das Setup erneut starten.")
        raise
    ok(f"Commit {commit['sha'][:7]} auf {branch}")
    return commit["sha"]


def pages_status(token, full):
    """Liefert build_type der Pages-Seite ('workflow' / 'legacy') oder None, wenn Pages aus ist."""
    try:
        return (gh("GET", f"/repos/{full}/pages", token) or {}).get("build_type")
    except ApiError as e:
        if e.status == 404:
            return None
        raise


def enable_pages(token, full):
    if pages_status(token, full) == "workflow":
        ok("GitHub Pages ist bereits eingeschaltet")
        return
    try:
        try:
            gh("POST", f"/repos/{full}/pages", token, {"build_type": "workflow"})
            ok("GitHub Pages eingeschaltet")
            return
        except ApiError as e:
            if e.status == 409:
                gh("PUT", f"/repos/{full}/pages", token, {"build_type": "workflow"})
                ok("GitHub Pages auf GitHub Actions umgestellt")
                return
            raise
    except ApiError as e:
        if e.status == 422 and "private" in e.body.lower():
            fail("GitHub Pages geht im Gratis-Plan nur mit öffentlichen Repos. Repo auf 'public' stellen und erneut starten.")
        if e.status not in (403, 404):
            raise
    # Token darf Pages nicht einschalten (dafür bräuchte er zusätzlich 'Administration: write').
    # Einfacher: einmal von Hand einschalten.
    print()
    print("    GitHub Pages muss einmal von Hand eingeschaltet werden (1 Klick):")
    print(f"      1. Öffne  https://github.com/{full}/settings/pages")
    print("      2. Unter 'Build and deployment' -> 'Source' wähle  'GitHub Actions'")
    print("         (es gibt keinen Speichern-Knopf, die Auswahl gilt sofort)")
    while True:
        input("    Danach hier Enter drücken ... ")
        status = pages_status(token, full)
        if status == "workflow":
            ok("GitHub Pages ist eingeschaltet")
            return
        if status == "legacy":
            print("    Pages ist an, aber die Quelle steht noch auf 'Deploy from a branch' – bitte auf 'GitHub Actions' stellen.")
        else:
            print("    Pages ist noch nicht eingeschaltet.")


def wait_for_deploy(token, full, sha):
    step("Warte auf das Deployment (ca. 1-3 Minuten)")
    deadline = time.time() + 600
    run = None
    while time.time() < deadline:
        runs = gh("GET", f"/repos/{full}/actions/runs?head_sha={sha}&per_page=10", token).get("workflow_runs", [])
        run = next((r for r in runs if r["name"] == "Deploy"), None)
        if run and run["status"] == "completed":
            break
        state = run["status"] if run else "wartet auf Start"
        print(f"\r    Status: {state}            ", end="", flush=True)
        time.sleep(10)
    print()
    if not run:
        print("    Workflow nicht gefunden – bitte im Repo unter 'Actions' nachsehen.")
        return False
    if run.get("conclusion") != "success":
        print(f"    Deployment fehlgeschlagen ({run.get('conclusion')}): {run['html_url']}")
        return False
    ok("Deployment erfolgreich")
    return True


# --------------------------------------------------------------------------- main

def main():
    print("Bier-App Setup")
    print("==============")
    print("Tipp: In der Konsole fügst du mit Rechtsklick oder Strg+V ein.\n")

    sb_token = ask("Supabase Access Token (sbp_...)", env="SUPABASE_ACCESS_TOKEN")
    gh_token = ask("GitHub Token (github_pat_...)", env="GITHUB_TOKEN")
    print("\nJetzt die Zugangsdaten, mit denen DU dich später in der App anmeldest:")
    app_email = ask("E-Mail für die App", env="BIER_EMAIL")
    app_password = ask("Passwort für die App (mind. 8 Zeichen)", env="BIER_PASSWORD")
    if not (sb_token and gh_token and app_email and len(app_password) >= 8):
        fail("Bitte alle Angaben machen (Passwort mind. 8 Zeichen).")

    repo = pick_repo(gh_token)
    site_url = f"https://{GITHUB_USER.lower()}.github.io/{repo['name']}/"

    public_key = supabase_setup(sb_token, app_email, app_password)
    supabase_auth(sb_token, public_key, site_url, app_email, app_password)

    step("App-Konfiguration schreiben")
    cfg = ROOT / "src" / "config.ts"
    text = cfg.read_text(encoding="utf-8")
    text = re.sub(r"SUPABASE_URL = '[^']*'", f"SUPABASE_URL = '{SUPABASE_URL}'", text)
    text = re.sub(r"SUPABASE_KEY = '[^']*'", f"SUPABASE_KEY = '{public_key}'", text)
    cfg.write_text(text, encoding="utf-8")
    ok("src/config.ts")

    sha = push_code(gh_token, repo)
    success = wait_for_deploy(gh_token, repo["full_name"], sha)

    print("\n" + "=" * 60)
    if success:
        print("FERTIG! Deine App:")
    else:
        print("Fast fertig – das Deployment braucht noch einen Blick (siehe oben). Die App wird hier liegen:")
    print(f"\n    {site_url}\n")
    print("Öffne den Link auf dem Handy, melde dich mit deiner E-Mail und deinem Passwort an")
    print("und füge die Seite zum Home-Bildschirm hinzu.")
    print("\nSicherheit: Bitte jetzt das Supabase-DB-Passwort zurücksetzen und beide Tokens löschen,")
    print("da sie im Chat standen. Die App braucht sie nicht mehr.")
    print("=" * 60)


if __name__ == "__main__":
    try:
        main()
    except ApiError as e:
        fail(str(e))
    except KeyboardInterrupt:
        print("\nAbgebrochen.")
