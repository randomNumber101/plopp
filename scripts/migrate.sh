#!/usr/bin/env bash
# Spielt neue Dateien aus supabase/migrations/ in die Datenbank ein (jede genau einmal).
# Benötigt: DB_URL
set -euo pipefail
: "${DB_URL:?DB_URL fehlt}"
cd "$(dirname "$0")/.."

psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
create schema if not exists app_private;
revoke all on schema app_private from public;
create table if not exists app_private.migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);
-- 001 wurde beim ersten Setup über die Supabase-API eingespielt
insert into app_private.migrations (name)
select '001_init.sql' where to_regclass('public.beers') is not null
on conflict do nothing;
SQL

for f in supabase/migrations/*.sql; do
  n="$(basename "$f")"
  if [ "$(psql "$DB_URL" -tAc "select 1 from app_private.migrations where name = '$n'")" = "1" ]; then
    echo "= $n (bereits eingespielt)"
    continue
  fi
  echo "+ $n"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q --single-transaction \
    -f "$f" \
    -c "insert into app_private.migrations (name) values ('$n')"
done
