# TODO

## Recurring

* check docs/todo-misc.md for any new items, fit these into the main TODO.md or phased plan as appropriate

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

Left to do on the server itself, none of it code:

* point DNS for `plugin-universe.com`, `www`, `api`, `sparql` and `mcp` at the host
* issue certificates, then `docker compose --profile proxy up -d`
* install `deploy/nginx/hyperdata-xmlns.conf` as `/etc/nginx/snippets/plugin-universe-xmlns.conf`
  and `include` it from the hyperdata.it server block — it is a snippet, not a site config.
  purl.org already redirects `/stuff/` to `https://hyperdata.it/xmlns/`, so that one rule is
  all purl.org ever needs to hold — everything that might change is on our own server. Then
  check that `curl -sL -H "Accept: text/turtle" http://purl.org/stuff/plugin-universe/plugin/<slug>`
  comes back as Turtle, which proves negotiation survives both hops.

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

## Phase 2 — the profiler — started

Built and verified: the sandbox (`src/profiler/Sandbox.js`), the lilv scanner,
the measurement model, per-run graphs. `node bin/profile.js --path <built bundles>`.

* **pluginval** — the main gap. Not installed here; it is a JUCE binary from
  Tracktion and covers VST/VST3/AU/LV2/LADSPA, so it is what would let the 46
  built downspout VST3s be measured at all.
* **CPU load** needs a host that runs audio through the plugin — `lv2bm`, or an
  in-house one. `pu:CpuLoad` is defined and nothing produces it yet.
* surface measurements on the plugin profile page, and as a search facet
  ("passes validation", "under 2% CPU")
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

* **wiki pages** with revisions as graph resources — the CC BY-SA half, still untouched. The
  `-prose` graph is registered and empty.
* **a contributions page** per account, so a person can see what they proposed — and the account
  bar has nowhere to point at present except the moderation queue.
* **contributor terms need legal review** before submissions are opened to anyone but the
  maintainer. `docs/contributor-terms.md` is marked draft.

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
* ~~**Contributor terms** drafted~~ — [docs/contributor-terms.md](docs/contributor-terms.md).
  **Still needs review by a lawyer before submissions open.** It is the one document in this
  repository with legal effect, and it is currently one person's plain-language statement of
  intent. The intent is settled; the wording is not verified.
* an [About page](docs/about.md) is drafted too. Both are written to be served at
  `/about` and `/terms` once there is a route for them.

## Phase 5 — open data and link-out — not started

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
