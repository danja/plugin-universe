# plugin-universe

An open, RDF-backed database of DAW plugins, with semantic search over it.

Plugin metadata is harvested from permissive sources into a triple store,
embedded for retrieval, measured by a sandboxed profiler, and served through a
web UI, a REST API, a public SPARQL endpoint and an MCP face for agents.

The catalogue is **CC0**. User-authored prose is CC BY-SA.

- [Architecture](docs/architecture.md) — data model, components, retrieval, deployment
- [Implementation plan](docs/plan.md) — six phases with exit criteria
- [Suggestions](docs/suggestions.md) — recommendations and rationale
- [Resources](docs/resources.md) — data sources, forums, specs, and the source terms review
- [Deployment](docs/deployment.md) — the server runbook
- [Mistakes](MISTAKES.md) — things that turned out to be wrong

## Status

Phase 0 (foundations) is complete. Phase 1 (harvest and search) is largely
complete: harvesters, the normaliser, the ingest pipeline, SHACL validation,
hybrid retrieval, and a read-only API and search UI. What remains is a
DOAP/GitHub harvester.

The catalogue holds **645 plugins** in three source graphs:

| Source | Plugins | Licence | What it contributes |
|---|---|---|---|
| [downspout](https://github.com/danja/downspout) | 50 | CC0-1.0 | VST3, curated behaviour — roles, routing, cautions, CC mappings |
| [flues](https://github.com/danja/flues) | 36 | MIT | LV2, machine-readable by design; ports map in untranslated |
| [Open Audio Stack registry](https://github.com/open-audio-stack/open-audio-stack-registry) | 559 | CC0-1.0 | breadth, and the packaging layer: checksummed downloads per platform and architecture |

Every plugin carries the two things people ask first — **can I see the source**
and **do I have to pay** — as separate facets, because they are independent:
Ardour is GPL-3.0 and its official binaries are sold. Source availability is
derived from the stated licence; pricing is only ever what a source asserted.
Currently 631 open source, 641 free, 4 donationware, 14 unknown.

Parameters are described with `lv2:port`, `units:` and `lv2:scalePoint`
throughout, whatever the source format. Hybrid retrieval scores MRR 0.893 on the
fixture corpus against 0.844 for vector similarity alone.

## Requirements

- Node ≥ 20.11
- A SPARQL 1.1 store (Fuseki; `docker compose up -d fuseki` provides one)
- Ollama with `nomic-embed-text:v1.5` for embeddings
- A toolchain for the native vector dependency: `python3 make g++ cmake
  pkg-config libopenblas-dev libblas-dev liblapack-dev`

## Setup

```sh
npm install
cp .env.example .env      # then fill it in — there are no defaults
npm run store:up          # or point .env at an existing Fuseki
```

`store:up` mounts `config/fuseki/assembler-tdb2.ttl`, which creates the
`plugin-universe` dataset — do not also create one through `/$/datasets`, or you
get two differently configured datasets with the same intent. Confirm it exists:

```sh
curl -s -u "admin:$SPARQL_PASSWORD" http://localhost:3030/\$/datasets \
  | grep -o '"ds.name" : "[^"]*"'
```

## Use

```sh
node bin/ingest.js              # harvest every source and build the index
node bin/search.js "warm analogue bus compressor"
node bin/search.js "reverb" --format LV2
node bin/search.js --facets
node bin/validate.js            # SHACL, graph by graph
node bin/serve.js               # search UI and JSON API on :4100
```

Harvesting LV2 bundles from GitHub is two steps, on purpose — which repositories to
harvest is a curation decision, and it belongs in a file someone can read and edit:

```sh
node bin/discover.js --merge                          # writes a candidate list; ingests nothing
node bin/ingest.js --github data/curation/github-candidates.json
```

Only rows marked `include` are harvested. A repository stating no licence the graph registry
recognises is listed but not included: silence is not permission. Each repository gets its own
graph carrying its own licence, so re-harvesting one is a DROP of that graph alone.

Ingest validates against `vocabs/shapes.ttl` before it writes anything, and
embedding the full catalogue takes about fifty minutes on CPU — `--skip-embeddings`
and `--skip-validation` are there for a faster loop.

The API is read-only and CORS-open, because a catalogue nobody can call from a
browser is not much of an open dataset:

| Endpoint | Returns |
|---|---|
| `GET /` | server-rendered search page |
| `GET /search?q=&format=&category=&pricing=&source=&licence=` | hybrid search results as JSON |
| `GET /facets` | facet values and counts |
| `GET /plugin/<slug>` | one plugin — HTML, or Turtle/JSON-LD by `Accept` or `.ttl`/`.jsonld` |
| `GET /health` | corpus and index size |

## Tests

```sh
npm test          # core: no external services
npm run test:store # store, embeddings, retrieval quality: requires live services
npm run test:all
```

Store tests are not mocked. Per `CLAUDE.md`, mocking is allowed only for
trivial arithmetic-style checks; a store layer that only works against a fake
is not known to work.

`tests/store/retrieval-quality.test.js` is the query regression suite. It prints
recall@1 and recall@3 over a fixed corpus so a change in retrieval quality is a
number rather than an impression.

`tests/rdf/shapes.test.js` checks that the SHACL shapes actually reject the
things they claim to; `tests/store/shapes.test.js` checks that every graph an
ingest wrote conforms to them.

## Licence

Code: see [LICENSE](LICENSE). Catalogue data: CC0-1.0.
