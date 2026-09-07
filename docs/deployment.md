# Deployment

Getting Plugin Universe onto a server, and harvesting once it is there.

The design is in [architecture.md §11](architecture.md). This is the runbook.

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

Create the dataset if the store does not have one:

```sh
curl -u "admin:$SPARQL_PASSWORD" -X POST http://localhost:3030/\$/datasets \
     --data 'dbName=plugin-universe&dbType=tdb2'
```

Then build and start the app:

```sh
docker compose up -d --build app
docker compose exec app node -e "fetch('http://localhost:4100/health').then(r=>r.text()).then(console.log)"
```

`/health` reports the corpus and index sizes. Both are zero until the first
harvest.

## Harvesting

Harvest commands run against the same image and the same volume as the service,
so the index they build is the index the app serves:

```sh
docker compose run --rm app node bin/ingest.js
```

That harvests the configured sources — downspout, flues and the Open Audio Stack
registry — validates them against the SHACL shapes, writes them to per-source
graphs, and embeds every plugin. **The embedding step is the slow part**: around
five seconds per plugin on CPU, so a full 645-plugin build is roughly fifty
minutes. It checkpoints every hundred plugins, so an interrupted run does not
start over.

To skip it while iterating on the graph:

```sh
docker compose run --rm app node bin/ingest.js --skip-embeddings
```

Restart the app afterwards — it loads the index once at start, not per request:

```sh
docker compose restart app
```

### GitHub

Two steps, deliberately. Which repositories to harvest is a curation decision,
and it belongs in a file someone has read.

```sh
docker compose run --rm app node bin/discover.js --merge
```

That writes `data/github-candidates.json` inside the `app-data` volume and
ingests nothing. Read it, edit the `include` flags, and pay particular attention
to rows whose licence is `unknown` — those are repositories that state no
licence the graph registry recognises, and harvesting them would add data the
public dump could never use. Silence is not permission; that decision is a
person's to make, not a crawler's.

```sh
docker compose run --rm app node bin/ingest.js --github data/github-candidates.json
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
it serves other sites too — use `deploy/nginx/plugin-universe.host.conf` and
leave the compose `proxy` profile alone:

```sh
sudo cp deploy/nginx/plugin-universe.host.conf \
        /etc/nginx/sites-available/plugin-universe.com
sudo ln -s /etc/nginx/sites-available/plugin-universe.com \
           /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

That file proxies to `127.0.0.1:4100` and `127.0.0.1:3030`, which is where
compose publishes the app and the store.

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

The second hop is `deploy/nginx/hyperdata-xmlns.conf`. Add its blocks to the
existing hyperdata.it server block; they are scoped to `/xmlns/plugin-universe/`
and touch nothing else under `/xmlns/`.

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
  --loc /fuseki/databases/plugin-universe > backup-$(date +%F).nq
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
