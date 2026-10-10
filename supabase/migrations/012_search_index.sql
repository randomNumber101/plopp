-- Schnelle Suche: Die App lädt einmal einen kompakten Suchindex (alle sichtbaren Biere und Brauereien,
-- inkl. Änderungen der eigenen Runde) und sucht dann direkt auf dem Gerät – ohne Wartezeit pro Tastendruck.
-- Ein einziger JSON-Wert, damit das PostgREST-Limit von 1000 Zeilen nicht greift.

create or replace function public.search_index()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with c as (select public.my_circle() as id),
  bo as (
    select o.target_id, o.data from public.circle_overrides o where o.circle_id = (select id from c) and o.kind = 'brewery'
  ),
  br as (
    select b.id,
           coalesce(bo.data ->> 'name', b.name) as name,
           case when bo.data ? 'city' then bo.data ->> 'city' else b.city end as city,
           b.logo_url, b.trust, b.brewery_type
    from public.breweries b
    left join bo on bo.target_id = b.id
    where (b.circle_id is null or b.circle_id = (select id from c))
      and not (case when bo.data ? 'hidden_at' then bo.data ->> 'hidden_at' is not null else b.hidden_at is not null end)
  ),
  be as (
    select x.id,
           coalesce(o.data ->> 'name', x.name) as name,
           case when o.data ? 'style' then o.data ->> 'style' else x.style end as style,
           case when o.data ? 'abv' then (o.data ->> 'abv')::numeric else x.abv end as abv,
           x.brewery_id, x.image_url, x.trust
    from public.beers x
    left join public.circle_overrides o on o.kind = 'beer' and o.target_id = x.id and o.circle_id = (select id from c)
    where (x.circle_id is null or x.circle_id = (select id from c))
      and case when o.data ? 'hidden_at' then o.data ->> 'hidden_at' is null else x.hidden_at is null end
      and (x.brewery_id is null or x.brewery_id in (select id from br))
  )
  select jsonb_build_object(
    'v', 1,
    'breweries', coalesce((select jsonb_agg(jsonb_build_array(id, name, city, logo_url, left(trust, 1), brewery_type)) from br), '[]'::jsonb),
    'beers', coalesce((select jsonb_agg(jsonb_build_array(id, name, style, abv, brewery_id, image_url, left(trust, 1))) from be), '[]'::jsonb)
  );
$$;

revoke execute on function public.search_index() from public, anon;
grant execute on function public.search_index() to authenticated;

-- Server-Suche (Rückfall, solange der Index lädt): auch Sorte, ohne Leerzeichen/Bindestriche, Umlaute egal
-- (in public, damit die Suche als aufrufender Nutzer läuft; harmlos: reine Textfunktion)
create or replace function public.fold_text(t text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(
           replace(replace(replace(replace(translate(lower(coalesce(t, '')), 'äöüéèáàâ', 'aoueeaaa'), 'ß', 'ss'), 'ae', 'a'), 'oe', 'o'), 'ue', 'u'),
           '[^a-z0-9]', '', 'g');
$$;

create or replace function public.search_beers(q text)
returns setof public.beers
language sql
stable
security invoker
set search_path = ''
as $$
  with c as (select public.my_circle() as id),
  words as (
    select public.fold_text(w) as w from unnest(regexp_split_to_array(btrim(q), '\s+')) w where public.fold_text(w) <> ''
  )
  select be.*
  from public.beers be
  left join public.breweries br on br.id = be.brewery_id
  left join public.circle_overrides o on o.kind = 'beer' and o.target_id = be.id and o.circle_id = (select id from c)
  left join public.circle_overrides bo on bo.kind = 'brewery' and bo.target_id = br.id and bo.circle_id = (select id from c)
  where (be.circle_id is null or be.circle_id = (select id from c))
    and case when o.data ? 'hidden_at' then o.data ->> 'hidden_at' is null else be.hidden_at is null end
    and (br.id is null or not (case when bo.data ? 'hidden_at' then bo.data ->> 'hidden_at' is not null else br.hidden_at is not null end))
    and (
      not exists (
        select 1 from words
        where position(words.w in public.fold_text(coalesce(o.data ->> 'name', be.name) || ' ' || coalesce(bo.data ->> 'name', br.name, '')
                                                    || ' ' || coalesce(be.style, ''))) = 0
      )
      -- „alt bier“ findet auch „Altbier“
      or position(public.fold_text(q) in public.fold_text(coalesce(o.data ->> 'name', be.name) || coalesce(be.style, ''))) > 0
    )
  order by (public.fold_text(coalesce(o.data ->> 'name', be.name)) like public.fold_text(q) || '%') desc,
           (be.circle_id is not null) desc, (be.trust = 'verified') desc, be.name
  limit 60;
$$;
