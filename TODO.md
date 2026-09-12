# TODO

What is left to do. **Why** things are the way they are lives in
[MISTAKES.md](MISTAKES.md) and the worklogs under [docs/entries/](docs/entries/);
this file does not repeat it.

Anything needing server access, credentials, or a decision that is Danja's is in
[docs/danja-todo.md](docs/danja-todo.md) instead.

**Where things are.** Phases 0–3 are complete and deployed. Phase 5 is nearly
so: dumps, a public SPARQL endpoint, an Open Audio Stack registry view and an
MCP face are all live. Phase 2 is stalled on a binary nobody has installed, and
Phase 4 has not started.

---

## Recurring — habits, not tasks

* **Check `docs/todo-misc.md`** for new items and fit them into a phase here.
* **Keep [docs/danja-todo.md](docs/danja-todo.md) current**, and prune it: it goes stale in
  one direction, with finished steps accumulating at the top while the next real action sinks.
* **Validate nginx before it leaves this machine** — `./deploy/nginx/check.sh`. Six
  configurations have failed `nginx -t` on the server; all six were findable here.
* **Run `npm run test:live` after every deploy.** It is the only check that sees the deployment
  rather than a copy of it.
* **Accessibility is a standing requirement, not a task.** Semantic markup, a visible focus
  ring, colour contrast that survives both themes, forms whose labels are attached, and
  anything interactive reachable by keyboard. See the audit item under Phase 3b for the
  one-off pass; this line is about not regressing after it.
* **Re-read this file and MISTAKES.md when starting something structural.** The recurring
  failure in [CLAUDE.md](CLAUDE.md) — two files that must change together with nothing
  connecting them — has cost more than any other class of defect here.

---

## Phase 2 — the profiler — running

Built: the sandbox, the lilv scanner, **the pluginval host**, the measurement model, per-run
graphs, and the readings surfaced on plugin pages and as a `measured=` filter.

`pluginval` is built from a pinned commit into `docker/profiler.Dockerfile` and run by
`node bin/profile.js --path <dir> --tool pluginval`. First sweep over the 51 built downspout
VST3s: **45 pass, 1 crashes, 4 have no binary in the bundle at all.** 57 plugins in the
catalogue now carry a reading.

* **Measurements reach the deployment.** *Done 2026-09-11:* `bin/backup.js --scope
  measurements` carries profiler runs from the machine that made them to the one
  that serves, registrations and all, and the first delivery is live — 50 plugins
  with readings, 288 measurement triples in the public SPARQL copy. `/health`
  reports `measured` and `measuredAt` so a future delivery can be checked rather
  than assumed.
* **CPU load** needs a host that runs audio through the plugin — `lv2bm`, or an in-house one.
  `pu:CpuLoad` is defined and nothing produces it. This is now the largest gap: pluginval
  instantiates and exercises a plugin but does not report what it cost.
* **`sidecar.vst3` segfaults under the `Automation` test.** Recorded as `crashed`, which is
  the design working. Worth reporting upstream to downspout — the catalogue found a real bug.
* **Four downspout bundles are empty** — `Contents/x86_64-linux/` with no `.so`: chipper,
  damiano, skream, worms. A build problem in that repo, not a catalogue one, but they are
  recorded as `failed` and will stay that way until rebuilt.
* **Reproducibility is assumed, not tested**: two runs of the same plugin on the same host,
  within a stated tolerance. The plan calls for this to be proven, and the open-time figures
  now give it something to be measured against.
* **Only the newest run shows on a plugin page.** A plugin measured by both lilv and pluginval
  keeps only the later run's readings, so its port counts disappear when it is validated. The
  behaviour is documented in `plugin/measurements.sparql` and was right when one tool wrote
  them; with two it loses information.
* **No facet dropdown in the search form.** 57 measured plugins out of 750-odd — up from 7, and
  the values are now `passed` / `ok` / `failed` / `crashed`. Closer to worth a control than it
  was; still a judgement about whether 8% coverage should shape everyone's search form.
* **AU, LADSPA and VST2 are reachable by pluginval and not built for.** AU is macOS-only; VST2
  needs Steinberg's SDK, which is not redistributable; LADSPA and VST2 both ship as a bare
  `.so`, so the profiler declines to guess which a file is.

## Phase 3b — the rest of the site

* **Image upload.** *Done 2026-09-11:* trusted contributors can add a picture to a plugin.
  Sniffed by magic bytes rather than declared type or extension, SVG refused outright, stored
  content-addressed under `data/images`, served same-origin with `nosniff` and an immutable
  cache. Carried in the essential and full backups, and **served by nginx from disk** — the
  app's `/image/` route stays as the fallback for a deployment with no proxy, and is what the
  tests exercise.
* **A plugin can reach the catalogue without reaching the index.** Live shows 753 documents
  against 752 vectors: the plugin accepted from a submission is in the store and has no
  embedding, so it is findable lexically and invisible to semantic search — which is the
  retrieval this catalogue is built on. `takeUpNewPlugins()` is called on acceptance and
  never throws, so a failure there is a warning in the log and a plugin that is quietly
  half-present. **Reindex on `/admin`, or `bin/ingest.js --only-new`, fixes an instance.**
  The gap is that nothing notices: `/health` reports both numbers and nothing compares them
  except a live test nobody runs on a schedule. Worth making the acceptance path report an
  embedding failure to the moderator who caused it, rather than only to the log.
* **Submit a plugin by URL, for a moderator.** Paste `https://danja.github.io/valis/` and have
  the target read on a best-effort basis rather than typing seven fields. Moderator-only,
  because it is the difference between a form and a fetch: the site would be making a request
  on somebody's say-so.

  **This is not the crawler and must not become it.** `docs/resources.md` §4 governs what is
  harvested at scale, and the rules there — a sanctioned API where one exists, never work
  around an access-control measure, `robots.txt` permitting a path is not a licence to
  re-publish it — still apply to a single fetch. What is different is consent and scale: one
  page, fetched once, at the request of a person who is usually its author. Worth writing that
  distinction into the terms review before building it, not after, and worth sending the same
  honest user agent so a sysadmin seeing it in their log can find out what it was.

* **Licence identifiers are normalised.** *Done 2026-09-11:* the catalogue held 23 spellings
  of 19 licences — `GPL-3.0` 317 against `GPLv3` 27 and `GPL3` 1, `MIT` 201 against
  `https://spdx.org/licenses/MIT` 6 — so the facet listed one licence several times and a
  filter on `GPL-3.0` missed 86 plugins under it. `toSpdx()` now reads SPDX's own URLs by
  capturing the identifier out of them, maps the DOAP vocabulary LV2 bundles use, and knows the
  unambiguous spellings; `vocabs/shapes.ttl` enumerates the result in `sh:in` at
  `sh:severity sh:Warning`, bound to the code's list by `tests/harvest/Licensing.test.js`.

  Two things were decided rather than merely coded. **An unversioned licence stays
  unversioned:** 59 plugins state `http://usefulinc.com/doap/licenses/gpl`, which names the
  GNU GPL and not a version of it, and they normalise to `GPL` — a facet entry of its own,
  because it is a different claim, and choosing a version for them would be an assertion about
  somebody else's licensing that nobody made. **`other` becomes `NOASSERTION`,** SPDX's token
  for a licence that exists and was not identified, which is what GitHub's API means by it.

  The stored data is fixed by `bin/renormalise-licences.js`, which is a recomputation and not a
  re-harvest: `dcterms:license` holds what each source said and never leaves the graph, so the
  derived `pu:licenceId` is re-derived from it in place. On Danja's list.

* **Uploads have no size story beyond the per-file cap.** 2 MB each, no per-account quota and
  no total. Content-addressing means duplicates cost nothing, but nothing stops one trusted
  account filling the disk. A quota wants adding before that matters.

* **An accepted plugin becomes searchable without a restart.** *Done 2026-09-11:*
  `SearchService.takeUpNewPlugins()` reloads the documents, rebuilds the lexical index and
  embeds anything without a vector, called when a submission is accepted. It never throws —
  the plugin is already in the catalogue, and a failure leaves it for the nightly
  `bin/ingest.js --only-new` rather than reversing an acceptance.
* **Submitting a plugin.** *Done 2026-09-11:* `/submit` for signed-in accounts, built from
  `SUBMITTABLE` so the form, the validator and the triples cannot drift; duplicate refusal
  against both the catalogue and the queue; SHACL before writing; the same trust promotion
  corrections use; and one moderation queue holding both kinds. Not yet decided: whether a
  contributor may edit or withdraw a pending submission, and whether an accepted plugin should
  be announced anywhere.
* **Every SPARQL query is in a file.** *Done 2026-09-12:* the entry here said Corrections.js
  inlined five; a scan found **seventeen across eight files** — Corrections 7, Accounts 5,
  Wiki 4, and one in Submissions, plus six copies of the same two generic graph queries spread
  over `BackupBuilder`, `DumpBuilder`, `Publication` and `ShapeValidator`. All are now under
  `sparql/queries/`, the two generic ones as a single `graph/contents` and `graph/triple-count`.

  What keeps them there is `tests/rdf/no-inline-sparql.test.js`, which parses every template
  literal in `src/` and fails on any that looks like a query — the rule had been stated in
  CLAUDE.md since Phase 0 and checked by nobody, which is the rate prose decays at. It exempts
  `SPARQLHelper.js` alone, and requires a written reason for each exemption.

  Three things fell out of it: `ShapeValidator` interpolated a graph name as `<${graph}>` with
  no `iri()`; `sparql/queries/plugin/by-iri.sparql` had been dead since Phase 0.5 and is
  deleted, found by the same test's orphan check; and `integer()` is now in `SPARQLHelper`,
  because a query needing `LIMIT` was the one thing a file could not express and was why some
  of these were assembled in JavaScript at all.

* **"Most recently added" is alphabetical, and the label is false.** Checked
  2026-09-11: `byRecency` is correct and the ordering *is* applied — but all 752
  plugins on the deployment share one `dcterms:created`, `2026-09-10`, because
  the dated ingest has run once. With every date equal the comparator falls
  through to `byName` by design, so the front page lists the alphabetical head
  of the catalogue under a heading that claims otherwise. The first hundred of
  them have no image at all.

  `IngestPipeline` carries first-seen dates across a re-harvest, so dates will
  differentiate from the next new source onward. Until then **recency is not an
  available option for the front page** — it is alphabetical wearing a label.
  Either stop claiming it, or pick a glimpse that is a real signal.
  (The local store has no dates at all, which is a separate staleness: it
  predates the dated ingest.)

Built on the accounts and moderation machinery Phase 3 finished, so none of this needs new
foundations.

* **`/ns` is useless to a person.** It returns a JSON list of vocabulary names, and it is linked
  from the footer of every page. It should be an HTML page saying what each vocabulary is for,
  negotiating to JSON for machines the way plugin pages already do.
* **Tags and categories in search results are not clickable.** A category should link to its
  page, a format to the filtered search. They look like links already.
* **Stars** — one per signed-in account per plugin, so the catalogue can say what people
  actually rate. Needs a vocabulary term, a graph decision (a user's own graph, like
  corrections), and a rate limit. Worth thinking about what it is *for* before building it:
  a popularity signal that feeds ranking is a different thing from a display number.
* **An accessibility audit.** One deliberate pass over every page type — headings, landmarks,
  focus order, contrast in both themes, form labels, the account bar, the wiki editor. Then the
  habit above keeps it.
* **An admin area** for `TIER.ADMIN` only. The tier exists and `bin/grant.js` sets it; nothing
  reads it. Account list, trust and suspension, the graph registry.
* **A Plugin Resources page and a Developers page** — categorised links for people using
  plugins and people writing them (JUCE, DPF, the LV2 and CLAP specs, validators). Curated
  first, then in the store so contributors can add through the moderation queue that exists.
  A `skos:Collection` over the existing scheme rather than a new taxonomy.
* **The wide-screen layout** has room beside the results and nothing in it. A sidebar or a
  hamburger; what goes there is an editorial question.
* **A 3D navigable plugin graph** — plugins as nodes, hover for a summary, click through to the
  page. Genuinely differentiating, and the one thing on this list that breaks a standing
  decision: the site is server-rendered with no client framework, and this cannot be. Worth
  doing as a self-contained page that degrades to the ordinary search rather than as a
  dependency the rest of the site acquires.

## Phase 4 — pro tier — not started

* **Company and developer profiles**, so a paying vendor can present themselves: a page per
  vendor, claimed by a verified account, with their plugins listed. `pu:vendor` IRIs are
  already minted, so identity exists; claiming and the labelling rules do not.
* Promoted placement must be labelled to meet DSA Art. 26/39 and ASA guidance — and the ASA
  advises against "sponsored" as the word.
* **Payments: Stripe.** Nothing here handles money yet, and taking it changes what the site is
  for legal purposes — the terms review in `docs/resources.md` §4 has promotion as its trigger
  for a real legal reading, and this is that trigger. Card details never touch this server;
  Stripe Checkout or a payment link keeps it that way, and that is worth deciding before any
  code.

## Phase 5 — open data — nearly done

Live: the dumps (`bin/dump.js`), the public SPARQL endpoint, the Open Audio Stack registry view
at `/registry/plugins/index.json`, the MCP face, and `/services` describing all of it.

* **Nothing serves the dumps.** They are written to `data/dumps`; how they are published is a
  decision in `docs/danja-todo.md`. `/services` says plainly that none is published yet.
* **Contribute upstream**: the user's own plugins to the Open Audio Stack registry, and the
  `trn:` extensions to `~/github/transmission` — in particular `trn:PluginFormat`, and retiring
  `trn:min`/`trn:minimum` in favour of the `lv2:` equivalents.
* **Profile augmentation from the open web** — videos and reviews, linked not copied. The
  conditional deliverable, and the one place the rules bite hardest: KVR links are permitted
  and KVR content is not; a source gets a row in [resources.md §4](docs/resources.md) before any
  code; never scrape a search engine; such graphs are `proprietary-linkout` and excluded from
  the dumps by their flag; and links rot, so it needs a re-check schedule.

## Backups — built, waiting to be installed

`bin/backup.js`, `bin/restore.js`, the nightly job and the pull script, all tested. Installing
them is in `docs/danja-todo.md`. Two things deliberately not done, both stated in
[docs/backups.md](docs/backups.md):

* **Encryption at rest**, if backups ever leave machines the user owns — these graphs hold
  personal data.
* **Retention against erasure.** The contributor terms promise an account can be erased;
  a backup taken beforehand still holds it. Ninety days of essential backups means up to ninety
  days before an erasure is complete everywhere, and an erasure request has to include them.

## Smaller things, not blocking

* **Rewrite README.md around the method, not the inventory** — how language-model and Semantic
  Web techniques work together, with the ontologies at the centre. Worth doing now that the
  taxonomy work has landed, so it describes what is there.
* **AUFX-O effect-type alignment is still not asserted.** The LV2 classes in
  `vocabs/categories.ttl` were verified against installed plugins; AUFX-O equivalents for
  reverb, delay and so on need someone who can open the published ontology.
* **Cross-source identity**: a plugin in both a local repo and the OAS registry mints two IRIs,
  because the identity tuples are different kinds of thing. Nothing in the corpus overlaps yet,
  so this is a design question rather than a defect — the answer is probably `owl:sameAs` from a
  matching pass, not a change to minting.
* **Embedding staleness**: `--only-new` embeds plugins with no vector, but cannot see a plugin
  whose *text* changed upstream — the IRI is unchanged, so the stale vector stays. Storing
  `pu:composedTextHash` beside each vector would close it and make a nightly refresh cheap.
* **`vocabs/shapes.ttl` is deliberately not loaded into the store**: SHACL shapes are how the
  store is checked, not part of what it describes.
* **The flues repo holds four copies of every bundle** (source, build, staging, release). The
  harvester skips them; the repo would be tidier without them.
* **Record the PURL configuration in this repo**, rather than only in the purl.org account.

---

## Done

Each of these is described in the worklogs under [docs/entries/](docs/entries/).

* **Phase 0 — foundations.** Config layering, the `trn:` extensions, per-graph licensing,
  SPARQL query files, the persisted vector index, Docker Compose with Fuseki.
* **Phase 1 — harvest and search.** Harvesters for downspout, flues, the Open Audio Stack
  registry and GitHub; the normaliser; SHACL shapes; hybrid retrieval; the read API with
  content negotiation; the search UI.
* **Phase 1 follow-on.** Plugin images, first-seen dates and the paged front page, and the
  category scheme moved out of JavaScript into `vocabs/categories.ttl` with definitions,
  synonyms and verified LV2 alignments.
* **Phase 2, in part.** The sandbox, the lilv scanner, the measurement model, and the readings
  surfaced on plugin pages and as a search filter.
* **Phase 3 — people and pages.** GitHub sign-in, corrections, the moderation queue, trust
  promotion, rate limiting, a contributions page, and the wiki with revisions, conflict
  detection and dependency-free sanitisation.
* **Phase 5, in part.** Dumps by licence flag, the public SPARQL endpoint on a separate
  published dataset, the Open Audio Stack registry view, the MCP face, and `/services`.
* **Deployment.** `bin/deploy.sh` with a build stamp on `/health`, `npm run test:live`,
  `./deploy/nginx/check.sh`, `robots.txt`, and the HTML moved out of code into `templates/`.
* **Smaller fixes.** `/ns` is a page for people that negotiates to JSON for machines; tags and
  categories in results link to the filtered search and the category page.
