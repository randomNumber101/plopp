-- Bewertungen mit Zwischenwerten (0,5 bis 5,0 in Zehnteln), bisherige ganze Sterne bleiben erhalten

alter table public.checkins drop constraint if exists checkins_rating_check;

alter table public.checkins
  alter column rating type numeric(2, 1) using rating::numeric(2, 1);

do $$ begin
  alter table public.checkins add constraint checkins_rating_check check (rating between 0.5 and 5);
exception when duplicate_object then null; end $$;
