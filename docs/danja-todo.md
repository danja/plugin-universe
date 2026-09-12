# Danja's list

Things only you can do: server access, credentials, legal, and the decisions
that are yours. [TODO.md](../TODO.md) is what the *project* needs; this is what
*you* need to do.

- [ ] **Add a picture to a plugin.** Open any plugin page while signed in as a
  moderator — the form is under the measurements, above "Suggest a correction".
  It appears only for a trusted contributor or a moderator, and it did not
  appear at all until now: the route existed and the plugin page never offered
  it.
- [ ] **Check a backup carries the images**, once there are any.
  `node bin/backup.js --scope essential` should report "N image(s)". They ride
  in `essential` and `full`, not in `measurements`. Nothing has been uploaded
  yet, so this is untested against real files.

- [ ] **Decide what uploading a picture means, in the contributor terms.** §2 covers facts
  (CC0) and authored prose (CC BY-SA). An image is neither — a screenshot of a plugin is
  usually the *plugin author's* copyright, not the uploader's. Nothing wrong is being claimed:
  the caption under a hosted picture says it is its author's and not the catalogue's. But the
  terms should say what the upload form means before there are many pictures, and that is a
  legal call rather than a coding one. It pairs with the review trigger in §4 below.

- [ ] **Try promoting a plugin**, and tell me if the ranking feels wrong. Sign in as a
  moderator, open `/admin`, and the promotion panel is below the moderation queue — paste a
  plugin slug and press *Promote for a year*. Search for something that plugin genuinely
  matches and it should come first with a **Promoted** label; search for something it does not
  match and it should not appear at all.

  A placement can take first place, per your call — `maxPromotedRank: 1`. It is *permitted*
  first place rather than given it: the boost is a 1.25× multiplier, so a much better match
  still wins. If a vendor ever complains that they paid and are second, that is why, and
  `boostFactor` is the number that would change.

## 2. The announcement, when you are ready

Worth drafting before posting anywhere, because the first thing people ask is
"where did you get my data" and the answer is better given than extracted.



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
* **nginx serves `/image/` and `/dumps/` from disk**, with the right types and
  the security headers repeated in each location. `/dumps/` is browsable and
  `/services` describes the three parts. The config is installed as
  `plugin-universe.com.conf` — the suffix matters, and the runbook said
  otherwise for a while.
* **753 plugins, 753 vectors, 50 measured.** `npm run test:live`: 58 pass.
* Moderator granted, and the first submitted plugin accepted, indexed and
  searchable.
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
