#!/bin/sh
# Pull the server's backups to this machine.
#
# Run HERE, not on the server, and that direction is the point: the server needs
# no credential to write anywhere else, so anything that compromises the server
# cannot reach or delete the copies held here. A push would hand it the keys to
# both.
#
# Only the essential scope crosses the wire by default. It is a couple of
# hundred triples — the accounts, contributions and wiki revisions that exist
# nowhere else — while the full backup is tens of megabytes of material that can
# be re-harvested from public sources. Pass --full when there is a reason.
#
# Install as a user cron entry or a systemd --user timer.

set -eu

HOST="${PU_SSH_HOST:?set PU_SSH_HOST to the ssh host or alias, e.g. hyperdata.it}"
REMOTE="${PU_REMOTE_BACKUP_DIR:-/var/backups/plugin-universe}"
LOCAL="${PU_LOCAL_BACKUP_DIR:-/chalet/plugin-universe-backups}"
SCOPE=essential
[ "${1:-}" = "--full" ] && SCOPE=full

# Fail on the real problem rather than on rsync's version of it. Without a key,
# rsync reports a protocol error or hangs on a password prompt in cron, and
# neither says "there is no key".
if ! ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" true 2>/dev/null; then
  echo "!! cannot ssh to $HOST without a password." >&2
  echo "!!" >&2
  echo "!! This runs unattended, so it needs key authentication. Either:" >&2
  echo "!!   ssh-copy-id $HOST" >&2
  echo "!! or add an entry to ~/.ssh/config naming the user and key:" >&2
  echo "!!   Host hyperdata" >&2
  echo "!!     HostName hyperdata.it" >&2
  echo "!!     User danny" >&2
  echo "!!     IdentityFile ~/.ssh/id_ed25519" >&2
  echo "!! then set PU_SSH_HOST to that Host name." >&2
  exit 1
fi

if ! ssh -o BatchMode=yes "$HOST" "test -d '$REMOTE/$SCOPE'" 2>/dev/null; then
  echo "!! $HOST has no $REMOTE/$SCOPE — has the nightly job run there yet?" >&2
  echo "!!   sudo /etc/cron.daily/plugin-universe-backup" >&2
  exit 1
fi

# Readable is a separate question from present. The backups hold personal data
# and are deliberately not world-readable, so a pull user who is not in the
# right group sees an empty-looking directory rather than a permission error.
if ! ssh -o BatchMode=yes "$HOST" "test -r '$REMOTE/$SCOPE'" 2>/dev/null; then
  echo "!! $REMOTE/$SCOPE on $HOST exists but is not readable by this login." >&2
  echo "!! The backups hold personal data and are group-readable, not world-readable." >&2
  echo "!! On the server, give your group read access:" >&2
  echo "!!   sudo chgrp -R <your-group> $REMOTE" >&2
  echo "!!   sudo chmod -R o-rwx,g+rX $REMOTE" >&2
  echo "!! and set PU_BACKUP_GROUP=<your-group> for the nightly job." >&2
  exit 1
fi

mkdir -p "$LOCAL/$SCOPE"

# --ignore-existing rather than a plain mirror, and no --delete: a backup store
# that mirrors the source will happily mirror the source being empty. Rotation
# here is a separate, deliberate decision.
rsync -az --ignore-existing \
  "$HOST:$REMOTE/$SCOPE/" "$LOCAL/$SCOPE/"

# The copy that lands here holds the same personal data, on a machine used for
# other things. rsync preserves the source's modes, so a file the server wrote
# world-readable arrives world-readable — protected only by the directory above
# it, which is one `chmod` away from not being true.
chmod -R o-rwx "$LOCAL/$SCOPE"

LATEST=$(ls -1 "$LOCAL/$SCOPE" | sort | tail -1)
if [ -z "$LATEST" ]; then
  echo "!! nothing pulled: no $SCOPE backups found on $HOST" >&2
  exit 1
fi

# A backup nobody checks is a belief. This is the cheap version: the manifest
# parses, names graphs, and the files it names are present and non-empty.
MANIFEST="$LOCAL/$SCOPE/$LATEST/MANIFEST.json"
[ -f "$MANIFEST" ] || { echo "!! $LATEST has no MANIFEST.json" >&2; exit 1; }
python3 - "$MANIFEST" <<'PY'
import json, os, sys
manifest = json.load(open(sys.argv[1]))
directory = os.path.dirname(sys.argv[1])
missing = [g['file'] for g in manifest['graphs']
           if not os.path.getsize(os.path.join(directory, g['file'])) > 0]
if missing:
    raise SystemExit(f"!! empty or missing in the backup: {', '.join(missing)}")
print(f"{manifest['scope']} backup {manifest['generatedAt']}: "
      f"{len(manifest['graphs'])} graphs, {manifest['triples']} triples")
PY

# Age check. A pull that silently keeps succeeding against a server that stopped
# writing backups a fortnight ago is the failure this is for.
if [ "$(find "$LOCAL/$SCOPE/$LATEST" -maxdepth 0 -mtime +2)" ]; then
  echo "!! the newest $SCOPE backup is more than two days old" >&2
  exit 1
fi
