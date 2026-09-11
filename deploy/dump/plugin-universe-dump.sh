#!/bin/sh
# Nightly dataset dump, run ON THE SERVER.
#
# Not a backup. The backup protects what cannot be rebuilt; this publishes what
# anybody may have. `data/dumps` is what nginx serves at /dumps/, and /services
# now tells people the dumps are there — so without something on a schedule
# they are a promise that goes stale, or an empty directory behind an
# advertised path.
#
# It overwrites in place rather than keeping dated copies: a dump is the current
# dataset by definition, and an old one is not useful enough to pay for. The
# backup is the thing that keeps history.
#
# Install as /etc/cron.daily/plugin-universe-dump, or as a systemd timer.

set -eu

# Settings outside the script, as with the backup: the script is installed by
# copying, so anything edited into it is discarded by the next install, and
# cron.daily runs with a near-empty environment.
#
#   # /etc/default/plugin-universe-dump
#   PU_REPO=/home/github/plugin-universe
#
CONFIG="${PU_CONFIG:-/etc/default/plugin-universe-dump}"
# shellcheck source=/dev/null
[ -r "$CONFIG" ] && . "$CONFIG"

REPO="${PU_REPO:-/home/github/plugin-universe}"
cd "$REPO"

# `run --rm`, not `exec`: the app container need not be running. A dump depends
# on Fuseki, not on the web service, and tying it to the site being up would
# mean no dump on exactly the day something is wrong.
#
# No -v: docker-compose.yml mounts ./data/dumps into the app container already,
# because the /admin button writes through the same path. Passing a second
# mount here would work and would be a second place to keep correct.
docker compose run --rm app node bin/dump.js

# nginx reads this directory; it does not write it. The files are public data —
# every graph in them was selected by a licence flag that permits
# redistribution — so they are world-readable on purpose, and the opposite of
# the backup, which is locked down because it holds accounts.
#
# Written by the container's user. Made readable here rather than assumed,
# because a dump nginx cannot open is a 403 on a path /services advertises.
DUMPS="$REPO/data/dumps"
chmod -R a+rX "$DUMPS"

echo "dump complete"
du -sh "$DUMPS"
ls -1 "$DUMPS"
