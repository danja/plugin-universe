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

- `src/harvest/` — `Harvester` (the interface), `DownspoutHarvester`, `Lv2Harvester`,
  `OpenAudioStackHarvester`, `GitHubHarvester` + `GitHubClient` + `GitHubDiscovery`,
  `Lv2Bundle` (bundle reading, shared by the disk and API paths), `HttpSource` (polite
  fetching), `Normaliser` (where vocabulary defects are fixed), `PluginSerialiser`,
  `IngestPipeline`
- `src/search/` — `SearchService` (hybrid retrieval), `LexicalIndex` (IDF-weighted lexical signal)
- `src/api/` — `server.js` (routing, read-only JSON + HTML, content negotiation), `render.js`
  (page assembly), `Templates.js` (the template loader), `serialise.js` (Turtle and JSON-LD),
  `pages.js` (the prose whitelist), `body.js`
- `templates/` — every page's HTML, plus `site.css`. Nothing else contains markup.
- `src/wiki/` — `Wiki.js` (revisions), `markdown.js` (untrusted Markdown), `render.js`
- `src/mcp/` — `server.js` (stateless Streamable HTTP), `tools.js` (the catalogue as tools)
- `bin/` — `ingest.js`, `discover.js`, `search.js`, `serve.js`, `validate.js`
- `src/rdf/` — `NamespaceManager` (the single prefix registry), `URIMinter`
- `src/store/` — `SPARQLClient`, `SPARQLHelper` (term formatting), `QueryService`
  (file-based query loading), `GraphRegistry` (named graphs, provenance, licence flags),
  `ShapeValidator` (SHACL, over `vocabs/shapes.ttl`)
- `src/profiler/` — `Sandbox` (the container the untrusted code runs in), `Lv2Scanner`
  (lilv: what a bundle declares), `PluginvalScanner` (pluginval: what the plugin does when
  hosted), `ProfilerRun` (matching a reading to a catalogue plugin, and writing the run's
  graph), `MeasurementSerialiser`
- `src/vectors/` — `VectorOperations`, `VectorIndex` (persisted FAISS index)
- `src/embeddings/` — `EmbeddingService` and the composed text view
- `vocabs/` — the ontologies, including `categories.ttl` (the SKOS category scheme, loaded by
  `src/rdf/CategoryScheme.js`); `sparql/queries/` — every query, by name
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
- **A harvester declares its licence and provenance, and never guesses either.** Adding a source
  means adding a row to the terms review in `docs/resources.md` §4 first.
- **One repository, one graph, when harvesting GitHub.** A repository's licence is a property of
  that repository, and the licence flag decides what reaches the public dump — a shared "github"
  graph would mean one flag for a hundred different answers. Repositories come from a reviewed
  candidate file written by `bin/discover.js`, never from a live search at ingest time, and a
  repository with no recognised licence is listed but not harvested.
- **Minting must be unique as well as idempotent.** Identity is bundle name and class ID where the
  format provides them, and the plugin's own canonical IRI where it does not (LV2). `IngestPipeline`
  refuses to write when two records mint the same IRI — a silent merge of two plugins is expensive
  to discover later.
- **Skip build trees when harvesting a repository.** A repo typically holds the same bundle in
  source, build, staging and release copies.
- **Never split a subject's triples across two `INSERT DATA` requests.** A blank node label is
  scoped to one request, so batching a serialised graph by triple count cuts ports and package
  files in half. `IngestPipeline` batches by group — one plugin, one concept — and writes an
  oversized group whole.
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

## The recurring failure in this project

Five times now, a change has been made in one file while a **second file that
had to change with it** was left alone. Nothing connected them, so nothing
complained, and each was found in production or by accident:

| Change | The file left behind | Symptom |
|---|---|---|
| Added licences to `LICENCES` | the `sh:in` list in `vocabs/shapes.ttl` | 136 SHACL violations after a GitHub sweep |
| Served pages from `docs/` | `.dockerignore`, which excluded `docs` | 500 on three routes, everything else fine |
| Added a test directory | the `include` list in `vitest.core.config.js` | tests written, never run — twice |
| Set the crawler's user-agent URL | the route it promises | a contact page that 404s, already advertised to sources |
| Added the `/moderation` route | the account bar that should link to it | a queue reachable only by typing the URL |
| Added `/plugin/<slug>/image` | the plugin page, which never showed the form | an upload route nothing on the site could reach |
| Added terms to `vocabs/plugin-universe.ttl` | the store's own copy of it, reloaded only by a full harvest | three metrics on plugin pages as bare local names, no label or unit |
| Saved a test fixture as `*.log` | `.gitignore`, which excludes `*.log` | a test that passes here and fails on a fresh clone |
| Stored uploaded images under `data/` | a volume in `docker-compose.yml` | uploads written into the container, gone on the next rebuild |
| Stored something irreplaceable that is not a triple | `BackupBuilder`, which reasons only about graphs | an "essential" backup that silently omits every picture |
| Added a `volumes:` block to a compose service | the `volumes:` it already had, forty lines down | duplicate YAML key; the deploy failed before anything started |
| Added a facet to the search | the copy of the facet list in `/plugins` | `?category=reverb` silently ignored on the browse list |
| Added a block to `site.css` | its `a { color: … }` rule, one of five opt-ins | 17 of 35 front-page links in browser-default blue |
| Added `sh:in` to `pu:licenceId` | the submission and correction forms, which wrote licences verbatim | the one path a person controls was the one that could still split a facet |
| Wrote a house rule into CLAUDE.md | any test that checks it | "no inline SPARQL" reached 17 violations across 8 files before anyone counted |
| Shipped a feature | the prose written around it | a caption reading "not copied here" on an image that is copied here; a disclosure promising a bound that changed an hour later |
| Added `/plugin/<slug>/image`, writing `foaf:depiction` | `CORRECTABLE`, the whitelist that route writes through | every upload refused with "cannot be corrected"; 22 upload tests passed, none wrote the fact |

**When adding a runtime dependency on a path, a value, or a list, find what else
has to agree with it — and write the test that binds them.** A test asserting
that two lists match is worth more than either list being carefully reviewed.
The four that now have such a test have stopped recurring.

Specifically, before finishing a change, check:

- **Does a feature that persists something have a test that reads it back?**
  Storing the file is not the feature; writing the fact is. Image upload had 22
  passing tests covering bytes, types, refusals and rendering, and none covering
  the write — which is the half that was broken, for as long as the route
  existed. The same check would have caught the relative IRI that RDF resolved
  into `http://server/...`.
- Does a SHACL shape enumerate what this code enumerates? And does **every**
  path that writes that property go through the normalisation — a harvester, a
  submission form and a correction form are three, and only the first went
  through `toSpdx`.
- **A `sh:severity` other than the default changes what callers do.**
  `rdf-validate-shacl` reports `conforms: false` for a warning, against SHACL
  §3.6; `ShapeValidator` corrects that, and `IngestPipeline` and `Submissions`
  both refuse to write on `conforms`. Adding a warning-severity shape without
  that correction would abort a harvest of 753 plugins over one odd string.
- Does `.dockerignore` exclude a path the app now reads at runtime?
- Is a new `tests/<dir>/` in `vitest.core.config.js`?
- Does a published URL — user agent, docs link, IRI — resolve to a route?
- Does a new route have something linking to it? **`tests/api/linked-routes.test.js` now checks
  both directions** — a link with no route *and* a route with no link. It was only ever checking
  the first, which is why `/plugin/<slug>/promote` shipped with a Stripe checkout behind it and
  no button anywhere. "Every link resolves" and "everything is reachable" sound like one
  property and are two.
- Does `.gitignore` exclude a file a test reads? A fixture is source, not output.
- Does anything new persist outside the triple store? Then `.dockerignore`, a compose
  volume and `BackupBuilder` all have to know, and none of them will complain.
- **An install ends with a question asked of the consumer, not of the artefact.** `nginx -t`
  passing and a reload succeeding say nothing about whether the file you edited is the file
  being served — a config copied to `plugin-universe.com` beside the enabled
  `plugin-universe.com.conf` cost three rounds of diagnosis. Finish with
  `nginx -T | grep -c` for something the new config contains, or with a `curl` that would
  only pass if it were live.
- **A manual step that has failed twice is a script.** `deploy/prepare-data-dirs.sh` exists
  because "create the directory and check the app can write to it" was written in the
  runbook, read, and got wrong anyway. Where a failure has one cause, the error message
  should name the remedy — see `explain()` in `src/api/AdminActions.js`.
- **Every configuration file consumed somewhere else deserves a check that runs here.**
  `deploy/nginx/check.sh` for nginx, `tests/api/compose.test.js` for docker-compose. A
  syntax error in either is a failed deploy and a round trip through a person. When adding
  to a service or a server block, read the whole of it first — `grep -A 14` is how a second
  `volumes:` key got written under one that was already there.
- Did a new term in `vocabs/` reach the *store's* copy? `bin/ingest.js --vocabs-only`.

**A sentence about the system is a claim, and nothing tests sentences.** Six
times now a document has said something untrue: TODO.md put five inline SPARQL
queries at a file that had seven, of seventeen across eight files; it said
`pu:vendor` IRIs "are already minted, so identity exists" when there were none,
which is a sentence a paid feature was about to be built on; README.md claimed a
plugin count and a harvester that had shipped; a JSON disclosure promised a
ranking bound that a config change falsified within the hour.

- **Take a figure from the system, not from memory.** `/health`, a SPARQL count,
  a `grep -c`. Every number in README.md was re-measured when it was rewritten,
  and two of them were wrong on the first pass.
- **Where the prose is a commitment, bind it with a test.**
  `tests/search/promotion.test.js` asserts `/about/promotion` still states the
  numbers `PROMOTION_CONFIG` applies. A published promise that drifts silently
  is worse than none.
- **A prose claim that would be expensive to get wrong deserves checking before
  it is acted on**, not after — the vendor-identity sentence would have been
  found the moment somebody ran the query, and it was in the file for days.
- **When a feature starts working, re-read what was written around it.** A
  feature that has never worked has no second case for its documentation to get
  wrong; shipping it is what makes every sentence near it suspect.

**A rule worth stating in this file is worth a test.** "No inline SPARQL"
sat here from Phase 0 and reached seventeen violations; `tests/rdf/no-inline-sparql.test.js`
now parses every template literal in `src/` and fails on any that reads as a
query. When adding a rule here, ask what would notice it being broken — and if
the answer is "a careful reader", write the check instead. A guard that scrapes
source needs its own test that the scraping still works, or it goes blind
rather than red.

**Where a list must exist, make it one list and export it.** `FACET_NAMES` in
`src/api/server.js` and the base `a` rule in `templates/site.css` are both
this — a default that cannot be forgotten, rather than a list that must be
remembered. Prefer that shape to a checklist entry whenever it is available.

## HTML lives in files, not in code

Pages are `templates/*.html`, loaded by name through `src/api/Templates.js`. The same rule as
SPARQL, for the same reasons: markup is a document with its own syntax that an editor can check
and a person can read, and `render.js` had reached 705 lines of mostly HTML — including a
stylesheet inside a JavaScript template literal, where a backtick in a CSS comment silently
ended the string and broke the build.

- Two placeholders: `{{name}}` inserts the value **escaped**, `{{{name}}}` inserts it as-is for
  a fragment already built as HTML. Escaping is the default because the alternative is
  remembering.
- **`{{{raw}}}` is a defence switched off deliberately, so ask who switched it back on.** For
  every raw placeholder: who escaped this, and *for which syntax*? Most are fragments this code
  built and escaped itself. The one that was not — `{{{jsonLd}}}`, a serialiser's output going
  into a `<script>` — could be closed by any harvested or submitted string containing
  `</script>`, because `JSON.stringify` does not escape `<` and has no reason to. The answer
  there was JSON's own escape, not HTML's.
- **No loops and no conditionals, deliberately.** A template language grows until it is a worse
  programming language, and every construct added makes the escaping question harder. A list is
  `templates.each(...)`, filling a row template and joining; an optional block is
  `templates.when(...)`, which is a fragment or an empty string. Templates lay out; code decides.
- Every placeholder must be supplied and every supplied value must be used — both directions,
  because a missing value renders an empty region of a page silently, and a surplus one means
  the template and its caller have drifted.
- A new template must be rendered by something: `tests/api/templates.test.js` fails on an
  orphan, on a stray `${...}` left from the template-literal era, and if `.dockerignore` ever
  excludes `templates/`. `createServer` renders a page at startup, so an image built without the
  directory refuses to start rather than 500ing on every page a person can see.
- **A guard that scrapes markup must scrape `templates/` too.** `tests/api/linked-routes.test.js`
  kept reading `render.js` after the links moved and went blind rather than red.
- **One template, rendered in one place per page.** The site links are the footer on a prose
  page and the left column on every page with columns; `layout()` takes `footer: false` so the
  page gets one and not both. Five templates now open with `<div class="columns">`; if a sixth
  wants them, the wrapper should move into `layout()` rather than be copied again. A second copy of a list that includes the contributor terms is a
  second list to keep correct, and the cost of them disagreeing is a reader following the
  wrong one.

## Long files are a smell

A source file that has grown long has usually stopped being one thing. Treat length as a signal
to look, not as a rule to obey: the question is whether the file still has a single reason to
change, and a long one rarely does.

- **Check periodically**, not only when touching a file — `wc -l src/**/*.js | sort -n | tail`
  takes a second and the answer drifts silently.
- Roughly, past **~400 lines** a module is worth a look and past **~600** it almost always wants
  splitting. Moving the markup into `templates/` took `render.js` from 705 to about 500 without
  changing a single test.
- Split along the seam that already exists — a route group, a serialisation format, one
  harvester's quirks — not by line count. `render.js` crossed 600 and lost its Turtle and JSON-LD
  to `src/api/serialise.js`, because those change when the graph model changes and the HTML
  changes when the pages do: two reasons to change, two files. Cutting it at line 400 instead
  would have said nothing about the code.
- The test suites are the safety net for this, so a refactor that needs its tests rewritten to
  pass is not a refactor. Move code, keep behaviour, and the existing tests should still hold.

## Working rules
- API keys are sacred. They must not be shared.
- **Keep [docs/danja-todo.md](docs/danja-todo.md) current.** It is the user's own action list —
  anything needing server access, credentials, legal review or a decision that is theirs goes
  there and not into a chat message that scrolls away. Revise it at the end of any session that
  changes what they need to do: strike finished items into the "Confirmed done" section rather
  than deleting them, move new ones into priority order, and say plainly which things block
  which. Do not let it accumulate completed steps — a list of what has already happened is not
  a list of what to do. It is also the right place to record something the deployment cannot
  tell us, and anything I asserted about the server that I have not actually verified.
- Do not run any `git` operations unless the user explicitly approves them.
- **Never hand over an nginx configuration without running `./deploy/nginx/check.sh`.** It
  validates the real files in a throwaway container, with self-signed certificates generated at
  whatever paths they name. Six configurations have failed `nginx -t` on the server, every one
  of them findable here in a second. It prints the warnings as well as counting them.
  `nginx -t` does not catch everything: **`add_header` inside a `location` replaces the
  server block's headers rather than adding to them**, so a static-file location must repeat
  HSTS, nosniff and Referrer-Policy or it silently serves without them — valid configuration,
  wrong behaviour. Likewise a `types` block replaces the mime map for that location.
- Use the Read tool to read files, not `sed`/`cat`/`head`/`tail` via Bash. Bash tool calls require per-call user approval; Read does not.
- Log mistakes in MISTAKES.md (what happened, root cause, prevention).
- Periodically review TODO.md and revise as necessary, and `docs/danja-todo.md` with it: TODO.md
  is what the project needs, danja-todo.md is what the user needs to do. An item that lands in
  one usually changes the other.

## Development Guidelines

- ES modules throughout. Node ≥ 20.
- Scripts are run from the repository root.
- **`npm run test:store` is not parallel-safe against itself.** It writes to shared named graphs
  in one Fuseki, so two concurrent runs corrupt each other and report failures that are not
  real — 8 and 17 of 175, from code that passes 175/175 run alone. One at a time. And write a
  run's output to a file rather than piping it through `tail` in the command, or the failure
  detail is discarded before anyone can read it and a duration gets mistaken for a verdict.
- Vitest, with separate core / store / live configurations. `npm test` is core (no services),
  `npm run test:store` needs Fuseki and Ollama, `npm run test:live` tests the **deployed site**
  over the internet and is never part of a sweep — `tests/rdf/suite-coverage.test.js` binds each
  test directory to the configuration that runs it and keeps the three disjoint.
- Mocking is only allowed for trivial arithmetic-style unit checks; every other test must assume
  the live services defined in `config/config.json` are reachable and interact with them directly.
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
  the same commit. The shapes are `vocabs/shapes.ttl`; run them with `npm run validate`, which
  validates every registered graph separately so a report names the source that needs fixing.
  `tests/rdf/shapes.test.js` proves the shapes fire; `tests/store/shapes.test.js` proves the
  pipeline satisfies them.

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
| `aufx:` | `https://w3id.org/aufx/ontology/1.0#` | alignment target only — see `vocabs/alignment.ttl` |

Plugin IRIs are minted under `http://purl.org/stuff/plugin-universe/`, by content hash over the
identifying tuple so that re-harvesting is idempotent — `.../plugin/<slug>-<sha256[0:8]>`, and
`.../vendor/`, `.../person/`, `.../release/`, `.../measurement/`, `.../correction/` and
`.../revision/` by the same rule. `URIMinter` refuses a type it does not know, so a new kind of
resource means adding it there rather than assembling an IRI by hand. The PURL redirects
to whatever host currently serves the site, so IRIs survive a change of domain; never mint an IRI
under the serving domain itself. Where an upstream canonical IRI already exists — LV2 plugins have
them by design — preserve it with `owl:sameAs` rather than replacing it.

Categories and tags are a `skos:ConceptScheme`, not an OWL class hierarchy. Vendor categories, LV2
plugin classes and user tags map in as `skos:closeMatch`.

The scheme lives in `vocabs/categories.ttl` and nowhere else — it was a JavaScript object literal
of parent links once, which is why it had four predicates and no way to say what a category meant.
Adding a category means adding a concept there with a definition and alternative labels; a bare
label in the data is written but reported, and `tests/store/categories.test.js` fails if one goes
undescribed. Alternative labels feed the **lexical** signal only. Do not add them to the composed
text view: that would invalidate every stored embedding for a signal the lexical index already
gives. Alignments to other vocabularies are asserted only where the target term has been
verified — the LV2 classes here were checked against installed plugins, and AUFX-O effect types
are absent because they have not been.

## Deployment

The runbook is `docs/deployment.md`. Docker Compose: `app`, `fuseki` (TDB2) and `ollama`, with a
healthcheck gate so the app waits for the store, and nginx behind a `proxy` profile terminating TLS
and reverse-proxying. The profiler runner is a separate, tightly confined container and is the only
component permitted to execute third-party code.

Only nginx is published. Everything else binds to `127.0.0.1` — Fuseki exposes an update endpoint,
and publishing that by accident is the worst mistake available here. `.dockerignore` keeps `.env`
out of the image; configuration reaches the container through the environment, and `Config.load()`
prefers a real environment variable over anything it reads from a file.

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
