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

## Phase 2 — the profiler — stalled

Built: the sandbox, the lilv scanner, the measurement model, per-run graphs, and the readings
surfaced on plugin pages and as a `measured=` filter.

* **`pluginval` is not installed anywhere.** A JUCE binary from Tracktion covering
  VST/VST3/AU/LV2/LADSPA. Without it the profiler reaches LV2 only, and the 46 built downspout
  VST3s cannot be measured at all. *Everything below is downstream of this.*
* **CPU load** needs a host that runs audio through the plugin — `lv2bm`, or an in-house one.
  `pu:CpuLoad` is defined and nothing produces it.
* **`pu:LatencySamples`** likewise: `pu:Latency` is the boolean a static scan can establish,
  and the sample count needs the same running host.
* **The scan matches a plugin by `owl:sameAs` to its LV2 IRI**, so it only reaches LV2 plugins
  the catalogue already holds. VST3 needs a different key.
* **Reproducibility is assumed, not tested**: two runs of the same plugin on the same host,
  within a stated tolerance. The plan calls for this to be proven.
* **No facet dropdown in the search form**, deliberately — 7 measured plugins out of 750-odd is
  not a control worth putting in front of everyone. Add it when coverage justifies it.

## Phase 3b — the rest of the site

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
