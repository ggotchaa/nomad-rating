#!/bin/sh
# Daily PostgreSQL backup with rotation (cron on the host, e.g. `15 3 * * * /srv/nomad/ops/backup.sh`).
#   KEEP_DAILY=14 KEEP_WEEKLY=8 ./ops/backup.sh
#
# Restore (stop app and worker first so nothing writes during the restore):
#   docker compose -f ops/compose.prod.yaml stop app worker
#   gunzip -c ops/backups/daily/nomad-YYYYmmdd-HHMM.sql.gz | \
#     docker compose -f ops/compose.prod.yaml exec -T postgres psql -U nomad -d postgres -c 'DROP DATABASE nomad' -c 'CREATE DATABASE nomad'
#   gunzip -c ops/backups/daily/nomad-YYYYmmdd-HHMM.sql.gz | \
#     docker compose -f ops/compose.prod.yaml exec -T postgres psql -U nomad -d nomad -v ON_ERROR_STOP=1
#   docker compose -f ops/compose.prod.yaml start app worker
# Check a backup regularly by restoring it into a scratch database (createdb nomad_check) the same way.
set -eu

DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE="docker compose -f $DIR/compose.prod.yaml"
OUT="$DIR/backups"
KEEP_DAILY="${KEEP_DAILY:-14}"
KEEP_WEEKLY="${KEEP_WEEKLY:-8}"
STAMP="$(date +%Y%m%d-%H%M)"

mkdir -p "$OUT/daily" "$OUT/weekly"
FILE="$OUT/daily/nomad-$STAMP.sql.gz"
$COMPOSE exec -T postgres pg_dump -U nomad -d nomad --no-owner --clean --if-exists | gzip -9 > "$FILE.tmp"
mv "$FILE.tmp" "$FILE"
[ -s "$FILE" ] || { echo "backup is empty: $FILE" >&2; exit 1; }

# Sunday copy goes to weekly.
[ "$(date +%u)" = 7 ] && cp "$FILE" "$OUT/weekly/"

prune() { ls -1t "$1"/nomad-*.sql.gz 2>/dev/null | tail -n +"$(($2 + 1))" | xargs -r rm -f; }
prune "$OUT/daily" "$KEEP_DAILY"
prune "$OUT/weekly" "$KEEP_WEEKLY"
echo "backup ok: $FILE ($(du -h "$FILE" | cut -f1))"
