# Plugin Universe — What the Plan Delivered

The completed half of [plan.md](plan.md). Phases 0, 1, 3 and 5 are done; the
parts of Phases 2 and 4 that are built are recorded here too, so what remains in
the plan is only what remains.

**This file is kept for the reasoning, not for the record.** A list of finished
work is not a list of work to do, and the temptation with a document like this is
to delete it once the tests pass. The decisions below still govern the code — the
licence flag set at write time, the blank-node batching rule, the review-then-
trust model, the entitlement checked when it is read — and each was expensive
enough to arrive at that re-deriving it would cost more than storing it.

Figures here were true when measured and are dated. `/health` is the live answer.

---

## Phase 0 — Foundations — **COMPLETE** (2026-09-06)

**Goal.** A repository that can store a triple, embed a string and run a test, with the vocabulary
settled. Nothing user-visible.

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
    see [sources.md §4](sources.md) — so this is implementation, not investigation.

**Exit criteria** — all met

- [x] Tests pass against a live local Fuseki — a graph is registered, read back, and its `prov:`
  metadata is present.
- [x] A string embeds, the vector is written to a persisted index, the process restarts, and the
  index loads from disk without touching the triple store.
- [x] `URIMinter` produces `http://purl.org/stuff/plugin-universe/plugin/<slug>-<hash>` and the same
  input twice produces the same IRI.
- [x] A graph carrying a non-CC0 licence flag is excluded from dump assembly.
- [x] Registering a graph without a licence is refused.
- [x] SHACL shapes reject a plugin with no `rdfs:label`. **Deferred to Phase 1 and delivered
  there**: the shapes had nothing to validate until a harvester produced plugin data, and writing
  them against an imagined shape rather than real harvested output would have been guesswork. The
  rule they encode (`rdfs:label` plus one of `trn:bundleName` / `trn:vstClassId`) was carried in
  `~/github/transmission/src/rdf/PluginProfileRdf.js` meanwhile.

**Risks, and how they landed**

- *Deciding the vocabulary by writing code instead of writing Turtle.* Settled `vocabs/` first; the
  code followed the ontology. Held — and the one place it later slipped, the category scheme as a
  JavaScript object literal, was moved back into `vocabs/categories.ttl` in the Phase 1 follow-on.
- *`faiss-node` native build friction.* Mitigated by taking semem's Dockerfile package list.
- *Treating the licence flag as metadata to fill in later.* Avoided. It is set by the harvester at
  write time, so the CC0 dump is a query rather than an audit.

---

## Phase 1 — Harvest and search — **COMPLETE** (2026-09-10)

**Goal.** A public, read-only search over a real corpus. The system does something useful.

Done: the harvester interface and the downspout, LV2, Open Audio Stack and
GitHub harvesters; the normaliser; per-source graphs with licence flags; the
serialiser onto `lv2:port`; the ingest pipeline with IRI-collision detection and
SHACL validation; the embedding pipeline; hybrid retrieval with an IDF-weighted
lexical signal; the read API with content negotiation and a server-rendered
search UI; the SHACL shapes deferred from Phase 0; the AUFX-O and schema.org
alignment graph.

Every exit criterion is met. The corpus is 754 plugins across 44 named graphs
rather than the three seed repositories this phase was scoped around, and the
risk it names — *"seed corpus too small and too uniform to prove semantic
search"* — was answered by the Open Audio Stack and GitHub harvesters, as the
mitigation said it would be.

Corpus at the time of writing: **645 plugins** — 50 downspout VST3, 36 flues LV2,
559 from the Open Audio Stack registry — in 41,777 triples across five graphs.
Every graph conforms to `vocabs/shapes.ttl`. Retrieval on the fixture corpus:
**MRR 0.893** hybrid against 0.844 vector-only; recall@1 87% against 80%. 186
tests pass, 48 against live Fuseki and Ollama. The GitHub sweep followed and took
the corpus to 754.

### Three things worth carrying forward

*`minSimilarity` is tied to the embedding model, not chosen on intuition.*
nomic-embed-text:v1.5 compresses cosine into roughly 0.45-0.70, so the original
0.35 floor excluded nothing and every query returned a full page of noise.
Re-measure it if the model changes.

*The registry answered a question the seed corpus could not.* "Warm analogue bus
compressor" was, until the registry landed, a demonstration of the noise floor —
the catalogue contained no compressor at all. It now returns five, and the store
test asserts that rather than asserting the absence.

*A blank node label is scoped to one `INSERT DATA`.* Batching a serialised graph
by triple count cut ports and package files in half at every boundary. Writes
are grouped by plugin; see MISTAKES.md. This is the class of defect the shapes
were written for and they found it on their first run.

**Deliverables**

1. Harvester interface (fetch → emit RDF into a named graph, with its licence flag → record a run),
   plus harvesters for:
   - **downspout** — 50 `profile.ttl` files from `/home/danny/github/downspout/plugins/*/`
   - **flues** — 88 LV2 `.ttl` files across 37 bundles under `/home/danny/github/flues/lv2/`
   - **valis** — `/home/danny/github/valis/profile.ttl` and the element ontology
   - **open-audio-stack registry** — the JSON registry endpoints; CC0-1.0, so its graph flows
     straight into the CC0 dump
   - **DOAP / GitHub** — repository metadata via the GitHub **API** only, never HTML scraping;
     project data, not maintainer email addresses (see [sources.md §4](sources.md))
2. Normaliser: source shapes → the graph model. Includes the `trn:min`/`trn:minimum` reconciliation
   onto `lv2:minimum`/`lv2:maximum`, the `trn:MIDI`/`trn:hasParameter` typo fixes, LV2 plugin classes
   into the SKOS scheme, and OAS manifest fields into the packaging layer.
3. Per-source named graphs with `prov:` metadata and a per-graph licence flag, plus DROP-and-reload
   re-harvest.
4. Embedding pipeline over the composed text view (name, vendor, description, role labels, tag
   labels, parameter names) — composed from the graph, not from a raw description field.
5. Hybrid query service: lexical + vector ANN + SPARQL facet filter, fused under weights from
   `config/preferences.js`. Vector index on the hot path; no cosine-in-JavaScript over SPARQL rows.
6. HTTP API (`node:http`) — search, plugin by IRI, facet enumeration, health. Public, rate-limited.
7. Web UI — search page with facets, plugin profile pages with `schema.org` JSON-LD, content
   negotiation on plugin IRIs returning Turtle / JSON-LD / HTML.
8. Alignment graph mapping `trn:` roles to AUFX-O and `schema:SoftwareApplication`.

**Exit criteria** — all met

- The full seed corpus (downspout + flues + valis + open-audio-stack) is in Fuseki, each in its own
  graph, each re-harvestable without disturbing the others.
- A natural-language query — "transport-synced MIDI modulator", "warm analogue bus compressor" —
  returns sensibly ranked results end to end through the UI.
- A facet filter (format = LV2, licence = MIT) composes correctly with a semantic query.
- A plugin IRI under `http://purl.org/stuff/plugin-universe/` dereferences, via the PURL redirect,
  to Turtle and to HTML.
- Re-running every harvester produces zero new IRIs (idempotence proven, not assumed).
- Every graph in the store carries a licence flag; assembling a CC0 dump is one query.

**Risks, and how they landed**

- *Seed corpus too small and too uniform to prove semantic search.* Real, and mitigated exactly as
  planned — the Open Audio Stack harvester was prioritised within the phase, and the corpus went
  from three repositories of one author's work to 754 plugins from 44 sources.
- *Composed-text embeddings underperform on one-line descriptions.* Measured rather than assumed;
  the fixture corpus in `tests/fixtures/` became the regression suite and
  `tests/store/retrieval-quality.test.js` reports against it.
- *Normaliser becomes the dumping ground.* Held: source quirks stayed in the harvesters.

### Phase 1 follow-on

Plugin images, first-seen dates and the paged front page; and the category scheme moved out of
JavaScript into `vocabs/categories.ttl` with definitions, synonyms and verified LV2 alignments.
It had been an object literal of parent links, which is why it had four predicates and no way to
say what a category meant.

---

## Phase 2, in part — the profiler's foundations

The rest of Phase 2 is in [plan.md](plan.md). What is built:

The sandbox, the lilv scanner, the pluginval host, the measurement model, per-run graphs, and the
readings surfaced on plugin pages and as a `measured=` filter.

**The sandbox is the piece the rest rests on:** `--network none`, read-only root
with a noexec tmpfs, all capabilities dropped, no-new-privileges, a pids limit,
memory and CPU bounds, an unprivileged user, and a wall-clock kill from outside
as well as in. Confinement is verified by test rather than asserted — the
network, the root filesystem and the plugin mount are each probed from inside.

**A crash is a result.** That took one correction to get right: a container's exit
code is its PID 1's, so a plugin taking the scanning tool down arrives as exit
139 with no signal field set, and reading that as an ordinary non-zero exit
loses the difference between "this plugin is malformed" and "this plugin
crashed". Both are now distinguished and recorded.

**First measured finding**, from 7 built flues bundles: **5 agree with their
harvested profile, 2 do not.** Flues Disyn reports 8 control ports where its
profile records 9; Flues Drumkit reports 18 against 43. The built bundles are
from a tagged v0.1.0 while the source tree has moved on, so this is likely
version skew rather than a defect — but that is exactly the question the
profiler exists to raise, and it could not be asked before.

**pluginval landed 2026-09-11**, built from a pinned commit into the profiler
image rather than installed: Tracktion's tagged binaries predate the CMake build
this uses, and a tool whose version drifted between runs would make those runs
incomparable. First sweep over 51 built downspout VST3s: 45 pass, 1 segfaults
under the `Automation` test, 4 turn out to have no binary in the bundle. It also
produced the first `pu:LatencySamples` values — defined in Phase 2 and, until a
host actually instantiated a plugin and asked, produced by nothing.

**The image's base is part of the measurement.** On bookworm not one downspout
VST3 loaded — glibc 2.36 against the 2.38 they were built for — and pluginval
reported them exactly as it reports a broken plugin. `PluginvalScanner` asks the
dynamic loader before it asks pluginval, so the next such mismatch is recorded
as a limitation of the profiler rather than a defect in the plugin.

`bin/backup.js --scope measurements` carries a run from the machine that made it to the one that
serves — profiling competes with serving, and a reading carries its platform precisely so it need
not be taken where it is served.

---

## Phase 3 — People and pages — **COMPLETE** (2026-09-11)

**Goal.** The catalogue becomes a community resource rather than a database with
a search box.

*Built, and live.* Sign-in, corrections, submissions, the moderation queue,
trust promotion, rate limiting, the contributions page, the wiki with revisions
and conflict detection, and image upload. One exit criterion is not met and is
tracked in [../TODO.md](../TODO.md): an admin cannot yet merge two duplicate
plugin entries. Nothing in the corpus overlaps, so it has not bitten.

What follows is the plan as written on 2026-09-07, kept because the decisions
and their reasoning are the valuable part and they still govern the code.

This was the first phase with **writes**. Everything up to it is a read-only
projection of harvested data that can be rebuilt from source at any time; from
here the store holds things that cannot be recreated. That changes the risk
profile more than it changes the size of the work.

### Decisions taken

Three, settled before planning because each one changes what gets built.

**Sign-in is GitHub OAuth, and only that.** The project never stores a
credential — no password hashing, no reset tokens, no email verification, no
breach plan. The audience is already there: LV2 and plugin development live on
GitHub, and the GitHub harvester already reads it. The OAuth App requests **no
scopes**, which still returns a public login, id and avatar from `/user`, and
deliberately not `user:email` — the standing rule is that an email address is
not catalogue data, and the surest way to keep it is to be unable to read one.
The cost is excluding anyone without a GitHub account, which is accepted.

**Contributions are reviewed first, then trusted.** A new contributor's first
edits sit in a queue; past a threshold they go live immediately, with revert as
the escape hatch. Moderation work is then bounded and shrinks as the community
grows, rather than arriving in full on day one when there is no community to
share it.

**Scope is accounts, corrections and the wiki.** Comments, rankings and vendor
submissions moved to Phase 3b. This still satisfied the stated exit criteria and
still exercised the CC0 / CC BY-SA split properly, which is the part worth
getting right while the volume is small.

### Consequences worth stating

*No new datastore, and no new memory.* Sessions are a signed cookie —
`HttpOnly`, `Secure`, `SameSite=Lax`, HMAC over the account id and an issue
time, with the secret in `.env`. There is no session table to keep, and
suspension is checked by looking the account up at request time, which is a
query the store answers anyway. On a 4 GB host already running Fuseki, Ollama
and the app, adding neither a session store nor a relational database is not a
minor consideration.

*The API stays on `node:http`.* [architecture.md §4](architecture.md) said a
framework would earn its place when writes arrived. With OAuth-only auth and
stateless cookies the write surface turned out to be a handful of form-encoded
POSTs, and a framework's dependency tree is a larger cost than the routing it
saves. **Since written:** file uploads arrived and the reconsideration went the
same way — magic-byte sniffing and content-addressed storage were less code than
a multipart dependency's configuration.

### Deliverables

1. **Accounts.** GitHub OAuth login and callback, signed-cookie sessions, and
   the tier model (public / registered / pro / admin) plus a trust level, in
   `<graph:system>`. Sign-out invalidates by expiry; suspension by account
   state.
2. **A licence flag for personal data.** `<graph:system>` holds people, so it
   gets a `personal-data` licence key with `redistributable: false`. The public
   dump then excludes accounts by the same mechanism that excludes a
   non-redistributable source — structurally, not by remembering to.
3. **`foaf:Person` profiles**, with their own pages, carrying a public login and
   a display name and nothing more.
4. **Corrections.** A typed, structured proposal to change a fact: subject,
   predicate, proposed value, rationale. Validated against the SHACL shapes
   *before* it is written, using the validator the ingest path already has.
   Accepted corrections land in the contributor's CC0 graph and take effect
   through the existing source-precedence rules rather than by overwriting
   anything.
5. **Plugin wiki pages.** Revisions as graph resources with `prov:wasAttributedTo`
   and `prov:generatedAtTime`, so history, diff and rollback are queries rather
   than features. Stored as text and rendered as a restricted Markdown subset —
   **never raw HTML**, and the existing escaping stays in the path.
6. **The licence boundary, enforced by the store.** Each contributor gets two
   graphs, not one: `graph:user/<id>-facts` under CC0 and
   `graph:user/<id>-prose` under CC BY-SA. Which graph a write lands in is
   decided by what kind of write it is, so the boundary is a property of the
   store rather than a judgement made at publication time. (`GraphRegistry.graphIri`
   forbids a slash in an id, hence the suffix form.)
7. **Moderation.** A queue of pending contributions; approve, reject, revert;
   suspend an account; merge duplicate plugins without losing either source's
   provenance. — *the merge is the one piece not built.*
8. **Write-path safety**, entirely new ground for this codebase: CSRF
   tokens on every form, per-account and per-IP rate limits, SHACL validation
   before write, and a hard rule that user input never reaches the store as
   anything but a literal.

### Exit criteria

- [x] A registered user can add a plugin that does not exist yet, edit its wiki
  page, and see the contribution attributed to their own graph.
- [x] A first-time contributor's edit is queued; the same user's edit after the
  trust threshold is live immediately.
- [x] The public CC0 dump contains the user's factual contribution and neither their
  prose nor their account — checked by query, not by inspection.
- [ ] An admin can merge two duplicate plugin entries without losing either source's
  provenance. **Not built** — in [../TODO.md](../TODO.md).
- [x] A reverted wiki edit leaves an auditable history.
- [x] Dropping a contributor's graphs removes their contributions and their account.

### Risks, and how they landed

- *Spam arrives the day it opens.* Rate limits, the review queue for first
  contributions, and per-graph revert as the escape hatch. Untested against real
  volume — the site has not been announced.
- *Duplicate plugins.* Content-hash minting helps only where the identifying
  tuple matches, and the catalogue already has a known case of the same plugin
  reachable from two sources under different keys. The deduplication tool is the
  unbuilt part of deliverable 7.
- *Erasure is not as clean as "drop the graph".* Dropping a contributor's graphs
  removes their contributions and their attribution, and that is the right
  mechanism. But a CC0 grant already made is irrevocable, and anything already
  published in a dump is gone from our control. The contributor terms say so
  plainly rather than implying a right to unpublish. **Backups add ninety days
  to this**, which [backups.md](backups.md) states and the terms do not yet.
- *The first write endpoint is the first attack surface.* Everything before was
  read-only and CORS-open because none of it could be changed.
- *Moderation is still unbounded if the trust threshold is wrong.* It is a
  number in `config/preferences.js`; expect to change it with evidence.

### Phase 3b — the rest of the site

Comment threads, rankings and the vendor submission flow were deferred out of Phase 3 as additive.
Most of what followed was built over 2026-09-11 to 13. What is left is in [../TODO.md](../TODO.md).

**The profile form.** `/submit` grew from seven fields to twelve — `trn:role`, `trn:accepts`,
`trn:produces`, `trn:requires` and `trn:caution` alongside name, homepage, vendor, description,
formats, category and licence — and `/about/profiles` explains what each is for. One form, not two,
so `SUBMITTABLE`, the shapes and the serialiser cannot drift apart. The choices are read from
`vocabs/trn-profile.ttl` at startup by `src/rdf/ProfileVocabulary.js` — 11 roles, 8 signal types, 2
host requirements — rather than copied into JavaScript, the same arrangement `CategoryScheme` has.
A term added to the vocabulary appears in the form with no code change, and the form cannot offer
something `vocabs/shapes.ttl` would then refuse.

**And the fields could be read back.** `trn:accepts`, `trn:produces` and `trn:requires` had been
harvested since Phase 0 into 181, 189 and 57 plugins and selected by no query, so they were on no
page and in no result — while a form and a prose page recommended them. They are now on the plugin
page, in the JSON, in `/facets`, in the MCP tool, and `?accepts=` / `?produces=` filter. In
MISTAKES.md; the facet-to-filter binding is now a table rather than a chain of `if`s.

**Ports and parameters arrive by URL, not by form.** `/admin` has a *Read a bundle* panel: a
moderator pastes a plugin slug and the URL of an LV2 plugin's `.ttl`, and the ports, their ranges,
units and scale points, the signal types and any host requirement are read and written, attributed,
into that moderator's CC0 graph. One fetch, through `PageReader`'s defences, following no
redirect — [sources.md](sources.md) §4 rule 8, the same bound as the submission form's URL box.
Additive only: it writes what the plugin has not got and reports what it left alone.

*The thing that would have made it useless.* A bundle is two files. `manifest.ttl` says
`a lv2:Plugin` and points at the real description with `rdfs:seeAlso`; that file carries the ports
and types the plugin by *subclass* — `lv2:AudioPlugin` — never as the bare class.
`readBundleDataset` looked for `lv2:Plugin`, which is right when the harvester has read a whole
bundle from disk, and finds nothing at all in the file that has the data. Following the `seeAlso`
would be a second fetch, which rule 8 forbids, so `typeAsPlugins` supplies the missing assertion
locally: a subject with `lv2:port` is a plugin. Found by running it against a real bundle rather
than a fixture; `tests/fixtures/lv2/` now has that shape.

**`/feedback`, and the 405 it uncovered.** A signed-in account can write to the moderators; the
message is an RDF record like a correction, queued, and shown on `/admin` where the only thing that
can be done to it is mark it read. It is stored **as personal data, not as a contribution** — see
`src/contrib/Feedback.js` for why that distinction is the whole design: everything else a person
writes here lands in a graph with a publication licence on it, and nobody writing in to say the
search is confusing agreed to CC0 or CC BY-SA.

Building it found that the read-only method guard, which runs before any route module, did not list
the billing paths. **Every payment POST had been answered 405.** In MISTAKES.md; the guard is now
one list and `tests/store/server-starts.test.js` POSTs to all ten write routes against a running
server.

**`/health` compares the two numbers it prints.** *2026-09-13:* it reported `plugins` and `index`
side by side and asserted nothing about them, so a plugin that reached the catalogue and not the
vector index — which `takeUpNewPlugins` allows deliberately, because refusing a whole submission
over a failed embedding would be worse — was findable by name, invisible to semantic search, and
reported nowhere but a log line. It now carries `unindexed` and a `problems` array, and `status` is
`degraded` rather than `ok` when that array is not empty. The decision is a pure function,
`healthProblems()`, precisely because the interesting case is the one a healthy instance cannot
demonstrate.

**Social metadata, on every page.** Open Graph and Twitter Card tags, plus `rel=canonical`. There
were none at all, so a link posted anywhere was a bare URL. A plugin page uses its own picture where
**this site stores it** — a hotlinked screenshot is somebody else's server and may refuse a
scraper — and otherwise a 1200×630 card at `/og-image.png`. `og:url` and `rel=canonical` are given
only where the address is stable: the front page, a plugin, a vendor, a category, the prose pages,
and page one of `/plugins`. **Not a search**, because a query is not a document, and not page four
of a listing, because saying so would ask a crawler to drop it.

**A throbber on submit buttons.** `templates/site.js` is the site's first and only script: one
delegated listener that marks the pressed button `aria-busy` and refuses a second submit. Served as
a deferred external file rather than inlined, so a CSP can be added later without an exception. Two
things it deliberately does not do. It **does not disable the button** — seven templates dispatch on
the pressed button's own `name`/`value`, and a disabled button is not submitted, so the usual
double-post guard would have dropped the field that says which action it is. And it **is not
required by anything**: every form works with the script blocked, which
`tests/api/responsive.test.js` asserts rather than assumes.

**The navigation, and `/about` as an index.** The footer is five links in a chosen order — About,
Services, Promotions, Plugin profiles, Contact — Vendors is the first group in the right-hand
column, and `/about` is the index for everything else the site says about itself. That last part is
what makes the first possible: `tests/api/linked-routes.test.js` requires every route to have
something linking to it, so the pages dropped from the footer had to land somewhere real rather
than just disappear. The contributor terms are the exception — they sit in the licence line beneath
the list, because they must be one click away from every page.

**Smaller, and each with a reason.** Licence identifiers normalised, 23 spellings to 19 licences,
enumerated in `vocabs/shapes.ttl` and fixed in place by `bin/renormalise-licences.js`. Every SPARQL
query moved into a file, with `tests/rdf/no-inline-sparql.test.js` keeping it so. Vendor pages at
`/vendor/<slug>` and `/vendors`. The accessibility pass over twelve page types, and the tab order
fixed so results come before the panel that refines them. Three columns on a wide screen. Image
upload, sniffed by magic bytes and stored content-addressed — which needed `staticFile` to stop
reading with `'utf8'`, text-only since robots.txt was the only static file. A borrowed favicon.
`/leggere-prima`, which taught the layout a `lang` attribute: it was hardcoded `lang="en"`, and a
screen reader given Italian prose in an English document reads it with English phonetics.

**`trn:` terms are written for a reader** — "Control MIDI" and "MIDI Generator" rather than
`ControlMidi` and `MidiGenerator`, from `rdfs:label`. The label is the link text and the local name
is still the link target, so the URL keeps resolving, and the lookup comes from the same filled
field table `/submit` is built from, so the form and the page cannot come to spell a term
differently. A plugin page's identifiers all resolve — formats and roles to the filtered search,
categories to their concept pages, the licence to SPDX where it really is an SPDX identifier, the
plugin's own IRI through its PURL, and **the author's canonical IRI**, preserved with `owl:sameAs`
on 86 plugins and shown nowhere until then. Found while testing the escaping: the JSON-LD block at
the foot of every plugin page could be closed by any value containing `</script>` — latent, never
exploited, now escaped and tested.

---

## Phase 4, in part — promotion and payments

The rest of Phase 4 is in [plan.md](plan.md). What is built:

### Promotion, and its compliance — deliverables 3 and 4

*Built and live, ahead of the money.* A moderator can promote a plugin from `/admin`; placements
are `pu:Promotion` resources that run a year and lapse by their own dates, read at query time so a
lapsed one stops applying whether or not any job ran. The re-rank is bounded, the label says
**Promoted** and links to `/about/promotion`, which publishes the numbers that are actually
applied — bound to the code by `tests/search/promotion.test.js`.

Building the compliance first was the right order and cost little: the shape of the thing was
decided while it was still cheap to change.

One decision differs from what the phase assumed: **no rank is reserved**, so a placement may reach
first. The bound that does the work is the relevance floor — a placement never appears in a search
it does not match. A placement is *permitted* first place rather than given it: the boost is a
1.25× multiplier, so a much better match still wins.

### Payments — deliverable 1, first increment

*2026-09-12:* a signed-in account can buy a promoted listing. `src/billing/Billing.js` configures
the client and verifies webhooks, `src/billing/routes.js` has the routes, and
`Promotions.grantPaid()` is a second door into promotion authorised by a payment rather than by a
moderator. Hosted Checkout, so no card detail reaches this server and no client-side framework is
needed.

Pricing is set in the sandbox: **€10 one-time** for one plugin for a year, **€99/year** for Pro,
which promotes as many of a vendor's plugins as they like. Both are found by Stripe lookup key
rather than a price id, so changing either is a dashboard action.

**The Pro tier is built too.** `/billing/subscribe` and `/billing/portal`, the account page at
`/account`, and the entitlement.

Two things settled in the building that are worth keeping.

**A paid tier is an entitlement with an expiry, checked when it is read.** `effectiveTier()` grants
nothing to a tier whose `pu:tierEndsAt` has passed, and a tier with *no* expiry counts as no tier.
So a renewal extends, and silence lapses. The alternative — grant on purchase, revoke on a
cancellation message — fails in the expensive direction: a lost delivery leaves somebody paid-up
for ever with nothing to notice. A placement included in a subscription takes the tier's own end
date, so cancellation needs no handling at all.

**"Your plugins" needed something to stand on.** `trn:vendor` is a bare string with no link to an
account, so without a check the entitlement would mean "promote anything". A **moderator confirms**
which vendor an account speaks for (`pu:claimsVendor`, the folded key), and the route requires all
three of: Pro, currently effective, and this plugin is that vendor's. Confirming is on `/admin`.

**Nothing has yet completed a real checkout**, and the reason is in MISTAKES.md: the read-only
method guard in `src/api/server.js` did not list the billing paths, so every payment POST answered
**405** and no handler ever ran. Fixed, and `tests/store/server-starts.test.js` now POSTs to every
write route against a running server.

### Vendor identity

*2026-09-13:* `bin/mint-vendors.js` derives a `pu:Vendor` per vendor, with `foaf:name`, a
`pu:vendorKey` and a `skos:altLabel` for every other spelling met, and links each plugin with
`foaf:maker`. 363 vendors over 645 plugins when first run here; **376 on the live site**. They are
in the curated `vendors` graph, registered CC0 — so they *qualify* for the dump. `trn:vendor` still
holds exactly what each source said; the identity is asserted beside it, never over it.

**Live on the serving host and published since 2026-09-13**: 376 `pu:Vendor` resources and 756
`foaf:maker` links on the public endpoint, with `/vendor/<name>-<hash>` dereferencing.

**This sentence was wrong twice before it was right, in the two ways available.** It first said
"CC0 and in the dump" — the species of claim MISTAKES.md already records against this very feature.
Corrected to "qualifies, but publish has not run", which sounded right, was checkable, and was
checked against the wrong machine: a publish then moved 753 plugins to 756 and left the vendors at
zero. **Derived on that host, qualifying for publication, and actually published are three facts**,
and the first — the one never asked — was the false one. `bin/mint-vendors.js` had only ever run on
the development machine.

Two things kept it invisible for as long as it was. The vendor pages fold `trn:vendor` strings in
JavaScript rather than reading the graph, so every one answered 200 throughout; and `foaf:maker` is
selected by a single `OPTIONAL` in `plugin/text-view.sparql`, which degrades silently by
construction, while `pu:Vendor` and `pu:vendorKey` are selected by nothing. **A published layer that
no page needs is a layer whose absence costs nothing** — which is why wiring the vendor pages to
read it is in [../TODO.md](../TODO.md) rather than being called finished here.

The guard is `tests/live/site.test.js`, *the published copy is the site's data*. It was written
before any of this was understood and is what falsified the diagnosis, by staying red through a
successful publish.

**Derived rather than harvested**, which is a deliberate departure from the original plan. A
harvester sees one source's graph and a vendor's identity is a fold *across* sources — "danja"
appears in four of them — so minting at harvest time would produce one vendor resource per source
per name, which is the problem rather than the fix.

Three of the four defects this closed: a rename keeps the IRI (it is minted from the fold, not from
the display name, which a test caught when the first version was not); there is a resource to
attach a description, a logo or an owning account to; and the minted IRI dereferences —
`/vendor/danja-ba40c9e0` and `/vendor/danja` reach the same page. The fourth — that "danja" and
"Danny Ayers" are one person and no string will ever say so — is in [../TODO.md](../TODO.md).

This is the entry TODO.md once described as a prose claim that was wrong: it said `pu:vendor` IRIs
"are already minted, so identity exists" when there were none, and a paid feature was about to be
built on that sentence. See MISTAKES.md.

---

## Phase 5 — Open data — **COMPLETE** except the conditional crawler

**Goal.** Deliver the open-data promise, and make the catalogue something other systems build on.

Live: the dumps (`bin/dump.js`), the public SPARQL endpoint on its own published dataset, the Open
Audio Stack registry view at `/registry/plugins/index.json`, the MCP face, and `/services`
describing all of it.

**Deliverables**

1. [x] Public read-only SPARQL endpoint at `sparql.<domain>`, rate-limited, with query timeouts.
2. [x] Dataset dumps under **CC0**, assembled by selecting only CC0-compatible graphs — mechanical,
   because the flag was set at harvest time in Phase 1. CC BY-SA prose graphs are published as a
   separate, separately-licensed dump rather than mixed in. Both carry a VoID description, and the
   preserved notices of any MIT/ISC-sourced graphs included.
3. [x] MCP endpoint at `mcp.<domain>` for agent access, using the command + Zod-schema + registry
   pattern.
4. [x] An open-audio-stack-compatible JSON view, so OwlPlug/StudioRack tooling can consume this
   catalogue as a registry.
5. [ ] Contribution back upstream: the user's own plugins submitted to the open-audio-stack
   registry; the `trn:` extensions proposed to the transmission repo. **Outstanding** — in
   [plan.md](plan.md) and [../TODO.md](../TODO.md).
6. [ ] *Conditional* — link-out-only indexing of third-party catalogues. **Outstanding and still
   conditional** — in [plan.md](plan.md).

**Exit criteria**

- [x] A third party can reconstruct the redistributable catalogue from a published dump alone.
- [x] An agent can answer a plugin question through the MCP endpoint without scraping the site.
- [x] A package manager can point at the OAS-compatible view and resolve packages from it —
  *served, and nobody has been told it exists.* That last step is in
  [HUMANS.md](../HUMANS.md).

**Risks, and how they landed**

- *Open dumps undercut the pro tier.* They should not — the pro tier sells promotion, freshness and
  service, not access to facts. This was the reasoning behind choosing CC0; it holds only as long as
  the pro tier is not quietly redefined as paid access to data. **Still the live constraint on
  Phase 4's pricing**, which is why the vendor-profile design says claiming should be free.
- *Public SPARQL endpoints are trivially abused.* Timeouts, result caps, rate limits, and a
  materialised dump as the recommended path for bulk consumers. **And one incident**: an old
  `sparql.` block served `graph:system/accounts` to the internet. `npm run test:live` now checks
  five plausible SPARQL paths unconditionally, because "not deployed" is exactly the state in which
  nobody is looking.

---

## Deployment, which no phase owned

`bin/deploy.sh` with a build stamp on `/health`, `npm run test:live`, `./deploy/nginx/check.sh`,
`robots.txt`, and the HTML moved out of code into `templates/`. DNS, certificates, nginx, the PURL
chain. Backups nightly on the server and pulled here nightly, with a restore rehearsed before
there was anything irreplaceable to lose — which is the right order.

`server.js`, `render.js` and `SearchService.js` were broken up when they reached 1247, 1189 and 744
lines: 298, 238 and 545 after, with the route groups and page kinds in modules of their own. No
caller changed, because each old module re-exports its whole surface. Behaviour is unchanged but
for one thing that could not survive being looked at: the `/admin` page was rendered by four nearly
identical blocks and one of them had lost the vendor-claims panel.
