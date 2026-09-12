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
VST3s: **45 pass, 1 crashes, 4 have no binary in the bundle at all.** 50 plugins in the
catalogue carry a reading, and `bin/backup.js --scope measurements` carries a run from the
machine that made it to the one that serves.

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
* **No facet dropdown for measurement verdicts.** 50 of 754 carry a reading, and the values are
  `passed` / `ok` / `failed` / `crashed`. `?measured=` works; the judgement is whether 7%
  coverage should shape everyone's search form.
* **AU, LADSPA and VST2 are reachable by pluginval and not built for.** AU is macOS-only; VST2
  needs Steinberg's SDK, which is not redistributable; LADSPA and VST2 both ship as a bare
  `.so`, so the profiler declines to guess which a file is.

## Phase 3b — the rest of the site — mostly built

* **Nothing notices when a plugin reaches the catalogue but not the index.** The instance that
  prompted this is fixed — `/health` now reports 754 documents against 754 vectors — but the
  hole is still open. `takeUpNewPlugins()` never throws, by design, so an embedding failure
  leaves a plugin findable lexically and invisible to semantic search, with a line in the log
  and nothing else. `/health` reports both numbers and nothing compares them. Worth reporting an
  embedding failure to the moderator who caused it, and worth a check that the two agree.
* **The contributor terms do not cover pictures.** §2 splits contributions two ways — facts are
  CC0, authored prose is CC BY-SA — and an uploaded image is neither. It is a copyright work,
  usually not the uploader's: a screenshot of a plugin is the plugin author's. The *statement*
  `foaf:depiction` is a fact and goes to the contributor's CC0 graph correctly; the file it
  points at is not covered by anything.

  Nothing is being claimed wrongly right now — the caption on a hosted picture says the picture
  is its author's and not the catalogue's, which is the honest position and the reason it was
  worded that way. But §4's promise ("you are free to state it, or you have permission from
  whoever holds the rights") was written about statements, and the terms should say what
  uploading a picture means before many are uploaded. **A legal question, so Danja's.**

* **Uploads have no size story beyond the per-file cap.** 2 MB each, no per-account quota and
  no total. Content-addressing means duplicates cost nothing, but nothing stops one trusted
  account filling the disk. A quota wants adding before that matters.

* **The front page could claim recency again.** When this was written every plugin shared one
  `dcterms:created`, so `byRecency` fell through to `byName` and "most recently added" was
  alphabetical wearing a label — the claim was removed rather than the sort. **The GitHub sweep
  has since spread the dates: 37 distinct values over two days.** Recency is a real signal now
  and the sort already asks for it, so this is an editorial decision about what the front page
  should show rather than work.

Built on the accounts and moderation machinery Phase 3 finished, so none of this needs new
foundations.

* **Stars** — one per signed-in account per plugin, so the catalogue can say what people
  actually rate. Needs a vocabulary term, a graph decision (a user's own graph, like
  corrections), and a rate limit. Worth thinking about what it is *for* before building it:
  a popularity signal that feeds ranking is a different thing from a display number.
* **An admin area** for `TIER.ADMIN` only. The tier exists and `bin/grant.js` sets it; nothing
  reads it. Account list, trust and suspension, the graph registry.
* **A Plugin Resources page and a Developers page** — categorised links for people using
  plugins and people writing them (JUCE, DPF, the LV2 and CLAP specs, validators). Curated
  first, then in the store so contributors can add through the moderation queue that exists.
  A `skos:Collection` over the existing scheme rather than a new taxonomy.
* **A 3D navigable plugin graph** — plugins as nodes, hover for a summary, click through to the
  page. Genuinely differentiating, and the one thing on this list that breaks a standing
  decision: the site is server-rendered with no client framework, and this cannot be. Worth
  doing as a self-contained page that degrades to the ordinary search rather than as a
  dependency the rest of the site acquires.

## Phase 4 — pro tier — promotion built, payments not started

* **A vendor is a string, not an identity — and a paid profile needs one.** `/vendor/<slug>`
  groups plugins by the vendor's name folded to lower-case alphanumerics, which merges the two
  genuine duplicates in the catalogue and nothing else. That is enough for a listing and is not
  enough to hang a claimable, editable profile on:

  - **Two names, one vendor.** "danja" (50 plugins) and "Danny Ayers" (36) are the same person.
    Nothing derivable from the strings will ever say so. Only a human assertion can.
  - **A rename orphans the page**, because the key is computed from the name.
  - **Nothing to attach anything to** — no resource for a description, a logo, a support URL or
    an owning account.

  The fix is a harvest change rather than a page change: mint `pu:vendor/<slug>-<hash>`
  (`URIMinter` already knows the type), give it `foaf:name` plus `skos:altLabel` for every
  spelling met, and have plugins carry `trn:vendor` as an IRI beside the literal. Then merging
  two vendors is adding an altLabel, a rename is editing `foaf:name`, and a claim is a triple.

  *(An earlier version of this entry asserted that `pu:vendor` IRIs were already minted. There
  were none. It is in MISTAKES.md as an instance of the documentation pattern.)*

* **Selling a vendor profile.** Not started, and it needs the identity above first. The shape
  that fits what is already built:

  - **Claiming before editing.** An account proves it speaks for a vendor — the cheapest
    credible check is a link or file at a domain the vendor's plugins already point at through
    `foaf:homepage`, since the catalogue holds that URL and did not get it from the claimant.
    A moderator confirms; the claim is a triple, so it is revocable by deleting one.
  - **Edited prose is CC BY-SA, not CC0**, and goes in the vendor's own prose graph — the same
    split the contributor terms already make, for the same reason. A vendor's blurb about
    themselves is authored text, not a fact about a plugin.
  - **It must not become a way to edit facts.** A profile is the vendor's own words next to the
    catalogue's findings, never on top of them. A `crashed` measurement stays `crashed` on a
    paid profile; that boundary is the whole reason anybody would trust the catalogue, and it
    is the same line `/about/promotion` already draws for placement.
  - **Disclosure.** A claimed profile should say it is the vendor's own, in the way a promoted
    result says it is paid for — a reader must be able to tell harvested fact from vendor copy
    without being told twice.
  - Paid or free is a pricing decision, not an architectural one: claiming, editing and
    labelling are the same work either way, and giving claiming away free while charging for
    presentation is the option that keeps the catalogue accurate.
* **Payments: Stripe.** Nothing here handles money yet, and taking it changes what the site is
  for legal purposes — the terms review in `docs/resources.md` §4 has promotion as its trigger
  for a real legal reading, and this is that trigger. Card details never touch this server;
  Stripe Checkout or a payment link keeps it that way, and that is worth deciding before any
  code.

## Phase 5 — open data — nearly done

Live: the dumps (`bin/dump.js`), the public SPARQL endpoint, the Open Audio Stack registry view
at `/registry/plugins/index.json`, the MCP face, and `/services` describing all of it.

* **Submit the dataset to [lod-cloud.net](https://lod-cloud.net/).** The catalogue already has
  what the submission asks for: a public SPARQL endpoint, dereferenceable IRIs, dumps with a
  stated licence, and a VoID description. Being in the diagram is how a Linked Data dataset is
  found by people who work that way, and the links out — `lv2:`, `skos:`, `doap:`, `foaf:`,
  `spdx:` — are what make it worth a node rather than an island. Needs the VoID description
  checked against their required fields first.
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
* **Tooltips where they earn their place.** From the inbox. Measurement metrics already carry
  labels and units from the vocabulary, which is the case that most wants one. Two cautions: a
  tooltip is invisible on a touch screen and to a keyboard user unless built as a proper
  disclosure, and anything important enough to need one is usually important enough to be on
  the page. So `title` for the incidental, a real disclosure for the rest, and neither as a way
  to make a crowded page hold more.
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

### 2026-09-11 and 12

The reasoning behind each of these is in the code it touched, in
[MISTAKES.md](MISTAKES.md) where something went wrong, or on the public page that states it —
which is why it is no longer restated here.

* **Measurements on the deployment.** `bin/backup.js --scope measurements` carries a profiler
  run from the machine that made it to the one that serves. 50 plugins, 288 triples.
* **Submitting a plugin**, and **accepting one indexes it** without a restart.
* **Submit by URL, for a moderator** — one fetch, drafted into the form for checking.
  `docs/resources.md` §4 rule 8 is what bounds it, written before the code.
* **Image upload**, sniffed by magic bytes, stored content-addressed, served by nginx.
* **Licence identifiers normalised** — 23 spellings to 19 licences, enumerated in
  `vocabs/shapes.ttl`, fixed in place by `bin/renormalise-licences.js`.
* **Every SPARQL query in a file**, with `tests/rdf/no-inline-sparql.test.js` keeping it so.
* **Vendor pages** — `/vendor/<slug>` and `/vendors`, linked from every vendor name.
* **Promoted listings** — a moderator can place one, it lapses after a year, the ranking effect
  is bounded and published at `/about/promotion`.
* **The accessibility pass**, enforced by `tests/api/accessibility.test.js` over twelve page
  types; and the tab order fixed so the results come before the panel that refines them.
* **Three columns on a wide screen**, and **README.md rewritten around the method.**
* **A plugin page's identifiers resolve** — formats and roles to the filtered search,
  categories to their concept pages, the licence to SPDX where it is really an SPDX identifier,
  the plugin's own IRI through its PURL, and **the author's canonical IRI**, preserved with
  `owl:sameAs` on 86 plugins and shown nowhere until now. Found while testing the escaping: the
  JSON-LD block at the foot of every plugin page could be closed by any value containing
  `</script>` — latent, never exploited, now escaped and tested.
