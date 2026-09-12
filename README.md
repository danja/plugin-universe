# plugin-universe

An open database of DAW plugins, live at **[plugin-universe.com](https://plugin-universe.com)**.

754 plugins, 61,371 triples, 288 measurements taken by running the binaries.
The facts are **CC0**; user-authored prose is CC BY-SA.

## The method

There are two ways to build a catalogue of anything. You can write a schema and
fill it in, or you can ask a language model and hope. This does neither, and the
argument for that is the interesting part of the project.

**The ontology is the contract, and code follows it.** Terms go in `vocabs/`
first. A plugin's parameters are described with `lv2:port`, `lv2:symbol`,
`lv2:default`, `lv2:scalePoint` and `units:unit` — LV2's own vocabulary, not a
private invention — which is why an LV2 bundle maps into this catalogue
*untranslated*, and why 1,600 ports carry real ranges and units rather than
prose about knobs. Categories are a SKOS concept scheme with definitions and
alternative labels, not an enum; a vendor category and an LV2 plugin class both
attach to it as `skos:closeMatch`.

**SHACL is what stops the model rotting.** `vocabs/shapes.ttl` says what a valid
plugin is, and the ingest pipeline validates before it writes, so a defective
harvester is caught while the graph it would have written is still a variable.
`tests/rdf/shapes.test.js` proves the shapes reject what they claim to — a shape
file that passes everything looks exactly like validation and is worse than
none.

**Provenance is structural, not documentary.** Every triple lives in a named
graph identifying where it came from, with `prov:` metadata and a licence flag
set at write time. There are 44 of them. That is what makes the CC0 dump a
*query over a flag* rather than a judgement someone makes at publication time,
and it is why re-harvesting a source is a DROP and reload of one graph and
nothing else.

**Retrieval uses a language model where a language model is good, and does not
elsewhere.** Two signals are fused: an IDF-weighted lexical score over names and
bundle identifiers, and cosine similarity over embeddings of a composed text
view. Neither works alone — someone typing *"Dragonfly"* wants that plugin, and
someone typing *"granular synthesiser"* gets LayerEngine, gRainbow and
*Oi, Grandad!*, none of which contains either word anywhere in its name. Vectors live in a persisted FAISS index and never in the graph;
the graph records the model, dimension and a hash of what was embedded, which is
enough to know an embedding is stale without re-computing it. The ANN index is
the hot path — candidates are never SELECTed out of SPARQL and cosined in
JavaScript.

**So the two techniques answer different questions.** SPARQL answers *which* —
every LV2 reverb under GPL with a latency measurement, as one query. Embeddings
answer *what is this like*. A facet is a filter and never a score, because a
person asking for LV2 plugins does not want a VST3 that is a close match.

**And measurement is what makes it a catalogue rather than an aggregation.** A
sandboxed profiler runs `pluginval` and `lilv` against the built binaries in a
disposable, network-less container with a read-only mount and a CPU limit. It
records what happened: open time cold and warm, reported latency, discovered
ports, and a verdict. A crash is a result, not an error. The verdicts
deliberately do not collapse to pass/fail — `unloadable` means *our* container
could not load the binary, which looks identical from outside to a broken
plugin, and recording it as `failed` would publish our limitation as somebody
else's defect.

Every reading carries its tool, version, platform, strictness and timestamp,
because without those a number is not a fact. The catalogue can support "a run
on Linux x64 under pluginval 1.0.4 at strictness 5 reported 0 samples of
latency". It cannot support "this plugin has no latency", and does not say so.

## What is in it

| Source | Plugins | Licence | What it contributes |
|---|---|---|---|
| [Open Audio Stack registry](https://github.com/open-audio-stack/open-audio-stack-registry) | 559 | CC0-1.0 | breadth, and the packaging layer — checksummed downloads per platform and architecture |
| GitHub repositories | 107 | per repo | LV2 bundles read from source, one graph per repository so each carries its own terms |
| [downspout](https://github.com/danja/downspout) | 50 | CC0-1.0 | VST3, curated behaviour — roles, routing, cautions, CC mappings |
| [flues](https://github.com/danja/flues) | 36 | MIT | LV2, machine-readable by design; ports map in untranslated |

Plus 377 vendors, 28 categories, and plugins submitted through the site itself.
The public SPARQL copy is republished after each harvest, so it can lag the
site by a plugin or two; `/health` is the live figure.

Every plugin carries the two things people ask first — **can I see the source**
and **do I have to pay** — as separate facets, because they are independent:
Ardour is GPL-3.0 and its official binaries are sold. Source availability is
derived from the stated licence; pricing is only ever what a source asserted.

Sources are only harvested after their terms are reviewed and recorded in
[docs/resources.md §4](docs/resources.md). A sanctioned API is used wherever one
exists, a 403 or a rate limit is treated as an answer rather than an obstacle,
and a repository stating no recognised licence is listed but not harvested —
silence is not permission. KVR Audio is excluded, and the reasoning is written
down rather than implied.

## Ways in

| | |
|---|---|
| Web | [plugin-universe.com](https://plugin-universe.com) — search, browse, plugin and vendor pages |
| JSON | any page with `Accept: application/json`, or `.json` |
| RDF | any plugin or category IRI with `Accept: text/turtle`, or `.ttl` / `.jsonld` |
| SPARQL | [`sparql.plugin-universe.com/public/query`](https://plugin-universe.com/about/sparql) — read-only, no key |
| Dumps | [`/dumps/`](https://plugin-universe.com/dumps/) — the CC0 set, VoID described, rebuilt nightly |
| Registry | `/registry/plugins/index.json` — an Open Audio Stack view, so OwlPlug and StudioRack can read it |
| MCP | [`mcp.plugin-universe.com`](https://plugin-universe.com/about/mcp) — the catalogue as tools an agent can call |

None of them needs an account or a key. Plugin IRIs are minted under a PURL and
dereference through it, so they survive a change of serving domain.

Some results are [paid placements](https://plugin-universe.com/about/promotion).
They carry a Promoted label, the ranking effect is bounded and its numbers are
published, and a placement can never appear in a search it does not match.

## Documents

- [Architecture](docs/architecture.md) — data model, components, retrieval, deployment
- [Implementation plan](docs/plan.md) — six phases with exit criteria
- [Measurements](docs/measurements.md) — what the profiler measures and what each verdict means
- [Resources](docs/resources.md) — data sources, forums, specs, and the source terms review
- [Suggestions](docs/suggestions.md) — recommendations and rationale
- [Deployment](docs/deployment.md) — the server runbook
- [Profiling](docs/profiling.md) — the profiler and its sandbox
- [Mistakes](MISTAKES.md) — things that turned out to be wrong, newest first

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
node bin/validate.js            # SHACL, graph by graph
node bin/profile.js --path <built bundles> --dry-run   # measure, see docs/profiling.md
node bin/serve.js               # search UI and JSON API on :4100
```

Harvesting LV2 bundles from GitHub is two steps, on purpose — which repositories
to harvest is a curation decision, and it belongs in a file someone can read and
edit:

```sh
node bin/discover.js --merge                          # writes a candidate list; ingests nothing
node bin/ingest.js --github data/curation/github-candidates.json
```

Only rows marked `include` are harvested. Each repository gets its own graph
carrying its own licence, so re-harvesting one is a DROP of that graph alone.

Ingest validates against `vocabs/shapes.ttl` before it writes anything, and
embedding the full catalogue takes about fifty minutes on CPU —
`--skip-embeddings` and `--skip-validation` are there for a faster loop.

## Tests

```sh
npm test            # core: no external services
npm run test:store  # store, embeddings, retrieval quality: requires live services
npm run test:live   # the deployed site, over the internet
```

Store tests are not mocked. Per `CLAUDE.md`, mocking is allowed only for trivial
arithmetic-style checks; a store layer that only works against a fake is not
known to work.

Retrieval changes are measured rather than asserted:
`tests/store/retrieval-quality.test.js` reports recall@1 and recall@3 over a
fixed corpus, currently 80% and 93%, so a change in quality is a number rather
than an impression. Several other suites exist to bind two things that must
agree — the SHACL licence enumeration to the code's list, the templates to their
callers, the published promotion numbers to the ones actually applied. That
pattern is the project's main defence against its own most common failure, which
is documented at the top of `CLAUDE.md`.

## Licence

Code: see [LICENSE](LICENSE). Catalogue data: CC0-1.0, attribution requested and
not required. Each plugin's own licence is its author's and is a separate
matter.
