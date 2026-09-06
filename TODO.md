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
  with content negotiation, server-rendered search UI. 86 plugins, 144 tests.

## Next — finish Phase 1

* open-audio-stack registry harvester (CC0, the largest clean external source)
* DOAP / GitHub harvester — API only, project data not maintainer emails
* SHACL shapes, deferred from Phase 0 until there was harvested data to shape
* AUFX-O and schema.org alignment graph

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
