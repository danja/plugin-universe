#!/bin/sh
# Nightly backup, run ON THE SERVER.
#
# Two scopes, because they answer different questions:
#
#   full       everything, for undoing a bad ingest without re-harvesting for
#              an hour. Kept briefly; it is large and it is reproducible.
#   essential  accounts, contributions, wiki revisions and the graph registry —
#              measured at 203 triples against 45,000 rebuildable ones. This is
#              the part that exists nowhere else, and it is small enough to keep
#              for a long time and to copy anywhere.
#
# Install as /etc/cron.daily/plugin-universe-backup, or as a systemd timer.

set -eu

REPO="${PU_REPO:-/home/github/plugin-universe}"
DEST="${PU_BACKUP_DIR:-/var/backups/plugin-universe}"
KEEP_FULL="${PU_KEEP_FULL:-7}"
KEEP_ESSENTIAL="${PU_KEEP_ESSENTIAL:-90}"

cd "$REPO"
mkdir -p "$DEST/full" "$DEST/essential"
STAMP=$(date -u +%Y-%m-%dT%H-%M-%S)

# The container does not run as root, so a bind mount owned by root is a
# directory it cannot write to — "EACCES: permission denied, mkdir". The
# Dockerfile fixes the runtime uid for exactly this reason and documents it for
# data/curation; this destination is created by this script, so it is this
# script's job to hand it over.
#
# Asked of the image rather than assumed: APP_UID is a build argument and can be
# overridden to match a host user, so 1001 is a default and not a fact.
OWNER=$(docker compose run --rm --entrypoint sh app -c 'printf "%s:%s" "$(id -u)" "$(id -g)"' 2>/dev/null | tr -d '\r\n')
if [ -z "$OWNER" ]; then
  echo "!! could not ask the app image which user it runs as; not changing ownership" >&2
else
  chown -R "$OWNER" "$DEST"
fi

# `run --rm` rather than `exec`: the app container need not be running, and a
# backup that depends on the thing it is protecting being healthy is not much of
# a backup.
docker compose run --rm \
  -v "$DEST:/backups" \
  app node bin/backup.js --scope essential --out "/backups/essential/$STAMP"

docker compose run --rm \
  -v "$DEST:/backups" \
  app node bin/backup.js --scope full --out "/backups/full/$STAMP"

# Rotation. Essential backups are kept far longer because they are tiny and
# irreplaceable; full ones are large and can be rebuilt from source.
prune () {
  ls -1d "$1"/*/ 2>/dev/null | sort | head -n "-$2" | while read -r old; do
    rm -rf "$old"
  done
}
prune "$DEST/full" "$KEEP_FULL"
prune "$DEST/essential" "$KEEP_ESSENTIAL"

echo "backup $STAMP complete"
ls -1 "$DEST/essential" | tail -3
