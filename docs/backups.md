# Backups

The store holds two kinds of thing and they need different treatment.

**Rebuildable.** Everything harvested — 45,000 triples of it — can be produced
again by re-running the harvesters against public sources. Losing it costs an
hour of machine time and nothing else.

**Irreplaceable.** Accounts, corrections, moderation decisions, trust levels and
wiki revisions exist **only** in Fuseki. Measured on the live store that is
**203 triples**, or 0.4% of the total. Nothing can rebuild it, and a contributor
whose work is lost does not contribute twice.

That ratio decides the design. The part worth protecting hardest is tiny, so the
usual objection to frequent off-site copies — cost and bandwidth — does not
apply to it.

`bin/dump.js` is **not** a backup. It publishes what may be published and
deliberately withholds accounts and pending contributions, which are precisely
the graphs that cannot be rebuilt.

## What runs where

| | Where | What | Kept |
|---|---|---|---|
| nightly | server | `essential` and `full` | 90 / 7 days |
| pull | this machine | `essential` only | indefinitely |

**The pull runs here, not there**, and the direction is the point: the server
holds no credential for anywhere else, so whatever compromises the server cannot
reach or delete the copies. A push would hand it the keys to both.

## On the server

```sh
sudo install -m 755 deploy/backup/plugin-universe-backup.sh \
  /etc/cron.daily/plugin-universe-backup
sudo /etc/cron.daily/plugin-universe-backup     # once, to check
```

Writes to `/var/backups/plugin-universe/{essential,full}/<timestamp>/`.
Override with `PU_BACKUP_DIR`, `PU_KEEP_FULL`, `PU_KEEP_ESSENTIAL`.

**Ownership.** The container does not run as root, so a bind mount owned by root
is one it cannot write to — `EACCES: permission denied, mkdir`. The script asks
the image which uid it runs as and hands the destination over. It asks rather
than assuming 1001, because `APP_UID` is a build argument that can be overridden
to match a host user.

**Permissions, and who may read them.** These files hold accounts,
contributions and wiki revisions — the personal data every published dump
deliberately withholds. The container writes them world-readable, so the script
strips that and grants read to one group instead — the group named by
`PU_BACKUP_GROUP` in `/etc/default/plugin-universe-backup`.

Directories are marked setgid, so tomorrow's backup inherits the group without
the script having to run first. Without `PU_BACKUP_GROUP` only the container
user can read them, the script says so on every run, and a non-root pull fails
with an explanation.

If you installed an older copy of the script, either re-install it after pulling
or do it once by hand:

```sh
sudo chown -R 1001:1001 /var/backups/plugin-universe
sudo chgrp -R danny /var/backups/plugin-universe
sudo chmod -R o-rwx,g+rX /var/backups/plugin-universe
```

## Here

This needs key authentication — it runs unattended, so a password prompt would
mean it silently never runs. `hyperdata` is not a resolvable name from here;
either use the real host or give it an alias:

```
# ~/.ssh/config
Host hyperdata
  HostName hyperdata.it
  User danny
  IdentityFile ~/.ssh/id_ed25519
```

The pull needs no privilege beyond reading those files — it is an `rsync` of a
directory — so it logs in as an ordinary user. That is also why the group
permission above exists rather than the pull running as root: a credential that
can only read backups is a smaller thing to lose than one that can do anything.

```sh
export PU_SSH_HOST=hyperdata
./deploy/backup/pull-backups.sh            # essential, the default
./deploy/backup/pull-backups.sh --full     # when there is a reason
```

The script checks it can reach the host without a password, and that the
remote backup directory exists, before it starts — so a missing key says "there
is no key" rather than producing an rsync protocol error.

Into `/chalet/plugin-universe-backups/essential/<timestamp>/`. As a cron entry
(installed):

```
PU_SSH_HOST=hyperdata
17 7 * * * /chalet/github/plugin-universe/deploy/backup/pull-backups.sh \
  >> ~/.local/state/plugin-universe/pull.log 2>&1 \
  || echo "plugin-universe backup pull FAILED - see the log"
```

07:17, after the server's `cron.daily`. Output goes to the log; only a failure
message reaches cron's mail, so a working job is silent and a broken one is not.

The key must have **no passphrase** — cron has no agent, and a job that blocks
on a prompt never runs and never says why. Check with:

```sh
ssh-keygen -y -P "" -f ~/.ssh/id_ed25519 >/dev/null && echo usable by cron
```

Worth testing the way cron will actually run it, rather than the way your shell
does — no profile, minimal `PATH`, no agent:

```sh
env -i HOME="$HOME" PATH=/usr/bin:/bin SHELL=/bin/sh PU_SSH_HOST=hyperdata \
  /chalet/github/plugin-universe/deploy/backup/pull-backups.sh
```

The pull checks the manifest parses, that every file it names is present and
non-empty, and that the newest backup is less than two days old — a pull that
keeps succeeding against a server which stopped writing a fortnight ago is the
failure this exists to catch. It does **not** use `--delete`: a backup store that
mirrors its source will faithfully mirror the source being empty.

## Restoring

Destructive, and it asks you to mean it. Naming the dataset rather than passing
`--yes` is deliberate: a restore that a typo can trigger is a second way to lose
the data it protects.

Here, where the backups and the code are on the same machine:

```sh
node bin/restore.js /chalet/plugin-universe-backups/essential/<stamp>
# prints what it would DROP and rewrite, and does nothing

node bin/restore.js <dir> --into plugin-universe
node bin/restore.js <dir> --into plugin-universe --graph graph:system/accounts
```

On the server the app runs in a container and the backups do not, so they have
to be mounted — and the path inside is `/backups`, not `/var/backups`:

```sh
docker compose run --rm -v /var/backups/plugin-universe:/backups \
  app node bin/restore.js /backups/essential/<stamp>
```

Each graph is dropped, reloaded, and **counted afterwards**; a count that does
not match the manifest is an error rather than a success message.

**A matching count is not proof.** Run `npm run validate` after any restore: a
correct count with wrong data is exactly the failure the first rehearsal found. The app loads
its index at start, so restart it if plugin data changed.

## What is deliberately not done

**No encryption at rest.** Both ends are machines you control, and the transfer
is over SSH. If the backups ever leave for storage you do not own, that changes:
these graphs contain personal data.

**No retention limit tied to erasure.** The contributor terms promise that an
account can be erased, and erasure is a DROP of two graphs — but a backup taken
before it still holds them. Ninety days of essential backups means up to ninety
days before an erasure is complete everywhere. That is defensible and it is not
automatic; if someone asks to be erased, the backups are part of the job.

**The first rehearsal found a real defect**, which is the argument for doing it.
A whole-dataset restore returned the correct triple count and silently cut 208
blank nodes in half — LV2 ports and package files that lost their properties
because a blank node label is scoped to one `INSERT DATA` and the loader grouped
by subject rather than by connected component. `bin/restore.js` counted and
reported success; only SHACL noticed. Fixed, and `npm run validate` after a
restore is now part of the drill below.

**The restore is not rehearsed on a schedule.** `tests/store/backup.test.js`
proves the round trip on every store test run — back a graph up, destroy it,
restore it, compare — which is more than most backup systems can say. Rehearsing
a *whole-dataset* restore on the real server is a different exercise and worth
doing once, deliberately, before it is needed.
