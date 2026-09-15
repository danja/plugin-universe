# TODO

What is left to do, in the order worth doing it.

**Why** things are the way they are lives in [MISTAKES.md](MISTAKES.md), the
worklogs under [docs/entries/](docs/entries/), and — for anything already
delivered — [docs/plan-done.md](docs/plan-done.md). This file does not repeat
them. The *design intent* of what is unbuilt is in
[docs/plan.md](docs/plan.md); this file is the actions.

Anything needing server access, credentials, legal review or a decision that is
Danja's is in [docs/danja-todo.md](docs/danja-todo.md) instead.

**Where things are.** Measured 2026-09-14 from `/health`, the public endpoint and
the suites, not from memory: **756 plugins, 756 indexed, 376 vendors all minted,
50 measured; 1244 core tests over 56 files and 263 store tests over 24.**
Phases 0, 1, 3 and 5 are complete and deployed. Phase 2 is running and is missing
the measurement it exists for. Phase 4 is built and has never taken money.

---

## 0. Do these first

Small, unblocked, and each closes something that is already wrong. None is more
than an hour.

* **Deploy the vendor merge, and decide who else is one maker.** *2026-09-13:
  built.* `data/curation/vendor-merges.json` is read by `bin/mint-vendors.js`,
  and locally `danja` + `Danny Ayers` are now one vendor with **86 plugins**
  (50 + 36) at one page. Needs the same two commands on the server as before:
  `mint-vendors`, restart, `publish`.

  What it does, and why each part is there:

  - **A merged-away IRI keeps answering.** `/vendor/dannyayers-20fd5796` was
    minted, published and shipped in the CC0 dump. The merge writes
    `<retired> owl:sameAs <survivor>` and the site aliases it, so all four of
    `/vendor/danja`, `/vendor/danny-ayers`, `/vendor/danja-ba40c9e0` and
    `/vendor/dannyayers-20fd5796` reach one page. The retired node is
    deliberately **not** typed `pu:Vendor`: typing it would load it as a second
    identity and undo the merge.
  - **The merge file is read in exactly one place.** `mint-vendors` writes one
    `foaf:maker` per plugin, so the site regroups from the graph rather than
    reading the file a second time. A second reader would be a second list.
  - **A misspelled key is refused**, because the run reports the same vendor
    count either way and a typo would otherwise be invisible. So are two
    survivors claiming one key, a key merged into itself, and a display-name
    override naming a spelling no source wrote.
  - **A missing file cannot silently un-merge.** `data/curation` reaches the
    container by bind mount and is excluded from the image, so a run without it
    would rewrite the graph unmerged and report success. It refuses when the
    store holds merges and no file is found; an explicit `"merges": []` is
    obeyed.

  **`pu:claimsVendor` now holds the vendor IRI** *(2026-09-14)*, which it had to
  before a vendor could pay. It held the folded name, and the fold is derived
  from the spelling — so the merge above changed which key a plugin folded to
  and the entitlement check stopped matching exactly the plugins the merge had
  just gathered. A Pro subscriber claiming `danja` would have been refused on
  their own 36 "Danny Ayers" plugins, silently, because the check simply does
  not match and there is nothing to report. `foaf:maker` points every plugin of
  both spellings at the surviving vendor, so the claim now follows a merge
  instead of breaking on one.

  Also: `/admin` refuses to claim a vendor with no minted identity (there is
  nothing to attach to, and it names the command), and the claims panel counts
  claims the catalogue cannot resolve — a claim confirmed under the old scheme
  reads that way, and it would otherwise entitle nothing while looking fine.

* **The front page can claim recency again.** When the claim was removed, every
  plugin shared one `dcterms:created`, so `byRecency` fell through to `byName`
  and "most recently added" was alphabetical wearing a label. **Measured on the
  public endpoint: 37 distinct dates over 753 plugins.** Recency is a real signal
  and the sort already asks for it, so this is an editorial decision rather than
  work.

* **A sitemap.** `robots.txt` has no `Sitemap:` line, and pointing at a 404 would
  be the same defect as advertising a contact page that does not exist — so the
  line waits on the file. **The decision has already been taken**
  ([danja-todo.md](docs/danja-todo.md)): the list is `/`, `/plugins` and its
  pages, the category pages and the plugin pages; `/search` stays out, and
  `robots.txt` already says so. 756 plugin pages is the whole argument for
  having one. Note the two-file trap while doing it: a new static route needs
  `STATIC_FILES`, something linking to it, and the `Sitemap:` line — which is
  what `tests/api/linked-routes.test.js` exists to catch.

---

## Recurring — habits, not tasks

* **Check `docs/todo-misc.md`** for new items and fit them into a section here.
* **Keep [docs/danja-todo.md](docs/danja-todo.md) current**, and prune it: it goes stale in
  one direction, with finished steps accumulating at the top while the next real action sinks.
* **Validate nginx before it leaves this machine** — `./deploy/nginx/check.sh`. Six
  configurations have failed `nginx -t` on the server; all six were findable here.
* **Run `npm run test:live` after every deploy.** It is the only check that sees the deployment
  rather than a copy of it.
* **Accessibility is a standing requirement, not a task.** Semantic markup, a visible focus
  ring, colour contrast that survives both themes, forms whose labels are attached, and
  anything interactive reachable by keyboard. The one-off pass is done and
  `tests/api/accessibility.test.js` holds it; this line is about not regressing.
* **Re-read this file and MISTAKES.md when starting something structural.** The recurring
  failure in [CLAUDE.md](CLAUDE.md) — two files that must change together with nothing
  connecting them — has cost more than any other class of defect here.
* **Write the worklog.** `docs/entries/` stops at 2026-09-10 and three days of substantial
  work since is recorded only in this file's Done section and in commit messages.

---

## 1. Phase 2 — the profiler — the measurement it exists for

This is the largest real gap in the product's differentiator. Everything else on
this page improves something that already works.

* **CPU load. Nothing produces it.** `pu:CpuLoad` has been defined since Phase 2
  was written. pluginval instantiates and exercises a plugin but does not report
  what it cost, so this needs a host that runs audio through the plugin —
  `lv2bm`, or an in-house one. Until it exists, "measured by running the
  binaries" means a validation verdict and a latency figure, which is true and is
  less than the phase promised.
* **Coverage is 50 of 756, and all of one author's work.** 7%, entirely
  downspout. A figure over one person's plugins is not yet what makes the
  catalogue authoritative, and breadth may matter more than the next tool: the
  flues LV2 bundles are built and to hand.
* **Reproducibility is assumed, not tested.** Two runs of the same plugin on the
  same host, within a stated tolerance. The plan calls for this to be proven and
  the open-time figures now give it something to be measured against.
* **Only the newest run shows on a plugin page.** A plugin measured by both lilv
  and pluginval keeps only the later run's readings, so its port counts disappear
  when it is validated. Documented in `plugin/measurements.sparql`, and right when
  one tool wrote them; with two it loses information.
* **`clap-validator` is not wrapped.** The one format gap that is neither a
  licensing nor a platform problem.
* **No facet dropdown for measurement verdicts.** `?measured=` works; the values
  are `passed` / `ok` / `failed` / `crashed`. The judgement is whether 7%
  coverage should shape everyone's search form — which is an argument for fixing
  coverage first.
* **AU, LADSPA and VST2 are reachable by pluginval and not built for.** AU is
  macOS-only; VST2 needs Steinberg's SDK, which is not redistributable; LADSPA
  and VST2 both ship as a bare `.so`, so the profiler declines to guess which a
  file is. Not work so much as a stated limit.

## 2. Phase 4 — the vendor profile, and proving the payments

Promotion, its compliance and the Stripe integration are built
([plan-done.md](docs/plan-done.md)). Two things are left, and the first is not code.

* **No real money has moved, and the gate is tax registration**, not this
  repository. On [danja-todo.md](docs/danja-todo.md), with the Stripe CLI test
  procedure. Worth knowing when it is run: every payment POST answered 405 until
  2026-09-13, so a delivery tried before then failed for that reason and not
  because of anything in the Stripe setup.

* **Selling a vendor profile — designed, unbuilt, and no longer blocked.** The
  identity it needed now exists, and so does the profile form that the same
  person would fill in first. What is missing is the page and the form. The shape
  that fits what is already built:

  - **Claiming before editing.** An account proves it speaks for a vendor. The
    cheapest credible check is a link or file at a domain the vendor's plugins
    already point at through `foaf:homepage` — a URL the catalogue holds and did
    not get from the claimant. A moderator confirms; the claim is a triple, so it
    is revocable by deleting one. **This replaces the current arrangement**, where
    a moderator confirms on judgement alone with no evidence trail.
  - **Edited prose is CC BY-SA, not CC0**, and goes in the vendor's own prose
    graph — the same split the contributor terms already make. A vendor's blurb
    about themselves is authored text, not a fact about a plugin.
  - **It must not become a way to edit facts.** A profile is the vendor's own
    words next to the catalogue's findings, never on top of them. A `crashed`
    measurement stays `crashed` on a paid profile.
  - **Disclosure.** A claimed profile should say it is the vendor's own, in the
    way a promoted result says it is paid for.
  - Paid or free is a pricing decision, not an architectural one. Giving claiming
    away free while charging for presentation is the option that keeps the
    catalogue accurate — and it is the one consistent with the CC0 reasoning,
    which holds only as long as the pro tier is not quietly redefined as paid
    access to data.

* **The vendor merge mechanism, and `pu:claimsVendor` holding a key rather than
  an IRI**, are both in *Do these first* above — they became concrete when the
  identity layer was wired into the pages, so they are written out once, there.

* **Not started, and not blocking**: the unfiltered query page, on-topic
  advertising, pro-tier API keys, and the blog and reviews section.

## 3. Phase 3b — the rest of the site

Built on the accounts and moderation machinery Phase 3 finished, so none of this
needs new foundations.

* **An admin cannot merge two duplicate plugin entries.** The one Phase 3 exit
  criterion not met. Nothing in the corpus overlaps, so it has not bitten —
  see also *cross-source identity* below, which is the same problem arriving from
  a different direction.

* **An embedding failure is not reported to the moderator who caused it.**
  `/health` now says so to whoever polls it, which closed the larger half. But
  accepting a submission while Ollama is down tells the moderator "indexed and
  searchable" is absent from the message, which is honest and does not tell them
  what to do about it.

* **Routing and CC mappings have no form.** `trn:companion` and
  `trn:targetParameter` reference other plugins and other parameters, so they
  want a picker rather than a text box. Now the only part of the fifty
  hand-written downspout profiles that cannot be supplied through the site.

* **Uploads have no size story beyond the per-file cap.** 2 MB each, no
  per-account quota and no total. **Sharper since 2026-09-14**, when `/submit`
  gained an upload: a picture is stored as soon as it is chosen, so a submission
  that is abandoned leaves the image behind. Content-addressing means a repeat
  costs nothing and only trusted accounts can upload at all, so this is a slow
  leak rather than a hole — but it is now reachable without completing anything. Content-addressing means duplicates cost
  nothing, but nothing stops one trusted account filling the disk.

* **The Resources page is curated prose, and the next step is the store.**
  `/resources` exists with two sections hand-seeded with about forty links.
  Contributors adding to it through the moderation queue, as a `skos:Collection`
  over the existing scheme rather than a new taxonomy, is still the right shape
  and is not built: today adding a link means editing `docs/resources.md`.

  **Links rot, and nothing here notices.** Four of the seeded sites answer 403 to
  an automated request — Cloudflare and the like — so a naive checker would
  report them broken and a checker that worked around the block would be doing
  the thing [sources.md](docs/sources.md) §4 rule 3 forbids. Any link-checking
  this page gets has to treat a 403 as **unknown**, not as dead.

* **Stars** — one per signed-in account per plugin. Needs a vocabulary term, a
  graph decision (a user's own graph, like corrections), and a rate limit. Worth
  thinking about what it is *for* before building it: a popularity signal that
  feeds ranking is a different thing from a display number.

* **An admin area for `TIER.ADMIN` only.** The tier exists and `bin/grant.js`
  sets it; nothing reads it. Account list, trust and suspension, the graph
  registry.

* **A logo, a favicon and a social card of this project's own.** What is served
  now is the hyperdata.it mark, plus a 1200×630 card generated from it against
  the site's dark palette. Replacing them is three files at the repository
  root — `favicon.png`, `favicon.ico`, `og-image.png` — and nothing else: the
  routes, the `<link>`, the `og:image` and the cache headers are already there.
  The card is the one most worth a designer's attention: it is what somebody sees
  before they decide whether to click.

* **A 3D navigable plugin graph** — plugins as nodes, hover for a summary, click
  through to the page. Genuinely differentiating, and the one thing on this list
  that breaks a standing decision: the site is server-rendered with no client
  framework, and this cannot be. Worth doing as a self-contained page that
  degrades to the ordinary search rather than as a dependency the rest of the
  site acquires.

## 4. Phase 5 — open data — two deliverables left

Live: the dumps, the public SPARQL endpoint, the registry view at
`/registry/plugins/index.json`, the MCP face, and `/services` describing all of
it. *Subject to the publish lag at the top of this file.*

* **Contribute upstream.** The user's own plugins to the Open Audio Stack
  registry, and the `trn:` extensions to `~/github/transmission` — in particular
  `trn:PluginFormat`, and retiring `trn:min`/`trn:minimum` in favour of the
  `lv2:` equivalents. This is the operating principle rather than a feature.
* **Submit the dataset to [lod-cloud.net](https://lod-cloud.net/).** The
  catalogue already has what the submission asks for: a public SPARQL endpoint,
  dereferenceable IRIs, dumps with a stated licence, and a VoID description. The
  links out — `lv2:`, `skos:`, `doap:`, `foaf:`, `spdx:` — are what make it worth
  a node rather than an island. Needs the VoID description checked against their
  required fields first, **and the publish lag closed**, or the dataset in the
  diagram is missing its vendors.
* **Profile augmentation from the open web** — videos and reviews, linked not
  copied. The conditional deliverable; the conditions are in
  [plan.md](docs/plan.md) and they are not negotiable.

## 5. Backups — built, waiting to be installed

`bin/backup.js`, `bin/restore.js`, the nightly job and the pull script, all tested. Installing
them is in [docs/danja-todo.md](docs/danja-todo.md). Two things deliberately not done, both
stated in [docs/backups.md](docs/backups.md):

* **Encryption at rest**, if backups ever leave machines the user owns — these graphs hold
  personal data.
* **Retention against erasure.** The contributor terms promise an account can be erased;
  a backup taken beforehand still holds it. Ninety days of essential backups means up to ninety
  days before an erasure is complete everywhere, and an erasure request has to include them.
  **The terms do not currently say so**, which pairs with the contributor-terms review on
  Danja's list.

## 6. Smaller things, not blocking

* **`src/contrib/Submissions.js` is 756 lines**, the longest file in `src/` and well past the
  ~600 CLAUDE.md calls "almost always wants splitting". It is three things: the `SUBMITTABLE`
  field table with its vocabulary composition, the `validate` / `valueTerm` pair, and the
  `Submissions` class that queues and writes. The seam is between the table and the class — the
  table changes when a field is added, the class when the moderation flow changes, and adding
  the platform field touched only the first. `src/contrib/submittable.js` with
  `Submissions.js` re-exporting, so no caller moves.
* **`src/api/render-forms.js` is 613 lines and `src/contrib/routes.js` 592**, both past the
  point CLAUDE.md says to look. The seam in each is the same one: **the submission flow**.
  `renderSubmitPage` plus `renderProfilePastePage` and the field renderer are one subject;
  `submitRoute` plus `profilePasteRoute` and the upload handling are its other half. A
  `src/api/render-submit.js` and a `src/contrib/submit-routes.js`, with the old modules
  re-exporting as `render.js` already does, would leave every caller alone. Worth doing before
  the next thing lands in either.
* **`SearchService.js` is 696 lines and past the point CLAUDE.md says to look.** It was 545
  after the last split; `unindexed()` and the vendor identity loading took it over. **The seam
  is the vendor fold** — `vendorIdentities`, the grouping in `loadDocuments`, `vendor()`,
  `vendorList()`, `vendorAliases` and `vendorIdentityCoverage()` are about a hundred lines that
  change when vendors change, not when retrieval does. `src/search/vendors.js`, with
  `SearchService.js` re-exporting as it already does for ranking, facets and documents, so no
  caller moves. Not urgent, and the longer it waits the more of the vendor-profile work lands
  in the wrong file.
* **Embedding staleness**: `--only-new` embeds plugins with no vector, but cannot see a plugin
  whose *text* changed upstream — the IRI is unchanged, so the stale vector stays. Storing
  `pu:composedTextHash` beside each vector would close it and make a nightly refresh cheap.
  *The most valuable item in this section*: it is the one that silently degrades search, which
  is the whole asset.
* **Cross-source identity**: a plugin in both a local repo and the OAS registry mints two IRIs,
  because the identity tuples are different kinds of thing. Nothing in the corpus overlaps yet,
  so this is a design question rather than a defect — the answer is probably `owl:sameAs` from a
  matching pass, not a change to minting. Same problem as the admin merge above.
* **AUFX-O effect-type alignment is still not asserted.** The LV2 classes in
  `vocabs/categories.ttl` were verified against installed plugins; AUFX-O equivalents for
  reverb, delay and so on need someone who can open the published ontology. Alignments are
  asserted only where the target term has been verified, which is why these are absent rather
  than guessed.
* **No `source`, `accepts` or `produces` dropdown on the search form.** `facetControls` renders
  four of the eleven facets deliberately — a form with eleven selects is a wall — so the rest are
  reachable by URL and from a plugin page but not browsable. `platform` took `source`'s place on
  2026-09-15: "will it run on my machine" disqualifies a plugin before anything else about it
  matters, and source availability is still a badge on every result row. Worth watching for one
  thing — **a plugin with no platform recorded is in no platform's results**, so setting that
  dropdown hides part of the catalogue without saying so. It is not sticky, which is most of the
  defence; if it ever becomes sticky it needs a line on the page saying what it excludes.
* **Nothing derives a platform from a format, and nothing should.** 176 plugins had no platform
  evidence in their packages — 90 source-only GitHub repositories, the 50 downspout plugins, the
  36 flues bundles. Reading LV2 as Linux and VST3 as all three would put an inference in the
  graph where every other fact is evidence, and it would be wrong for several repositories here.
  If it is ever revisited it wants a separate predicate with its own provenance, not
  `pu:supportedPlatform`.

  The route that *is* open is asking whoever knows. flues is done — `bin/ingest.js` states Linux
  for that repository beside its licence, vendor and pricing, which is where a per-repository
  fact belongs, and `tests/harvest/harvesters.test.js` asserts the harvester stays silent
  without it. downspout is the same shape and still open; its README names all four builds. That
  leaves the ~90 GitHub repositories, where the only honest mechanism is a release asset — see
  [docs/danja-todo.md](docs/danja-todo.md).
* **Tooltips where they earn their place.** Measurement metrics already carry labels and units
  from the vocabulary, which is the case that most wants one. Two cautions: a tooltip is
  invisible on a touch screen and to a keyboard user unless built as a proper disclosure, and
  anything important enough to need one is usually important enough to be on the page. So
  `title` for the incidental, a real disclosure for the rest, and neither as a way to make a
  crowded page hold more.
* **The flues repo holds four copies of every bundle** (source, build, staging, release). The
  harvester skips them; the repo would be tidier without them.
* **Record the PURL configuration in this repo**, rather than only in the purl.org account.
  Sharper since the 2026-09-12 outage: a third party's uptime is load-bearing for the
  catalogue's identifiers, and the configuration exists in one place nobody here can read.
* **`vocabs/shapes.ttl` is deliberately not loaded into the store**: SHACL shapes are how the
  store is checked, not part of what it describes. Here so it is not "fixed".

---

## Done

Phases 0, 1, 3 and 5, and the built parts of 2 and 4, are described with their
reasoning in **[docs/plan-done.md](docs/plan-done.md)** — which is where that
narrative now lives, so this file can be a list of what to do. The worklogs are
under [docs/entries/](docs/entries/) and what went wrong is in
[MISTAKES.md](MISTAKES.md).

In one line each, most recent first:

* **2026-09-14** — **Every plugin page offers its own profile.**
  `/plugin/<slug>/profile.ttl` serves the same authored shape `/submit` hands back, built from
  what the catalogue holds — so an author who finds their plugin already here can take the file
  and host it rather than filling in a form for facts we already have. Its own address rather
  than a fourth representation of the plugin IRI: the existing `.ttl` is everything the
  catalogue knows, and negotiating between the two on one address would make
  `Accept: text/turtle` ambiguous.
* **2026-09-14** — **A picture with the submission.** `/submit` takes an upload before the
  Submit button, the same trusted-contributors-only rule the plugin page's upload applies, for
  the same reason: a picture is public the moment it is served, so there is no useful queued
  state. `foaf:depiction` became a `SUBMITTABLE` field — uploaded rather than typed, so no URL
  box invites a hotlink — and the form became multipart, which needed the field allowance
  counted from the field table: a fully ticked form sends 44 fields against the default cap of
  20, and busboy's answer to too many is to stop.
* **2026-09-14** — **Self-hosted plugin profiles.** `/submit` has a *Download profile* button
  beside Submit, producing a `profile.ttl` an author hosts beside their own plugin.
  **`/submit/profile`** is the page for one they have already written — Turtle or JSON-LD,
  recognised by looking at the document rather than by asking. And *Read a page* became **Read a
  page or profile**: the moderator's one fetch now takes a profile URL as readily as a plugin's
  page, deciding which it has **from the body rather than from `Content-Type`**, because static
  hosts and GitHub raw serve `.ttl` as `text/plain`.

  A profile always **drafts into the form** and is saved by the ordinary Submit button, so there
  is one write path through one validator whichever way it arrived. `/about/profiles` carries
  the guidance: why hosting it yourself is better, what the file looks like, where to put it,
  and the two ways to tell us. The round trip found the bug: `pu:category/reverb` is not a legal
  prefixed name, so every generated profile with a category was unparseable.
* **2026-09-14** — `pu:claimsVendor` holds the vendor IRI rather than the folded name, so a
  Pro entitlement survives a vendor merge instead of silently failing on the plugins the merge
  gathered. **Category and Licence on `/submit` are dropdowns**, their options read from
  `vocabs/categories.ttl` and from `LICENCE_IDS` — the list `vocabs/shapes.ttl` enumerates — so
  neither can produce a value the shapes would then refuse. `loadSubmittable()` is now the one
  way to build the field table; six callers were each composing it.
* **2026-09-13** — `/health` compares its two counts and reports `degraded` with a named remedy;
  the *Read a bundle* panel on `/admin`; vendor identity derived by `bin/mint-vendors.js`,
  **and carried to the server**, where it had never been run — 376 vendors and 756 `foaf:maker`
  links now on the public endpoint, with `/vendor/<name>-<hash>` resolving. Found by
  `tests/live/site.test.js` *the published copy is the site's data*, which stayed red through a
  successful publish and so disproved the diagnosis that had been written into three documents;
  in [MISTAKES.md](MISTAKES.md). **And then wired into the pages it was derived for**:
  `vendor/identities.sparql`, `vendorNames()`, the spellings and the IRI on `/vendor/<slug>` and
  its JSON, and `/health` reporting a vendor layer that is absent rather than waiting to be
  asked. Also `/leggere-prima`; a borrowed favicon; the navigation
  reorganised with `/about` as its index; and the plan split into
  [docs/plan.md](docs/plan.md) and [docs/plan-done.md](docs/plan-done.md).
* **2026-09-12** — Stripe checkout and the Pro subscription; plugin profiles submittable *and*
  readable back; `/feedback`, and the 405 that had made every payment POST unreachable; social
  metadata on every page; the submit throbber; `server.js`, `render.js` and `SearchService.js`
  broken up; `bin/serve.js` under test.
* **2026-09-11** — Phase 3 complete: sign-in, corrections, submissions, moderation, trust
  promotion, the wiki. pluginval built into the profiler image and swept over the downspout
  VST3s. Measurements carried to the deployment. Promoted listings, labelled and bounded, with
  `/about/promotion` bound to the code by test. The accessibility pass.
* **2026-09-10 and before** — Phase 5's dumps, endpoint, registry view and MCP face; Phase 1's
  harvesters, normaliser, shapes, hybrid retrieval and read API; Phase 0's foundations. Every
  SPARQL query in a file; all HTML in `templates/`; licence identifiers normalised; vendor
  pages; deployment with a build stamp and a live test suite.
