#!/usr/bin/env bash
# Ermittelt die Verbindungs-URL zur Supabase-Datenbank und schreibt sie (maskiert) nach $GITHUB_ENV.
#  - SUPABASE_DB_URL gesetzt  → wird direkt verwendet
#  - sonst SUPABASE_DB_PASSWORD → Session-Pooler (IPv4) wird automatisch gesucht
set -euo pipefail
REF="mrbsjnhvwugzujdblfof"
REGION="eu-west-1"

try() {
  PGCONNECT_TIMEOUT=10 psql "$1" -tAc "select 1" >/dev/null 2>/tmp/psql.err
}

if [ -n "${SUPABASE_DB_URL:-}" ]; then
  URL="$SUPABASE_DB_URL"
  if ! try "$URL"; then
    echo "::error::Verbindung mit SUPABASE_DB_URL fehlgeschlagen: $(cat /tmp/psql.err)"
    exit 1
  fi
elif [ -n "${SUPABASE_DB_PASSWORD:-}" ]; then
  PW="$(python3 -c 'import os,urllib.parse;print(urllib.parse.quote(os.environ["SUPABASE_DB_PASSWORD"],safe=""))')"
  URL=""
  for host in "aws-0-$REGION.pooler.supabase.com" "aws-1-$REGION.pooler.supabase.com" "aws-2-$REGION.pooler.supabase.com"; do
    CAND="postgresql://postgres.$REF:$PW@$host:5432/postgres?sslmode=require"
    if try "$CAND"; then URL="$CAND"; echo "Verbunden über $host"; break; fi
    echo "  $host: $(head -c 200 /tmp/psql.err)"
  done
  if [ -z "$URL" ]; then
    echo "::error::Keine Verbindung zur Datenbank. Stimmt das Passwort im Secret SUPABASE_DB_PASSWORD?"
    exit 1
  fi
else
  echo "::error::Secret SUPABASE_DB_PASSWORD fehlt (Repo → Settings → Secrets and variables → Actions)."
  exit 1
fi

echo "::add-mask::$URL"
echo "DB_URL=$URL" >> "$GITHUB_ENV"
