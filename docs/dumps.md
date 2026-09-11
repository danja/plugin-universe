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

**The directory must exist before the first `docker compose up`.** `docker run
-v` creates a missing source directory as *root*, and the app does not run as
root, so it then cannot write: `mkdir -p data/dumps` first.
