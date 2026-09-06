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
- [Mistakes](MISTAKES.md) — things that turned out to be wrong

## Status

Phase 0 (foundations) is complete. Phase 1 (harvest and search) is largely
complete: harvesters for the seed repositories, the normaliser, the ingest
pipeline, hybrid retrieval, and a read-only API and search UI.

The catalogue currently holds **86 plugins** harvested from
[downspout](https://github.com/danja/downspout) (50, VST3) and
[flues](https://github.com/danja/flues) (36, LV2), with their parameters
described as `lv2:port`. Hybrid retrieval scores MRR 0.893 on the fixture
corpus against 0.844 for vector similarity alone.

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

Create the dataset if your store does not already have one:

```sh
curl -X POST http://localhost:3030/\$/datasets \
     --data 'dbName=plugin-universe&dbType=tdb2'
```

## Use

```sh
node bin/ingest.js              # harvest the seed sources and build the index
node bin/search.js "warm analogue bus compressor"
node bin/search.js "reverb" --format LV2
node bin/search.js --facets
node bin/serve.js               # search UI and JSON API on :4100
```

The API is read-only and CORS-open, because a catalogue nobody can call from a
browser is not much of an open dataset:

| Endpoint | Returns |
|---|---|
| `GET /` | server-rendered search page |
| `GET /search?q=&format=&category=` | hybrid search results as JSON |
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

## Licence

Code: see [LICENSE](LICENSE). Catalogue data: CC0-1.0.
