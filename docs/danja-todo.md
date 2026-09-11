# Danja's list

Things only you can do: server access, credentials, legal, and the decisions
that are yours. [TODO.md](../TODO.md) is what the *project* needs; this is what
*you* need to do.

**What I cannot see.** I have no access to the server. What I can check is the
public site, and `npm run test:live` does that from here. Anything below
asserted about the deployment came from that, not from looking.

## 1. Make yourself a moderator — the queue is invisible without it

`/moderation` exists and is linked from the account bar, but **only for an
account whose trust level is `moderator`**, and there is deliberately no web
route that makes the first one: every such route is a privilege-escalation bug
waiting to be found. Shell access is the correct bar.

```sh
# on the server, in /home/github/plugin-universe
docker compose run --rm app node bin/grant.js --list
docker compose run --rm app node bin/grant.js --login danja --trust moderator
```

Then sign out and back in — the account bar is built from the session, so the
link appears on the next sign-in rather than the next page.

- [ ] grant yourself moderator

## 2. Try submitting a plugin

`/submit` is live for signed-in accounts, linked from the account bar. Worth
walking through once as a real user, because I cannot: the sign-in is GitHub
OAuth and I have no account.

- [ ] submit something — one of your own that is not in the catalogue — and see
  whether the form asks for the right things and refuses the right things
- [ ] then review it in the moderation queue, which now holds proposed plugins
  beside corrections

Two things I decided and you may disagree with: the **homepage is required**,
because it is what identifies a plugin when a person rather than a harvester is
describing it, and **at least one format is required**, because without one the
plugin is invisible to the facet most people filter by first. Formats are
checkboxes — a plugin is commonly built for several, and the catalogue has
always modelled it that way.

## 3. Two findings from the first pluginval sweep

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

## 4. Decisions that are yours

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

## 5. Worth doing when you have a moment

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
* **An accepted submission indexes itself.** Nothing to run — accepting one in
  the moderation queue reloads the documents and embeds the new plugin in the
  running app, and the page says so. If Ollama is down it says that instead, and
  the nightly `--only-new` picks it up.
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
* **Three columns on a wide screen**, on every page that has content to
  navigate away from — search, browse, plugin pages, category pages and the
  submit form. Site links left, content centre, formats and the twelve largest
  categories right — each side column a fixed width in
  rem, so widening the window widens the results and nothing else. Below 58rem
  it stacks: the browse panel behind a toggle at the top, the site links last
  where a footer belongs. No script; the toggle is a checkbox. Twelve of
  twenty-eight categories is settled — `sidebarCategories` in
  `config/preferences.js` if it ever changes.
* **The footer is gone from the three column pages** and is still the footer
  everywhere else, rendered from one template either way.
* **The front page shows plugins with a picture**, and the ordering claim it
  could not support is gone — every plugin shares one `dcterms:created`, so
  "most recently added" was alphabetical wearing a label. Recency becomes a real
  signal after a second ingest spreads the dates; nothing needs changing then,
  the sort is already asked for.
* **Measurements are live.** 50 plugins carry pluginval readings — 45 passed,
  4 failed, 1 crashed — with their labels, units and explanations resolving, and
  288 measurement triples in the public SPARQL copy. The delivery path
  (`bin/backup.js --scope measurements` → rsync → `bin/restore.js --graph`) is
  proven end to end; `bin/backup.js` prints it with your paths filled in.
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
* Two `lv2-scan` graphs from early flues runs are registered here and were
  deliberately **not** carried to the server — only the pluginval run was. They
  measured 7 flues plugins and found the one real disagreement so far (Disyn
  reporting 8 control ports against a profile recording 9). Worth carrying when
  there is a reason to; harmless where they are.
