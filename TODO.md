# TODO

## Done

* ~~lists of data sources, forums, general resources~~ — [docs/resources.md](docs/resources.md)
* ~~dataset licence~~ — **CC0** for facts, **CC BY-SA** for user-authored prose
* ~~IRI namespace~~ — `http://purl.org/stuff/plugin-universe/`
* ~~terms-of-service review~~ — [docs/resources.md §4](docs/resources.md); KVR excluded
* ~~register the domain~~ — plugin-universe.com
* ~~Phase 0: foundations~~ — config, vocabularies, SPARQL store with per-graph licensing,
  persisted vector index, embedding pipeline
* ~~Phase 1 core~~ — harvesters for downspout and flues, normaliser, ingest pipeline with
  IRI-collision detection, hybrid retrieval with an IDF-weighted lexical signal, read API
  with content negotiation, server-rendered search UI
* ~~open-audio-stack registry harvester~~ — 559 plugins, CC0, with the packaging layer
  (checksummed downloads, platforms, architectures) that the seed corpus had no source for
* ~~SHACL shapes~~ — `vocabs/shapes.ttl`, run by `npm run validate` and before every write
* ~~AUFX-O and schema.org alignment graph~~ — `vocabs/alignment.ttl`

## Next — get it live, then sweep

Deployment is built and verified: the image builds, carries no `.env`, and serves 645 plugins
against live Fuseki and Ollama with a passing container healthcheck; compose and nginx
configurations both validate. See [docs/deployment.md](docs/deployment.md).

The DNS, the certificates and the nginx snippet were all done in a later session — the site
serves, sign-in works against the live GitHub OAuth App, and the IRI chain was checked end to
end with `curl -sL -H "Accept: text/turtle"` surviving both hops. purl.org holds one rule
redirecting `/stuff/` to `https://hyperdata.it/xmlns/`; everything that might change is on our
own server.

Anything still needing a person at a terminal has moved to
[docs/danja-todo.md](docs/danja-todo.md), which is the list to work from.

## Then — run the sweep on the server

The GitHub harvester is built and tested; what remains is running it somewhere with
bandwidth. This host's connection makes a bulk sweep impractical, so the two steps are
separated deliberately:

```sh
node bin/discover.js --merge      # writes data/curation/github-candidates.json — review it
node bin/ingest.js --github data/curation/github-candidates.json
```

Discovery writes a file and ingests nothing. Only rows marked `include` are harvested, and a
repository with no recognised licence is listed but not included, because silence is not
permission. Each repository gets its own graph carrying its own licence.

* review the candidate list once it exists. Unlicensed repositories are skipped by policy
  (resources.md §4 rule 7) and need no attention; what is worth a look is whether anything
  obviously worth having was missed by the topic search
* consider seeding it with the DISTRHO and MOD organisations, and with repositories already
  named by harvested plugins' `foaf:homepage`
* the embedding step is incremental, so a GitHub sweep only embeds what it adds

## Phase 1 follow-on — the front page and the taxonomy

Search works; what surrounds it did not. Three items from `docs/todo-misc.md`, all of them
Phase 1 territory rather than new phases, and two of them the same defect: data harvested and
never displayed, therefore never verified (MISTAKES.md pattern 3).

* ~~**plugin images**~~ — done. 560 of the 645 plugins had `foaf:depiction` from the OAS
  registry and nothing rendered it. Now a thumbnail in each result and a captioned figure on the
  profile page, in the JSON-LD as `schema:image` and in the Turtle as `foaf:depiction`.
  Hotlinked rather than copied, so: https only (an http image on an https page is blocked as
  mixed content, silently), `referrerpolicy="no-referrer"` so the image host is not told which
  plugin a reader was looking at, lazy with fixed dimensions so a page of results is not 25
  blocking requests to someone else's server, and a caption naming the host — attached to the
  image rather than to the provenance block, which does not always render.
* ~~**a browsable listing under the search box**~~ — done, with the vocabulary it needed.
  `dcterms:created` now means *first seen by this catalogue* (no source states a release date the
  others agree with). `IngestPipeline` reads the existing dates **before** the re-harvest drops
  the graph and carries them across, because a date that resets every run would make "recently
  added" a list of whatever was harvested last; `tests/store/first-seen.test.js` proves that over
  three runs. Anything with no date sorts last, not first. One rule decides the front page: a
  query is ranked and capped at 25, anything else — facets or nothing at all — is a paged browse,
  10 per page from `RETRIEVAL_CONFIG.browsePageSize`, facets carried through the pager.
  * **the existing 645 plugins have no date until they are re-harvested.** The first dated run
    stamps everything it writes with that run's time, so ordering only becomes meaningful for
    what is added after it — which is honest, because nobody knows when the rest arrived. Worth
    doing as part of the GitHub sweep rather than as a separate pass.
* ~~**more SKOS in the taxonomy**~~ — done. The scheme was 28 concepts using four predicates,
  because it was a JavaScript object literal of parent links inside `PluginSerialiser.js`. It is
  now an ontology, [`vocabs/categories.ttl`](vocabs/categories.ttl), loaded by
  `src/rdf/CategoryScheme.js`: 337 triples over the same 28 concepts, each with a definition,
  alternative labels, and `skos:closeMatch` to the LV2 plugin classes — every one of which was
  verified against the LV2 plugins installed on the development machine rather than assumed.
  `lv2:EffectPlugin` is deliberately not asserted because it could not be confirmed, and
  `pucat:amp` is `lv2:SimulatorPlugin` rather than `lv2:AmplifierPlugin`, which means a gain
  stage — a false friend recorded in a `skos:scopeNote`.
  * Alternative labels feed the **lexical** signal only, not the composed text the embeddings
    are built from: adding them there would invalidate 645 stored vectors for a signal the
    lexical index gives away free. "overdrive" now returns dm-SD1, dm-TubeScreamer and
    Schrammel OJD; "brickwall" returns three limiters.
  * Category pages show the definition, the synonyms, the parent, the children, related
    categories and the LV2 alignment; `/category/<slug>.ttl` serves the whole concept rather
    than a stub.
  * **AUFX-O effect-type alignment is still not asserted.** `vocabs/alignment.ttl` maps
    structure and stops at terms that could be confirmed; the same rule applied here, so
    `aufx:` equivalents for reverb, delay and so on await a pass that can check the published
    ontology.

## Found while surfacing the measurements

* ~~**The project's own vocabularies were not in the store.**~~ `vocabs/plugin-universe.ttl`,
  `trn-extensions.ttl` and `trn-profile.ttl` were served from disk at `/ns/<name>.ttl` and were
  absent from the graph entirely, so every `pu:` and `trn:` IRI in the published data resolved
  to a document the endpoint holding that data could not read. A SPARQL query could not ask
  what a term meant — which is how the profiler's metric labels, defined in the vocabulary and
  nowhere else, were unavailable to the code that had to display them. `bin/ingest.js` now
  loads all three, one graph each. **This needs a re-ingest on the server to take effect.**
* `vocabs/shapes.ttl` is deliberately still not loaded: SHACL shapes are how the store is
  checked, not part of what it describes.

## HTML moved out of code

`render.js` was 705 lines of mostly markup. Pages are now `templates/*.html`, loaded by name
through `src/api/Templates.js` — the same discipline as `sparql/queries/`, with `{{escaped}}`
and `{{{raw}}}` placeholders, no loops and no conditionals, and every placeholder required in
both directions. `site.css` is a file rather than a JavaScript template literal, which is where
a backtick in a comment silently broke the build once.

* ~~`src/api/server.js` past the threshold~~ — 557 now. The wiki's routes moved to
  `src/wiki/routes.js` beside the rest of the wiki, and the response helpers to
  `src/api/respond.js` so a feature's routes can live with the feature. The corrections and
  moderation routes are the next candidates if it grows again.
* `tests/api/templates.test.js` fails on an orphaned template, on a stray `${...}`, and if
  `.dockerignore` ever excludes `templates/`; `createServer` renders a page at startup so a
  deployment missing the directory refuses to start.

## Phase 2 — the profiler — started

Built and verified: the sandbox (`src/profiler/Sandbox.js`), the lilv scanner,
the measurement model, per-run graphs. `node bin/profile.js --path <built bundles>`.

* **pluginval** — the main gap. Not installed here; it is a JUCE binary from
  Tracktion and covers VST/VST3/AU/LV2/LADSPA, so it is what would let the 46
  built downspout VST3s be measured at all.
* **CPU load** needs a host that runs audio through the plugin — `lv2bm`, or an
  in-house one. `pu:CpuLoad` is defined and nothing produces it yet.
* ~~surface measurements on the plugin profile page, and as a search facet~~ — done. The
  readings now appear on the plugin page with the tool, host and date beside them, in the JSON
  representation, and as a `measured=<verdict>` filter and facet. Showing them found two
  defects in minutes, which is the argument for showing data: a scan time rendered as a bare
  "364" when only the vocabulary knew it meant milliseconds, and `pu:Latency` carrying a
  boolean while the vocabulary defined it as a count of samples.
  * The **facet has no dropdown in the search form** yet, deliberately: 7 measured plugins out
    of 752 is not a control worth putting in front of everyone. The filter works by URL and the
    facet is in `/facets`. Add the dropdown when coverage justifies it.
  * `pu:Latency` is now defined as the boolean a *scan* can establish — whether the plugin
    declares latency at all — and `pu:LatencySamples` is the number a running host would
    report. Nothing produces the latter yet; it needs the same host that CPU load does.
* reproducibility: two runs of the same plugin on the same host, within a stated
  tolerance. The plan calls for this to be tested rather than assumed.
* the scan currently matches a plugin by `owl:sameAs` to its LV2 IRI, so it only
  reaches LV2 plugins the catalogue already holds. VST3 needs a different key.

## Phase 3 — people and pages — the correction loop closes

Built and tested: `personal-data` licence flag, `src/auth/{Session,GitHubOAuth,Accounts,routes}.js`,
the three routes, sign-in state in the header, and sign-in verified end to end in a real browser
both locally and on the live server.

~~contributions~~, ~~the two graphs per contributor~~, ~~CSRF~~, ~~the moderation queue UI~~,
~~trust promotion~~, ~~rate limiting~~ — done. A signed-in reader suggests a correction from the
plugin page; it is validated and queued or applied by trust level; a moderator accepts or rejects
it at `/moderation`; an accepted one lands in `graph:user/<id>-facts` under CC0 without
overwriting the harvested statement, and five acceptances promote the contributor to `trusted`,
after which their corrections apply on arrival. Rejections stay in the queue marked rejected.

`bin/grant.js` makes the first moderator, from a shell on the server. There is deliberately no web
route that does this.

`tests/store/contributions.test.js` covers the whole loop against the live store — the threshold,
the two decision paths, re-review of a decided correction, and the hourly limit counted from the
store rather than from memory.

Next, in order:

* ~~**wiki pages** with revisions as graph resources~~ — done. The CC BY-SA half is live: prose
  on each plugin page, an editor at `/plugin/<slug>/wiki/edit`, every version kept at
  `.../wiki/history`, and old revisions readable. Nothing is edited or deleted — a save writes a
  new revision superseding the last through `prov:wasRevisionOf`, so reverting is itself a
  revision. Each author's revisions go to their own `-prose` graph, so attribution and erasure
  both work by graph.
  * **Sanitisation without a dependency.** `marked` does not sanitise. Rather than clean the
    HTML afterwards, `src/wiki/markdown.js` stops the dangerous constructs being emitted: raw
    HTML tokens are dropped, so nothing in the output is markup marked did not itself build;
    link schemes are filtered, because `[x](javascript:…)` passes through marked untouched
    (verified, not assumed); and images render as links rather than loads, since an image in a
    wiki page is a URL every reader's browser fetches from a third party. 21 tests written as
    attacks.
  * **A conflicting save is refused**, with the current version handed back and the editor's own
    text kept. Silently overwriting somebody's work is the one thing a wiki must not do.
  * Free text into SPARQL literals is covered by `tests/store/wiki.test.js`, which round-trips
    quotes, backslashes, newlines, `"""` and an injection payload, then asserts the graph the
    payload named was never created.
* ~~**a contributions page** per account~~ — done, at `/contributions`, linked from the account
  bar. Shows every suggestion with its status, the decision date, and how far a new contributor
  is from the trust threshold. Their own only: a pending correction sits in the personal-data
  graph and carries the contributor's own words about why they think something is wrong.
* ~~contributor terms need legal review~~ — a second opinion judged them adequate to open
  contributions on (2026-09-09). Not a lawyer's sign-off, and `docs/contributor-terms.md` says
  so; it is due another look **before the site is promoted**, which is when the exposure
  changes. Contributions are no longer blocked.

## Phase 3 — the plan

[docs/plan.md](docs/plan.md) has the detail. Decisions taken: GitHub OAuth only (no credential
ever stored, no scopes requested, deliberately not `user:email`); contributions reviewed first
then trusted; scope is accounts + corrections + wiki, with comments, rankings and vendor
submissions deferred to 3b.

Two things to settle before writing code:

* **A GitHub OAuth App** is needed — client id and secret into `.env` as `GITHUB_CLIENT_ID` /
  `GITHUB_CLIENT_SECRET`, plus a `SESSION_SECRET` for the cookie HMAC. The callback URL is
  `https://plugin-universe.com/auth/callback`, so it cannot be registered until DNS and TLS
  are live.
* ~~**Contributor terms** drafted~~ — [docs/contributor-terms.md](docs/contributor-terms.md),
  and as of 2026-09-09 in force: a second opinion judged them good enough to open contributions
  on. Still the one document in this repository with legal effect, so it is due a proper review
  **before the site is promoted**.
* an [About page](docs/about.md) is drafted too. Both are written to be served at
  `/about` and `/terms` once there is a route for them.

## Phase 3b — the rest of the site

Built on the accounts and moderation machinery that Phase 3 finished, so none of this needs new
foundations.

* **an admin area**, for `TIER.ADMIN` only — currently one person. The tier exists and
  `bin/grant.js` sets it; nothing reads it yet. Account list, trust and suspension, the graph
  registry, and whatever the moderation page should not carry.
* **a Plugin Resources page and a Developers page** — categorised links: what a plugin *user*
  wants, and what someone *writing* one does (JUCE, DPF, the LV2 and CLAP specs, validators).
  Curated first, then persisted in the store so signed-in contributors can add to them through
  the moderation queue that already exists. Resources are a natural `skos:` collection over
  the same category scheme rather than a new taxonomy.
* **the wide-screen layout.** Small screens are right now; a large one shows a single narrow
  column with empty space either side. Wants a hamburger or a sidebar with something worth
  putting in it — facets, categories, recently added — rather than a wider measure, which would
  make the prose harder to read, not easier.
* ~~**text stored as Markdown, rendered with templating and marked**~~ — done for everything
  authored: wiki prose is Markdown in `pu:wikiText`, the standing documents are the
  repository's own files, and both render through `marked` into `templates/`. A plugin's
  `rdfs:comment` stays plain text on purpose — it is a harvested fact in whatever form the
  source wrote it, and treating a source's text as markup would render somebody else's
  punctuation as formatting.

## Phase 4 — pro tier

[docs/plan.md](docs/plan.md) has the detail; nothing here is started.

* **company and developer profiles**, so a paying vendor can present themselves: a page per
  vendor, claimed by a verified account, with their plugins listed. The `pu:vendor` IRIs are
  already minted, so the identity half exists — what is missing is claiming, and the labelling
  rules that come with anything paid (DSA Art. 26/39, and the ASA's advice against "sponsored"
  as the word).

## Phase 5 — open data — started

* ~~**CC0 dataset dumps, assembled by licence flag**~~ — `bin/dump.js` and
  `src/store/DumpBuilder.js`. Three parts because three sets of terms cannot honestly be merged:
  `cc0/` public domain, `notice/` permissive with the notices beside them, `prose/` CC BY-SA
  share-alike. One file per graph — Turtle carries no graph name, so a merged file would lose
  the provenance the whole design is built around — plus `MANIFEST.json`, `void.ttl` and a
  README. Graphs flagged not redistributable are never written and are **reported every time**:
  a dump that quietly omits something is as hard to trust as one that quietly includes it.
  * `shareAlike` is now a flag on `LICENCES`, because CC BY-SA was being filed as merely
    notice-carrying. Share-alike governs what a consumer may build from the data, and only that
    decides which dataset it belongs in.
  * A rebuild clears the section directories first. It did not, and reclassifying the prose left
    a copy in `notice/` — the same text published twice under two different sets of terms.
* **Nothing serves the dumps yet.** They are written to `data/dumps`; deciding how they are
  published — nginx from disk is the obvious answer, since the app has no business streaming
  tens of megabytes — is in `docs/danja-todo.md`.
* Still to do in this phase: the public SPARQL endpoint at `sparql.`, the MCP face, the
  open-audio-stack-compatible JSON view, and contributing the user's own plugins upstream.

### The conditional link-out deliverable

[docs/plan.md §Phase 5](docs/plan.md) has the detail. One item from `docs/todo-misc.md` belongs
here rather than earlier, because it is the conditional link-out deliverable and it is the one
place in this project where the rules bite hardest:

* **profile augmentation from the open web** — videos and reviews found by search, linked from
  the plugin page. Constraints, none of them optional:
  - **KVR is excluded from harvesting** (CLAUDE.md, resources.md §4). A *link* to a KVR review
    page is not harvesting and is not excluded; copying a word of the review, a rating, or a
    substantial part of their listing is. The line is: store the URL and our own label for it,
    nothing of theirs.
  - **A source gets a row in [resources.md §4](docs/resources.md) before a line of code**, as
    every other source has. That review is where "link-out only" is written down and checked.
  - **Do not scrape a search engine.** DuckDuckGo's HTML endpoint is scraping whatever it is
    called, and working around a bot check is forbidden by rule. Use a sanctioned API — the
    YouTube Data API for videos — or nothing.
  - Such graphs are `proprietary-linkout`, non-redistributable, and excluded from the CC0 dump
    by the flag rather than by anyone remembering at publication time.
  - Links rot. A link-out graph needs re-checking on a schedule and a way to record a dead link,
    or the catalogue slowly fills with 404s that look like data.

## Backups — nothing else on this list matters as much

Until Phase 3 the store held nothing that could not be rebuilt: drop it all, re-run the
harvesters, and the catalogue comes back. That stopped being true the moment a stranger could
write to it. Corrections, moderation decisions, trust levels, accounts and wiki revisions exist
**only** in Fuseki. There is no second copy and no way to reconstruct them, and a contributor
whose work is lost does not contribute twice.

* **a daily, dated backup of every graph**, run on the server. `bin/dump.js` is not this: it
  publishes what may be published and deliberately withholds accounts and pending corrections,
  which are exactly the graphs that cannot be rebuilt. A backup wants everything, including the
  withheld graphs, and wants to be restorable rather than readable.
* **a one-off backup script** to run before anything risky — an ingest that drops graphs, a
  Fuseki upgrade, a schema change.
* **a restore script, and a test that it works.** An untested backup is a belief, not a backup.
  Restoring into a scratch dataset and counting triples is the cheap version of proving it.
* Retention and where they live: the server has one small disk, so dated backups need a
  rotation policy and ideally somewhere off the machine.

## Recurring — not a phase, a habit

* **Keep [docs/danja-todo.md](docs/danja-todo.md) current.** Anything needing server access,
  credentials, legal review or a decision belongs there rather than in this file, and it is
  worth revising at the end of any session that changes it. It goes stale in one direction —
  completed steps accumulate at the top and the next real action sinks — so pruning matters
  more than adding. Finished items are struck into its "Confirmed done" section, not deleted.
* **Run `npm run test:live` after every deploy.** It is the only check that sees the deployment
  rather than a copy of it: a container never rebuilt, an ingest run on the wrong machine, an
  expired certificate, a broken redirect. `./bin/deploy.sh` verifies the commit stamp by itself,
  but only the live suite checks the site.
* **Re-read this file and MISTAKES.md when starting something structural.** The recurring
  failure in [CLAUDE.md](CLAUDE.md) — two files that must change together with nothing
  connecting them — has cost more than any other class of defect here, and it is cheapest to
  catch before the second file is forgotten rather than after.
* check docs/todo-misc.md for any new items, fit these into the main TODO.md or phased plan as appropriate

## Outstanding, not blocking

* **rewrite README.md around the method, not the inventory.** The interesting claim this project
  can make is how language-model techniques and Semantic Web techniques work together: embeddings
  find what a person meant, the ontology says what the answer *is*, and each covers the other's
  weakness — retrieval without hallucination, structure without hand-curation at scale. The
  ontologies are the load-bearing part and should be the centre of it: `trn:` for behaviour,
  `lv2:` for parameters, SKOS for the taxonomy, per-graph provenance and licensing as a
  structural property rather than a policy. Worth writing once the taxonomy work above lands, so
  it describes what is there.
* **the default graph is not the same store everywhere.** `config/fuseki/assembler-tdb2.ttl`
  sets `tdb2:unionDefaultGraph true`, so on the deployed store a query with no `GRAPH` clause
  sees every named graph at once. The development endpoint this repo talks to was not created
  from that assembler, so the same query there matches nothing — no error, just an empty result.
  Nothing in the application is affected, because every query names its graph, and
  `tests/rdf/QueryService.test.js` now asserts that so it stays true. What it does affect is
  **the public SPARQL endpoint in Phase 5**: a stranger writing `SELECT * WHERE { ?s ?p ?o }`
  gets everything or nothing depending on a setting they cannot see. Decide which it should be,
  and publish the answer in the VoID description rather than leaving it to be discovered.
* configure the PURL redirect from `http://purl.org/stuff/plugin-universe/` to plugin-universe.com,
  and record that configuration in this repo rather than only in the purl.org account
* point plugin-universe.com DNS at a host; decide whether to also register the `.it` and redirect
* propose the `trn:` extensions upstream to `~/github/transmission` — in particular
  `trn:PluginFormat`, and retiring `trn:min`/`trn:minimum` in favour of `lv2:`
* the flues repo has four copies of every bundle (source, build, staging, release); the
  harvester now skips them, but the repo itself would be tidier without them
* cross-source identity: a plugin present in both a local repo and the OAS registry currently
  mints two IRIs, because the identity tuples are different kinds of thing. Nothing in the
  current corpus overlaps, so this is a design question rather than a defect — the answer is
  probably `owl:sameAs` from a matching pass, not a change to minting.
* embedding throughput: `--only-new` now embeds just the plugins with no vector, which covers
  the common case of a sweep adding a few. What it cannot see is a plugin whose *text* changed
  upstream — its IRI is unchanged, so the stale vector stays. The index records no text hash to
  compare against; storing `pu:composedTextHash` beside each vector would close that, and would
  make a nightly refresh cheap instead of a fifty-minute rebuild.
