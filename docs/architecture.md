# Plugin Universe — System Architecture

Status: draft, 2026-09-06. Companion documents: [Implementation Plan](plan.md),
[Suggestions](suggestions.md), [Resources](resources.md).

## 1. Purpose and scope

Plugin Universe is an open database of Digital Audio Workstation plugins: an RDF-backed content
management system with semantic search over it.

It exists because the data does not exist in a usable form. The largest catalogue (KVR Audio) is a
web resource, not a dataset — it cannot be queried, joined, or consumed by a program. Meanwhile the
cost of producing a plugin has collapsed: a person with basic technical skills can now build one
with AI assistance, and the resulting flood of new plugins has no catalogue that scales to it. A
machine-readable catalogue that ingests automatically is the right shape of answer, and the window
for establishing one is open now (see [notes.md](notes.md)).

Three audiences, in priority order:

1. **Musicians and producers** searching for a plugin by what it *does*, not by its marketing copy.
2. **Plugin developers** wanting their work discovered, and wanting measured comparisons.
3. **Programs and agents** — DAWs, plugin managers, and LLM agents that need structured plugin
   knowledge. This audience is the one nobody currently serves.

Posture, from [plan-draft.md](plan-draft.md): open data, free public access with restrictions, paid
pro accounts. Three user tiers plus admin.

### What this system is not

Not a plugin *installer* (that is OwlPlug's job), not a store, and not a sample library. It links
out to where plugins are obtained; it does not host binaries.

## 2. Data model

The graph is layered. Each layer has a distinct source of authority, a distinct update cadence, and
its own vocabulary. Keeping them separate is what makes the whole thing maintainable: a harvester
may rewrite the discovery layer wholesale without touching curated judgements, and a curator may
edit behaviour without invalidating measurements.

```
┌─────────────────────────────────────────────────────────────┐
│  Social         foaf:  sioc:  skos:      people, wiki, tags │
├─────────────────────────────────────────────────────────────┤
│  Measurement    pu:    prov:  qudt-ish   profiler results   │
├─────────────────────────────────────────────────────────────┤
│  Packaging      doap:  schema:  spdx:    versions, files    │
├─────────────────────────────────────────────────────────────┤
│  Discovery      trn:   lv2:   units:     technical facts    │
├─────────────────────────────────────────────────────────────┤
│  Curated        trn:                     behavioural claims │
├─────────────────────────────────────────────────────────────┤
│  Identity       HTTP IRIs                                   │
└─────────────────────────────────────────────────────────────┘
```

### 2.0 Vocabulary decision

**Extend `trn:` (`http://purl.org/stuff/transmissions/`) rather than mint a new ontology.** It
already exists at `/home/danny/github/transmission/vocabs/profile.ttl`, it is already emitted by
50 downspout plugins and by valis, it has a working parser
(`/home/danny/github/transmission/src/rdf/PluginProfileRdf.js`) and a normative spec
(`/home/danny/github/transmission/docs/plugin-profiles.md`). Reuse established vocabularies wherever
one fits, and let the open-audio-stack manifest model inform the packaging layer.

Namespaces, registered in a single `NamespaceManager` (one file, no exceptions — see §9):

| Prefix | IRI | Used for |
|---|---|---|
| `trn:` | `http://purl.org/stuff/transmissions/` | plugin profiles, roles, signals, routing |
| `pu:` | `http://purl.org/stuff/plugin-universe/` | the minting base (§2.1) and terms with no home elsewhere: measurements, catalogue admin, promotion |
| `lv2:` | `http://lv2plug.in/ns/lv2core#` | ports and parameters |
| `units:` | `http://lv2plug.in/ns/extensions/units#` | parameter units |
| `atom:`, `midi:`, `time:` | `http://lv2plug.in/ns/ext/…` | port capabilities on LV2-sourced data |
| `doap:` | `http://usefulinc.com/ns/doap#` | projects, releases, maintainers |
| `foaf:` | `http://xmlns.com/foaf/0.1/` | people, vendors |
| `schema:` | `https://schema.org/` | SoftwareApplication, Offer, price — for search-engine visibility |
| `skos:` | `http://www.w3.org/2004/02/skos/core#` | tag scheme, category concepts |
| `dcterms:` | `http://purl.org/dc/terms/` | titles, dates, licence, source |
| `prov:` | `http://www.w3.org/ns/prov#` | provenance on every named graph |
| `spdx:` | `http://spdx.org/rdf/terms#` | licence identifiers, checksums |

**Alignment outward.** The nearest prior art in RDF is QMUL's AUFX-O (the Audio Effect Ontology,
which extends the Studio Ontology, itself built on the Music Ontology). Publish an alignment graph
mapping `trn:AudioEffect` and the role taxonomy to AUFX-O classes and `schema:SoftwareApplication`,
kept in a separate graph so it can be revised without touching instance data. Do not adopt AUFX-O as
the primary vocabulary: it models effect *application within a production session*, which is a
different problem from cataloguing effect *implementations*.

Implemented as `vocabs/alignment.ttl`, written into `<graph:alignment/vocabularies>`. Every
statement is `skos:closeMatch` rather than `owl:equivalentClass` or `owl:sameAs`, for two reasons
that are worth keeping: `trn:PluginProfile` is used here as the plugin but named as a description
of one, and asserting equivalence would propagate that ambiguity into other people's reasoners
rather than containing it; and AUFX-O models plugin formats as *classes* (`aufx:VST`, `aufx:LV2`)
where this catalogue models them as *individuals* of `trn:PluginFormat`, so there is no OWL-DL-safe
identity to assert without punning for a mapping file's convenience. AUFX-O is CC BY-SA 4.0; the
alignment graph is CC0 because it contains this project's assertions about their identifiers and
does not reproduce their ontology.

### 2.1 Identity

**IRIs are minted under `http://purl.org/stuff/plugin-universe/`.** The `purl.org/stuff/` space is
already under the project owner's control and is where `trn:` and `ragno:` live, so identity does not
wait on, and is not tied to, a registered domain. A PURL is a permanent identifier that redirects to
wherever the resource is currently served, which means the serving host can change — a new domain, a
move between machines, a change of hosting entirely — without breaking a single published IRI. For a
dataset intended to be cited and linked by other systems, that decoupling is the whole point.

The domain name is therefore a deployment concern only, not a prerequisite for minting.

Two minting rules:

- **Preserve upstream IRIs where they exist.** LV2 plugins already have canonical IRIs — flues uses
  `https://danja.github.io/flues/plugins/<name>`, which is exactly right. Record these with
  `owl:sameAs` and do not replace them.
- **Mint where they do not.** Use content-hash minting after
  `/home/danny/github/semem/src/utils/URIMinter.js` (12 lines):
  `http://purl.org/stuff/plugin-universe/plugin/<slug>-<sha256[0:8]>`, hashed over the stable
  identifying tuple (vendor + bundle name + VST class ID where available). This makes ingest
  idempotent for free — re-harvesting the same plugin produces the same IRI, so the update is a
  no-op rather than a duplicate.

Vendors, people, releases and measurements get IRIs by the same rules under
`.../vendor/`, `.../person/`, `.../release/`, `.../measurement/`.

Content negotiation happens at the serving host, which the PURL redirects to: an IRI resolves to
Turtle, JSON-LD, or the HTML profile page according to the request.

**Resolution is two hops, and this is deliberate.** purl.org holds a single partial redirect from
`/stuff/` to `https://hyperdata.it/xmlns/`, which is already in place and never needs to change
again; hyperdata.it, which the project owner administers, holds the rule that points
`/xmlns/plugin-universe/` at the current serving host. The redirect configuration is a piece of
deployment state that must be maintained alongside the site, so it lives in the repo as
`deploy/nginx/hyperdata-xmlns.conf` rather than only in someone's account.

The indirection is worth more than it costs. It means every decision that might change lives on a
server under our control, so moving the catalogue is an edit to a config file rather than a request
to a third-party admin interface — which matters, because purl.org's own editing has proved
unreliable. Both hops use 302 rather than 301: a permanent redirect is cached indefinitely by
browsers and crawlers, which would nail the IRIs to the current host and undo the decoupling that is
the entire reason for minting under a PURL.

The namespace root resolves to the ontology rather than to the site, because a consumer resolving
the bare `pu:` prefix is asking what the terms mean. `pu:category/<slug>` resolves to the SKOS
concept and the plugins in it, so a facet is a page and an IRI at once.

### 2.2 Curated behaviour layer

This is `trn:` used as designed: knowledge a human (or an agent) asserts about what a plugin is for,
which no scanner can extract. `trn:role` from the `trn:PluginRole` taxonomy (AudioEffect,
AudioInstrument, MidiGenerator, MidiProcessor, Controller, Utility, …), `trn:accepts` / `trn:produces`
over the signal-type individuals (`trn:Audio`, `trn:Midi`, `trn:ControlMidi`, `trn:DrumMidi`, …),
`trn:requires` (`trn:HostTransport`, `trn:Launchpad`), `trn:caution`, and the routing properties
`trn:recommendedBefore` / `trn:recommendedAfter` / `trn:companion` / `trn:feedsControls`.

The CC-mapping vocabulary (`trn:ccMapping` → blank node with `trn:ccNumber`, `trn:ccRole`,
`trn:targetParameter`, `trn:ccTriggerValue`) carries over unchanged.

Curated claims are **attributed**. Every one lands in a named graph identifying who asserted it, so
a vendor's own description and a user's contradicting note can coexist and be ranked differently.

Extensions this project adds to `trn:` (proposed upstream to the transmission repo, not forked):

- `trn:PluginRole` subclasses the catalogue needs and downspout does not have — synthesis method
  (subtractive, FM, granular, physical modelling, sampler), and effect families (dynamics, EQ,
  reverb, delay, distortion, modulation, pitch, spatial, analysis). These are better expressed as a
  `skos:ConceptScheme` than as OWL classes; see §2.6.
- `trn:format` — an individual per plugin format (`trn:VST3`, `trn:VST2`, `trn:CLAP`, `trn:AU`,
  `trn:LV2`, `trn:AAX`, `trn:LADSPA`, `trn:Standalone`). valis already improvises this as
  `val:formats "VST3"` string literals; make it typed.

### 2.3 Discovery layer

Technical facts extracted mechanically from a bundle or a manifest: `trn:bundleName`,
`trn:vstClassId`, `trn:vendor`, `trn:category`, `trn:modulePath`, `trn:discoverySource`, and the
parameter list.

**Parameters use `lv2:port`, not `trn:parameter`.** This follows valis, which states the rule
explicitly in its ontology header: port and control-range description reuses `lv2:` and `units:`
rather than inventing terms. So:

```turtle
:some-plugin lv2:port
  [ a lv2:InputPort, lv2:ControlPort ;
    lv2:symbol "cutoff" ; lv2:name "Cutoff" ;
    lv2:default 1000.0 ; lv2:minimum 20.0 ; lv2:maximum 20000.0 ;
    lv2:portProperty lv2:logarithmic ;
    units:unit units:hz ] .
```

The consequences are worth stating, because they are the whole reason for the choice: flues' 88 LV2
`.ttl` files map in with **no translation at all**; valis element definitions map in the same way;
enumerated parameters get `lv2:scalePoint` for free; and units become machine-comparable rather than
free-text.

This decision also resolves an existing defect. Downspout's profiles use both `trn:min`/`trn:max`
(17 occurrences) and `trn:minimum`/`trn:maximum` (13), with stray `trn:hasParameter` and `trn:MIDI`
typos. Rather than pick a winner, the normaliser maps all of them onto `lv2:minimum`/`lv2:maximum`
and the ad-hoc terms are retired.

Discovery is **authoritative for technical facts** — when a scan and a curated profile disagree
about a bundle name, the scan wins. This is transmission's existing rule and it is a good one.

### 2.4 Packaging and distribution layer

Modelled on the open-audio-stack registry manifest, which is the live open standard here (shared
between StudioRack and OwlPlug) and which any package manager already knows how to consume.

A `pu:Package` carries a slug (`organization/package-name`), a current version and a list of prior
versions, and for each version a set of files. Each file record has a download URL, SHA-256, size,
the formats it contains, the CPU architectures and the operating systems it supports. Licence uses
SPDX identifiers. Expressed in RDF as `doap:Project` + `doap:Version` + `doap:file`, with
`spdx:checksum` and `schema:SoftwareApplication` / `schema:Offer` mirrors for search-engine
visibility.

Two properties are worth carrying over verbatim from the OAS spec because they encode trust cheaply:
`verified` (the package slug's organisation matches the download URL's domain) and `attested`
(a GitHub artifact attestation exists). Both are computed at harvest time, never asserted by a
submitter.

**Binaries are never hosted.** Only URLs and checksums.

### 2.5 Measurement layer

Output of the profiler (§6), as timestamped observations rather than plugin properties — because
they are true of *a plugin version on a machine at a time*, not of the plugin:

```turtle
pu:measurement-abc123 a pu:Measurement ;
    pu:subject <http://purl.org/stuff/plugin-universe/plugin/foo-1a2b3c4d> ;
    pu:version "1.2.0" ;
    pu:tool "pluginval - 1.0.4" ;
    pu:metric pu:CpuLoad ; pu:value 0.043 ; pu:blockSize 512 ; pu:sampleRate 48000 ;
    pu:platform "linux-x64" ;
    prov:generatedAtTime "2026-09-06T12:00:00Z"^^xsd:dateTime ;
    prov:wasGeneratedBy :profiler-run-77 .
```

Metrics: validation verdict (pass / fail / crash, with the failing test), CPU load at a stated block
size and sample rate, reported latency, denormal behaviour, state save/restore integrity, and scan
time. Search exposes aggregates over these (median CPU across runs), never a single run.

### 2.6 Social and taxonomy layer

Registered users get a `foaf:Person` profile and a wiki page. Plugins get a wiki page, a comment
thread and a ranking. Comments and revisions are ordinary graph resources with `prov:` attribution,
which means moderation is a graph operation and history is free.

Tags and categories are a `skos:ConceptScheme`, not classes — categories in this domain are fuzzy,
overlapping and contested ("is a saturator a distortion or a dynamics processor?"), which is what
SKOS is for. `skos:broader` / `skos:related` / `skos:altLabel` let search expand a query across
synonyms without committing to a false taxonomy. Vendor-supplied categories, LV2 plugin classes and
user tags all map into the one scheme as `skos:closeMatch`.

## 3. Provenance and named graphs

**One named graph per source.** This is the single most important structural decision in the system,
and it is a deliberate correction of semem, which uses one graph for everything and therefore cannot
say where anything came from.

```
<graph:source/downspout>         harvested from the user's own repo
<graph:source/flues>             harvested LV2 bundles
<graph:source/open-audio-stack>  harvested from the OAS registry
<graph:vendor/{id}>              vendor-submitted, self-asserted
<graph:user/{id}>                user contributions and edits
<graph:profiler/{run}>           one graph per profiler run
<graph:curated>                  editorial assertions
<graph:alignment/categories>     the SKOS category concept scheme
<graph:alignment/vocabularies>   ontology mappings to AUFX-O, schema.org
<graph:system>                   accounts, tiers, promotion records
```

Each graph carries `prov:wasDerivedFrom`, `prov:generatedAtTime`, `dcterms:license` and a harvest
run identifier. Four things fall out of this that are otherwise expensive:

- **Licensing is enforceable per graph.** A public dump can be assembled by selecting the graphs
  whose licence permits redistribution, mechanically, without auditing individual triples.
- **Re-harvest is a graph swap.** DROP and reload one source without risking any other.
- **Conflicts are representable.** Two sources may disagree; the query layer decides precedence
  rather than the ingest layer destroying one of the claims.
- **Attribution is automatic**, which the open-data promise requires anyway.

Precedence when sources conflict, highest first: profiler measurement > discovery scan > vendor
submission > open registry > curated editorial > user contribution. Encoded as weights in
`config/preferences.js`, not scattered through queries.

## 4. Components

```
 SOURCES                    INGEST                      STORE            SERVE
┌──────────────┐      ┌───────────────────┐      ┌──────────────┐   ┌──────────────┐
│ own repos    │─────▶│ harvester         │      │              │   │ query svc    │
│ (downspout,  │      │  (per source)     │      │   Fuseki     │   │  hybrid      │
│  flues,      │      └─────────┬─────────┘      │   TDB2       │◀─▶│  retrieval   │
│  valis)      │                ▼                │              │   └──────┬───────┘
├──────────────┤      ┌───────────────────┐      │ named graph  │          │
│ open-audio-  │─────▶│ normaliser        │─────▶│  per source  │   ┌──────▼───────┐
│ stack        │      │  → graph model    │      └──────┬───────┘   │ HTTP API     │
├──────────────┤      └─────────┬─────────┘             │           │  (Express)   │
│ LV2 bundles  │─────▶          ▼                       ▼           └──┬────────┬──┘
├──────────────┤      ┌───────────────────┐      ┌──────────────┐     │        │
│ DOAP / GitHub│─────▶│ validator (SHACL) │      │ embedding    │  ┌──▼───┐ ┌──▼───┐
├──────────────┤      └───────────────────┘      │ pipeline     │  │ web  │ │ MCP  │
│ vendor submit│─────▶                           └──────┬───────┘  │  UI  │ │ face │
├──────────────┤                                        ▼          └──────┘ └──────┘
│ user contrib │─────▶                           ┌──────────────┐
├──────────────┤                                 │ vector index │
│ profiler ────┼────────────────────────────────▶│  (persisted) │
└──────────────┘                                 └──────────────┘
```

**Harvesters** — one per source, each a small module with a common interface: fetch, emit RDF into
its own named graph, record a run. Sources differ enormously in shape (a git checkout of `.ttl`
files, a JSON REST registry, a GitHub API sweep), so the interface is deliberately thin and the
normaliser does the unifying work.

**Normaliser** — maps source-specific shapes onto the graph model of §2. This is where the
`trn:min`/`trn:minimum` reconciliation lives, where LV2 classes map into the SKOS scheme, and where
IRIs are minted or preserved.

**Validator** — SHACL shapes over the normalised output, run before anything is written. The
transmission parser's existing rule ("every profile needs `rdfs:label` and one of `trn:bundleName`
or `trn:vstClassId`") becomes a shape rather than a thrown exception.

The shapes are `vocabs/shapes.ttl`, loaded by `src/store/ShapeValidator.js`. They run in two
places, and both are needed because they catch different things. `IngestPipeline` validates the
serialised triples before writing, so a defective harvester never reaches the store. `bin/validate.js`
validates each named graph *after* writing, which is the only way to see defects introduced by the
write itself — the first run of it found that batching an `INSERT DATA` by triple count was cutting
blank nodes in half, because a blank node label is scoped to one request. Constraints are chosen for
what would otherwise be invisible: a format IRI that is a typo creates a facet matching nothing; a
category outside the concept scheme dangles; a malformed SHA-256 is worse than none, because it
looks checkable.

**Store** — Apache Jena Fuseki, TDB2, assembler configuration adapted from
`/home/danny/github/semem/config/fuseki/assembler-tdb2.ttl`.

**Embedding pipeline** — builds one embedding per plugin from a composed text view (name, vendor,
description, role labels, tag labels, parameter names). Composing the text from the graph rather
than embedding a raw description is what makes semantic search work on plugins whose descriptions
are one line of marketing.

**Vector index** — see §5.

**Query service** — hybrid retrieval, §5.

**HTTP API** — Express, following the `BaseAPI` + `APIRegistry` scaffolding shape from
`/home/danny/github/semem/src/api/common/`. Public read endpoints unauthenticated and rate-limited;
write and pro endpoints behind API-key/session auth.

**MCP face** — optional but cheap, and it is the differentiator for the third audience. The
command-class + Zod-schema + registry pattern in
`/home/danny/github/semem/src/mcp/tools/verbs/` is directly copyable.

**Web UI** — search, plugin profile pages, wiki, blog. Server-rendered HTML with progressive
enhancement; the plugin pages must be crawlable and must carry `schema.org` JSON-LD.

## 5. Retrieval

Hybrid, with three signals fused under configurable weights — the shape of
`/home/danny/github/semem/src/ragno/search/DualSearch.js`, not its implementation (which is
entangled with graph algorithms this project does not need):

1. **Lexical/exact** — name, vendor, bundle name. A user searching "Pro-Q" wants Pro-Q first.
2. **Vector similarity** — ANN over the composed-text embeddings. This is what answers "warm
   analogue-modelled bus compressor".
3. **Structured filter** — SPARQL over facets: format, OS, architecture, licence, price, role, tag,
   measured CPU below a threshold. Applied as a filter, not a score.

Two rules that are corrections of observed semem behaviour, stated here so they are not
accidentally re-implemented:

- **The vector index is the hot path.** Candidate generation goes through the ANN index. It does not
  SELECT rows out of SPARQL and compute cosine similarity in JavaScript — that is what
  `semem/src/stores/modules/Search.js` does, and it does not scale past a few thousand rows.
- **The index is persisted to disk and updated incrementally.** It is not rebuilt at boot by reading
  every embedding out of the triple store. `/home/danny/github/semem/src/ragno/search/VectorIndex.js`
  has the `writeIndex`/`readIndex` pattern to follow.

Embeddings are stored **out of band**, keyed by plugin IRI, not as JSON string literals in RDF. The
graph records the model, dimension and generation time; the vectors live in the index. Storing
vectors as string literals bloats the store and forces a full parse on every load.

Index choice: FAISS (`faiss-node`) is the known quantity and is adequate at catalogue scale
(10⁴–10⁵ plugins). The interface is abstracted so it can be swapped for `sqlite-vec` or Qdrant
without touching the query service — the decision that matters is the abstraction, not the engine.

**Promotion is a re-rank, applied after retrieval and clearly bounded**, never a filter that hides
results. See §7.

## 6. Profiler subsystem

A minimal host that scans, validates and benchmarks a plugin, feeding the measurement layer. This is
the part of the system with no equivalent anywhere, and it is what makes the catalogue authoritative
rather than aggregated. It is scheduled early (Phase 2) for that reason.

Built on existing tools rather than a new host:

| Tool | Covers | Gives |
|---|---|---|
| `pluginval` (headless) | VST, VST3, AU, LV2, LADSPA | validation strictness levels, crash detection |
| `clap-validator` | CLAP | format conformance |
| `lv2bm` | LV2 | benchmark, JACK load percentage |
| `lilv` / `lv2info` | LV2 | metadata extraction without loading binaries |
| in-house runner | all | CPU load at fixed block size and sample rate, latency, denormal behaviour |

**Isolation is not optional.** A profiler runs untrusted third-party native code, so each run
happens in a disposable container with no network, a read-only mount of the plugin, a CPU and wall
clock limit, and a crash treated as a *result* rather than an error. The runner process is separate
from the API process; a segfault must never take down the site. This mirrors transmission's existing
choice of an "isolated VST3 inspector".

Results are normalised, tagged with the host machine's specification, and written into a per-run
named graph. Because the hardware varies, only relative comparisons within one run are published as
comparisons; absolute figures are always reported with their platform.

## 7. Identity, tiers and promotion

| Tier | Can |
|---|---|
| Public | search (promoted-weighted results), read wiki, read profiles, download open dumps |
| Registered | add plugins, edit wiki, comment, rank, own a FOAF profile |
| Pro | promote own plugins, unfiltered query page, on-topic advertising, blogging |
| Admin | moderate, merge duplicates, manage graphs, run harvests |

Accounts, tiers and entitlements live in `<graph:system>`, separate from content. Payment is handled
by an external provider; card data never touches this system, and the graph stores only a customer
reference and an entitlement with an expiry.

**Promotion and the law.** Paid placement must be labelled. The EU Digital Services Act requires
that ads be clearly identifiable, with disclosure of who paid and the main ranking parameters, and
(for larger platforms) a public ad repository; the UK ASA/CAP rules require disclosure that is
immediate, prominent and understandable, and specifically advise *against* "sponsored" as a label
because it is read ambiguously. Concretely:

- Promoted results carry a visible "Ad" or "Promoted" label at the result itself, not in a footnote.
- The ranking effect of promotion is documented on a public page and is bounded — a promoted result
  may be boosted but never inserted where it does not match the query.
- Registered and pro users get the unfiltered view; the boost is disclosed to everyone.
- Promotion records are graph resources, so an ad repository is a query, not a feature to build.

Building this to the standard from the start costs almost nothing; retrofitting it after a complaint
costs a great deal.

## 8. Data sources and ingest posture

**Permissive sources only, for now.** The EU/UK sui generis database right protects a curated
catalogue against extraction of a substantial part for 15 years *even where the individual facts are
unprotected* — which is precisely the shape of a plugin catalogue. The UK's s.29A text-and-data-
mining exception covers non-commercial research only, so it does not cover this project. Bulk
harvesting an incumbent catalogue would also poison the open-data promise, since the result could
not be redistributed.

**Two licences, one rule.** The factual catalogue is **CC0**; user-authored prose — wiki text,
reviews, comments — is **CC BY-SA**. The split follows the nature of the work rather than its
location: facts about a plugin are not authored, so nothing is given away by releasing them; a
review is authored, and its writer keeps attribution and share-alike. Because the two live in
different graphs, the boundary is structural rather than a matter of judgement at publication time.

That constrains ingest:
every graph that appears in a public dump must be CC0-compatible. Graphs from sources that are not
(MIT- or ISC-licensed data, whose notice must be preserved; anything non-redistributable) are still
harvested and still queryable, but carry a licence flag that excludes them from the CC0 dump or
attaches the required notice. This is exactly what the per-graph licence flag of §3 is for.

Phase 1 sources, all verified clean (terms reviewed 2026-09-06, findings in
[resources.md §4](resources.md)):

- The user's own repos — downspout (50 profiles), flues (37 LV2 bundles), valis. Owned outright.
- The open-audio-stack registry — **CC0-1.0**, machine-readable, purpose-built for this. The single
  best external source: a CC0 registry feeding a CC0 dataset needs no further analysis.
- webprofusion/OpenAudio — **CC0-1.0**, a curated list of open-source audio projects.
- LV2 bundles harvested from source repositories — the metadata is in the bundle by design; licence
  is per repository, recorded per graph at harvest time.
- DOAP files and GitHub repository metadata via the **GitHub API** — GitHub's acceptable use policies
  explicitly exclude API collection from their definition of scraping. HTML scraping of GitHub is
  not permitted and is not used. Maintainer names and emails are personal data: see below.
- Vendor submissions and user contributions — the long-term primary source, under contributor terms
  granting CC0 for factual contributions and CC BY-SA for authored prose.

### Operating principle

Obey the law, and be a good citizen of the ecosystem this catalogue documents — the second is the
stricter of the two and is what should settle the marginal cases. Concretely: use a sanctioned API
wherever one exists rather than scraping around it; treat a 403, a rate limit or a bot check as an
answer rather than an obstacle; identify the crawler honestly with a contact address; harvest at a
rate that costs the source nothing; credit every source whether or not its licence compels it; ask a
maintainer when the terms are unclear, which costs a day and settles the question permanently; and
contribute corrections back upstream rather than silently keeping a better copy. A catalogue of other
people's work exists on their goodwill. None of this is legally required, and all of it is cheaper
than the alternative.

**Personal data.** DOAP `foaf:maintainer` records and GitHub owner fields are personal data under
GDPR, and GitHub's policies separately prohibit using collected information to sell personal
information. Harvest the project, not the person: store a maintainer's public name and project role,
never harvested email addresses, and honour erasure requests by graph. Registered users' own profiles
are a different matter — those are given with consent.

**Designed for, not yet built:** third-party catalogues may later be indexed **link-out only** —
name and URL sufficient to point a user at the source, with no substantial re-publication of the
catalogue's content, and honouring robots.txt and terms of service. The harvester interface
accommodates a source whose graph is marked non-redistributable and is excluded from public dumps;
that per-graph licence flag (§3) is what makes the option available without re-architecting.

The annotated source list lives in [resources.md](resources.md).

## 9. Configuration and code conventions

Adopted from semem because they work, with its known defects corrected:

- **Layered config**: static defaults → `config/config.json` → `${ENV}` interpolation → environment
  overrides. Secrets only in `.env`.
- **No inline fallbacks.** If a value is not successfully retrieved from config, that is an error to
  fix, not a default to invent. Indeterminate behaviour is worse than a crash.
- **Tunables in one commented file**, `config/preferences.js`: retrieval weights, thresholds, source
  precedence, rate limits.
- **File-based SPARQL.** Queries live in `sparql/queries/<category>/*.sparql` with a shared
  `sparql/templates/prefixes.sparql`, loaded through one loader with one interpolation syntax. semem
  has two loaders with two syntaxes and a third set of templates elsewhere; pick one and keep it.
- **One namespace registry.** Every prefix is declared in a single `NamespaceManager` module and
  nowhere else. semem has three different IRIs in use for its own `semem:` prefix — the direct cost
  of not doing this.
- **ES modules, Node ≥ 20, Vitest.** Mocking only for trivial arithmetic-style checks; every other
  test runs against the live services in `config/config.json`.

## 10. What is reused from semem

Extracted into this repo — no dependency on semem, which carries far more than this project needs.

| semem source | Reused as |
|---|---|
| `src/services/sparql/SPARQLHelper.js` | INSERT/DELETE builder, literal escaping, authenticated POST |
| `src/stores/modules/SPARQLExecute.js` | query/update primitive, endpoint normalisation |
| `src/services/sparql/SPARQLQueryService.js` + `QueryCache.js` | file-based query loader (one loader only) |
| `sparql/` directory convention | `queries/`, `templates/prefixes.sparql`, `config/query-mappings.json` |
| `src/core/Vectors.js` | `VectorOperations` — cosine, validation, dimension standardisation; zero deps |
| `src/stores/modules/Vectors.js` | FAISS wrapper, index↔row mapping, serialise/deserialise |
| `src/ragno/search/VectorIndex.js` | the `writeIndex`/`readIndex` persistence pattern |
| `src/core/Embeddings.js`, `src/services/embeddings/EmbeddingsAPIBridge.js`, `src/connectors/EmbeddingConnectorFactory.js` | provider priority chain with fallback, rate limiting, retry |
| `src/utils/URIMinter.js` | content-hash URI minting → idempotent ingest |
| `src/Config.js` | layered config with `${ENV}` interpolation (drop the tbox auto-detection) |
| `src/ragno/core/NamespaceManager.js` | namespace registry, with plugin vocabulary swapped in |
| `config/preferences.js` | the "all tunables in one commented file" convention |
| `src/api/common/BaseAPI.js`, `APIRegistry.js`, `src/api/http/middleware/` | Express scaffolding |
| `src/mcp/tools/verbs/` + `VerbSchemas.js` | command-class + Zod + registry pattern, for the MCP face |
| `Dockerfile`, `docker-compose.yml`, `config/fuseki/assembler-tdb2.ttl` | app-alongside-Fuseki stack |

The Dockerfile matters more than it looks: it records the apt packages needed to build the native
vector dependencies (`python3 make g++ cmake libopenblas-dev libblas-dev liblapack-dev pkg-config`),
which is an hour saved.

Shape borrowed, code not: `src/ragno/search/DualSearch.js` (signal fusion with tunable weights) and
`src/stores/SPARQLStore.js`'s modular split (Execute / Vectors / Search / Cache / Store).

Explicitly not carried over: ZPT navigation, VSOM visualisation, memory decay, Wikidata/Wikipedia
enrichment, community detection, and the `docs/` and `data/` trees.

## 11. Deployment

Docker Compose, following semem's arrangement: an application container and a Fuseki container, with
a healthcheck gate so the app waits for the store. nginx terminates TLS, does gzip and rate limiting,
and reverse-proxies to the services. The profiler runner is a separate, more tightly confined
container, and is the only component allowed to execute third-party code.

Subdomain layout, following the existing `tensegrity.it` convention:

| Host | Serves |
|---|---|
| `<domain>` | web UI, plugin profile pages, wiki, blog |
| `api.<domain>` | REST API |
| `sparql.<domain>` | public read-only SPARQL endpoint (Phase 5), rate-limited |
| `mcp.<domain>` | MCP endpoint for agents |

Backups: TDB2 dumps on a schedule, plus the harvest runs are reproducible from source, so the
irreplaceable data is user contributions, curated editorial and measurements — those get their own
backup cadence.

## 12. Decisions made and questions still open

### Settled

- **Dataset licence: CC0** for the factual catalogue, **CC BY-SA** for user-authored prose. The pro
  tier sells promotion, freshness and service, not access to facts, so a permissive licence on the
  facts costs the business model nothing and buys the adoption that makes a catalogue into
  infrastructure. Every ingest decision follows from this — see §8.
- **IRI namespace: `http://purl.org/stuff/plugin-universe/`.** Already controlled, permanent,
  independent of hosting. Minting can begin immediately; the domain name is deployment only.
- **Source terms: reviewed.** The Phase 1 sources are verified compatible; the findings and the
  standing rules are in [resources.md §4](resources.md).

### Still open

- **Domain name.** `plugin-universe.com` and `plugin-universe.it` were both confirmed available on
  2026-09-06; `pluginuniverse.com` without the hyphen has been held since 2010 and serves a blank
  page. The recommendation is `plugin-universe.com` as canonical — a ccTLD carries a permanent
  geotargeting signal that cannot be overridden for a gTLD-style global audience — with the `.it`
  optionally registered and redirected. Needed for serving and as the PURL redirect target; blocks
  nothing in Phase 0 or Phase 1.
- **Hosting scale.** Fuseki plus a vector index plus the profiler on one Linux box is fine at launch;
  the profiler is the component most likely to need its own machine.
- **Upstreaming `trn:`.** The vocabulary extensions here should be proposed to the transmission repo
  rather than forked. Whether transmission wants to be a public vocabulary is the user's call.
- **KVR.** No general terms-of-service page exists to review, and the site blocks non-browser
  clients outright. Excluded from harvesting. If a relationship is ever wanted, it starts with an
  email to `contactus@kvraudio.com`, not with a crawler.
