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

## 1. Deploy — the standing routine

Everything through the wiki and the templates is live: `/health` reports
`fad5d1b`, which is HEAD. Nothing is outstanding here except the habit.

```sh
# here
git add -A && git commit && git push
# on the server
cd /home/github/plugin-universe && ./bin/deploy.sh
# here again
npm run test:live
```

`./bin/deploy.sh` pulls `--ff-only`, stamps the commit, builds, starts, and
refuses to claim success unless the running container reports the commit it was
just given. It touches code only. A **data** change wants
`docker compose run --rm app node bin/ingest.js --only-new` and then
`docker compose restart app` — a restart reuses the image, which is right for
data and wrong for code.

**One small fix is waiting for the next deploy**: clicking "Edit" on a wiki page
while signed out returned raw JSON, and now redirects to sign-in and back again.
The live suite has one failing check until then, and that is the check working.

- [ ] deploy the sign-in redirect with whatever lands next

## 2. Credentials — closed

**Nothing outstanding.** The exposed credential was `GITHUB_TOKEN`, the personal
access token used for harvesting. It has been revoked and **deliberately not
replaced**, which resolves the exposure better than rotating would have: a
revoked token that does not exist cannot be abused.

Verified rather than assumed — the app runs with `GITHUB_TOKEN` unset and
reports sign-in, contributions and the wiki all enabled. Nothing in the serving
path constructs a GitHub client. The token has exactly two users, both commands
run by hand: `bin/discover.js` and `bin/ingest.js --github`.

**You will need one again** the next time you sweep or refresh a repository.
It is not part of the OAuth App and needs no new GitHub App — it lives at
Settings → Developer settings → **Personal access tokens** → Generate new token
(classic), with **no scopes ticked**. Put it in `.env` on the server, run the
sweep, and revoking it again afterwards is a perfectly reasonable habit.

Two things done along the way that were not the leak, and cost nothing:

* `GITHUB_CLIENT_SECRET` cycled. That is the OAuth App secret, used only in the
  sign-in callback exchange.
* All user tokens revoked on the OAuth App. This changed nothing here:
  `GitHubOAuth.identify()` uses a user's token once to call `/user` and never
  returns it to the caller, so there was none stored to revoke. Sessions are
  HMAC cookies signed with `SESSION_SECRET` and are independent of GitHub, so
  nobody was signed out — someone signing in may see GitHub's authorize prompt
  once more, and that is all.

## 3. The GitHub sweep — running now

Running as of 2026-09-10. Built and tested but never run at scale before — this
machine's connection is why it was left for the server.

When it finishes, two things are worth doing: read the output for
`N categories are in the data but not in vocabs/categories.ttl` (a repository's
own tags can introduce a category nothing defines — tell me and I will write the
concepts), and commit `data/curation/github-candidates.json`, because it records
decisions you made rather than output.

The commands, for reference and for the next time:

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

## 5. Backups — built, needs installing

Written and tested; the runbook is [backups.md](backups.md). Two commands to
put it in service.

**On the server**, nightly:

```sh
sudo install -m 755 deploy/backup/plugin-universe-backup.sh \
  /etc/cron.daily/plugin-universe-backup
sudo /etc/cron.daily/plugin-universe-backup     # once, to check it works
```

**Here**, pulling to `/chalet/plugin-universe-backups/` (the directory exists):

```sh
export PU_SSH_HOST=hyperdata          # whatever your ssh alias is
./deploy/backup/pull-backups.sh
```

Then a cron entry, in `docs/backups.md`.

The pull runs from here rather than pushing from the server, so the server holds
no credential for this machine — whatever compromises it cannot reach the
copies. Only the `essential` scope crosses the wire by default: 203 triples
against 45,000 rebuildable ones, because accounts, contributions and wiki
revisions exist nowhere else and everything else is a copy of something public.

`tests/store/backup.test.js` backs a graph up, destroys it, restores it and
compares — on every store run. An untested backup is a belief.

- [ ] install the nightly job on the server
- [ ] run the pull here once, then add the cron entry
- [ ] one deliberate whole-dataset restore rehearsal, before it is needed

Two things I did **not** do, both noted in the runbook: no encryption at rest,
since both ends are yours and the wire is SSH — revisit if backups ever leave
for storage you do not own, because these graphs hold personal data. And
retention is not tied to erasure: ninety days of essential backups means up to
ninety days before an erasure the terms promise is complete everywhere. That is
defensible, it is not automatic, and if someone asks to be erased the backups
are part of the job.

## 6. Decisions that are yours

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
- **What the front page should show.** It lists most-recently-added, which after
  the GitHub sweep means a run of image-less LV2 utilities — accurate, and a
  poor first impression for a visitor who has never seen the site. The
  alternatives are worth a thought: most recently added but only what has a
  description and a picture, or a curated handful, or random-but-good. Whatever
  it is, it is an editorial decision rather than a technical one.
- **The wide-screen layout.** Small screens are right now; a large one shows a
  single narrow column with space either side. The fix is not a wider measure —
  that makes prose harder to read — but something worth putting beside it:
  facets, categories, recently added, or a hamburger. Which of those you want is
  a taste question, and it is yours.
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
- ~~The wiki~~ — deployed and serving. Prose on each plugin page, an editor,
  every revision kept, CC BY-SA and attributed. Sanitised by not emitting
  anything dangerous rather than by cleaning up afterwards; images in wiki text
  render as links rather than loads, which is a decision you can revisit.
- ~~HTML out of the code~~ — pages are `templates/*.html` now. Nothing in `src/`
  contains markup, and a deployment missing `templates/` refuses to start
  rather than serving 500s.

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
