-- Genaue Adressen der Brauereien + Cache für den Website-Crawler

alter table public.breweries add column if not exists street text;      -- „Marktstraße 8“
alter table public.breweries add column if not exists postcode text;    -- „96155“

-- Ergebnis je Website (Adresse, Sortiment, Diagnose) – nur für den Import, nicht über die API erreichbar
create table if not exists app_private.site_cache (
  url         text primary key,
  data        jsonb not null default '{}'::jsonb,
  fetched_at  timestamptz not null default now()
);
