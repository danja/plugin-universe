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

## Phase 3 — people and pages — auth layer done

Built and tested: `personal-data` licence flag, `src/auth/{Session,GitHubOAuth,Accounts,routes}.js`,
the three routes, and the sign-in state in the header. 255 tests.

**Not yet verified: one real browser round trip.** Everything up to the redirect to GitHub is
exercised, and the callback's rejections are tested, but nobody has actually signed in. Run
`SITE_ORIGIN=http://localhost:4100 node bin/serve.js`, click the link, and check that an account
appears in `<graph:system/accounts>` and the header shows the login.

Next, in order:

* **contributions.** A typed correction — subject, predicate, proposed value, rationale —
  validated against the SHACL shapes before it is written, landing in the contributor's CC0
  graph. This is the first write of catalogue data by a person.
* **the two graphs per contributor**, `graph:user/<id>-facts` and `-prose`, registered with
  their respective licences at first contribution.
* **the review queue** and the trust threshold that empties it.
* **CSRF tokens** on the contribution forms. The OAuth flow has its state check; ordinary form
  posts have nothing yet, and the moment there is a form that changes data they need one.
* **wiki pages** with revisions as graph resources.

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

## Outstanding, not blocking

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
