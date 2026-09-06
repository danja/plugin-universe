# TODO

## Done

* ~~compile a list of data sources / forums / general resources~~ — [docs/resources.md](docs/resources.md)
* ~~decide the dataset licence~~ — **CC0** for facts, **CC BY-SA** for user-authored prose
* ~~settle the IRI namespace~~ — `http://purl.org/stuff/plugin-universe/`
* ~~terms-of-service review of the Phase 1 sources~~ — [docs/resources.md §4](docs/resources.md); all clear, KVR excluded
* ~~register the domain~~ — plugin-universe.com
* ~~Phase 0: foundations~~ — config, vocabularies, SPARQL store with per-graph licensing, persisted
  vector index, embedding pipeline. 62 tests, 22 against live services.

## Next — Phase 1 (see [docs/plan.md](docs/plan.md))

* harvester interface, then harvesters for downspout, flues, valis
* normaliser: `trn:min`/`trn:minimum` onto `lv2:minimum`, LV2 classes into the SKOS scheme
* SHACL shapes (deferred from Phase 0 — nothing to validate until a harvester produces plugin data)
* lexical signal and facet filtering, to lift recall@1 above the 80% vector-only baseline
* open-audio-stack registry harvester

## Outstanding, not blocking

* configure the PURL redirect from `http://purl.org/stuff/plugin-universe/` to plugin-universe.com,
  and record that configuration in this repo rather than only in the purl.org account
* point the site DNS at a host; decide whether to also register plugin-universe.it and redirect it
* whether to propose the `trn:` extensions upstream to `~/github/transmission`
