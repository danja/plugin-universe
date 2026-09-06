# Plugin Universe — Implementation Plan

Status: draft, 2026-09-06. Companion documents: [Architecture](architecture.md),
[Suggestions](suggestions.md), [Resources](resources.md).

Every component named here is defined in [architecture.md](architecture.md). Each phase lists its
goal, deliverables, exit criteria and risks. No phase depends on anything introduced later.

## Sequencing rationale

The profiler is scheduled second, before accounts, wiki or revenue. That is deliberate. Measured
data is the one thing no competing catalogue has and the one thing that cannot be replicated by
aggregation, so it should exist before there is any pressure to launch. Accounts and payments are
well-understood work that can be done at any time; they are not what makes the project worth doing.

The first two phases also happen to be the ones the user personally wants ("I want this data!"), so
if the project stops after Phase 2 it has still delivered its primary motivation.

---

## Phase 0 — Foundations — **COMPLETE** (2026-09-06)

Delivered: `src/Config.js`, `src/rdf/{NamespaceManager,URIMinter}.js`,
`src/store/{SPARQLClient,SPARQLHelper,QueryService,GraphRegistry}.js`,
`src/vectors/{VectorOperations,VectorIndex}.js`,
`src/embeddings/EmbeddingService.js`, `vocabs/`, `sparql/queries/graph/`,
`docker-compose.yml`, `Dockerfile`, `config/fuseki/assembler-tdb2.ttl`.
62 tests pass, 22 of them against live Fuseki and Ollama.

Baseline recorded for Phase 1 to improve on: vector-only retrieval scores
**recall@1 80%, recall@3 93%** over the 12-plugin, 15-query fixture corpus in
`tests/fixtures/`. The three failures are all vocabulary-mismatch cases, which
is precisely what the lexical signal is for.

**Goal.** A repository that can store a triple, embed a string and run a test, with the vocabulary
settled. Nothing user-visible.

**Deliverables**

1. Repo scaffolding: ESM, Node ≥ 20, Vitest with separate core/sparql/integration configs, lint,
   `npm` scripts run from the repo root.
2. Layered configuration — `src/Config.js` ported from
   `/home/danny/github/semem/src/Config.js` with the tbox auto-detection dropped; `config/config.json`
   with `${ENV}` interpolation; `config/preferences.js` for tunables. No inline fallbacks anywhere.
3. `vocabs/` — the extended `trn:` ontology (§2.2–2.3 of the architecture), starting from
   `/home/danny/github/transmission/vocabs/profile.ttl` verbatim and adding the format individuals
   and the SKOS category scheme; plus local copies of `lv2core.ttl` and `units.ttl` as valis does in
   `/home/danny/github/valis/vocabs/lv2/`.
4. `src/rdf/NamespaceManager.js` — the single prefix registry, after
   `/home/danny/github/semem/src/ragno/core/NamespaceManager.js`.
5. SPARQL core extracted from semem: `SPARQLHelper.js`, `SPARQLExecute.js`, and **one**
   query-template loader over the `sparql/queries/` + `sparql/templates/prefixes.sparql` +
   `sparql/config/query-mappings.json` convention.
6. Embedding and vector core extracted: `VectorOperations`, the FAISS wrapper, the provider chain
   (`EmbeddingConnectorFactory` → Ollama/Nomic), with `writeIndex`/`readIndex` persistence wired in
   from the start rather than retrofitted.
7. `src/rdf/URIMinter.js` — content-hash minting, plus the upstream-IRI preservation rule.
8. Docker Compose with Fuseki (TDB2 assembler from
   `/home/danny/github/semem/config/fuseki/assembler-tdb2.ttl`) and the app container, including the
   apt packages the native vector build needs.
9. SHACL shapes for the core plugin shape, and a validator module that runs them.
10. Licence plumbing for the **CC0** decision: a per-graph licence flag set at harvest time, and the
    dump-assembly query that selects only CC0-compatible graphs. The source terms review is done —
    see [resources.md §4](resources.md) — so this is implementation, not investigation.

**Exit criteria** — met except where noted

- [x] Tests pass against a live local Fuseki — a graph is registered, read back, and its `prov:`
  metadata is present.
- [x] A string embeds, the vector is written to a persisted index, the process restarts, and the
  index loads from disk without touching the triple store.
- [x] `URIMinter` produces `http://purl.org/stuff/plugin-universe/plugin/<slug>-<hash>` and the same
  input twice produces the same IRI.
- [x] A graph carrying a non-CC0 licence flag is excluded from dump assembly.
- [x] Registering a graph without a licence is refused.
- [ ] SHACL shapes reject a plugin with no `rdfs:label`. **Deferred to Phase 1**: the shapes have
  nothing to validate until a harvester produces plugin data, and writing them against an imagined
  shape rather than real harvested output would be guesswork. The rule they encode
  (`rdfs:label` plus one of `trn:bundleName` / `trn:vstClassId`) is carried in
  `~/github/transmission/src/rdf/PluginProfileRdf.js` meanwhile.

**Risks**

- *Deciding the vocabulary by writing code instead of writing Turtle.* Settle `vocabs/` first; the
  code follows the ontology, not the reverse.
- *`faiss-node` native build friction.* Mitigated by taking semem's Dockerfile package list.
- *Treating the licence flag as metadata to fill in later.* If it is not set by the harvester at
  write time it will not be set at all, and the CC0 dump becomes an audit instead of a query.

---

## Phase 1 — Harvest and search — **IN PROGRESS**

Done: the harvester interface and the downspout and LV2 harvesters; the
normaliser; per-source graphs with licence flags; the serialiser onto
`lv2:port`; the ingest pipeline with IRI-collision detection; the embedding
pipeline; hybrid retrieval with an IDF-weighted lexical signal; the read API
with content negotiation and a server-rendered search UI.

Corpus: **86 plugins** (50 downspout VST3, 36 flues LV2), 8,135 triples.
Retrieval on the fixture corpus: **MRR 0.893** hybrid against 0.844
vector-only; recall@1 87% against 80%. 144 tests pass, 43 against live
Fuseki and Ollama.

Still to do: the open-audio-stack registry harvester, the DOAP/GitHub harvester,
SHACL shapes (deferred from Phase 0), and the AUFX-O alignment graph.

One calibration worth carrying forward: `minSimilarity` in
`config/preferences.js` is tied to the embedding model, not chosen on
intuition. nomic-embed-text:v1.5 compresses cosine into roughly 0.45-0.70, so
the original 0.35 floor excluded nothing and every query returned a full page
of noise. Re-measure it if the model changes.

**Goal.** A public, read-only search over a real corpus. The system does something useful.

**Deliverables**

1. Harvester interface (fetch → emit RDF into a named graph, with its licence flag → record a run),
   plus harvesters for:
   - **downspout** — 50 `profile.ttl` files from `/home/danny/github/downspout/plugins/*/`
   - **flues** — 88 LV2 `.ttl` files across 37 bundles under `/home/danny/github/flues/lv2/`
   - **valis** — `/home/danny/github/valis/profile.ttl` and the element ontology
   - **open-audio-stack registry** — the JSON registry endpoints; CC0-1.0, so its graph flows
     straight into the CC0 dump
   - **DOAP / GitHub** — repository metadata via the GitHub **API** only, never HTML scraping;
     project data, not maintainer email addresses (see [resources.md §4](resources.md))
2. Normaliser: source shapes → the graph model. Includes the `trn:min`/`trn:minimum` reconciliation
   onto `lv2:minimum`/`lv2:maximum`, the `trn:MIDI`/`trn:hasParameter` typo fixes, LV2 plugin classes
   into the SKOS scheme, and OAS manifest fields into the packaging layer.
3. Per-source named graphs with `prov:` metadata and a per-graph licence flag, plus DROP-and-reload
   re-harvest.
4. Embedding pipeline over the composed text view (name, vendor, description, role labels, tag
   labels, parameter names) — composed from the graph, not from a raw description field.
5. Hybrid query service: lexical + vector ANN + SPARQL facet filter, fused under weights from
   `config/preferences.js`. Vector index on the hot path; no cosine-in-JavaScript over SPARQL rows.
6. HTTP API (Express) — search, plugin by IRI, facet enumeration, health. Public, rate-limited.
7. Web UI — search page with facets, plugin profile pages with `schema.org` JSON-LD, content
   negotiation on plugin IRIs returning Turtle / JSON-LD / HTML.
8. Alignment graph mapping `trn:` roles to AUFX-O and `schema:SoftwareApplication`.

**Exit criteria**

- The full seed corpus (downspout + flues + valis + open-audio-stack) is in Fuseki, each in its own
  graph, each re-harvestable without disturbing the others.
- A natural-language query — "transport-synced MIDI modulator", "warm analogue bus compressor" —
  returns sensibly ranked results end to end through the UI.
- A facet filter (format = LV2, licence = MIT) composes correctly with a semantic query.
- A plugin IRI under `http://purl.org/stuff/plugin-universe/` dereferences, via the PURL redirect,
  to Turtle and to HTML.
- Re-running every harvester produces zero new IRIs (idempotence proven, not assumed).
- Every graph in the store carries a licence flag; assembling a CC0 dump is one query.

**Risks**

- *Seed corpus too small and too uniform to prove semantic search.* All three seed repos are one
  author's work. Mitigate by prioritising the open-audio-stack harvester within this phase for
  breadth, and by testing queries a stranger would type.
- *Composed-text embeddings underperform on one-line descriptions.* Measure early with a fixed set
  of ~30 hand-written query/expected-result pairs; that set becomes the regression suite.
- *Normaliser becomes the dumping ground.* Keep source quirks in the harvesters; the normaliser sees
  only the common shape.

---

## Phase 2 — Profiler

**Goal.** Measured data in the graph. The catalogue becomes authoritative rather than aggregated.

**Deliverables**

1. Sandboxed runner: disposable container, no network, read-only plugin mount, CPU and wall-clock
   limits, crash captured as a result. Separate process from the API — a segfault must not affect
   the site.
2. Tool wrappers producing normalised output: `pluginval` (headless, VST/VST3/AU/LV2/LADSPA),
   `clap-validator` (CLAP), `lv2bm` (LV2 benchmarks), `lilv`/`lv2info` (LV2 metadata without loading
   binaries).
3. In-house measurements: CPU load at fixed block size and sample rate, reported latency, denormal
   behaviour, state save/restore integrity, scan time.
4. Measurement layer written to per-run named graphs, tagged with platform specification.
5. Aggregation queries (median CPU across runs) and measured facets exposed in search — "effects
   using under 2% CPU", "plugins that pass strict validation".
6. Plugin profile pages show measurements with their platform context.

**Exit criteria**

- Every plugin in the seed corpus that can be run on the host has a validation verdict and a CPU
  figure in the graph.
- A crashing plugin produces a recorded `fail` result and leaves the runner healthy.
- A measured facet filter works end to end from the search UI.
- Two runs of the same plugin on the same host produce figures within a stated tolerance;
  reproducibility is tested, not assumed.

**Risks**

- *Cross-platform coverage.* A Linux host cannot profile AU or AAX. Be explicit in the UI about what
  was measured where; treat macOS and Windows runners as later additions, not a blocker.
- *Sandbox escape or resource exhaustion.* This is the highest-risk component in the system, since it
  runs arbitrary third-party native code. Confine it hard, run it on its own machine as soon as
  volume justifies it.
- *Benchmark figures read as authoritative comparisons across machines.* Publish comparisons only
  within a run; always show the platform.

---

## Phase 3 — People and pages

**Goal.** The catalogue becomes a community resource rather than a database with a search box.

**Deliverables**

1. Accounts, sessions, and the tier model (public / registered / pro / admin) in `<graph:system>`.
2. `foaf:` profiles for registered users, with their own pages.
3. Plugin wiki pages — revisions as graph resources with `prov:` attribution, so history and rollback
   are queries.
4. Comment threads and rankings.
5. User contribution flow: add a plugin, edit a profile, propose a correction. Contributions land in
   `<graph:user/{id}>` and are subject to the source-precedence rules. Contributor terms grant CC0
   for factual contributions and CC BY-SA for authored prose, and the two land in separate graphs so
   the licence boundary is enforced by the store rather than by review.
6. Vendor submission flow, landing in `<graph:vendor/{id}>` and marked self-asserted.
7. Moderation tools: merge duplicate plugins, revert a revision, hide a comment, suspend an account.

**Exit criteria**

- A registered user can add a plugin that does not exist yet, edit its wiki page, and see the
  contribution attributed to their graph.
- An admin can merge two duplicate plugin entries without losing either source's provenance.
- A reverted wiki edit leaves an auditable history.

**Risks**

- *Spam and low-quality submissions arrive the day it opens.* Rate limits, a moderation queue for
  first contributions, and per-graph revert as the escape hatch.
- *Duplicate plugins.* Content-hash minting helps only where the identifying tuple matches; a
  deduplication review tool is part of the moderation deliverable, not an afterthought.
- *Moderation is unbounded work for one person.* Consider requiring an account age or a contribution
  threshold before edits go live unreviewed.

---

## Phase 4 — Pro tier and revenue

**Goal.** The project pays its hosting bills.

**Deliverables**

1. Payment integration with an external provider — no card data in this system, only a customer
   reference and an entitlement with an expiry.
2. Pro entitlements: promoted listings, the unfiltered query page, on-topic advertising, blogging.
3. Promotion as a bounded post-retrieval re-rank, never a filter that hides results.
4. Compliance, built in rather than retrofitted: a visible "Ad"/"Promoted" label at each promoted
   result (not "Sponsored" — the ASA advises against it as ambiguous); a public page documenting the
   main ranking parameters and the bound on the promotion boost; promotion records as graph
   resources, so the DSA-style ad repository is a query.
5. Pro-tier API keys for bulk and programmatic access.
6. Blog and reviews section.

**Exit criteria**

- A paid account can promote a plugin; the placement appears labelled; the boost is bounded and
  documented; the promotion is visible in the public ad-repository query.
- Downgrade and expiry revoke entitlements correctly.

**Risks**

- *Promotion corrupts search quality and users leave.* Keep the bound conservative and keep the
  unfiltered view available; search quality is the entire asset.
- *Payments and tax across jurisdictions.* Use a provider that handles VAT/MOSS rather than building
  it.
- *Too few pro customers to matter.* See the revenue alternatives in [suggestions.md](suggestions.md);
  do not let promoted placement be the only model.

---

## Phase 5 — Open data

**Goal.** Deliver the open-data promise, and make the catalogue something other systems build on.

**Deliverables**

1. Public read-only SPARQL endpoint at `sparql.<domain>`, rate-limited, with query timeouts.
2. Dataset dumps under **CC0**, assembled by selecting only CC0-compatible graphs — mechanical,
   because the flag was set at harvest time in Phase 1. CC BY-SA prose graphs are published as a
   separate, separately-licensed dump rather than mixed in. Both carry a VoID description, and the
   preserved notices of any MIT/ISC-sourced graphs included.
3. MCP endpoint at `mcp.<domain>` for agent access, using the command + Zod-schema + registry
   pattern.
4. An open-audio-stack-compatible JSON view, so OwlPlug/StudioRack tooling can consume this
   catalogue as a registry.
5. Contribution back upstream: the user's own plugins submitted to the open-audio-stack registry;
   the `trn:` extensions proposed to the transmission repo.
6. *Conditional* — link-out-only indexing of third-party catalogues (name and URL, no substantial
   re-publication, robots.txt and terms respected), only if the Phase 0 legal review supports it.
   Such graphs are marked non-redistributable and excluded from dumps.

**Exit criteria**

- A third party can reconstruct the redistributable catalogue from a published dump alone.
- An agent can answer a plugin question through the MCP endpoint without scraping the site.
- A package manager can point at the OAS-compatible view and resolve packages from it.

**Risks**

- *Open dumps undercut the pro tier.* They should not — the pro tier sells promotion, freshness and
  service, not access to facts. This was the reasoning behind choosing CC0; it holds only as long as
  the pro tier is not quietly redefined as paid access to data.
- *Public SPARQL endpoints are trivially abused.* Timeouts, result caps, rate limits, and a
  materialised dump as the recommended path for bulk consumers.

---

## Cross-cutting, running throughout

- **The query regression suite** from Phase 1 grows with each phase; search quality is measured, not
  asserted.
- **Every harvest is reproducible.** Any source graph can be dropped and rebuilt from source at any
  time.
- **Documentation as worklog** — progress notes under `docs/` following the naming convention in
  [CLAUDE.md](../CLAUDE.md).
- **The seed repos stay in sync.** downspout, flues and valis are both the seed corpus and the test
  data; changes there are the first signal that the normaliser has drifted.
