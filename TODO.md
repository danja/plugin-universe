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
* **The profile form is built; two of its fields are not.** *2026-09-12:* `/submit` grew from
  seven fields to twelve — `trn:role`, `trn:accepts`, `trn:produces`, `trn:requires` and
  `trn:caution` alongside the original name, homepage, vendor, description, formats, category
  and licence — and `/about/profiles` explains what each is for and why it is worth the
  trouble. One form, not two, so `SUBMITTABLE`, the shapes and the serialiser still cannot
  drift apart.

  The choices are read from `vocabs/trn-profile.ttl` at startup by
  `src/rdf/ProfileVocabulary.js` — 11 roles, 8 signal types, 2 host requirements — rather than
  copied into JavaScript, the same arrangement `CategoryScheme` has. A term added to the
  vocabulary appears in the form with no code change, and the form cannot offer something
  `vocabs/shapes.ttl` would then refuse.

  What was deliberately left out, and is still out:

  - **Ports and parameters are not in the form and should not be** — they arrive by URL
    instead. *2026-09-13:* `/admin` has a *Read a bundle* panel: a moderator pastes a plugin
    slug and the URL of an LV2 plugin's `.ttl`, and the ports, their ranges, units and scale
    points, the signal types and any host requirement are read and written, attributed, into
    that moderator's CC0 graph. One fetch, through `PageReader`'s defences, following no
    redirect — `docs/sources.md` §4 rule 8, the same bound as the submission form's URL box.
    Additive only: it writes what the plugin has not got and reports what it left alone.

    **The thing that would have made it useless.** A bundle is two files. `manifest.ttl` says
    `a lv2:Plugin` and points at the real description with `rdfs:seeAlso`; that file carries
    the ports and types the plugin by *subclass* — `lv2:AudioPlugin` — never as the bare class.
    `readBundleDataset` looks for `lv2:Plugin`, which is right when the harvester has read a
    whole bundle from disk and finds nothing at all in the file that has the data. Following
    the `seeAlso` would be a second fetch, which rule 8 forbids, so `typeAsPlugins` supplies
    the missing assertion locally: a subject with `lv2:port` is a plugin. Found by running it
    against a real bundle rather than a fixture; `tests/fixtures/lv2/` now has that shape.
  - **Routing and CC mappings reference other plugins and other parameters.** `trn:companion`
    and `trn:targetParameter` need something to point *at*, so they want a picker rather than a
    text box. Still a later pass, and now the only part of the fifty hand-written downspout
    profiles that cannot be supplied through the site.

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
* **The Resources page is curated prose, and the next step is the store.** `/resources` exists
  with two sections — producers and developers — hand-seeded with about forty links. The
  original plan was for contributors to add to it through the moderation queue, as a
  `skos:Collection` over the existing scheme rather than a new taxonomy. That is still the
  right shape and is not built: today adding a link means editing `docs/resources.md`.

  **Links rot, and nothing here notices.** Four of the seeded sites answer 403 to an automated
  request — Cloudflare and the like — so a naive checker would report them broken and a checker
  that worked around the block would be doing the thing `docs/sources.md` §4 rule 3 forbids.
  Any link-checking this page gets has to treat a 403 as "unknown", not as "dead".
* **A logo, and a favicon of this project's own.** What is served now is the hyperdata.it mark
  as a placeholder. Replacing it is two files at the repository root and nothing else — the
  route, the `<link>` and the cache headers are already there.
* **A 3D navigable plugin graph** — plugins as nodes, hover for a summary, click through to the
  page. Genuinely differentiating, and the one thing on this list that breaks a standing
  decision: the site is server-rendered with no client framework, and this cannot be. Worth
  doing as a self-contained page that degrades to the ordinary search rather than as a
  dependency the rest of the site acquires.

## Phase 4 — pro tier — promotion built, payments not started

* **Vendors have identities — and the profile that hangs on one does not exist yet.**
  *2026-09-13:* `bin/mint-vendors.js` derives a `pu:Vendor` per vendor, with `foaf:name`, a
  `pu:vendorKey` and a `skos:altLabel` for every other spelling met, and links each plugin with
  `foaf:maker`. 363 vendors over 645 plugins, in the curated `vendors` graph, CC0 and in the
  dump. `trn:vendor` still holds exactly what each source said; the identity is asserted beside
  it, never over it.

  **Derived rather than harvested**, which is a deliberate departure from what this entry used
  to say. A harvester sees one source's graph and a vendor's identity is a fold *across*
  sources — "danja" appears in four of them — so minting at harvest time would produce one
  vendor resource per source per name, which is the problem rather than the fix.

  Three of the four defects are now closed: a rename keeps the IRI (it is minted from the
  fold, not from the display name, which a test caught when the first version was not); there
  is a resource to attach a description, a logo or an owning account to; and the minted IRI
  dereferences — `/vendor/danja-ba40c9e0` and `/vendor/danja` reach the same page.

  **The fourth is still open, and always was a human question.** "danja" (50 plugins) and
  "Danny Ayers" (36) are one person, and nothing derivable from the strings will ever say so.
  What has changed is that there is now something to assert it *about*: merging them means
  adding an `skos:altLabel` and repointing, and there is no mechanism for that yet. A curated
  merge file read by `bin/mint-vendors.js` is the obvious shape — the reviewed-candidates file
  the GitHub sweep uses is the precedent.

  Also still open: `pu:claimsVendor` holds the folded key rather than the vendor IRI. The two
  join on the fold, so nothing is broken, and moving it means migrating claims — of which
  there are currently none.

* **Selling a vendor profile.** Not started. **The identity it needed now exists** (above), so
  this is no longer blocked — what is missing is the page and the form, not the foundation. The
  shape that fits what is already built:

  - **The profile form is the other half of this, and it is now built** (see Phase 3b). A
    vendor who has filled in their own plugins is the same person who wants a claim confirmed,
    and the form requires `foaf:homepage` — which is the URL the domain check below reads, and
    which the catalogue therefore holds without having got it from the claimant.
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
* **Payments: Stripe, first increment built.** *2026-09-12:* a signed-in account can buy a
  promoted listing. `src/billing/Billing.js` configures the client and verifies webhooks,
  `src/billing/routes.js` has the two routes, and `Promotions.grantPaid()` is a second door into
  promotion authorised by a payment rather than by a moderator. Hosted Checkout, so no card
  detail reaches this server and no client-side framework is needed.

  Pricing is set in the sandbox: **€10 one-time** for one plugin for a year, **€99/year** for
  Pro, which promotes as many of a vendor's plugins as they like. Both are found by Stripe
  lookup key rather than a price id, so changing either is a dashboard action.

  **The Pro tier is built too.** `/billing/subscribe` and `/billing/portal`, the account page at
  `/account`, and the entitlement: a Pro subscriber promotes their own plugins without paying
  per plugin.

  Two things settled in the building that are worth keeping.

  - **A paid tier is an entitlement with an expiry, checked when it is read.** `effectiveTier()`
    grants nothing to a tier whose `pu:tierEndsAt` has passed, and a tier with *no* expiry
    counts as no tier. So a renewal extends, and silence lapses. The alternative — grant on
    purchase, revoke on a cancellation message — fails in the expensive direction: a lost
    delivery leaves somebody paid-up for ever with nothing to notice. A placement included in a
    subscription takes the tier's own end date, so cancellation needs no handling at all.
  - **"Your plugins" needed something to stand on.** `trn:vendor` is a bare string with no link
    to an account, so without a check the entitlement would mean "promote anything". A
    **moderator confirms** which vendor an account speaks for (`pu:claimsVendor`, the folded
    key), and the route requires all three of: Pro, currently effective, and this plugin is that
    vendor's. Confirming is on `/admin`.

  **Still to do.** The claim is confirmed by hand with no evidence trail beyond the moderator's
  judgement. The check worth adding is the one in the vendor-profile design: a file or link at a
  domain the vendor's plugins already point at through `foaf:homepage` — a URL the catalogue
  holds and did not get from the claimant.

  **Two things are not the code's to settle.** Italian tax registration is on Danja's list and
  gates going live — Stripe's own onboarding is what will stop an unregistered account taking
  real money. And `docs/sources.md` §4 names payment as the trigger for a real legal reading
  of the contributor terms; that is still outstanding.

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
  and KVR content is not; a source gets a row in [sources.md §4](docs/sources.md) before any
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
* **No `accepts` or `produces` dropdown on the search form.** `facetControls` renders four of
  the ten facets deliberately — a form with ten selects is a wall — so these are reachable by
  URL and from a plugin page but not browsable. Whether they earn a place on the form is an
  editorial question and the answer probably depends on whether anyone uses the links.
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
  `docs/sources.md` §4 rule 8 is what bounds it, written before the code.
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
* **Plugin profiles can be submitted** — five behavioural fields on `/submit`, their choices
  read from `vocabs/trn-profile.ttl` rather than copied into code, and `/about/profiles`
  explaining what a profile buys the person filling it in.
* **And can now be read back.** `trn:accepts`, `trn:produces` and `trn:requires` had been
  harvested since Phase 0 into 181, 189 and 57 plugins and selected by no query, so they were
  on no page and in no result. They are on the plugin page, in the JSON, in `/facets`, in the
  MCP tool, and `?accepts=` / `?produces=` filter — which makes "what can follow this?" a link
  rather than a question the catalogue silently held the answer to. In MISTAKES.md; the
  facet-to-filter binding is now a table rather than a chain of `if`s.
* **`/feedback`, and the 405 it uncovered.** A signed-in account can write to the moderators;
  the message is an RDF record like a correction, queued, and shown on `/admin` where the only
  thing that can be done to it is mark it read. It is stored **as personal data, not as a
  contribution** — see `src/contrib/Feedback.js` for why that distinction is the whole design:
  everything else a person writes here lands in a graph with a publication licence on it, and
  nobody writing in to say the search is confusing agreed to CC0 or CC BY-SA.

  Building it found that the read-only method guard, which runs before any route module, did
  not list the billing paths. **Every payment POST had been answered 405** — checkout,
  subscription, portal and Stripe's webhook — so no payment could ever have completed. In
  MISTAKES.md; the guard is now one list and `tests/store/server-starts.test.js` POSTs to all
  ten write routes against a running server.
* **A favicon, borrowed.** `/favicon.png` and `/favicon.ico` are served from the repository
  root through `STATIC_FILES`, linked from every page by `<link rel="icon">`. The image is the
  **hyperdata.it mark, the owner's own design, standing in** until this project has one. Serving
  it needed `staticFile` to stop reading with `'utf8'` — it had been text-only since robots.txt
  was the only static file, and the first binary one would have been silently mangled by the
  decode and shown as a broken icon.
* **`/leggere-prima`** — `docs/read-me-first.md` in Italian, cross-linked with the English. The
  layout learned a `lang` attribute for it: it was hardcoded `lang="en"`, and a screen reader
  given Italian prose in an English document reads it with English phonetics.
* **The navigation, from the inbox.** The footer is five links in a chosen order — About,
  Services, Promotions, Plugin profiles, Contact — Vendors is the first group in the right-hand
  column, and **`/about` is now the index** for everything else the site says about itself.
  That last part is what makes the first possible: `tests/api/linked-routes.test.js` requires
  every route to have something linking to it, so the pages dropped from the footer had to land
  somewhere real rather than just disappear. The contributor terms are the exception — they sit
  in the licence line beneath the list, because they must be one click away from every page and
  a licence sentence is where they belong.
* **`server.js`, `render.js` and `SearchService.js` broken up.** 1247, 1189 and 744 lines became
  298, 238 and 545, with the route groups and page kinds in modules of their own — the layout is
  in [CLAUDE.md](CLAUDE.md). No caller changed: `render.js` re-exports the whole rendering
  surface and `SearchService.js` the ranking, facet and document helpers, so the split is an
  arrangement of the code rather than a change to how anything uses it. Behaviour is unchanged
  but for one thing that could not survive being looked at: the `/admin` page was rendered by
  four nearly identical blocks and one of them had lost the vendor-claims panel.
* **`bin/serve.js` is now under test.** `tests/store/server-starts.test.js` starts it and asks
  for a page. Two failures have now got past 867 passing tests and a `node --check` by being
  wiring rather than logic; both are in MISTAKES.md.
* **`trn:` terms are written for a reader** — "Control MIDI" and "MIDI Generator" rather than
  `ControlMidi` and `MidiGenerator`, from `rdfs:label`, on every role and signal on a plugin
  page. The label is the link text and the local name is still the link target, so the URL
  keeps resolving. The lookup comes from the same filled field table `/submit` is built from,
  so the form and the page cannot come to spell a term differently.
* **A plugin page's identifiers resolve** — formats and roles to the filtered search,
  categories to their concept pages, the licence to SPDX where it is really an SPDX identifier,
  the plugin's own IRI through its PURL, and **the author's canonical IRI**, preserved with
  `owl:sameAs` on 86 plugins and shown nowhere until now. Found while testing the escaping: the
  JSON-LD block at the foot of every plugin page could be closed by any value containing
  `</script>` — latent, never exploited, now escaped and tested.
