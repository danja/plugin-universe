# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this
repository.

There should be no inline fallbacks as this leads to indeterminate code. If a value is not
successfully retrieved from config then that is an error that needs fixing.

## Project Overview

Plugin Universe is an open database of Digital Audio Workstation plugins: an RDF-backed content
management system with integrated semantic search. Plugin metadata is harvested from permissive
sources into a Fuseki triple store, embedded for semantic retrieval, measured by a sandboxed
profiler, and served through a web UI, a REST API, a public SPARQL endpoint and an MCP face.

Node.js, ES modules, Vitest for tests. Phase 0 (foundations) is complete; see
`docs/plan.md` for what each phase delivers.

## Layout

- `src/rdf/` — `NamespaceManager` (the single prefix registry), `URIMinter`
- `src/store/` — `SPARQLClient`, `SPARQLHelper` (term formatting), `QueryService`
  (file-based query loading), `GraphRegistry` (named graphs, provenance, licence flags)
- `src/vectors/` — `VectorOperations`, `VectorIndex` (persisted FAISS index)
- `src/embeddings/` — `EmbeddingService` and the composed text view
- `vocabs/` — the ontologies; `sparql/queries/` — every query, by name
- `tests/fixtures/` — the corpus and queries behind the retrieval regression suite

The full design is in `docs/architecture.md`; the phased implementation plan is in `docs/plan.md`.
Read those before making structural changes.

## Architectural Notes

- **Named graph per source.** Every triple lives in a graph identifying where it came from, with
  `prov:` metadata and a licence flag. Never write to a shared catch-all graph. Re-harvesting a
  source is a DROP and reload of its graph alone.
- **The vector index is the hot path.** Candidate generation goes through the persisted ANN index.
  Do not SELECT rows out of SPARQL and compute cosine similarity in JavaScript.
- **Embeddings are stored out of band**, keyed by plugin IRI. The graph records the model, dimension
  and generation time; the vectors live in the index, never as JSON string literals in RDF.
- **Discovery beats curation for technical facts.** When a scan and a curated profile disagree about
  a bundle name or a parameter range, the scan wins. Source precedence, highest first: profiler
  measurement, discovery scan, vendor submission, open registry, curated editorial, user
  contribution. The weights live in `config/preferences.js`.
- **Parameters use `lv2:port`**, `units:` and `lv2:scalePoint` — not bespoke terms. This is why LV2
  bundles map in without translation.
- **The profiler runs untrusted native code** in a disposable, network-less, resource-limited
  container, in a process separate from the API. A plugin crash is a recorded result, not an error.
- **Two licences, enforced structurally.** The factual catalogue is CC0; user-authored prose (wiki
  text, reviews, comments) is CC BY-SA. They live in separate graphs, so the boundary is a property
  of the store rather than a judgement at publication time. Every graph carries a licence flag, set
  by the harvester at write time, and dump assembly is a query over that flag. A harvester that does
  not set one is incomplete.

## Working rules
- API keys are sacred. They must not be shared.
- Do not run any `git` operations unless the user explicitly approves them.
- Use the Read tool to read files, not `sed`/`cat`/`head`/`tail` via Bash. Bash tool calls require per-call user approval; Read does not.
- Log mistakes in MISTAKES.md (what happened, root cause, prevention).
- Periodically review TODO.md and revise as necessary.

## Development Guidelines

- ES modules throughout. Node ≥ 20.
- Scripts are run from the repository root.
- Vitest, with separate core / sparql / integration configurations. Mocking is only allowed for
  trivial arithmetic-style unit checks; every other test must assume the live services defined in
  `config/config.json` are reachable and interact with them directly.
- SPARQL queries live in files under `sparql/queries/<category>/<name>.sparql`, loaded by name
  through `QueryService`. Prefixes come from `NamespaceManager`, so a query cannot use a prefix the
  code does not know about. Placeholders are `${name}` and every one must be supplied — an unfilled
  placeholder is an error, because a silently empty graph name produces a query that runs and
  returns the wrong thing. Values passed in must already be formatted terms from `SPARQLHelper`
  (`iri()`, `literal()`, `typedLiteral()`); `QueryService` quotes nothing itself. Do not inline
  SPARQL as template literals in JavaScript, and do not add a second loader or syntax.
- Retrieval changes are measured, not asserted. `tests/store/retrieval-quality.test.js` reports
  recall@1 and recall@3 over a fixed corpus; the current baseline is 80% and 93%. Move the floors up
  as the signals improve, and never tune a fixture until a test passes.
- Record anything that turned out to be wrong in `MISTAKES.md`, newest first.
- Every prefix is declared in `src/rdf/NamespaceManager.js` and nowhere else. Never hardcode a
  namespace IRI in a module.
- New RDF terms go in `vocabs/` first; code follows the ontology, not the reverse.
- Changes to the graph model require the SHACL shapes and the query regression suite to be updated in
  the same commit.

## Data Sources and Terms

The governing principle is to obey the law and be a good citizen of the ecosystem this catalogue
documents. The second is stricter than the first and settles the marginal cases. Ingest rules, with
the full review in `docs/resources.md` §4:

- Only harvest sources whose terms have been reviewed and recorded there. Adding a source means
  adding a row to that table first.
- Use a sanctioned API where one exists; never scrape HTML where an API is offered. GitHub in
  particular: its acceptable use policies exempt API collection from their definition of scraping,
  but HTML scraping is not permitted.
- Never work around an access-control measure. A 403, a rate limit or a bot check is an answer.
- `robots.txt` permitting a path is not a licence to re-publish what is on it. EU/UK sui generis
  database right protects curated catalogues against extraction of a substantial part even where the
  individual facts are unprotected.
- Personal data is not catalogue data. Store a maintainer's public name and project role; do not
  harvest email addresses; support erasure by graph.
- KVR Audio is excluded from harvesting. Do not add a KVR harvester.
- Identify the crawler honestly with a contact address, harvest at a rate that costs the source
  nothing, credit sources whether or not their licence compels it, and contribute corrections back
  upstream rather than keeping a better copy privately.

## Configuration Management

Configuration is layered: static defaults → `config/config.json` → `${ENV}` interpolation →
environment overrides. Secrets live only in `.env`.

Tunable constants are centralised in `config/preferences.js` rather than hardcoded in source:
retrieval fusion weights, similarity thresholds, source precedence, rate limits, profiler resource
caps. Each constant carries a comment explaining its purpose. When adding a configurable value, add
it there.

## Vocabulary and Graph Conventions

Primary vocabulary is `trn:` — `http://purl.org/stuff/transmissions/` — extended by this project and
shared with `~/github/transmission`, `~/github/downspout` and `~/github/valis`. Extensions should be
proposed upstream to the transmission repo, not forked.

| Prefix | IRI | Used for |
|---|---|---|
| `trn:` | `http://purl.org/stuff/transmissions/` | plugin profiles, roles, signals, routing |
| `pu:` | `http://purl.org/stuff/plugin-universe/` | measurements, catalogue admin, promotion |
| `lv2:` / `units:` | `http://lv2plug.in/ns/…` | ports, parameters, units |
| `doap:` / `foaf:` / `schema:` | — | projects, people, software listings |
| `skos:` | — | the tag and category concept scheme |
| `dcterms:` / `prov:` / `spdx:` | — | metadata, provenance, licences and checksums |

Plugin IRIs are minted under `http://purl.org/stuff/plugin-universe/`, by content hash over the
identifying tuple so that re-harvesting is idempotent — `.../plugin/<slug>-<sha256[0:8]>`, and
`.../vendor/`, `.../person/`, `.../release/`, `.../measurement/` by the same rule. The PURL redirects
to whatever host currently serves the site, so IRIs survive a change of domain; never mint an IRI
under the serving domain itself. Where an upstream canonical IRI already exists — LV2 plugins have
them by design — preserve it with `owl:sameAs` rather than replacing it.

Categories and tags are a `skos:ConceptScheme`, not an OWL class hierarchy. Vendor categories, LV2
plugin classes and user tags map in as `skos:closeMatch`.

## Deployment

Docker Compose: an application container and a Fuseki (TDB2) container, with a healthcheck gate so
the app waits for the store. nginx terminates TLS and reverse-proxies. The profiler runner is a
separate, tightly confined container and is the only component permitted to execute third-party code.

Subdomains: the bare domain serves the web UI, `api.` the REST API, `sparql.` the public read-only
endpoint, `mcp.` the agent endpoint.

Note that the native vector dependencies need `python3 make g++ cmake libopenblas-dev libblas-dev
liblapack-dev pkg-config` at build time.

## Docs and Worklog Guidelines

- `docs/architecture.md`, `docs/plan.md`, `docs/suggestions.md` and `docs/resources.md` are the
  standing documents. Keep `docs/index.md` current when adding one.
- Progress reports and plans are saved as markdown under `docs/entries/`, named
  `YYYY-MM-DD_claude_title.md`, with the main title starting `# Claude :`, written in the style of a
  development worklog. If a document exceeds a page or two, or the topic of activity changes, start a
  new one.
- `docs/prompts/` is gitignored scratch space; do not rely on its contents.

## Related Local Repositories

Referenced by `docs/local-references.md`; useful as seed data and as prior art:

- `~/github/transmission` — the `trn:` vocabulary (`vocabs/profile.ttl`), an rdf-ext profile parser
  (`src/rdf/PluginProfileRdf.js`) and the profile spec (`docs/plugin-profiles.md`)
- `~/github/downspout` — 50 VST3 plugins with hand-written `profile.ttl` files
- `~/github/flues` — 37 LV2 bundles, 88 `.ttl` files; the reference for LV2-shaped metadata
- `~/github/valis` — RDF loaded at runtime; the precedent for describing parameters with `lv2:port`
- `~/github/semem` — the SPARQL / embedding / FAISS core is extracted from here (see
  `docs/architecture.md` §10). This project does not depend on semem; do not add it as a dependency.
