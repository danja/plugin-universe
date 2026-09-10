# Danja's list

Things only you can do: server access, credentials, legal, and the decisions
that are yours rather than mine.

`TODO.md` is what the *project* needs. This is what *you* need to do next, in
order. Done items are struck out at the bottom rather than deleted, so the list
stays short without losing the record.

**What I cannot see.** I have no access to the server. What I *can* check is the
public site, and `npm run test:live` does that from here — 29 checks, five
seconds. Anything below asserted about the deployment came from that, not from
looking at the machine.

---

## 1. Deploy the build stamp — one command, then it gets easier

There is uncommitted work in the tree: `/health` now reports which **code** is
running, plus `bin/deploy.sh` and the tests around it.

```sh
# here
git status                 # read it; there are new files as well as changes
git add -A && git commit   # your call on the message
git push
```

```sh
# on the server
cd /home/github/plugin-universe
./bin/deploy.sh
```

That is the whole deploy from now on. It pulls (`--ff-only`, so a diverged
branch stops rather than being merged by a script), stamps the commit, builds,
starts, then polls `/health` and **refuses to claim success unless the running
container reports the commit it was just given**. It touches code only — data
is a separate decision and it says so on the way out.

Then from here:

```sh
npm run test:live          # expect 29 of 29
```

Until that first stamped build the live suite fails one check, because
`/health` reports a null commit — meaning *nobody can tell what is deployed*,
which is where we were before this existed. Everything else passes.

- [ ] committed and pushed
- [ ] `./bin/deploy.sh` on the server
- [ ] `npm run test:live` — 29 of 29

---

## 2. Rotate the harvesting token — before anything else touches GitHub

**The `GITHUB_TOKEN` was exposed twice** in an earlier session: once by an IDE
selection putting it in the transcript, once by a `docker compose config` I ran
that printed the resolved environment. This blocks §3.

- [ ] revoke the current token at https://github.com/settings/tokens
- [ ] issue a new one — **no scopes**, public repository metadata only
- [ ] update `.env` here **and** on the server
- [ ] `docker compose up -d app` on the server so the new value reaches the
      container (an `.env` edit alone does not)

The OAuth App client secret was not printed and does not need rotating unless
you would rather be sure.

---

## 3. Run the GitHub sweep

Built, tested, and never run at scale — this machine's connection is why it was
left for the server. Needs §2 done first.

```sh
cd /home/github/plugin-universe
docker compose run --rm app node bin/discover.js --merge
```

That writes `data/curation/github-candidates.json` and **ingests nothing**. It
is a bind mount, so read and edit it on the host.

- Only rows marked `include` are harvested.
- A repository with no recognised licence is listed and not included. That is
  policy ([resources.md §4](resources.md), rule 7) and needs no attention.
- What is worth your eye is whether anything obviously good was *missed* by the
  topic search. Worth seeding: the DISTRHO and MOD organisations, and any
  repository already named by a harvested plugin's `foaf:homepage`.

```sh
docker compose run --rm app node bin/ingest.js --github data/curation/github-candidates.json
docker compose restart app          # data changed, not code
npm run test:live                   # from here, afterwards
```

Watch the ingest output for `N categories are in the data but not in
vocabs/categories.ttl`. A repository's own tags can introduce a category nothing
defines; it is written with a label and no definition, and reported. Tell me and
I will write the concepts.

- [ ] discovery run, candidate file reviewed by a person
- [ ] sweep ingested, app restarted
- [ ] `data/curation/github-candidates.json` committed — it records decisions
      you made, not output

---

## 3b. Re-ingest, when convenient

Not urgent, and not a blocker. Two things landed that only take effect on the
next ingest:

* **The ontologies now go into the store.** `vocabs/plugin-universe.ttl`,
  `trn-extensions.ttl` and `trn-profile.ttl` were served from disk and were not
  in the graph at all, so every `pu:` and `trn:` IRI in the published data
  pointed at a document the endpoint holding the data could not read. Until the
  re-ingest, the profiler's measurement labels fall back to bare local names on
  the live site.
* The corrected `pu:Latency` definition, and units on the metrics.

```sh
cd /home/github/plugin-universe
docker compose run --rm app node bin/ingest.js --only-new
docker compose restart app
```

- [ ] re-ingested, whenever it suits

## 3c. The wiki is built and needs deploying with the rest

`/plugin/<slug>/wiki/edit` writes community notes, kept as revisions, licensed
CC BY-SA and attributed to whoever wrote them. It is on the same deploy as
everything else in §1 — `./bin/deploy.sh` — and needs **no ingest**, though the
ontology re-ingest in §3b is still worth doing.

Worth knowing before anyone else uses it:

* **Prose is sanitised by not emitting anything dangerous** rather than by
  cleaning up afterwards. Raw HTML never survives parsing, link schemes are
  filtered, and images render as links rather than loads — an image in a wiki
  page is a URL every reader's browser fetches from a third party. If you want
  images to display, that is a decision to take deliberately.
* **The terms now cover this.** Prose is the CC BY-SA half, which is what the
  second opinion was about; the editor says so before anyone types.
* Rate limited to 20 saves an hour per account, and a save built on a stale copy
  is refused rather than overwriting.

- [ ] deployed with §1
- [ ] write one page yourself and see whether the editor is pleasant to use

## 3d. Dumps exist but nothing serves them

`node bin/dump.js` writes the publishable dataset to `data/dumps` — CC0,
permissive-with-notices, and CC BY-SA prose in three parts, with a manifest and
a VoID description. Personal data is withheld by the licence flag, reported on
every run, and a test asserts a withheld graph can never produce a file.

Two things need you:

* **How they get served.** The app has no business streaming tens of megabytes;
  nginx serving `data/dumps` from disk at `/dumps/` is the obvious answer, and
  it is a config change on the server rather than code. Say the word and I will
  write the location block and a `/data` page describing the parts.
* **Attribution for the prose.** CC BY-SA requires naming the author, and each
  revision records the account it is attributed to — but the account-IRI-to-name
  mapping is in a withheld graph, so the dump alone does not tell a consumer
  whom to credit. The README states that plainly rather than papering over it.
  Closing it properly means publishing a minimal public attribution record —
  IRI and public login, nothing else — which is a decision about personal data
  and not one I should take silently.

- [ ] decide how dumps are served
- [ ] decide whether to publish a minimal attribution record

## 4. Blockers

**`pluginval` is not installed anywhere.** A JUCE binary from Tracktion covering
VST/VST3/AU/LV2/LADSPA, and the thing that would let the 46 built downspout VST3s
be measured at all. Without it Phase 2 reaches LV2 plugins only, and nothing else
in the profiler is waiting on anything.

---

## 5. Decisions that are yours

- **Plugin images.** 560 plugins show a thumbnail hotlinked from the Open Audio
  Stack registry's GitHub Pages site, with a caption saying so. The alternative
  is caching them locally with a recorded source. Hotlinking is a request to
  someone else's server on every page view; caching is a copy of someone else's
  image. I picked hotlinking as the smaller imposition and made it lazy and
  referrer-free. Say if you would rather cache.
- **AI and automated crawlers are allowed** by `robots.txt`, deliberately:
  publishing a CC0 catalogue with content-negotiated RDF and an agent-facing API
  and then blocking machines would be incoherent. It is one `User-agent` block
  to reverse if you disagree.
- **The public SPARQL endpoint's default graph.** On the deployed store a query
  with no `GRAPH` clause sees everything (`tdb2:unionDefaultGraph true`); a
  store built by hand answers the same query with nothing. Nothing in the app is
  affected — every query names its graph and a test enforces that — but a
  stranger writing `SELECT * WHERE { ?s ?p ?o }` at `sparql.` gets everything or
  nothing depending on a setting they cannot see. Decide which, and publish the
  answer in the VoID description rather than leaving it to be discovered.
- **AUFX-O effect types.** The category scheme aligns to LV2 classes I verified
  against the plugins installed here. AUFX-O equivalents for reverb, delay and
  so on are *not* asserted, because I could not check the published ontology. If
  you can open it, the missing alignments are an hour's work.
- **When to get the terms properly reviewed.** A second opinion judged them
  adequate and contributions are open on that basis; `docs/contributor-terms.md`
  now says exactly that rather than claiming a sign-off it did not have. The
  trigger for a real review is **promotion** — advertising the site, or taking
  money for placement — because that is when the exposure changes and when the
  DSA/ASA labelling obligations in Phase 4 arrive alongside it. Worth deciding
  now who does it, so it is not the thing holding up a launch.
- **A sitemap.** `robots.txt` has no `Sitemap:` line because there is no
  sitemap, and pointing at a 404 is the same defect as a user agent advertising
  a contact page that does not exist. Worth having for 752 plugin pages — say
  the word.

---

## Standing habits

- **After a code change:** `./bin/deploy.sh` on the server, then
  `npm run test:live` from here.
- **After a data change:** `docker compose run --rm app node bin/ingest.js --only-new`
  then `docker compose restart app`. A restart reuses the existing image, which
  is right for data and wrong for code.
- **`npm run test:live` is the check that matters** — it is the only one that
  can see a container that was never rebuilt, an ingest run on the wrong
  machine, an expired certificate or a broken redirect.
- **Ask me to update this file** when it drifts. It is meant to be short.

---

## Confirmed done

Struck out rather than deleted, so the record survives.

- ~~DNS, certificates, the nginx snippet, the PURL redirect chain~~ — verified
  from outside by the live suite: http→https, HSTS, the www name, and
  `purl.org` → `hyperdata.it` → `plugin-universe.com` carrying `Accept:
  text/turtle` through four redirects.
- ~~Deploy of the corrections, moderation, images, listing and category work~~ —
  serving, 752 plugins, index and corpus in step, sign-in enabled.
- ~~The dated ingest~~ — `dcterms:created` written and preserved across
  re-harvest. Every plugin currently carries the same date, which is honest:
  that run is the first time the catalogue recorded any. Ordering becomes
  meaningful for what is added after it.
- ~~The enriched category scheme~~ — definitions, synonyms and LV2 alignments
  live; "overdrive", "brickwall" and "reverberation" find the right plugins.
- ~~SHACL validation against the new shapes~~.
- ~~`/robots.txt`~~ — serving, byte-identical to the repository copy.
- ~~First moderator~~ — `danja`, set with `bin/grant.js`. The moderation queue
  is linked from the account bar.

## Known and not wrong yet

- **`sparql.plugin-universe.com` returns 404 and `mcp.` does not resolve.** Both
  are Phase 5. Worth knowing the DNS for one exists and the other does not, so
  there is no half-configured subdomain quietly serving the main site.
- Two profiler scan graphs from test runs are still registered
  (`graph:profiler/lv2-scan-…`). Harmless, and they will be joined by real ones.
- The flues repository holds four copies of every bundle (source, build,
  staging, release). The harvester skips them; the repository would be tidier
  without them.
- Propose the `trn:` extensions upstream to `~/github/transmission` — in
  particular `trn:PluginFormat`, and retiring `trn:min`/`trn:minimum` in favour
  of the `lv2:` equivalents.
