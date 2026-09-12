# Danja's list

Things only you can do: server access, credentials, legal, and the decisions
that are yours. [TODO.md](../TODO.md) is what the *project* needs; this is what
*you* need to do.


## One-off

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

- [ ] **purl.org was down on 2026-09-12**, and `npm run test:live` fails on the one test that
  follows the PURL chain. **Nothing here is broken** — 57 of 58 live tests pass, the site
  serves normally, and purl.org answers on neither port 80 nor 443 while archive.org (same
  operator) and everything else responds in under a second. The test now says so in as many
  words instead of "TypeError: fetch failed".

  What is actually broken while it lasts: dereferencing a plugin IRI. Anyone following
  `http://purl.org/stuff/plugin-universe/plugin/<slug>` — which is how an RDF consumer reaches
  the catalogue, and what the IRIs promise — gets nothing. Browsing and searching are
  unaffected.

  Check with `curl -sSI http://purl.org/stuff/plugin-universe/`. Nothing to do but wait.

  **If it happens repeatedly, there is a decision behind it.** The minting base was chosen so
  IRIs survive a change of serving domain, and that reasoning is sound — but it makes a third
  party's uptime load-bearing for the catalogue's identifiers. `w3id.org` is the usual
  alternative and is configured through a public GitHub repository rather than a web form,
  which makes it easier to fix when it breaks. Moving would mean either re-minting every IRI or
  carrying `owl:sameAs` for ever, so it is not worth doing over one outage — only over a
  pattern. Worth noting the dates if you see it again.

- [ ] **A security review and pentest of the whole system**, including the rest of the server —
  your idea from the inbox, and the right time is before the announcement rather than after the
  traffic. Worth being specific about scope when you set it up: the things most worth attacking
  here are the **Fuseki update endpoint** (bound to 127.0.0.1; publishing it by accident is the
  worst mistake available), **`/admin`** and the promotion and moderation writes behind it, the
  **image upload** path, the **moderator URL fetch** in `PageReader` (which makes the server
  issue a request somebody else chose — `checkFetchable` is the defence and the TOCTOU in it is
  documented), and **`graph:system/accounts`**, which was readable on the public internet once
  already. `npm run test:live` checks five plausible SPARQL paths unconditionally because of
  that incident. Everything outside this repository is yours alone to judge.

- [ ] **Read the contact page as a stranger would.** `/about/contact` is the one place the
  address lives now, and it was assembled from three earlier copies with different framings.
  Your name, your address, your voice — worth an edit before it is advertised. Same for
  `/about`, which nobody has re-read since the site gained measurements, vendors, promotion and
  a wiki.

- [ ] **Try the site with the keyboard alone**, before you announce. Tab from the top: the
  first stop should be "Skip to content", which was not there until now. Everything focusable
  should show a visible ring in both light and dark. If anything traps focus or hides it, that
  is worth knowing before the traffic arrives rather than after.

- [ ] **`bin/publish.js`, when you get a moment.** The public SPARQL copy holds 753 plugins and
  the site holds 754 — it lags by one accepted submission. Harmless, and it is the standing
  habit already in this file rather than a new job; worth doing before the announcement so the
  endpoint and the site agree if anyone checks.

## The announcement, when you are ready

The draft is in [announcement-01.md](announcement-01.md). The points that were
listed here are in it; what is left is your decision about where it goes and
when. The one thing worth keeping in view while editing: the first question
people ask is "where did you get my data", and the answer reads far better
given than extracted — `docs/resources.md` §4 is the answer, and it is public.

## Two findings from the first pluginval sweep

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

## Decisions that are yours


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

## Worth doing when you have a moment

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
* **Profiler run:** build the image once with
  `docker build -f docker/profiler.Dockerfile -t plugin-universe-profiler .`, then
  `node bin/profile.js --path <dir of built plugins> --tool pluginval` — `--dry-run` shows the
  verdicts without writing. Then `node bin/backup.js --scope measurements` and carry it over;
  it prints the steps with your paths filled in. Measure here rather than on the server:
  profiling competes with serving, and a reading carries its platform precisely so it need not
  be taken where it is served.
* **`npm run test:live` is the check that matters** — the only one that sees the
  deployment rather than a copy of it.
* **Ask me to prune this file** when it drifts. It is meant to be short.

## Confirmed done

A list of what has already happened is not a list of what to do, so this stays
short. Anything here that is still *operationally* true — a path that matters, a
habit — has moved up into Standing habits or down into Known, and not wrong.

* **Deployment.** DNS, certificates, nginx, the PURL chain, `bin/deploy.sh` with
  a build stamp on `/health`, and `npm run test:live`.
* **The catalogue.** 754 plugins, 754 vectors, 50 measured; the GitHub sweep
  ingested; first-seen dates, images, the SKOS taxonomy.
* **People.** Sign-in, corrections, submissions, the moderation queue, trust
  promotion, rate limiting, the wiki. Moderator granted; the first submitted
  plugin accepted, indexed and searchable.
* **Ways out.** The public SPARQL endpoint on its own dataset, the dumps served
  by nginx, the registry view, the MCP endpoint, `/services` describing all of
  it, and `robots.txt`.
* **Measurements.** `pluginval` built into the profiler image and run over the
  downspout VST3s — 45 pass, 1 crashes, 4 have no binary — carried to the server
  and live. `pu:LatencySamples`, defined since Phase 2 and produced by nothing,
  has values.
* **The site's shape.** Three columns on a wide screen, stacking below 58rem;
  the footer only where there are no columns; the front page showing plugins
  with a picture.
* **Backups.** Nightly on the server, pulled here nightly, restore rehearsed.
* **Security.** SSH keys and password authentication disabled. The exposed
  `GITHUB_TOKEN` revoked and not replaced; `GITHUB_CLIENT_SECRET` cycled. **A
  personal-data exposure closed** — an old `sparql.` block served
  `graph:system/accounts` to the internet; `npm run test:live` now checks five
  plausible SPARQL paths unconditionally, because "not deployed" is exactly the
  state in which nobody is looking.

## Known, and not wrong

* **The nginx config is installed as `plugin-universe.com.conf`** — the suffix
  matters, the runbook said otherwise for a while, and a config sitting beside
  the one in use cost three rounds of diagnosis. `nginx -T | grep -c` for
  something the new file contains is the check that would have caught it.
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
