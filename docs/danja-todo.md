# Danja's list

Things only you can do: server access, credentials, legal, and the decisions
that are yours. [TODO.md](../TODO.md) is what the *project* needs; this is what
*you* need to do.

**What I cannot see.** I have no access to the server. What I can check is the
public site, and `npm run test:live` does that from here. Anything below
asserted about the deployment came from that, not from looking.

---

## 1. Two steps to finish the backups

Everything else is done and verified: the nightly job on the server, the pull to
`/chalet/plugin-universe-backups` at 07:17, and a restore rehearsal that found a
real defect before it was needed.

**Re-install the job and its configuration**, once you have pulled — the
installed copy is still the older one, which writes files world-readable:

```sh
sudo install -m 755 deploy/backup/plugin-universe-backup.sh \
  /etc/cron.daily/plugin-universe-backup
sudo install -m 644 deploy/backup/plugin-universe-backup.default \
  /etc/default/plugin-universe-backup
sudo /etc/cron.daily/plugin-universe-backup
```

The second file carries `PU_BACKUP_GROUP=danny`. Without it the permissions hold
only because you set them by hand, and tomorrow's backup undoes that.

**Rehearse a restore on the server.** It touches nothing without `--into`:

```sh
docker compose run --rm app node bin/restore.js \
  /var/backups/plugin-universe/essential/<stamp>
```

Reading what it prints tells you whether the backup holds what you think. Doing
it now means the first time you read that output is not during an incident.

- [ ] job and configuration re-installed
- [ ] restore rehearsed on the server

## 2. `pluginval` — the only real blocker

A JUCE binary from Tracktion covering VST/VST3/AU/LV2/LADSPA. Without it the
profiler reaches LV2 plugins only, and the 46 built downspout VST3s cannot be
measured at all. Everything else in Phase 2 — CPU load, latency in samples,
reproducibility — is downstream of it.

- [ ] install `pluginval` wherever the profiler runs

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
  random-but-good.
* **What goes beside the results on a wide screen.** Facets, categories,
  recently added, or a hamburger. A taste question.
* **A sitemap.** `robots.txt` has no `Sitemap:` line because there is no
  sitemap, and pointing at a 404 is the same defect as advertising a contact
  page that does not exist. Worth having for 750-odd plugin pages.
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
