-- Suche findet Brauereien auch über ihre Marken und andere Namen (brewery_aliases):
-- „Sternburg“ → Leipziger Brauhaus zu Reudnitz, „Tannenzäpfle“ → Rothaus.
-- Mitgeliefert werden nur Aliase, die nicht schon im Namen stecken (höchstens 6 je Brauerei).
-- Idempotent: ersetzt nur die Funktion.

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
           b.logo_url, b.trust, b.brewery_type, b.cap_color
    from public.breweries b
    left join bo on bo.target_id = b.id
    where (b.circle_id is null or b.circle_id = (select id from c))
      and not (case when bo.data ? 'hidden_at' then bo.data ->> 'hidden_at' is not null else b.hidden_at is not null end)
  ),
  al as (
    select a.brewery_id, jsonb_agg(a.alias order by length(a.alias)) as aliases
    from (
      select d.brewery_id, d.alias, row_number() over (partition by d.brewery_id order by length(d.alias)) as n
      from (
        select distinct on (x.brewery_id, lower(x.alias)) x.brewery_id, x.alias
        from public.brewery_aliases x
        join br on br.id = x.brewery_id
        where length(x.alias) between 3 and 60
          and position(lower(x.alias) in lower(br.name)) = 0
      ) d
    ) a
    where a.n <= 6
    group by a.brewery_id
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
    'v', 2,
    'breweries', coalesce((select jsonb_agg(jsonb_build_array(br.id, br.name, br.city, br.logo_url, left(br.trust, 1),
                                                              br.brewery_type, br.cap_color, al.aliases))
                           from br left join al on al.brewery_id = br.id), '[]'::jsonb),
    'beers', coalesce((select jsonb_agg(jsonb_build_array(id, name, style, abv, brewery_id, image_url, left(trust, 1))) from be), '[]'::jsonb)
  );
$$;

revoke execute on function public.search_index() from public, anon;
grant execute on function public.search_index() to authenticated;
