#!/bin/sh
# Daily backup of PostgreSQL and uploaded photos, with rotation.
# Host cron: `15 3 * * * /srv/nomad/ops/backup.sh >> /var/log/nomad-backup.log 2>&1`
#
# Optional environment (e.g. in ops/.env.backup, sourced below):
#   KEEP_DAILY=14 KEEP_WEEKLY=8
#   BACKUP_REMOTE=s3remote:nomad-backups  off-site copy with rclone (configure the remote with `rclone config`)
#   BACKUP_PING_URL=https://hc-ping.com/<uuid>  dead-man switch: pinged on success, <url>/fail on failure
#
# Restore (stop app and worker first so nothing writes during the restore):
#   docker compose -f ops/compose.prod.yaml stop app worker
#   gunzip -c ops/backups/daily/nomad-YYYYmmdd-HHMM.sql.gz | \
#     docker compose -f ops/compose.prod.yaml exec -T postgres psql -U nomad -d postgres -c 'DROP DATABASE nomad' -c 'CREATE DATABASE nomad'
#   gunzip -c ops/backups/daily/nomad-YYYYmmdd-HHMM.sql.gz | \
#     docker compose -f ops/compose.prod.yaml exec -T postgres psql -U nomad -d nomad -v ON_ERROR_STOP=1
#   docker compose -f ops/compose.prod.yaml run --rm -T --no-deps -v "$PWD/ops/backups/daily:/b:ro" --entrypoint sh app \
#     -c 'tar -xzf /b/uploads-YYYYmmdd-HHMM.tar.gz -C /data/uploads'
#   docker compose -f ops/compose.prod.yaml start app worker
# Check a backup regularly by restoring it into a scratch database (createdb nomad_check) the same way.
set -eu

DIR="$(cd "$(dirname "$0")" && pwd)"
[ -f "$DIR/.env.backup" ] && . "$DIR/.env.backup"
COMPOSE="docker compose -f $DIR/compose.prod.yaml"
OUT="$DIR/backups"
KEEP_DAILY="${KEEP_DAILY:-14}"
KEEP_WEEKLY="${KEEP_WEEKLY:-8}"
STAMP="$(date +%Y%m%d-%H%M)"

ping() { [ -n "${BACKUP_PING_URL:-}" ] && wget -q -T 10 -O /dev/null "$BACKUP_PING_URL$1" || true; }
trap 'ping /fail' EXIT

mkdir -p "$OUT/daily" "$OUT/weekly"
DB="$OUT/daily/nomad-$STAMP.sql.gz"
$COMPOSE exec -T postgres pg_dump -U nomad -d nomad --no-owner --clean --if-exists | gzip -9 > "$DB.tmp"
mv "$DB.tmp" "$DB"
[ -s "$DB" ] || { echo "backup is empty: $DB" >&2; exit 1; }

FILES="$OUT/daily/uploads-$STAMP.tar.gz"
$COMPOSE exec -T app tar -czf - -C /data/uploads . > "$FILES.tmp"
mv "$FILES.tmp" "$FILES"

# Sunday copy goes to weekly.
[ "$(date +%u)" = 7 ] && cp "$DB" "$FILES" "$OUT/weekly/"

prune() { ls -1t "$1"/$2-*.gz 2>/dev/null | tail -n +"$(($3 + 1))" | xargs -r rm -f; }
for kind in nomad uploads; do
  prune "$OUT/daily" "$kind" "$KEEP_DAILY"
  prune "$OUT/weekly" "$kind" "$KEEP_WEEKLY"
done

if [ -n "${BACKUP_REMOTE:-}" ]; then
  rclone copy "$OUT" "$BACKUP_REMOTE" --max-age 8d
fi

trap - EXIT
ping ""
echo "backup ok: $DB ($(du -h "$DB" | cut -f1)), $FILES ($(du -h "$FILES" | cut -f1))"
