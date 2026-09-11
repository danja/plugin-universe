# Danja's list

Things only you can do: server access, credentials, legal, and the decisions
that are yours. [TODO.md](../TODO.md) is what the *project* needs; this is what
*you* need to do.

**What I cannot see.** I have no access to the server. What I can check is the
public site, and `npm run test:live` does that from here. Anything below
asserted about the deployment came from that, not from looking.

## 1. The live catalogue has no measurements — carry them over

Everything the profiler has ever measured lives in the Fuseki on **this**
machine. The deployment has none: `measured=passed` returns 0, the `measured`
facet does not appear, and `/about/measurements` is a published page explaining
readings nobody can see.

Four commands, all on you because they need the server:

```sh
node bin/backup.js --scope measurements       # prints the rest for you
rsync -a <the dir it names>/ danny@hyperdata.it:/tmp/measurements/
```

then on the server. **Run the restore twice** — the first time with no `--into`,
because it prints the dataset name to use, and that name comes from
`SPARQL_DATASET` in the server's environment, which this machine cannot know.
Naming the wrong one is refused, and the refusal is easy to lose in a long
`docker compose run`. That is what happened on the first attempt.

```sh
docker compose run --rm -v /tmp/measurements:/measurements app \
  node bin/restore.js /measurements                       # what it would do
docker compose run --rm -v /tmp/measurements:/measurements app \
  node bin/restore.js /measurements --into <name it printed>
docker compose run --rm app node bin/ingest.js --vocabs-only
docker compose run --rm app node bin/publish.js
docker compose restart app
curl -s https://plugin-universe.com/health                # "measured" > 0
```

- [ ] carry the measurements over, then `npm run test:live`

**A choice while you are there.** The backup will offer three runs: two `lv2-scan`
graphs over the same flues directory fifty seconds apart, and the pluginval run.
The two lv2 scans are the ones this file has been calling "harmless" — they were,
while nothing published them. Only the newest run shows on a plugin page, so
carrying both is untidy rather than wrong; `--graph <iri>` on the restore takes
one at a time if you would rather carry just the later one.

## 2. Two findings from the first pluginval sweep

`pluginval` is built into the profiler image and has been run over all 51 built
downspout VST3s. It found two things in **your** code, which is the catalogue
doing its job on the one repository you can act on:

- [ ] **`sidecar.vst3` segfaults** under pluginval's `Automation` test at
  strictness 5. Reproduce with
  `node bin/profile.js --path ~/github/downspout/build/bin --tool pluginval --dry-run`,
  or on that one plugin alone. It is recorded in the catalogue as `crashed`.
- [ ] **Four bundles contain no binary** — `chipper`, `damiano`, `skream`,
  `worms` each have `Contents/x86_64-linux/` and nothing in it. They are
  recorded as `failed`, with pluginval's own words ("the plugin binary is
  missing or damaged"), and will read that way until the build is fixed and the
  profiler re-run.

Nothing here needs server access. The profiler runs on this machine.

## 3. Decisions that are yours

* **How the dumps get served.** `bin/dump.js` writes them to `data/dumps` and
  nothing publishes them. nginx from disk is the obvious answer — the app has no
  business streaming tens of megabytes — and I will write the location block and
  a page describing the parts. `/services` currently says plainly that no dump is
  published, which is honest but thin.
* **Whether to publish a minimal attribution record.** CC BY-SA requires naming
  the author of wiki prose. Each revision records the account it is attributed
  to, but the IRI-to-name mapping is in a withheld graph, so the dump alone does
  not say whom to credit. Closing it means publishing an IRI and a public login
  and nothing else — a decision about personal data I should not take alone.
* **What the front page should show.** Most-recently-added means a run of
  image-less LV2 utilities after the sweep: accurate, and a poor first
  impression. Recent-but-only-with-a-picture, a curated handful, or
  random-but-good. **Easier to answer now:** `/` no longer has to be the
  exhaustive browse list — that is `/plugins` — so whatever `/` shows is a
  glimpse of ten, and nothing is lost by curating it.
* **What goes beside the results on a wide screen.** Facets, categories,
  recently added, or a hamburger. A taste question.
* **A sitemap.** `robots.txt` has no `Sitemap:` line because there is no
  sitemap, and pointing at a 404 is the same defect as advertising a contact
  page that does not exist. Worth having for 750-odd plugin pages. **Easier to
  answer now:** the list is `/`, `/plugins` and its pages, the category pages
  and the plugin pages. `/search` stays out, and `robots.txt` already says so.
* **When to get the contributor terms properly reviewed.** A second opinion
  judged them adequate and contributions are open on that basis. The trigger for
  a real review is **promotion** — advertising, or taking money for placement —
  because that is when the exposure changes and the DSA/ASA labelling
  obligations arrive with it. Worth deciding now who does it.
* **Whether AI crawlers stay welcome.** `robots.txt` does not exclude them, on
  the reasoning that publishing CC0 RDF and an agent-facing API and then
  blocking machines would be incoherent. One `User-agent` block to reverse.
* **Whether wiki images should display.** They render as links rather than
  loads, because an image in a wiki page is a URL every reader's browser fetches
  from a third party. A deliberate choice, not a missing feature.

## 4. Worth doing when you have a moment

* **Tell the Open Audio Stack people the registry view exists.**
  `/registry/plugins/index.json` publishes the catalogue in their format, so
  OwlPlug and StudioRack can read it. Contributing back rather than keeping a
  better copy privately is the operating principle — and **your own plugins are
  in this catalogue and not in theirs**, which is the wrong way round. Point
  OwlPlug at the URL before announcing anything.
* **Point a real MCP client at the endpoint** — Claude Code or Codex, per
  [/services](/services) — and ask it something like "find me a free
  open-source plate reverb in LV2". I can test the protocol; I cannot test
  whether the tool descriptions help an agent choose, and that is the part most
  likely to be wrong.
* **Commit `data/curation/github-candidates.json`** if you have not. It records
  decisions you made about which repositories to harvest, not output.
* **A new `GITHUB_TOKEN`** whenever you next sweep. Settings → Developer
  settings → Personal access tokens, **no scopes**. The old one was revoked and
  deliberately not replaced; revoking it again afterwards is a reasonable habit.

## Standing habits

* **Code change:** `./bin/deploy.sh` on the server, then `npm run test:live`.
* **Data change:** `docker compose run --rm app node bin/ingest.js --only-new`,
  then `docker compose restart app`, then `bin/publish.js` — or the public
  SPARQL copy drifts behind. A restart reuses the image, which is right for data
  and wrong for code.
* **Vocabulary change:** `node bin/ingest.js --vocabs-only`, then restart the
  app. The store holds its own copy of `vocabs/*.ttl`, and it is that copy that
  tells a plugin page what `pu:OpenTimeCold` means.
* **Profiler run:** measure here, then `node bin/backup.js --scope measurements`
  and carry it over — it prints the steps. Profiling on the server competes with
  serving, and measurements carry their platform precisely so they need not be
  made where they are served.
* **Profiler run:** `docker build -f docker/profiler.Dockerfile -t plugin-universe-profiler .`
  once, then `node bin/profile.js --path <dir of built plugins> --tool pluginval`.
  Add `--dry-run` to see the verdicts without writing anything.
* **`npm run test:live` is the check that matters** — the only one that sees the
  deployment rather than a copy of it.
* **Ask me to prune this file** when it drifts. It is meant to be short.

## Confirmed done

* Deployment: DNS, certificates, the nginx snippet, the PURL chain end to end.
* Sign-in, corrections, the moderation queue, trust promotion, rate limiting.
* The wiki, deployed and serving.
* The GitHub sweep, ingested.
* Plugin images, first-seen dates, the paged front page, the SKOS taxonomy.
* `robots.txt`, the build stamp on `/health`, `bin/deploy.sh`.
* The public SPARQL endpoint, on a separate published dataset.
* The MCP endpoint, and `/services` describing every way in.
* Backups: nightly on the server, pulled here nightly, restore rehearsed.
* **`pluginval`.** Built from a pinned commit into the profiler image and run
  over the downspout VST3s. 45 pass, 1 crashes, 4 have no binary. The profiler
  now reaches VST3, and `pu:LatencySamples` — defined since Phase 2 and produced
  by nothing — has values.
* SSH keys for `danny`, and password authentication disabled on the server.
* **Credentials.** The exposed `GITHUB_TOKEN` was revoked and not replaced; an
  unset token cannot be abused. `GITHUB_CLIENT_SECRET` was cycled too, though it
  was never the leaked one.
* **A personal-data exposure, closed.** An old `sparql.` block proxied to the
  live catalogue and served `graph:system/accounts` to the internet. Removed,
  and `npm run test:live` now checks five plausible SPARQL paths
  unconditionally — not gated on any endpoint being deployed, because "not
  deployed" is exactly the state in which nobody is looking.

## Known, and not wrong

* `data/curation/` is deliberately not gitignored: a reviewed candidate file
  records decisions. `data/dumps/` and `data/backups/` are ignored — regenerated
  output.
* There is very little irreplaceable data yet: one account, no corrections, no
  wiki revisions. The backup machinery is proven before there is anything to
  lose, which is the right order.
* Two profiler scan graphs from test runs are still registered. Harmless.
