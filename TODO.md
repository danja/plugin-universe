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

## Next — finish Phase 1

* DOAP / GitHub harvester — API only, project data not maintainer emails.
  `GITHUB_TOKEN` is in `.env` (fine-grained, public-read-only, no scopes — the reasoning is
  recorded in `.env.example`). One decision left: **which repositories to sweep.** The OAS
  registry already covers most open-source plugins that publish releases, so the value here is
  the ones that do not — LV2 bundles living in source repos with a `manifest.ttl` and no
  release artefacts. Candidate seeds: the `lv2` and `lv2plugin` GitHub topics, the DISTRHO and
  MOD organisations, and repositories already referenced by harvested plugins' `foaf:homepage`.

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
