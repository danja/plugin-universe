# TODO

## Done

* ~~lists of data sources, forums, general resources~~ — [docs/resources.md](docs/resources.md)
* ~~dataset licence~~ — **CC0** for facts, **CC BY-SA** for user-authored prose
* ~~IRI namespace~~ — `http://purl.org/stuff/plugin-universe/`
* ~~terms-of-service review~~ — [docs/resources.md §4](docs/resources.md); KVR excluded
* ~~register the domain~~ — plugin-universe.com
* ~~Phase 0: foundations~~ — config, vocabularies, SPARQL store with per-graph licensing,
  persisted vector index, embedding pipeline
* ~~Phase 1 core~~ — harvesters for downspout and flues, normaliser, ingest pipeline with
  IRI-collision detection, hybrid retrieval with an IDF-weighted lexical signal, read API
  with content negotiation, server-rendered search UI
* ~~open-audio-stack registry harvester~~ — 559 plugins, CC0, with the packaging layer
  (checksummed downloads, platforms, architectures) that the seed corpus had no source for
* ~~SHACL shapes~~ — `vocabs/shapes.ttl`, run by `npm run validate` and before every write
* ~~AUFX-O and schema.org alignment graph~~ — `vocabs/alignment.ttl`

## Next — get it live, then sweep

Deployment is built and verified: the image builds, carries no `.env`, and serves 645 plugins
against live Fuseki and Ollama with a passing container healthcheck; compose and nginx
configurations both validate. See [docs/deployment.md](docs/deployment.md).

Left to do on the server itself, none of it code:

* point DNS for `plugin-universe.com`, `www`, `api`, `sparql` and `mcp` at the host
* issue certificates, then `docker compose --profile proxy up -d`
* add the blocks in `deploy/nginx/hyperdata-xmlns.conf` to the hyperdata.it nginx config.
  purl.org already redirects `/stuff/` to `https://hyperdata.it/xmlns/`, so that one rule is
  all purl.org ever needs to hold — everything that might change is on our own server. Then
  check that `curl -sL -H "Accept: text/turtle" http://purl.org/stuff/plugin-universe/plugin/<slug>`
  comes back as Turtle, which proves negotiation survives both hops.

## Then — run the sweep on the server

The GitHub harvester is built and tested; what remains is running it somewhere with
bandwidth. This host's connection makes a bulk sweep impractical, so the two steps are
separated deliberately:

```sh
node bin/discover.js --merge      # writes data/github-candidates.json — review it
node bin/ingest.js --github data/github-candidates.json
```

Discovery writes a file and ingests nothing. Only rows marked `include` are harvested, and a
repository with no recognised licence is listed but not included, because silence is not
permission. Each repository gets its own graph carrying its own licence.

* review the candidate list once it exists — particularly the `unknown` licences, which are a
  question for a person and not for a crawler
* consider seeding it with the DISTRHO and MOD organisations, and with repositories already
  named by harvested plugins' `foaf:homepage`
* the embedding step is incremental, so a GitHub sweep only embeds what it adds

## Then — Phase 2 (the profiler)

See [docs/plan.md](docs/plan.md). This is the differentiator; it is scheduled
before accounts and payments for that reason.

## Outstanding, not blocking

* configure the PURL redirect from `http://purl.org/stuff/plugin-universe/` to plugin-universe.com,
  and record that configuration in this repo rather than only in the purl.org account
* point plugin-universe.com DNS at a host; decide whether to also register the `.it` and redirect
* propose the `trn:` extensions upstream to `~/github/transmission` — in particular
  `trn:PluginFormat`, and retiring `trn:min`/`trn:minimum` in favour of `lv2:`
* the flues repo has four copies of every bundle (source, build, staging, release); the
  harvester now skips them, but the repo itself would be tidier without them
* cross-source identity: a plugin present in both a local repo and the OAS registry currently
  mints two IRIs, because the identity tuples are different kinds of thing. Nothing in the
  current corpus overlaps, so this is a design question rather than a defect — the answer is
  probably `owl:sameAs` from a matching pass, not a change to minting.
* embedding throughput: 645 plugins take about 50 minutes on this machine, CPU-only. Fine for
  a nightly rebuild, too slow for an interactive re-ingest. Incremental embedding keyed on
  `pu:composedTextHash` would only re-embed what changed.
