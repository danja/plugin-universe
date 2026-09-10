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

## Here

```sh
export PU_SSH_HOST=hyperdata
./deploy/backup/pull-backups.sh            # essential, the default
./deploy/backup/pull-backups.sh --full     # when there is a reason
```

Into `/chalet/plugin-universe-backups/essential/<timestamp>/`. As a cron entry:

```
17 4 * * *  PU_SSH_HOST=hyperdata /chalet/github/plugin-universe/deploy/backup/pull-backups.sh
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

```sh
node bin/restore.js /chalet/plugin-universe-backups/essential/<stamp>
# prints what it would DROP and rewrite, and does nothing

node bin/restore.js <dir> --into plugin-universe
node bin/restore.js <dir> --into plugin-universe --graph graph:system/accounts
```

Each graph is dropped, reloaded, and **counted afterwards**; a count that does
not match the manifest is an error rather than a success message. The app loads
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

**The restore is not rehearsed on a schedule.** `tests/store/backup.test.js`
proves the round trip on every store test run — back a graph up, destroy it,
restore it, compare — which is more than most backup systems can say. Rehearsing
a *whole-dataset* restore on the real server is a different exercise and worth
doing once, deliberately, before it is needed.
