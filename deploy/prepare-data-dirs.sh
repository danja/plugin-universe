#!/bin/sh
# Create and hand over the host directories the app writes, run ON THE SERVER.
#
# `data/images` and `data/dumps` are bind-mounted into the app container and
# read by nginx. Two things make them a recurring trap:
#
#   - `docker run -v` creates a missing source directory as **root**, and the
#     app does not run as root. The first write then fails with
#     "EACCES: permission denied, mkdir".
#   - The Dockerfile chowns /app/data at build time, which does nothing for
#     these: a bind mount replaces that directory with the host's, ownership
#     and all.
#
# So the host has to hand them over, and that is this script. It has been a
# documented manual step twice and failed twice, which is what a script is for.
#
# Run it after cloning and after any change to APP_UID. Safe to re-run.

set -eu
cd "$(dirname "$0")/.."

DIRS="data/images data/dumps"

mkdir -p $DIRS

# Asked of the image rather than assumed. APP_UID is a build argument and can
# be overridden to match a host user, so 1001 is a default and not a fact —
# the same reasoning as deploy/backup/plugin-universe-backup.sh, which had to
# learn it first.
OWNER=$(docker compose run --rm --entrypoint sh app \
          -c 'printf "%s:%s" "$(id -u)" "$(id -g)"' 2>/dev/null | tr -d '\r\n')

if [ -z "$OWNER" ]; then
  echo "!! Could not ask the app image which user it runs as." >&2
  echo "!! Build it first:  docker compose build app" >&2
  exit 1
fi

chown -R "$OWNER" $DIRS

# World-readable: nginx serves both directories and is a different user again.
# These hold published pictures and published datasets — nothing here is
# personal data, which is the opposite of the backup directory and the reason
# this line is `a+rX` rather than `o-rwx`.
chmod -R a+rX $DIRS

echo "handed $DIRS to $OWNER"
ls -ld $DIRS
