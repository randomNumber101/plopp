"""Schreibt den Katalog mengenbasiert (Staging-Tabellen + COPY) in die Datenbank.

Regeln:
- Datensätze werden über ext_id wiedererkannt.
- Vom Nutzer angelegte Einträge (source = 'user') werden nie überschrieben; sie bekommen
  höchstens fehlende Angaben (Koordinaten, Website, Logo …) und die ext_id ergänzt.
- Veraltete Katalog-Einträge (nicht mehr im aktuellen Lauf) werden aufgeräumt. Hat der Nutzer
  ein solches Bier schon eingetragen, wandern Check-ins/Merkliste über den Barcode zum neuen Bier;
  ohne Nachfolger bleibt es erhalten.
"""

from __future__ import annotations

import json

import psycopg

BREWERY_COLS = ["ext_id", "name", "city", "state", "country", "lat", "lng", "website", "logo_url", "source",
                "trust", "sources", "brewery_type", "region", "district", "founded", "geo_precision", "parent_ext",
                "street", "postcode"]
BREWERY_TYPES = ["text", "text", "text", "text", "text", "double precision", "double precision", "text", "text",
                 "text", "text", "jsonb", "text", "text", "text", "text", "text", "text", "text", "text"]
BEER_COLS = ["ext_id", "brewery_ext", "name", "style", "abv", "image_url", "source", "trust", "sources"]
BEER_TYPES = ["text", "text", "text", "text", "numeric(4,1)", "text", "text", "text", "jsonb"]


def _dedupe(rows: list[dict], *keys) -> list[dict]:
    seen, out = set(), []
    for r in rows:
        k = tuple(r[x] for x in keys)
        if k in seen:
            continue
        seen.add(k)
        out.append(r)
    return out


def _val(v):
    if isinstance(v, (dict, list)):
        return json.dumps(v, ensure_ascii=False)
    return v


def load(conn: psycopg.Connection, breweries: list[dict], beers: list[dict], prune: bool = True) -> dict:
    breweries = [{**b, "_k": (b["name"].lower(), (b.get("city") or "").lower())} for b in breweries]
    breweries = _dedupe(_dedupe(breweries, "ext_id"), "_k")
    valid = {b["ext_id"] for b in breweries}
    for b in breweries:
        if b.get("parent_ext") not in valid:
            b["parent_ext"] = None
        b.setdefault("sources", {})
    beers = [b for b in beers if b["brewery_ext"] in valid]
    beers = _dedupe(_dedupe([{**b, "_k": (b["brewery_ext"], b["name"].lower())} for b in beers], "ext_id"), "_k")

    stats: dict = {}
    with conn.transaction(), conn.cursor() as cur:
        cur.execute("create temp table stg_breweries (" + ", ".join(
            f"{c} {t}" for c, t in zip(BREWERY_COLS, BREWERY_TYPES)) + ") on commit drop")
        cur.execute("create temp table stg_beers (" + ", ".join(
            f"{c} {t}" for c, t in zip(BEER_COLS, BEER_TYPES)) + ") on commit drop")
        cur.execute("create temp table stg_barcodes (ean text, beer_ext text) on commit drop")
        cur.execute("create temp table stg_aliases (brewery_ext text, alias text, alias_key text) on commit drop")

        with cur.copy(f"copy stg_breweries ({', '.join(BREWERY_COLS)}) from stdin") as cp:
            for b in breweries:
                cp.write_row([_val(b.get(c)) for c in BREWERY_COLS])
        with cur.copy(f"copy stg_beers ({', '.join(BEER_COLS)}) from stdin") as cp:
            for b in beers:
                cp.write_row([_val(b.get(c, {} if c == "sources" else None)) for c in BEER_COLS])
        with cur.copy("copy stg_barcodes (ean, beer_ext) from stdin") as cp:
            for b in beers:
                for e in sorted(b["eans"]):
                    cp.write_row([e, b["ext_id"]])
        from .util import key as _key
        with cur.copy("copy stg_aliases (brewery_ext, alias, alias_key) from stdin") as cp:
            for b in breweries:
                for a in b.get("aliases") or []:
                    cp.write_row([b["ext_id"], a, _key(a)])

        # ---------------------------------------------------------------- Brauereien
        # Vorhandene Einträge ohne bzw. mit veralteter ext_id über Name + Ort neu zuordnen
        cur.execute("""
            with cand as (
              select distinct on (s.ext_id) b.id, s.ext_id
              from public.breweries b
              join stg_breweries s on lower(b.name) = lower(s.name)
                                  and lower(coalesce(b.city, '')) = lower(coalesce(s.city, ''))
              where (b.ext_id is null or not exists (select 1 from stg_breweries x where x.ext_id = b.ext_id))
                and b.circle_id is null
                and not exists (select 1 from public.breweries y where y.ext_id = s.ext_id)
              order by s.ext_id, b.created_at
            )
            update public.breweries b set ext_id = cand.ext_id from cand where b.id = cand.id
        """)
        stats["breweries_linked"] = cur.rowcount
        cur.execute("""
            update public.breweries b set
              name = case when 'name' = any(b.locked) or exists (
                       select 1 from public.breweries x
                       where x.id <> b.id and x.circle_id is null and lower(x.name) = lower(s.name)
                         and lower(coalesce(x.city, '')) = lower(coalesce(s.city, ''))
                     ) then b.name else s.name end,
              city = case when 'city' = any(b.locked) or exists (
                       select 1 from public.breweries x
                       where x.id <> b.id and x.circle_id is null and lower(x.name) = lower(s.name)
                         and lower(coalesce(x.city, '')) = lower(coalesce(s.city, ''))
                     ) then b.city else s.city end,
              state = case when 'state' = any(b.locked) then b.state else coalesce(s.state, b.state) end,
              country = case when 'country' = any(b.locked) then b.country else coalesce(s.country, b.country) end,
              lat = case when 'lat' = any(b.locked) then b.lat else coalesce(s.lat, b.lat) end,
              lng = case when 'lng' = any(b.locked) then b.lng else coalesce(s.lng, b.lng) end,
              website = case when 'website' = any(b.locked) then b.website else coalesce(s.website, b.website) end,
              logo_url = coalesce(s.logo_url, b.logo_url),
              source = s.source, trust = s.trust, sources = s.sources,
              brewery_type = s.brewery_type, region = s.region, district = s.district,
              founded = s.founded,
              geo_precision = case when 'lat' = any(b.locked) then b.geo_precision else coalesce(s.geo_precision, b.geo_precision) end,
              street = coalesce(s.street, b.street), postcode = coalesce(s.postcode, b.postcode)
            from stg_breweries s
            where b.ext_id = s.ext_id and b.source <> 'user' and b.circle_id is null
        """)
        stats["breweries_updated"] = cur.rowcount
        cur.execute("""
            update public.breweries b set
              state = coalesce(b.state, s.state), lat = coalesce(b.lat, s.lat),
              lng = coalesce(b.lng, s.lng), website = coalesce(b.website, s.website),
              logo_url = coalesce(b.logo_url, s.logo_url),
              brewery_type = coalesce(b.brewery_type, s.brewery_type),
              district = coalesce(b.district, s.district), region = coalesce(b.region, s.region),
              street = coalesce(b.street, s.street), postcode = coalesce(b.postcode, s.postcode)
            from stg_breweries s
            where b.ext_id = s.ext_id and b.source = 'user'
        """)
        cur.execute("""
            insert into public.breweries (ext_id, name, city, state, country, lat, lng, website, logo_url, source,
                                          trust, sources, brewery_type, region, district, founded, geo_precision,
                                          street, postcode, circle_id)
            select s.ext_id, s.name, s.city, s.state, s.country, s.lat, s.lng, s.website, s.logo_url, s.source,
                   s.trust, s.sources, s.brewery_type, s.region, s.district, s.founded, s.geo_precision,
                   s.street, s.postcode, null
            from stg_breweries s
            where not exists (select 1 from public.breweries x where x.ext_id = s.ext_id)
            on conflict do nothing
        """)
        stats["breweries_inserted"] = cur.rowcount
        cur.execute("""
            update public.breweries b set parent_id = p.id
            from stg_breweries s join public.breweries p on p.ext_id = s.parent_ext
            where b.ext_id = s.ext_id and b.parent_id is distinct from p.id
        """)
        cur.execute("""
            update public.breweries b set parent_id = null
            from stg_breweries s
            where b.ext_id = s.ext_id and s.parent_ext is null and b.parent_id is not null and b.source <> 'user'
        """)
        cur.execute("""
            insert into public.brewery_aliases (brewery_id, alias, alias_key, source)
            select br.id, s.alias, s.alias_key, 'katalog'
            from stg_aliases s join public.breweries br on br.ext_id = s.brewery_ext
            where s.alias_key <> ''
            on conflict do nothing
        """)

        # ---------------------------------------------------------------- Biere
        cur.execute("""
            create temp table stg_beers2 on commit drop as
            select s.*, br.id as brewery_id
            from stg_beers s join public.breweries br on br.ext_id = s.brewery_ext
        """)
        cur.execute("""
            with cand as (
              select distinct on (s.ext_id) b.id, s.ext_id
              from public.beers b
              join stg_beers2 s on b.brewery_id = s.brewery_id and lower(b.name) = lower(s.name)
              where (b.ext_id is null or not exists (select 1 from stg_beers x where x.ext_id = b.ext_id))
                and b.circle_id is null
                and not exists (select 1 from public.beers y where y.ext_id = s.ext_id)
              order by s.ext_id, b.created_at
            )
            update public.beers b set ext_id = cand.ext_id from cand where b.id = cand.id
        """)
        stats["beers_linked"] = cur.rowcount
        cur.execute("""
            update public.beers b set
              name = case when 'name' = any(b.locked) or exists (select 1 from public.beers x where x.id <> b.id
                                       and x.circle_id is null
                                       and x.brewery_id = s.brewery_id and lower(x.name) = lower(s.name))
                          then b.name else s.name end,
              brewery_id = case when exists (select 1 from public.beers x where x.id <> b.id
                                       and x.circle_id is null
                                       and x.brewery_id = s.brewery_id and lower(x.name) = lower(case when 'name' = any(b.locked) then b.name else s.name end))
                          then b.brewery_id else s.brewery_id end,
              style = case when 'style' = any(b.locked) then b.style else coalesce(s.style, b.style) end,
              abv = case when 'abv' = any(b.locked) then b.abv else coalesce(s.abv, b.abv) end,
              image_url = coalesce(s.image_url, b.image_url), source = s.source,
              trust = s.trust, sources = s.sources
            from stg_beers2 s
            where b.ext_id = s.ext_id and b.source <> 'user' and b.circle_id is null
        """)
        stats["beers_updated"] = cur.rowcount
        cur.execute("""
            update public.beers b set
              style = coalesce(b.style, s.style), abv = coalesce(b.abv, s.abv),
              image_url = coalesce(b.image_url, s.image_url)
            from stg_beers2 s
            where b.ext_id = s.ext_id and b.source = 'user'
              and (b.style is null or b.abv is null or b.image_url is null)
        """)
        cur.execute("""
            insert into public.beers (ext_id, brewery_id, name, style, abv, image_url, source, trust, sources, circle_id)
            select s.ext_id, s.brewery_id, s.name, s.style, s.abv, s.image_url, s.source, s.trust, s.sources, null
            from stg_beers2 s
            where not exists (select 1 from public.beers x where x.ext_id = s.ext_id)
            on conflict do nothing
        """)
        stats["beers_inserted"] = cur.rowcount

        # ---------------------------------------------------------------- Barcodes (+ Umzug von veralteten Bieren)
        cur.execute("""
            create temp table stale_beers on commit drop as
            select b.id from public.beers b
            where b.source <> 'user' and b.trust <> 'user' and b.circle_id is null
              and (b.ext_id is null or not exists (select 1 from stg_beers s where s.ext_id = b.ext_id))
        """)
        cur.execute("""
            create temp table beer_moves on commit drop as
            select distinct on (bb.beer_id) bb.beer_id as old_id, nb.id as new_id
            from public.beer_barcodes bb
            join stg_barcodes s on s.ean = bb.ean
            join public.beers nb on nb.ext_id = s.beer_ext
            where bb.beer_id in (select id from stale_beers) and bb.beer_id <> nb.id and bb.circle_id is null
        """)
        cur.execute("""
            update public.beer_barcodes bb set beer_id = nb.id
            from stg_barcodes s join public.beers nb on nb.ext_id = s.beer_ext
            where bb.ean = s.ean and bb.circle_id is null and bb.beer_id <> nb.id and bb.beer_id in (select id from stale_beers)
        """)
        stats["barcodes_moved"] = cur.rowcount
        cur.execute("""
            insert into public.beer_barcodes (ean, beer_id, circle_id)
            select s.ean, b.id, null from stg_barcodes s join public.beers b on b.ext_id = s.beer_ext
            where s.ean ~ '^[0-9]{8,14}$'
            on conflict do nothing
        """)
        stats["barcodes_inserted"] = cur.rowcount
        cur.execute("update public.checkins c set beer_id = m.new_id from beer_moves m where c.beer_id = m.old_id")
        stats["checkins_moved"] = cur.rowcount
        cur.execute("""
            insert into public.wishlist (user_id, beer_id, created_at)
            select w.user_id, m.new_id, w.created_at from public.wishlist w join beer_moves m on m.old_id = w.beer_id
            on conflict do nothing
        """)
        cur.execute("delete from public.wishlist w using beer_moves m where w.beer_id = m.old_id")

        # Sicherung: Wenn plötzlich mehr als die Hälfte des Katalogs „veraltet“ wäre, stimmt etwas nicht
        # Website-Biere dürfen sich stark ändern (bessere Erkennung räumt Dubletten auf), der übrige Katalog nicht
        cur.execute("""
            select count(*) filter (where b.source not like '%%website%%'),
                   count(*) filter (where b.source like '%%website%%')
            from public.beers b where b.id in (select id from stale_beers)
        """)
        stale_core, stale_web = cur.fetchone()
        cur.execute("""
            select count(*) filter (where source not like '%%website%%' and source <> 'user'),
                   count(*) filter (where source like '%%website%%')
            from public.beers
        """)
        core_n, web_n = cur.fetchone()
        new_web = sum(1 for b in beers if "website" in (b.get("source") or ""))
        stale_n = stale_core + stale_web
        stats["beers_stale"] = stale_n
        stats["beers_stale_website"] = stale_web
        if prune and core_n and stale_core > 0.5 * core_n:
            prune = False
            stats["prune_skipped"] = f"{stale_core} von {core_n} Katalog-Bieren wären gelöscht worden"
        elif prune and web_n > 200 and new_web < 0.2 * web_n:
            prune = False
            stats["prune_skipped"] = f"nur {new_web} Website-Biere statt bisher {web_n} – Websites offenbar nicht erreicht"
        if prune:
            # Veraltete Biere ohne Bezug zum Nutzer entfernen
            cur.execute("""
                delete from public.beers b
                where b.id in (select id from stale_beers)
                  and b.hidden_at is null
                  and not exists (select 1 from public.checkins c where c.beer_id = b.id)
                  and not exists (select 1 from public.wishlist w where w.beer_id = b.id)
            """)
            stats["beers_pruned"] = cur.rowcount
            # Veraltete Brauereien ohne Biere / Unterstandorte / Nutzerbezug entfernen
            cur.execute("""
                delete from public.breweries br
                where br.source <> 'user' and br.trust <> 'user' and br.circle_id is null
                  and (br.ext_id is null or not exists (select 1 from stg_breweries s where s.ext_id = br.ext_id))
                  and not exists (select 1 from public.beers b where b.brewery_id = br.id)
                  and not exists (select 1 from public.breweries c where c.parent_id = br.id)
            """)
            stats["breweries_pruned"] = cur.rowcount

        cur.execute("""
            select (select count(*) from public.breweries),
                   (select count(*) from public.breweries where trust = 'verified'),
                   (select count(*) from public.breweries where lat is not null),
                   (select count(*) from public.breweries where logo_url is not null),
                   (select count(*) from public.beers),
                   (select count(*) from public.beers where trust = 'verified'),
                   (select count(*) from public.beer_barcodes),
                   (select count(*) from public.breweries where street is not null)
        """)
        t = cur.fetchone()
        stats.update(db_breweries=t[0], db_breweries_verified=t[1], db_breweries_on_map=t[2],
                     db_breweries_with_logo=t[3], db_beers=t[4], db_beers_verified=t[5], db_barcodes=t[6],
                     db_breweries_with_address=t[7])
    return stats


def load_caches(conn: psycopg.Connection) -> tuple[dict, dict, dict, dict, list]:
    """→ (geocode_cache, web_cache, brand_overrides {marke_key: ext_id|None}, site_cache,
          ausgeblendete Biere [(brauerei_ext_id, biername)])"""
    geo, web, over, sites, hidden = {}, {}, {}, {}, []
    with conn.cursor() as cur:
        try:
            cur.execute("select query, lat, lng, state, precision from app_private.geocode_cache")
            for q, lat, lng, st, pr in cur.fetchall():
                geo[q] = {"lat": lat, "lng": lng, "state": st, "precision": pr}
            cur.execute("select url, logo_url, status from app_private.web_cache "
                        "where fetched_at > now() - interval '120 days'")
            for u, logo, status in cur.fetchall():
                web[u] = {"logo_url": logo, "status": status}
            cur.execute("""select o.source_key, o.action, b.ext_id from public.match_overrides o
                           left join public.breweries b on b.id = o.target_id where o.kind = 'brand'""")
            for k, action, ext in cur.fetchall():
                over[k] = ext if action == "match" else None
        except psycopg.errors.UndefinedTable:
            conn.rollback()
    with conn.cursor() as cur:
        try:
            from .sites import TTL_FAIL_DAYS, TTL_OK_DAYS

            cur.execute("select url, data from app_private.site_cache where fetched_at > now() - "
                        "(case when (data->>'status') = '200' then %s else %s end) * interval '1 day'",
                        (TTL_OK_DAYS, TTL_FAIL_DAYS))
            for u, d in cur.fetchall():
                sites[u] = d
        except psycopg.errors.UndefinedTable:
            conn.rollback()
    with conn.cursor() as cur:
        try:
            cur.execute("""select br.ext_id, b.name from public.beers b join public.breweries br on br.id = b.brewery_id
                           where b.hidden_at is not null and br.ext_id is not null""")
            hidden = [(e, n) for e, n in cur.fetchall()]
        except psycopg.errors.UndefinedColumn:
            conn.rollback()
    conn.commit()
    return geo, web, over, sites, hidden


def save_caches(conn: psycopg.Connection, geo_new: dict, web_new: dict, sites_new: dict | None = None) -> None:
    with conn.transaction(), conn.cursor() as cur:
        if sites_new:
            cur.executemany(
                "insert into app_private.site_cache (url, data) values (%s, %s) "
                "on conflict (url) do update set data = excluded.data, fetched_at = now()",
                [(u, json.dumps(d, ensure_ascii=False, default=list)) for u, d in sites_new.items()],
            )
        cur.executemany(
            "insert into app_private.geocode_cache (query, lat, lng, state, precision) values (%s, %s, %s, %s, %s) "
            "on conflict (query) do update set lat = excluded.lat, lng = excluded.lng, state = excluded.state, "
            "precision = excluded.precision, fetched_at = now()",
            [(q, r.get("lat"), r.get("lng"), r.get("state"), r.get("precision")) for q, r in geo_new.items()],
        )
        cur.executemany(
            "insert into app_private.web_cache (url, logo_url, status) values (%s, %s, %s) "
            "on conflict (url) do update set logo_url = excluded.logo_url, status = excluded.status, fetched_at = now()",
            [(u, r.get("logo_url"), r.get("status")) for u, r in web_new.items()],
        )


# ---------------------------------------------------------------- Rückfall-Speicher für Quellen
# Fällt eine Quelle (z. B. OpenStreetMap/Overpass) einmal aus, nimmt der Lauf den letzten guten Stand,
# statt mit halbem Katalog weiterzumachen.

def source_cache_get(conn: psycopg.Connection, name: str):
    try:
        with conn.transaction(), conn.cursor() as cur:
            cur.execute("select data, fetched_at from app_private.source_cache where name = %s", (name,))
            row = cur.fetchone()
            return (row[0], row[1]) if row else (None, None)
    except Exception:  # noqa: BLE001
        return None, None


def source_cache_put(conn: psycopg.Connection, name: str, data) -> None:
    try:
        with conn.transaction(), conn.cursor() as cur:
            cur.execute(
                "insert into app_private.source_cache (name, data) values (%s, %s) "
                "on conflict (name) do update set data = excluded.data, fetched_at = now()",
                (name, json.dumps(data, ensure_ascii=False, default=list)),
            )
    except Exception as e:  # noqa: BLE001
        print(f"(Quelle {name} nicht zwischengespeichert: {str(e)[:120]})", flush=True)
