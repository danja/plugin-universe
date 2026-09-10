# Document Index

## Public-facing

* [About](about.md) — what the project is, who it is for, and the licence. Becomes /about
* [Contributor terms](contributor-terms.md) — in force; revisit before the site is promoted
* [Crawler](crawler.md) — what the harvester does and how to stop it. Becomes /about/crawler, which the user agent already points at

## Standing documents

* [System Architecture](architecture.md) — the design: data model, vocabularies, components, retrieval, profiler, deployment
* [Implementation Plan](plan.md) — six phases, each with deliverables, exit criteria and risks
* [Suggestions](suggestions.md) — recommendations on data, engineering, product, law and scope
* [Resources](resources.md) — data sources, forums, specifications, ontologies, tooling, and the source terms review
* [Deployment](deployment.md) — the runbook: containers, TLS, harvesting on the server, backups
* [Profiling](profiling.md) — measuring plugins, and the sandbox that runs untrusted code

## Worklog

* [2026-09-10 — Prose from strangers, and getting the HTML out of the code](entries/2026-09-10_claude_the-wiki-and-html-in-files.md)
* [2026-09-09 — Closing the correction loop, and putting the data on the page](entries/2026-09-09_claude_phase-three-and-the-front-page.md)
* [2026-09-07 — The registry, the shapes, and two bugs the shapes found](entries/2026-09-07_claude_registry-shapes-alignment.md)

## Working documents

* [Danja's list](danja-todo.md) — actions needing server access, credentials or a decision
* [TODO](../TODO.md) — what the project needs next, by phase

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

Phase 0 is complete and Phase 1 is nearly so — 645 plugins from three sources,
SHACL-validated, hybrid search over them. See [the plan](plan.md) for what
remains, and [MISTAKES.md](../MISTAKES.md) for what turned out to be wrong along
the way.

Repository conventions for AI assistants are in [CLAUDE.md](../CLAUDE.md).
