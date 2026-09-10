# Danja's list

Things only you can do: server access, credentials, legal, and the decisions
that are yours. [TODO.md](../TODO.md) is what the *project* needs; this is what
*you* need to do.

**What I cannot see.** I have no access to the server. What I can check is the
public site, and `npm run test:live` does that from here — 52 checks. Anything
below asserted about the deployment came from that, not from looking.

---

## 1. Backups — the one I would do first

Nothing else on this list risks anything irreversible. Accounts, corrections,
moderation decisions, trust levels and wiki revisions exist **only** in Fuseki,
on one disk, with no second copy. Measured: 203 irreplaceable triples against
45,000 that a re-harvest could rebuild. `bin/dump.js` is not a backup — it
deliberately withholds exactly those graphs.

Built and tested. Two commands.

```sh
# on the server
sudo install -m 755 deploy/backup/plugin-universe-backup.sh \
  /etc/cron.daily/plugin-universe-backup
sudo /etc/cron.daily/plugin-universe-backup     # once, to check

# here — pulls to /chalet/plugin-universe-backups, which exists
export PU_SSH_HOST=hyperdata
./deploy/backup/pull-backups.sh
```

Then a cron entry; the runbook is [backups.md](backups.md). The pull runs from
here rather than pushing from the server, so the server holds no credential for
this machine and cannot reach the copies.

- [ ] nightly job installed on the server
- [ ] pull run once here, then a cron entry
- [ ] one deliberate whole-dataset restore rehearsal, before it is needed

## 2. `pluginval` — the only real blocker

A JUCE binary from Tracktion covering VST/VST3/AU/LV2/LADSPA. Without it the
profiler reaches LV2 plugins only, and the 46 built downspout VST3s cannot be
measured at all. Everything else in Phase 2 — CPU load, latency in samples,
reproducibility — is downstream of it.

- [ ] install `pluginval` on whichever machine runs the profiler

## 3. Decisions that are yours

* **How the dumps get served.** `bin/dump.js` writes them to `data/dumps`;
  nothing publishes them. The app has no business streaming tens of megabytes,
  so nginx from disk is the obvious answer — a config change, and I will write
  the location block and a page describing the parts. `/services` currently says
  plainly that no dump is published, which is honest but thin.
* **Whether to publish a minimal attribution record.** CC BY-SA requires naming
  the author of wiki prose. Each revision records the account it is attributed
  to, but the IRI-to-name mapping is in a withheld graph, so the dump alone does
  not say whom to credit. Closing it means publishing IRI and public login and
  nothing else — a decision about personal data I should not take alone.
* **What the front page should show.** Most-recently-added means a run of
  image-less LV2 utilities after the sweep. Accurate, and a poor first
  impression. Alternatives: recent-but-only-with-a-picture, a curated handful,
  or random-but-good.
* **What goes beside the results on a wide screen.** Facets, categories,
  recently added, or a hamburger. A taste question.
* **A sitemap.** `robots.txt` has no `Sitemap:` line because there is no
  sitemap, and pointing at a 404 is the same defect as advertising a contact
  page that does not exist. Worth having for 750-odd plugin pages.
* **When to get the contributor terms properly reviewed.** A second opinion
  judged them adequate and contributions are open on that basis. The trigger for
  a real review is **promotion** — advertising, or taking money for placement —
  because that is when the exposure changes and the DSA/ASA labelling
  obligations arrive alongside it. Worth deciding now who does it.
* **Whether AI crawlers stay welcome.** `robots.txt` does not exclude them, on
  the reasoning that publishing CC0 RDF and an agent-facing API and then
  blocking machines would be incoherent. One `User-agent` block to reverse.
* **Whether wiki images should display.** They currently render as links rather
  than loads, because an image in a wiki page is a URL every reader's browser
  fetches from a third party. Displaying them is a deliberate choice, not a
  missing feature.

## 4. Worth doing when you have a moment

* **Tell the Open Audio Stack people the registry view exists.**
  `/registry/plugins/index.json` publishes the catalogue in their format so
  OwlPlug and StudioRack can read it. Contributing back rather than keeping a
  better copy privately is the operating principle — and **your own plugins are
  in this catalogue and not in theirs**, which is the wrong way round. Worth
  pointing OwlPlug at the URL before announcing anything.
* **Point a real MCP client at the endpoint** — Claude Code or Codex, per
  [/services](/services) — and ask it something like "find me a free
  open-source plate reverb in LV2". I can test the protocol; I cannot test
  whether the tool descriptions help an agent choose, and that is the part most
  likely to be wrong.
* **Commit `data/curation/github-candidates.json`** if you have not. It records
  decisions you made about which repositories to harvest, not output.
* **Re-run `bin/publish.js` after each ingest**, or the public SPARQL copy
  drifts behind. Worth adding to the nightly job beside the backup.

## Standing habits

* **Code change:** `./bin/deploy.sh` on the server, then `npm run test:live`.
* **Data change:** `docker compose run --rm app node bin/ingest.js --only-new`,
  then `docker compose restart app`, then `bin/publish.js`. A restart reuses the
  image, which is right for data and wrong for code.
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
* **Credentials.** The exposed `GITHUB_TOKEN` was revoked and deliberately not
  replaced; an unset token cannot be abused. You will need a new one for the
  next sweep — Settings → Developer settings → Personal access tokens, **no
  scopes**. `GITHUB_CLIENT_SECRET` was cycled too; it was never the leaked one.
* **A personal-data exposure, closed.** An old `sparql.` block proxied to the
  live catalogue and served `graph:system/accounts` to the internet. Removed,
  and `npm run test:live` now checks five plausible SPARQL paths unconditionally
  — not gated on any endpoint being deployed, because "not deployed" is exactly
  the state in which nobody is looking.

## Known, and not wrong

* `data/curation/` is deliberately not gitignored: a reviewed candidate file
  records decisions. `data/dumps/` and `data/backups/` are ignored — they are
  regenerated output.
* Two profiler scan graphs from test runs are still registered. Harmless.
