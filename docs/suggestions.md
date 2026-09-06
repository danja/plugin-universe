# Plugin Universe — Suggestions

Status: draft, 2026-09-06. Companion documents: [Architecture](architecture.md), [Plan](plan.md),
[Resources](resources.md).

Opinionated recommendations arising from the research, each with its reasoning. These are proposals,
not decisions.

---

## On the data

### 1. Dogfood before you harvest anything external

Seed exclusively from downspout, flues and valis for the first pass. Three reasons: the data is owned
outright, so no licence question can stall the work; the corpus is small enough that every mapping
error is visible by inspection; and the plugins are understood well enough to judge whether a search
result is actually good. Only once the model survives that should the open-audio-stack harvester run.

The seed corpus is also permanent test data — when the normaliser drifts, it will show up there
first.

### 2. Generate profiles; stop hand-writing them

Right now `profile.ttl` files are authored by hand across 50 downspout plugin directories, and
`/home/danny/github/transmission/profiles/downspout.ttl` is a manually synced consolidated copy that
has already drifted. That is three copies of the same facts (per-plugin TTL, consolidated TTL, and
49 Jekyll front-matter files under `docs/pages/_products/`) with nothing keeping them equal.

Derive what can be derived: parameter tables come from the C++ source, bundle names and class IDs
come from the built VST3, and the consolidated file should be a generated concatenation. Only the
genuinely curated parts — role, cautions, pairing hints, CC semantics — need a human.

valis already shows how to make this stick: its ontology↔C++ conformance test asserts that the set of
classes carrying `val:implementation` and the set of factories registered in C++ are equal *in both
directions*, so drift is a test failure rather than a surprise. Apply the same idea to profiles.
`/home/danny/github/valis/scripts/generate-docs.sh` is the only real generator across the three repos
and deserves imitating.

### 3. Fix the vocabulary defects while adopting it, not later

Three concrete items, all cheap now and expensive after there is production data:

- `trn:min`/`trn:max` (17 uses) and `trn:minimum`/`trn:maximum` (13 uses) both exist. Retire both in
  favour of `lv2:minimum`/`lv2:maximum`.
- `trn:MIDI` vs `trn:Midi`, `trn:hasParameter` vs `trn:parameter`, `trn:comment` vs `rdfs:comment` —
  one-off typos that will otherwise be copied forward by every future profile written by pattern-
  matching on an existing one.
- Move parameters wholesale onto `lv2:port` + `units:` + `lv2:scalePoint`, per valis's stated rule.
  The payoff is that flues' LV2 bundles need no translation at all, and units become comparable.

### 4. Make the SKOS category scheme do the work OWL classes cannot

Plugin categories are contested and overlapping — a saturator is arguably dynamics, arguably
distortion, arguably neither. A class hierarchy forces a wrong answer; a `skos:ConceptScheme` with
`skos:broader`, `skos:related` and `skos:altLabel` lets vendor categories, LV2 plugin classes and
user tags all map in as `skos:closeMatch` without any of them having to be correct. It also gives
query expansion across synonyms for free, which matters more for search quality than any ranking
tweak.

---

## On the engineering

### 5. Five design rules, each a correction of something observed in semem

These are worth stating as rules because each one is cheap at the start and painful to retrofit:

1. **The vector index is the hot path.** semem's `src/stores/modules/Search.js` pulls candidate rows
   out of SPARQL and computes cosine similarity in JavaScript, bypassing FAISS entirely. It works at
   thousands of rows and fails at a catalogue.
2. **Persist the index; update it incrementally.** semem rebuilds in memory at boot by SELECTing
   every embedding out of the graph. `src/ragno/search/VectorIndex.js` has the `writeIndex`/
   `readIndex` pattern already — use it from day one.
3. **Store vectors out of band, keyed by IRI.** semem stores them as JSON array string literals in
   RDF, which bloats the store and forces a full parse on load. Keep model, dimension and generation
   time in the graph; keep the numbers in the index.
4. **One namespace registry.** semem has three different IRIs in use for its own `semem:` prefix
   (`http://purl.org/semem/`, `http://purl.org/stuff/semem/`, `http://semem.hyperdata.it/`). One
   module, no exceptions.
5. **Named graph per source, from the first commit.** semem uses a single graph and therefore cannot
   say where anything came from. Retrofitting provenance onto an existing store is a migration; doing
   it at the start is a naming convention.

Add a sixth, from the same source: **pick one SPARQL template loader.** semem has two, with two
different interpolation syntaxes (`${var}` and `{{var}}`), plus a third set of templates under
`config/`. The file-based query convention is the best idea in that repo; the duplication is the
worst.

### 6. Extract deliberately, and delete as you go

The extraction list in [architecture.md §10](architecture.md) is about 2,500 lines of genuinely
useful code out of ~112,000. Port it file by file with a test for each, rather than copying `src/`
and pruning. Two files to read for their idea and then discard: `src/search/ArticleSearchService.js`
and `src/services/search/SearchServer.js` demonstrate the FAISS-from-SPARQL bootstrap but contain
hardcoded endpoints and credentials. `src/core/SimilaritySearch.js` is dead code that references an
undefined global.

### 7. Build the query regression suite before the search UI

Thirty hand-written query/expected-result pairs, written before any ranking work, turn "does search
feel better?" into a number. Without it, every weight change is a guess, and the fusion weights in a
hybrid retriever are exactly the kind of thing that gets tuned by vibes until it regresses.

---

## On the product

### 8. The profiler is the moat — treat it that way

Everything else in this system can in principle be assembled by someone else from public sources.
Measured data cannot: it requires running the plugins. It is also the answer to the problem the
project exists to address — when AI-assisted development floods the space with plugins, the scarce
thing is not a list but a filter, and measurement is the only filter that does not require human
attention per plugin.

That argues for the Phase 2 placement, and for going slightly further than validation: CPU load at a
stated block size is the number producers actually ask about and nobody publishes.

### 9. Serve the machine audience deliberately — nobody else does

KVR is a website. It cannot be queried by a DAW, a plugin manager, or an agent. A public SPARQL
endpoint, an MCP face, and an open-audio-stack-compatible JSON view cost little on top of the work
already planned and open an audience with no incumbent. Given the trajectory in
[notes.md](notes.md) — more plugins, more AI-mediated workflows — the programs choosing plugins may
matter more than the humans browsing them sooner than expected.

### 10. Federate rather than compete

The open-audio-stack registry (shared by StudioRack and OwlPlug) is the live open standard for plugin
distribution metadata. Publishing an OAS-compatible view means existing package managers can consume
this catalogue rather than duplicate it, and submitting the user's own plugins upstream costs one
pull request. A catalogue that other tools depend on is far harder to displace than one that competes
for the same eyeballs — and it is a better fit for the open-data posture than trying to out-KVR KVR.

### 11. Do not fight the incumbent on coverage

KVR has two decades of catalogue and a community. Matching its breadth by harvesting is both legally
risky (see below) and strategically pointless. Compete on the axes it cannot follow quickly: machine
readability, measured data, semantic search, open licence, and automated ingest that scales with the
flood.

---

## On the law and the licence

### 12. The database-right constraint is real and shapes the ingest design

EU and UK sui generis database right protects a curated catalogue against extraction of a substantial
part for 15 years, *even where the individual facts are unprotected* — which is precisely the shape
of a plugin catalogue. The UK's s.29A text-and-data-mining exception covers non-commercial research
only, so it does not cover a project with a paid tier. Bulk-harvesting an incumbent would also make
the resulting dataset unredistributable, which contradicts the open-data promise.

The chosen posture — permissive sources now, link-out-only crawling later if a review supports it —
is the right one, and the per-graph licence flag is what makes it enforceable rather than aspirational.

The review has been done ([resources.md §4](resources.md)). The short version: every Phase 1 source
is clear, most of them CC0; GitHub must be used through its API rather than scraped; and KVR is
excluded — it has no general terms-of-service page to rely on, it blocks non-browser clients at the
edge, and its product database is precisely the kind of curated compilation the sui generis right
was written for. The one rule worth internalising from the exercise: `robots.txt` permitting a path
is not a licence to re-publish what is on it.

### 13. CC0 — decided, and it pays off immediately

**The dataset licence is CC0.** Attribution requested, not required. The pro tier sells promotion,
freshness and service rather than access to facts, so a permissive licence costs the business model
nothing and buys the adoption that turns a catalogue into infrastructure. The rejected alternative
was ODbL, which keeps share-alike over derived databases but is friction for exactly the downstream
tools you most want to adopt this.

The decision paid for itself during the source review: **the open-audio-stack registry is itself
CC0-1.0**, as is webprofusion/OpenAudio. A CC0 registry feeding a CC0 dataset needs no compatibility
analysis at all — the largest external source is simply clear. Under ODbL that ingest would have been
fine too, but every downstream consumer would then have inherited a share-alike obligation, and the
federation argument in §10 would have been much harder to make.

Two consequences to hold onto:

- The pro tier must never quietly become "paid access to the data". The moment it does, the licence
  argument collapses and the open dumps become a liability rather than the distribution strategy.
- Authored prose is not fact, and is licensed **CC BY-SA** — the one thing CC0 does not fit. Because
  prose and facts already live in different graphs, the licence boundary is structural rather than a
  judgement made at publication time, which is the only reason a two-licence dataset is safe to
  operate.

### 14. Build ad compliance in now; it costs nothing at this stage

The DSA requires ads to be clearly identifiable with disclosure of who paid and the main ranking
parameters; ASA/CAP require disclosure that is immediate, prominent and understandable, and
specifically advise against "Sponsored" as a label because it reads ambiguously. Use "Ad" or
"Promoted", at the result itself. Document the promotion bound publicly. Because promotion records
are graph resources, an ad repository is a query rather than a feature.

The framing in [plan-draft.md](plan-draft.md) — "results filtered to the advantage of promoted
plugins" — should become "results *re-ranked* within a published bound". A promoted result must never
appear where it does not match the query, or the search stops being trusted, which is the only asset
the project has.

---

## On scope

### 15. Things to deliberately not build in year one

- A plugin installer or package manager. OwlPlug exists; integrate with it.
- Binary hosting. URLs and checksums only — it changes the legal and cost profile entirely.
- A DAW project-file analyser. Interesting, adjacent, and a whole product of its own.
- Preset and sample-library cataloguing. The OAS model covers presets and projects; adopt the schema
  so the door stays open, but do not populate it.
- Native macOS/Windows profiler runners, until Linux coverage is proven and someone is asking.
- Federation or ActivityPub for the social layer.

### 16. Revenue: do not let promoted placement be the only model

Promoted listings put revenue in direct tension with search quality, and search quality is the whole
asset. Alternatives that align rather than conflict:

- **Labelled sponsored listings** — the same thing, kept small and bounded.
- **API keys for bulk and commercial access.** The data is open; a supported, rate-limited,
  SLA-backed endpoint is a service, and services are sellable without restricting the data.
- **Profiler-as-a-service.** Developers pay to have their plugin validated and benchmarked across
  platforms before release, with the results published in the catalogue. This one sells the moat
  directly, and the buyer's interest is aligned with the catalogue's quality.
- **Dataset snapshots with support** for companies wanting a maintained feed.

Given the stated motivation — "a dribble of income to pay my hosting bills" — the API-key and
profiler routes reach that number with far less product surface than payments-plus-tiers-plus-ads,
and without compromising the search.

### 17. The window argument cuts toward narrow and fast

[notes.md](notes.md) argues the opportunity is time-limited. If that is right, the implication is not
to build more but to build less: Phases 0–2 produce a catalogue with measured data and a semantic
search over it, which is the defensible core and the thing the user actually wants. Accounts,
payments and promotion are ordinary work that can follow once the data exists — and if the landscape
shifts underneath the project, the data is what retains value.
