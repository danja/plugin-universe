# Document Index

## Standing documents

* [System Architecture](architecture.md) — the design: data model, vocabularies, components, retrieval, profiler, deployment
* [Implementation Plan](plan.md) — six phases, each with deliverables, exit criteria and risks
* [Suggestions](suggestions.md) — recommendations on data, engineering, product, law and scope
* [Resources](resources.md) — data sources, forums, specifications, ontologies, tooling, and the source terms review

## Background

* [Initial Plan](plan-draft.md) — the original sketch
* [Notes](notes.md) — the window-of-opportunity argument
* [Plugin metadata notes](perplexity.md) — LV2 / VST3 / CLAP / AU metadata compared
* [Local References](local-references.md) — related repositories on this machine

## Settled decisions

* Licensing: **CC0** for the factual catalogue, **CC BY-SA** for user-authored prose
* IRI namespace: `http://purl.org/stuff/plugin-universe/`
* Vocabulary: extend `trn:`, reuse `lv2:`/`units:`/`doap:`/`foaf:`/`skos:`/`prov:`, packaging modelled on open-audio-stack
* Backend: a lean SPARQL + embedding + vector core extracted from `~/github/semem`, not a dependency on it
* Ingest: permissive sources only; KVR excluded ([source terms review](resources.md))
* Domain: plugin-universe.com (serving only — IRIs are on purl.org and survive a move)

Phase 0 is complete. See [the plan](plan.md) for what remains, and
[MISTAKES.md](../MISTAKES.md) for what turned out to be wrong along the way.

Repository conventions for AI assistants are in [CLAUDE.md](../CLAUDE.md).
