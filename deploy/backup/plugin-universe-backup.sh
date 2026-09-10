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

# These files hold accounts, contributions and wiki revisions — personal data.
# The container writes them world-readable by default, which on a machine with
# more than one login is a copy of the personal data this project takes care to
# withhold from every published dump.
#
# So: no access for anyone else, and read access for one group, which is how a
# non-root user pulls them without being root. Set PU_BACKUP_GROUP to a group
# that user belongs to.
chmod -R o-rwx "$DEST"
if [ -n "${PU_BACKUP_GROUP:-}" ]; then
  chgrp -R "$PU_BACKUP_GROUP" "$DEST"
  chmod -R g+rX "$DEST"
  # setgid, so tomorrow's backup inherits the group rather than needing this
  # script to have run first.
  find "$DEST" -type d -exec chmod g+s {} +
else
  echo "!! PU_BACKUP_GROUP is not set, so only the container user can read these."
  echo "!! A non-root pull will fail. Set it to a group your pull user is in:"
  echo "!!   PU_BACKUP_GROUP=danny /etc/cron.daily/plugin-universe-backup"
fi

echo "backup $STAMP complete"
ls -1 "$DEST/essential" | tail -3
