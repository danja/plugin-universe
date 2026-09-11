# The dataset dumps

The whole catalogue as files, at [`/dumps/`](/dumps/), rebuilt nightly.

**This is not the backup.** The backup protects what cannot be rebuilt —
accounts, contributions, wiki revisions, uploaded pictures — and is locked down
because it holds personal data. A dump is the opposite: it is what anybody may
have, it is world-readable on purpose, and losing it costs one command.

## What is in it

| Path | What | Terms |
|---|---|---|
| `cc0/` | The factual catalogue | CC0, public domain |
| `notice/` | Material from permissively-licensed sources | Their terms, notices included |
| `prose/` | Contributor-written text | CC BY-SA 4.0, attribution required |
| `MANIFEST.json` | Each file's graph, licence and source | — |
| `void.ttl` | A VoID description of the dataset | — |

Three directories rather than one because they are three datasets under three
sets of terms. Which licence applies to a file is a property of where it sits,
not something a consumer has to work out — the same structural approach the
store takes with its licence flag per graph.

**A graph whose licence does not permit redistribution is not in any of them.**
It was never written, rather than filtered on the way out; `DumpBuilder` refuses
to assemble a part it cannot account for, and reports what it withheld.

## Serving

nginx serves `data/dumps` from disk. The app never touches them on the way out —
it has no business streaming tens of megabytes while it has searches to answer.

Two things in the nginx location are load-bearing and neither is caught by
`nginx -t`:

- The `types` block **replaces** the mime map for that location rather than
  adding to it, so every extension a dump contains has to be named. Without it
  each `.ttl` is served as `application/octet-stream` and a browser offers to
  download the dataset description instead of showing it.
- `add_header` inside a location **replaces** the server block's headers. The
  block repeats HSTS, nosniff and Referrer-Policy, or the dumps are served
  without them.

## When /dumps/ returns 404

**First, find out who answered.** The content type says it:

```sh
curl -sI https://plugin-universe.com/dumps/void.ttl | grep -i content-type
```

- `text/turtle` — nginx is serving the file. Working.
- `application/json` — **the application answered**, so nginx never matched the
  location and proxied the request through. The config in the repository is not
  the config nginx is running.
- `text/html` — nginx answered and the file is genuinely missing. Rebuild the
  dumps.

**If the application answered, ask nginx what it is actually running.** `nginx -T`
prints the whole effective configuration, every included file resolved — which
is the only way to tell "I copied the file" from "the file I copied is the one
in use":

```sh
sudo nginx -T | grep -c 'location /dumps/'        # 0 means it is not loaded
sudo nginx -T | grep -n 'server_name plugin-universe.com'
```

**Then find out which copy is stale.** There are three files involved and the
block has to be in all three: the one in the repository *on the server*, the one
in `sites-available`, and whatever `sites-enabled` actually points at.

```sh
cd /home/github/plugin-universe
git log --oneline -1                                              # pulled?
grep -c 'location /dumps/' deploy/nginx/plugin-universe.host.conf  # in the repo?
grep -c 'location /dumps/' /etc/nginx/sites-available/plugin-universe.com.conf
ls -l /etc/nginx/sites-enabled/
```

The first zero going down that list is the step that did not happen.

Three things produce a zero, in rough order of likelihood:

1. **The copy did not happen, or went somewhere that is not enabled.**
   `/etc/nginx/sites-available/` is not loaded; `/etc/nginx/sites-enabled/` is,
   and usually by symlink. `ls -l /etc/nginx/sites-enabled/` shows where each
   one points.
2. **Another server block claims the same name and loads first.** nginx takes
   the first match and only *warns* about the duplicate — `[warn] conflicting
   server name` — so the site keeps working while the new config is ignored.
   This project has hit that before. The second `grep` above lists every block
   claiming the name; there should be one.
3. **nginx was not reloaded.** `systemctl reload nginx` after `nginx -t`.

## Rebuilding

On a schedule:

```sh
sudo install -m 755 deploy/dump/plugin-universe-dump.sh \
  /etc/cron.daily/plugin-universe-dump
sudo install -m 644 deploy/dump/plugin-universe-dump.default \
  /etc/default/plugin-universe-dump
sudo /etc/cron.daily/plugin-universe-dump      # once, to check
```

By hand, either of:

```sh
docker compose run --rm app node bin/dump.js
```

or the **Rebuild dumps** button on `/admin`.

**`./data/dumps` must be mounted into the app container**, and
`docker-compose.yml` does it. Without that mount `bin/dump.js` writes inside the
container, reports a file count, and changes nothing anybody can fetch — the
dump appears to work and nginx serves whatever was there before. The same mount
is what makes the `/admin` button do anything at all.

**The directory must exist and be owned by the container's user.** `docker run
-v` creates a missing source directory as *root*, the app does not run as root,
and the Dockerfile's `chown /app/data` does nothing here — a bind mount replaces
that directory with the host's, ownership and all. The symptom is
`EACCES: permission denied, mkdir 'data/dumps/cc0'`.

```sh
sudo ./deploy/prepare-data-dirs.sh
```

It asks the image which uid it runs as rather than assuming 1001, because
`APP_UID` is a build argument. Safe to re-run, and needed again after any change
to that argument.
