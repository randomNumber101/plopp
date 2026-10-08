"""Schreibt den Katalog mengenbasiert (Staging-Tabellen + COPY) in die Datenbank.

Regeln:
- Datensätze werden über ext_id wiedererkannt.
- Vom Nutzer angelegte Einträge (source = 'user') werden nie überschrieben; sie bekommen
  höchstens fehlende Angaben (Koordinaten, Website …) und die ext_id ergänzt.
- Es wird nichts gelöscht.
"""

from __future__ import annotations

import psycopg

BREWERY_COLS = ["ext_id", "name", "city", "state", "country", "lat", "lng", "website", "logo_url", "source"]
BEER_COLS = ["ext_id", "brewery_ext", "name", "style", "abv", "image_url", "source"]


def _dedupe(rows: list[dict], *keys) -> list[dict]:
    seen, out = set(), []
    for r in rows:
        k = tuple(r[x] for x in keys)
        if k in seen:
            continue
        seen.add(k)
        out.append(r)
    return out


def load(conn: psycopg.Connection, breweries: list[dict], beers: list[dict]) -> dict:
    # Doppelte (Name, Ort) bzw. (Brauerei, Name) vorab entfernen – sonst greifen die Unique-Indizes
    breweries = _dedupe(
        [{**b, "_k": (b["name"].lower(), (b["city"] or "").lower())} for b in breweries], "ext_id"
    )
    breweries = _dedupe(breweries, "_k")
    valid_breweries = {b["ext_id"] for b in breweries}
    beers = [b for b in beers if b["brewery_ext"] in valid_breweries]
    beers = _dedupe([{**b, "_k": (b["brewery_ext"], b["name"].lower())} for b in beers], "ext_id")
    beers = _dedupe(beers, "_k")

    stats = {}
    with conn.transaction(), conn.cursor() as cur:
        cur.execute(
            "create temp table stg_breweries (ext_id text, name text, city text, state text, country text,"
            " lat double precision, lng double precision, website text, logo_url text, source text) on commit drop"
        )
        cur.execute(
            "create temp table stg_beers (ext_id text, brewery_ext text, name text, style text,"
            " abv numeric(4,1), image_url text, source text) on commit drop"
        )
        cur.execute("create temp table stg_barcodes (ean text, beer_ext text) on commit drop")

        with cur.copy(f"copy stg_breweries ({', '.join(BREWERY_COLS)}) from stdin") as cp:
            for b in breweries:
                cp.write_row([b[c] for c in BREWERY_COLS])
        with cur.copy(f"copy stg_beers ({', '.join(BEER_COLS)}) from stdin") as cp:
            for b in beers:
                cp.write_row([b[c] for c in BEER_COLS])
        with cur.copy("copy stg_barcodes (ean, beer_ext) from stdin") as cp:
            for b in beers:
                for e in sorted(b["eans"]):
                    cp.write_row([e, b["ext_id"]])

        # ---------------------------------------------------------------- Brauereien
        # 1) Vorhandene Einträge ohne ext_id über Name + Ort zuordnen
        cur.execute("""
            update public.breweries b set ext_id = s.ext_id
            from stg_breweries s
            where b.ext_id is null
              and lower(b.name) = lower(s.name)
              and lower(coalesce(b.city, '')) = lower(coalesce(s.city, ''))
              and not exists (select 1 from public.breweries x where x.ext_id = s.ext_id)
        """)
        stats["breweries_linked"] = cur.rowcount
        # 2) Katalog-Einträge aktualisieren (Name/Ort nur, wenn das keinen Konflikt erzeugt)
        cur.execute("""
            update public.breweries b set
              name = case when exists (
                       select 1 from public.breweries x
                       where x.id <> b.id and lower(x.name) = lower(s.name)
                         and lower(coalesce(x.city, '')) = lower(coalesce(s.city, ''))
                     ) then b.name else s.name end,
              city = case when exists (
                       select 1 from public.breweries x
                       where x.id <> b.id and lower(x.name) = lower(s.name)
                         and lower(coalesce(x.city, '')) = lower(coalesce(s.city, ''))
                     ) then b.city else s.city end,
              state = coalesce(s.state, b.state),
              country = coalesce(s.country, b.country),
              lat = coalesce(s.lat, b.lat),
              lng = coalesce(s.lng, b.lng),
              website = coalesce(s.website, b.website),
              logo_url = coalesce(s.logo_url, b.logo_url),
              source = s.source
            from stg_breweries s
            where b.ext_id = s.ext_id and b.source <> 'user'
              and (b.name, b.city, b.state, b.country, b.lat, b.lng, b.website, b.logo_url, b.source)
                  is distinct from (s.name, s.city, coalesce(s.state, b.state), coalesce(s.country, b.country),
                                    coalesce(s.lat, b.lat), coalesce(s.lng, b.lng), coalesce(s.website, b.website),
                                    coalesce(s.logo_url, b.logo_url), s.source)
        """)
        stats["breweries_updated"] = cur.rowcount
        # 3) Eigene Einträge nur ergänzen
        cur.execute("""
            update public.breweries b set
              state = coalesce(b.state, s.state), lat = coalesce(b.lat, s.lat),
              lng = coalesce(b.lng, s.lng), website = coalesce(b.website, s.website),
              logo_url = coalesce(b.logo_url, s.logo_url)
            from stg_breweries s
            where b.ext_id = s.ext_id and b.source = 'user'
              and (b.state is null or b.lat is null or b.website is null or b.logo_url is null)
        """)
        # 4) Neue Brauereien
        cur.execute("""
            insert into public.breweries (ext_id, name, city, state, country, lat, lng, website, logo_url, source)
            select s.ext_id, s.name, s.city, s.state, s.country, s.lat, s.lng, s.website, s.logo_url, s.source
            from stg_breweries s
            where not exists (select 1 from public.breweries x where x.ext_id = s.ext_id)
            on conflict do nothing
        """)
        stats["breweries_inserted"] = cur.rowcount

        # ---------------------------------------------------------------- Biere
        cur.execute("""
            create temp table stg_beers2 on commit drop as
            select s.*, br.id as brewery_id
            from stg_beers s join public.breweries br on br.ext_id = s.brewery_ext
        """)
        cur.execute("""
            update public.beers b set ext_id = s.ext_id
            from stg_beers2 s
            where b.ext_id is null and b.brewery_id = s.brewery_id and lower(b.name) = lower(s.name)
              and not exists (select 1 from public.beers x where x.ext_id = s.ext_id)
        """)
        stats["beers_linked"] = cur.rowcount
        cur.execute("""
            update public.beers b set
              style = coalesce(s.style, b.style), abv = coalesce(s.abv, b.abv),
              image_url = coalesce(s.image_url, b.image_url), source = s.source
            from stg_beers2 s
            where b.ext_id = s.ext_id and b.source <> 'user'
              and (b.style, b.abv, b.image_url, b.source) is distinct from
                  (coalesce(s.style, b.style), coalesce(s.abv, b.abv), coalesce(s.image_url, b.image_url), s.source)
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
            insert into public.beers (ext_id, brewery_id, name, style, abv, image_url, source)
            select s.ext_id, s.brewery_id, s.name, s.style, s.abv, s.image_url, s.source
            from stg_beers2 s
            where not exists (select 1 from public.beers x where x.ext_id = s.ext_id)
            on conflict do nothing
        """)
        stats["beers_inserted"] = cur.rowcount

        # ---------------------------------------------------------------- Barcodes
        cur.execute("""
            insert into public.beer_barcodes (ean, beer_id)
            select s.ean, b.id from stg_barcodes s join public.beers b on b.ext_id = s.beer_ext
            where s.ean ~ '^[0-9]{8,14}$'
            on conflict do nothing
        """)
        stats["barcodes_inserted"] = cur.rowcount

        cur.execute("""
            select (select count(*) from public.breweries),
                   (select count(*) from public.breweries where lat is not null),
                   (select count(*) from public.beers),
                   (select count(*) from public.beer_barcodes),
                   (select count(*) from public.breweries where logo_url is not null)
        """)
        t = cur.fetchone()
        stats.update(db_breweries=t[0], db_breweries_on_map=t[1], db_beers=t[2], db_barcodes=t[3],
                     db_breweries_with_logo=t[4])
    return stats
