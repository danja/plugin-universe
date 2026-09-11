# Deployment

Getting Plugin Universe onto a server, and harvesting once it is there.

The design is in [architecture.md §11](architecture.md). This is the runbook.

## The live server

| | |
|---|---|
| Host | `hyperdata` |
| Repository | **`/home/github/plugin-universe`** — every `docker compose` command in this document runs from there |
| Site | `https://plugin-universe.com` |
| IRI second hop | nginx on the same host, `/etc/nginx/snippets/plugin-universe-xmlns.conf` |

Paths in this document are relative to the repository directory. `./data/seed`
and `./data/curation` in `docker-compose.yml` resolve against it, so they are
`/home/github/plugin-universe/data/seed` and `.../data/curation` on the server
unless `SEED_DIR` says otherwise.

## What runs

| Container | Purpose | Exposed |
|---|---|---|
| `fuseki` | Apache Jena Fuseki, TDB2. The store. | loopback only |
| `ollama` | Embeddings (`nomic-embed-text:v1.5`) | loopback only |
| `app` | The Node service: search UI, JSON API, content negotiation | loopback only |
| `nginx` | TLS, gzip, rate limiting, subdomain routing | 80 and 443 |

Only nginx is reachable from outside. Fuseki in particular has an update
endpoint, and publishing that by accident would be the single worst mistake
available here — hence the `127.0.0.1:` prefixes in the compose file.

## Requirements

- Docker with Compose v2
- **4 GB of RAM is enough**, and the defaults are sized for it. See below.
- Around 10 GB of disk for the store, the embedding model and the index.
- DNS for `plugin-universe.com`, `www`, `api`, `sparql` and `mcp` pointing at
  the host.

### Memory

Every limit is set in `docker-compose.yml` and overridable from `.env`. The
defaults, and where they come from:

| Container | Limit | Swap | Why |
|---|---|---|---|
| `fuseki` | 1400m, heap 1g | none | TDB2 memory-maps its indexes and relies on the OS page cache, not the Java heap. A bigger `-Xmx` does not help it and steals memory the page cache would use better. |
| `ollama` | 1600m | none | Model residency. `OLLAMA_KEEP_ALIVE` decides whether it stays loaded between searches. |
| `app` | 384m, heap 256m | 640m | Measured: 48 MB resident serving 645 plugins, unchanged through a 40-request concurrent burst. |
| `nginx` | 96m | default | Proxying only. |

**Ollama is a serving dependency, not only a batch one.** Search embeds the
query text, so a text search fails without it. The per-query cost is negligible;
the memory is the model sitting resident. `OLLAMA_KEEP_ALIVE=30m` keeps it warm
during active use and releases it overnight, at the price of a second or two on
the first search after an idle spell.

Steady-state serving is roughly 1.8 GB. The peak is an ingest, where Fuseki and
Ollama are both working: about 2.4 GB.

### Swap

Worth having on a small host, and worth keeping away from two of these
containers. `memswap_limit` equals `mem_limit` for `fuseki` and `ollama`, which
means no swap for either — a JVM garbage collection walks the whole live heap,
so a paged-out heap turns a GC into a disk I/O storm, and Ollama reads its model
weights on every forward pass. Swap's real job here is absorbing cold pages
elsewhere on the system and keeping the OOM killer away from the store.

```sh
sudo fallocate -l 4G /swapfile        # btrfs needs different handling
sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

sudo sysctl vm.swappiness=10
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swappiness.conf
```

`swappiness=10` matters: the default of 60 swaps anonymous memory fairly
eagerly, which is what to avoid with a JVM present. `zram` is a good alternative
or complement — compressed swap in RAM, no disk I/O — and on a small VPS it
usually beats a swapfile.

Docker needs cgroup v2, or `swapaccount=1` on a cgroup v1 kernel, to honour
`memswap_limit`. Where it cannot, it warns and ignores the setting rather than
failing, so check `docker compose up` output the first time.

## First run

```sh
git clone https://github.com/danja/plugin-universe && cd plugin-universe
cp .env.example .env
```

Fill in `.env`. Every value is required — there are no fallbacks, and a missing
one is an error rather than a silent default. `SPARQL_URL_BASE` and `OLLAMA_URL`
are only used when running outside Docker; compose sets them to the service
names.

```sh
docker compose up -d fuseki ollama
docker compose exec ollama ollama pull nomic-embed-text:v1.5
```

Pulling the model is a few hundred megabytes and only happens once; it lives in
the `ollama-models` volume.

The `plugin-universe` dataset is created by the assembler that compose mounts,
so there is nothing to create by hand — doing it through `/$/datasets` would
make a second, differently configured one. Confirm it is there:

```sh
curl -s -u "admin:$SPARQL_PASSWORD" http://localhost:3030/\$/datasets \
  | grep -o '"ds.name" : "[^"]*"'
```

`/plugin-universe` is ours. `/ds` also appears — the image ships its own default
dataset and it is harmless, unused and empty.

Then build and start the app:

```sh
docker compose up -d --build app
docker compose exec app node -e "fetch('http://localhost:4100/health').then(r=>r.text()).then(console.log)"
```

`/health` reports the corpus and index sizes. Both are zero until the first
harvest.

## Harvesting

> **After any `git pull`, rebuild before running anything.** The Dockerfile
> copies the source into the image, so `docker compose run` executes the code
> that was baked in at build time — not what is in the checkout. A pull with no
> rebuild silently runs the old version.
>
> ```sh
> git pull && docker compose build app && docker compose up -d app
> ```


Harvest commands run against the same image and the same volume as the service,
so the index they build is the index the app serves:

```sh
docker compose run --rm app node bin/ingest.js
```

That harvests the configured sources, validates them against the SHACL shapes,
writes them to per-source graphs, and embeds every plugin.

**Two of the three sources are local git checkouts.** downspout and flues are
read from the filesystem, so on a server they have to be there. Clone them into
`data/seed/`, which is bind-mounted into the container at `/srv/seed`:

```sh
git clone https://github.com/danja/downspout data/seed/downspout
git clone https://github.com/danja/flues     data/seed/flues
```

Or, if they are already checked out somewhere, point `SEED_DIR` at their
*parent* directory — it must contain `downspout/` and `flues/`:

```sh
echo 'SEED_DIR=/home/github' >> .env
docker compose up -d          # recreates the app container with the new mount
```

The container runs as uid 1001, and the mount is read-only, so the checkouts
have to be world-readable. `ls -ld /home/github /home/github/downspout` — if
either is `drwx------`, the harvest sees nothing and reports the source as
missing, which looks identical to not having cloned it.

A missing checkout is
not fatal — the ingest says so plainly and carries on with the rest — but it is
86 plugins quietly absent, so read that output rather than skimming it. The Open
Audio Stack registry needs no checkout; it is fetched over HTTP.

**Do the slow part separately the first time.** Embedding is around five seconds
per plugin on CPU, so a 645-plugin build is roughly fifty minutes and will make
the site sluggish while it runs. Harvest first:

```sh
docker compose run --rm app node bin/ingest.js --skip-embeddings
docker compose restart app
```

The site is now populated and searchable — **lexical search works without any
vectors at all**, so this is a usable state rather than a broken one. Then embed
when it suits, overnight or under `nohup`:

```sh
docker compose run --rm app node bin/ingest.js
docker compose restart app
```

It checkpoints every hundred plugins, so an interrupted run does not start over.

**After a sweep that added a few plugins, embed only those:**

```sh
docker compose run --rm app node bin/ingest.js --only-new
docker compose restart app
```

`--only-new` embeds what the index has no vector for. It compares IRIs, not
content, so a plugin whose description changed upstream keeps its stale vector —
a full run is still the way to pick that up. `/health` reporting `plugins` above
`index` is what tells you some are missing.

Restart the app afterwards — it loads the index once at start, not per request:

```sh
docker compose restart app
```

### GitHub

Two steps, deliberately. Which repositories to harvest is a curation decision,
and it belongs in a file someone has read.

The candidate list has to be editable on the host, so `data/curation/` is
bind-mounted rather than living in the `app-data` volume. The container runs as
uid 1001, so give it that directory once:

```sh
sudo chown -R 1001:1001 data/curation
docker compose run --rm app node bin/discover.js --merge
```

(Alternatively build the image as your own user —
`docker compose build --build-arg APP_UID=$(id -u) --build-arg APP_GID=$(id -g) app`
— and skip the chown. Either works; the chown is one command and survives a
rebuild.)

That writes `data/curation/github-candidates.json` and ingests nothing. Read it,
edit the `include` flags, and **commit it** — it is a record of decisions about
other people's work, not a cache.

Rows whose licence is `unknown` are **skipped**: those repositories state no
licence the graph registry recognises, and harvesting them would add data the
public dump could never use. That is settled policy
([resources.md §4, rule 7](resources.md)), so they need no action — they stay in
the file as a record of what was seen. Set `include` on one only after asking
its maintainer.

```sh
docker compose run --rm app node bin/ingest.js --github data/curation/github-candidates.json
```

Each repository becomes its own graph carrying its own licence, so re-harvesting
one is a DROP of that graph alone. Embedding is incremental — a GitHub sweep
only embeds the plugins it adds.

Re-runs are cheap: `GitHubClient` caches ETags and sends conditional requests,
and a 304 costs nothing against the rate limit at all.

### Validating

```sh
docker compose run --rm app node bin/validate.js
```

Every registered graph, checked against `vocabs/shapes.ttl` separately so the
report names the source that needs fixing. Ingest validates before writing too;
this catches anything introduced by the write itself.

## nginx: two ways

**If the server already runs nginx** — the common case, and the right one when
it serves other sites too — use the two host configs and leave the compose
`proxy` profile alone.

It has to be two stages, because nginx refuses to load a config whose
`ssl_certificate` does not exist, while certbot's webroot method needs nginx
already serving the challenge path. Stage one breaks that circle:

```sh
sudo cp deploy/nginx/plugin-universe.acme.conf \
        /etc/nginx/sites-available/plugin-universe.com
sudo ln -s /etc/nginx/sites-available/plugin-universe.com /etc/nginx/sites-enabled/
sudo mkdir -p /var/www/certbot
sudo nginx -t && sudo systemctl reload nginx

sudo certbot certonly --webroot -w /var/www/certbot \
  -d plugin-universe.com -d www.plugin-universe.com \
  -d api.plugin-universe.com -d sparql.plugin-universe.com

sudo cp deploy/nginx/plugin-universe.host.conf \
        /etc/nginx/sites-available/plugin-universe.com
sudo nginx -t && sudo systemctl reload nginx
```

The full config proxies to `127.0.0.1:4100` and `127.0.0.1:3030`, which is where
compose publishes the app and the store.

**It also serves two directories straight off disk** — `/image/` from
`data/images` and `/dumps/` from `data/dumps`. Those are absolute paths in the
host config, because nginx is on the machine rather than in a container with
mounts, so a repository checked out anywhere but
`/home/github/plugin-universe` needs them edited.

Run `sudo ./deploy/prepare-data-dirs.sh` before reloading. nginx reads these as
its own user — `www-data` on Debian — which needs every directory on the way
traversable, and a home directory is commonly `0750`. The script reports what is
in the way rather than changing it: making somebody's home world-traversable is
their decision. Without it, `/image/` and `/dumps/` return 403 while everything
else works.

### HTTP/2 on a shared host

`plugin-universe.host.conf` does not enable HTTP/2, deliberately. **HTTP/2 is a
property of the listening socket, not of a server block**: whichever vhost
enables it for `:443` enables it for every vhost on that socket. Setting it in
one file when another file does not produces

```
[warn] protocol options redefined for 0.0.0.0:443
```

and leaves which setting wins dependent on include order. Enable it once, in one
file, for the whole server — and note that the standalone `http2 on;` directive
needs nginx ≥ 1.25.1, while `listen 443 ssl http2;` works on every version and
merely warns as deprecated on newer ones.

**If nginx has the machine to itself**, use the compose profile instead, which
mounts `deploy/nginx/plugin-universe.conf` and proxies to the service names:

```sh
docker compose --profile proxy up -d
```

The two files are not interchangeable, and the difference is not cosmetic.
`sites-enabled/*` is included inside the `http { }` block, so anything at file
scope in the container variant would apply to every vhost on the machine: its
`gzip on` collides with the one Debian's `nginx.conf` already sets, and its
`proxy_set_header` and `gzip_types` would silently change how the server's other
sites behave. The host variant keeps all of that inside its own server blocks
and prefixes its `limit_req_zone` names, since zone names share one namespace
across the whole configuration.

## TLS

Issue certificates before starting nginx, using the webroot the proxy serves:

With host nginx, certbot handles both issuance and the config edit:

```sh
sudo certbot certonly --webroot -w /var/www/certbot \
  -d plugin-universe.com -d www.plugin-universe.com \
  -d api.plugin-universe.com -d sparql.plugin-universe.com
```

`plugin-universe.host.conf` already points at
`/etc/letsencrypt/live/plugin-universe.com/`, which is where that puts them.
Renewal is whatever cron or systemd timer certbot installed; it reloads nginx
itself.

With the containerised proxy, issue them into the mounted directory instead:

```sh
mkdir -p deploy/nginx/certs
docker run --rm \
  -v plugin-universe_certbot-webroot:/var/www/certbot \
  -v "$PWD/deploy/nginx/certs:/etc/letsencrypt/live" \
  certbot/certbot certonly --webroot -w /var/www/certbot \
  -d plugin-universe.com -d www.plugin-universe.com \
  -d api.plugin-universe.com -d sparql.plugin-universe.com

docker compose --profile proxy up -d
```

Renewal runs the same command; nginx picks up the new files on
`docker compose exec nginx nginx -s reload`.

Either way, the ACME challenge must be reachable over plain HTTP before the
certificate exists — both configs serve `/.well-known/acme-challenge/` from
`/var/www/certbot` and redirect everything else to HTTPS, so create that
directory before the first run.

## Resolving the IRIs

Plugin IRIs are minted under `http://purl.org/stuff/plugin-universe/` and never
under the serving domain, so that identity survives a change of host. Resolution
is two hops:

```
http://purl.org/stuff/plugin-universe/plugin/achord-0b1944d0
  ── purl.org, partial redirect on /stuff/ ──────────────────────►
https://hyperdata.it/xmlns/plugin-universe/plugin/achord-0b1944d0
  ── deploy/nginx/hyperdata-xmlns.conf ──────────────────────────►
https://plugin-universe.com/plugin/achord-0b1944d0
```

**This is a better arrangement than a single purl.org rule.** purl.org holds one
redirect — `/stuff/` to `/xmlns/` — that never needs to change again, and it is
already in place. Every decision that might change lives on hyperdata.it, a
server under our administration. Moving the catalogue to another host becomes an
edit to a config file rather than a request to someone else's admin interface,
which matters given that purl.org's own editing has been unreliable.

The second hop is `deploy/nginx/hyperdata-xmlns.conf`. It is a **snippet**, not a
site config — bare `location` blocks, which are only legal inside a `server { }`,
so putting it in `sites-enabled/` fails with "location directive is not allowed
here". Install it as an include:

```sh
sudo cp deploy/nginx/hyperdata-xmlns.conf \
        /etc/nginx/snippets/plugin-universe-xmlns.conf
```

then one line inside the existing hyperdata.it TLS server block:

```nginx
include /etc/nginx/snippets/plugin-universe-xmlns.conf;
```

```sh
sudo nginx -t && sudo systemctl reload nginx
```

Everything in it is scoped to `/xmlns/plugin-universe/`, so the other namespaces
hyperdata.it serves are untouched.

Two details in there worth not undoing:

- **302, not 301.** A permanent redirect is cached indefinitely by browsers and
  crawlers, which would nail the IRIs to plugin-universe.com and defeat the
  indirection entirely. The extra round trip is the price of being able to move.
- **The namespace root is the ontology.** `http://purl.org/stuff/plugin-universe/`
  resolves to `/ns/plugin-universe.ttl` rather than the search page, because a
  consumer resolving the bare `pu:` prefix is asking what the terms mean.

### What resolves

| IRI | Serves |
|---|---|
| `pu:` (the namespace root) | the ontology, as Turtle |
| `pu:plugin/<slug>` | one plugin — HTML, Turtle or JSON-LD by `Accept` |
| `pu:category/<slug>` | the SKOS concept and the plugins in it |
| `pu:categories` | the concept scheme |

The vocabularies are also listed at `/ns`, and served individually at
`/ns/<name>.ttl`: `plugin-universe`, `alignment`, `shapes`, `trn-extensions`,
`trn-profile`.

### Checking it

Content negotiation has to survive both redirects — every client resends
`Accept` on a redirected request, but it is worth proving rather than assuming:

```sh
curl -sL -H "Accept: text/turtle" \
     http://purl.org/stuff/plugin-universe/plugin/achord-0b1944d0
```

That should come back as Turtle, having passed through purl.org and
hyperdata.it. It is the property that makes these IRIs linked data rather than
links, so check it after any change to either hop.

## Backups

Harvested graphs are reproducible from source, so they are not what needs
backing up. What is irreplaceable:

- user contributions and curated editorial (Phase 3 onward)
- profiler measurements (Phase 2 onward) — these are observations of a moment
  on a machine and cannot be recreated

```sh
docker compose exec fuseki /jena-fuseki/bin/tdb2.tdbdump \
  --loc /fuseki-base/databases/plugin-universe > backup-$(date +%F).nq
```

Until those phases land, a weekly dump is ample.

## Operating notes

- **The app loads the index at start.** After any ingest, restart it.
- **Watch the limits before trusting them.** `docker stats --no-stream` after a
  day of real traffic says whether the defaults above fit your host. A container
  that keeps hitting its ceiling is killed and restarted, which looks like a
  mysterious outage rather than a memory problem.
- **Harvest politely.** `config/preferences.js` holds the request interval and
  the crawler's user agent, which carries a real contact address. If that
  address stops working, fix it before the next sweep.

## Checking nginx before it reaches the server

```sh
./deploy/nginx/check.sh
```

Runs a throwaway `nginx:alpine` over the real files in `deploy/nginx/`, with
self-signed certificates generated at whatever paths they name, upstream
hostnames pointed at loopback, and each site checked on its own — because
`plugin-universe.conf` and `plugin-universe.host.conf` are alternatives rather
than companions.

Six configurations have failed `nginx -t` on the server. All six would have
failed here first.
