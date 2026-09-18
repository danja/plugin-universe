# Danja's list

Things only you can do: server access, credentials, legal, and the decisions
that are yours. [TODO.md](TODO.md) is what the *project* needs; this is what
*you* need to do.


## One-off


- [ ] **Commit the downspout profile edits, then re-harvest downspout on the server.**
  *2026-09-15:* `pu:supportedPlatform pu:Windows, pu:MacOS, pu:Linux` is now in all 52
  `plugins/*/profile.ttl` files in `~/github/downspout`, with the `pu:` prefix added to each.
  **They are edited and not committed** — that repository is yours and I do not run git in it.
  Every file was parsed before and after and gained exactly three triples on the subject it
  already described, including `plugins/worms/profile.ttl`, which is LV2/DOAP-shaped rather
  than `trn:PluginProfile` and needed the same care.

  `DownspoutHarvester` did not read that predicate — it returned a fixed set of fields — so the
  edits on their own would have changed nothing in the catalogue. It reads it now, in both
  shapes, and so does the shared LV2 bundle reader, which means an author who puts
  `pu:supportedPlatform` in their own `.lv2` manifest is believed by the disk harvester and the
  GitHub one alike.

  ```sh
  docker compose run --rm app node bin/ingest.js --source downspout
  docker compose run --rm app node bin/mint-vendors.js   # see below — do not skip this
  docker compose restart app
  ```

  **This will add two plugins you are currently missing.** The local re-harvest read 52
  profiles where the deployed catalogue holds 50: `moka` and `magneto`, added to the repository
  on 2026-09-09 and 2026-09-12, are not on the site. Nothing reports a source that has grown
  since it was last read, which is worth knowing on its own.

  `bin/mint-vendors.js` is not optional after a harvest that adds a plugin. Two store tests went
  red locally until it was run: a new plugin carries a vendor *string* and the minted `foaf:maker`
  lives in a derived graph that only that script rebuilds, so until it runs those plugins have no
  vendor identity and your `danja` vendor page is missing them.

  **The README says the macOS and Windows builds are untested.** You have stated all three
  platforms and that is your call — but if it is still true, it belongs in `trn:caution` on the
  affected plugins, which is a field the profiles already carry and the plugin page already
  shows. Worth a pass while the files are open.


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

  One was found and fixed on 2026-09-12 without a review: the JSON-LD block at the foot of
  every plugin page embedded `JSON.stringify(...)` inside a `<script>`, and `JSON.stringify`
  does not escape `<` — so any harvested or submitted value containing `</script>` would have
  closed the block and had the rest parsed as markup. Never exploited; the only `<` in the live
  catalogue are port names like `L <> M`. Worth telling whoever reviews, because it says what
  kind of thing to look for: the places where escaping is deliberately off.

- [ ] **Read the contact page as a stranger would.** `/about/contact` is the one place the
  address lives now, and it was assembled from three earlier copies with different framings.
  Your name, your address, your voice — worth an edit before it is advertised. Same for
  `/about`, which nobody has re-read since the site gained measurements, vendors, promotion and
  a wiki.

- [ ] **Read `/about/profiles` as a plugin author would**, and fill one in for one of your own.
  `/submit` now asks for roles, what a plugin accepts and produces, what it requires of the host,
  which platforms it runs on, and any caution worth stating — the fields the downspout profiles
  already carry, platforms included since 2026-09-15 — and
  that page is what has to persuade a stranger those fields are worth their ten minutes. It
  That page used to promise something that did not exist — *"send us the URL of your bundle"*
  for ports and parameters. **It exists now:** `/admin` has a *Read a bundle* panel, and the
  page says what it actually does, including that a person does the fetching and that nothing
  is overwritten. Worth trying on one of your own flues plugins: paste the slug and the raw
  URL of its `.ttl` — the one `manifest.ttl` points at, not the manifest — and see what comes
  back. Two things that were not obvious: the **plugin** field takes the whole
  address of its page (`https://plugin-universe.com/plugin/shifty-74ec851b`) —
  you do not have to trim it to the slug — and the **.ttl** field wants a raw
  URL, so on GitHub use the `raw.githubusercontent.com` form rather than the
  page you read the file on.

  Worth doing on a real plugin of yours rather than reading it cold — you are the only person
  who can say whether the vocabulary's own labels ("Control MIDI", "Host Transport") mean
  anything to someone who has not read the ontology.

- [ ] **Try the site with the keyboard alone**, before you announce. Tab from the top: the
  first stop should be "Skip to content", which was not there until now. Everything focusable
  should show a visible ring in both light and dark. If anything traps focus or hides it, that
  is worth knowing before the traffic arrives rather than after.

- [ ] **Re-confirm any vendor claim after the next deploy.** *2026-09-14:* a claim now names
  the vendor's minted IRI rather than their folded name. It had to, before anyone pays: the fold
  comes from the spelling, so merging "Danny Ayers" into "danja" changed which key those plugins
  folded to and the Pro entitlement stopped matching them — a subscriber refused on their own 36
  plugins, silently, because a check that does not match has nothing to report.

  **Nothing migrates automatically**, because the accounts graph is not published and I cannot
  see from here whether any claim exists on the server. If one does, it holds the old value and
  now entitles nothing. `/admin` counts claims it cannot resolve and says so in the Vendor claims
  panel — if that warning appears, withdraw the claim and confirm it again in the same panel.
  Nothing else changes: you type the vendor's name or slug exactly as before.

- [ ] **Before any real money: talk to a commercialista about a partita IVA.** You are in Italy
  with a codice fiscale and no VAT registration. A codice fiscale is a personal tax identifier
  that every resident has — it is not a business registration, and on its own it is not normally
  enough to invoice for ongoing commercial activity.

  **I am not qualified to advise on Italian tax and this is not advice.** What follows is the
  set of questions worth taking to an accountant, so the conversation is short.

  - **Is this *attività abituale*?** Italy distinguishes occasional work (*prestazione
    occasionale*, done under a codice fiscale with a ritenuta d'acconto) from habitual business
    activity, which generally requires a **partita IVA**. Selling advertising placements and
    subscriptions from a website, repeatedly, to strangers, is much more likely to be the
    second. Ask directly, and describe it as recurring online sales rather than as a side
    project.
  - **Ask about the *regime forfettario*.** It is the small-operator flat-tax regime, up to
    €85,000 of revenue. It still means holding a partita IVA, but with substantially simpler
    obligations, and invoices issued without VAT charged under a specific stated exemption.
    For a one-person web service this is the usual answer, and it is the thing to ask about by
    name.
  - **Electronic invoicing through SdI is mandatory, including for forfettari.** Italy requires
    invoices to go through the Sistema di Interscambio in a prescribed XML format. Stripe's
    invoices are **not** SdI invoices. So the invoicing half of the plan probably belongs with
    your accountant's software or an SdI provider rather than with Stripe, and Stripe's role
    reduces to taking the payment and giving the customer a receipt. Worth settling before any
    invoice is issued, not after.
  - **Selling to businesses in other EU countries** is a different VAT treatment again (reverse
    charge, and the OSS scheme for consumers). Only relevant once you are registered, but ask in
    the same conversation rather than in a second one.

  **What this blocks and what it does not.**

  - **It does not block building.** Everything is in Stripe test mode, no money moves, and I can
    build and test the whole flow without any of this being settled.
  - **It does block going live, and Stripe will be the one to stop you.** The sandbox currently
    reports `charges_enabled: false` and `details_submitted: false`. Activating a real account
    means completing Stripe's onboarding, and for an Italian business account that asks for tax
    identification. So this is not a formality you can defer past launch — it is the gate.
  - **The currency is worth deciding now.** The account defaults to EUR. Prices can be set in
    anything, but EUR is the natural choice and changing it later means re-creating prices.

- [ ] **Test the payment flow end to end with the Stripe CLI.** The code is built and unit-tested
  but nothing has yet completed a real checkout.

  **2026-09-13: this was not going to work, and now should.** The read-only guard in
  `src/api/server.js` runs before any route is reached and did not list the billing paths, so
  `/billing/webhook`, `/billing/subscribe`, `/billing/portal` and `/plugin/<slug>/promote` all
  answered **405** and their handlers never ran. Measured, not guessed — the old guard was put
  back and each one asked. Fixed, and a test now POSTs to every write route against a running
  server. It is worth knowing when you do run this: if a delivery had been tried before today,
  it failed for that reason and not because of anything in your Stripe setup.

  Two terminals:

  ```sh
  stripe login
  stripe listen --forward-to localhost:4100/billing/webhook
  ```

  That prints a **`whsec_…` signing secret which is different from the one the dashboard gives
  you** — put it in `.env` as `STRIPE_WEBHOOK_SECRET` and restart the app, or every delivery is
  refused, which is the deliberate behaviour. Then sign in, open a plugin, buy a placement, and
  pay with `4242 4242 4242 4242`, any future expiry, any CVC.

  What should happen: a redirect to Stripe, then back to the plugin page, and the plugin carries
  a **Promoted** label within a second or two. If it does not, `stripe listen` shows the
  delivery and its response.

  Two test-mode products exist in your sandbox: **€10 one-time** to promote a single plugin for
  a year (`promoted_listing_year`) and **€99/year** for Plugin Universe Pro, which promotes as
  many of a vendor's plugins as they like (`pro_tier_year`). Changing the price is a dashboard action and never a deploy — Stripe
  prices are immutable, so you create a new one and move that lookup key onto it (the dashboard
  offers this; by API it is `transfer_lookup_key: true`). Archive the old price afterwards so it
  cannot be bought by an id somebody kept.

  **The two behave differently when a price changes.** The €10 placement is a one-time
  purchase, so there is nothing to grandfather: past buyers have their year and the next buyer
  pays whatever the key resolves to that day. The €99 subscription is the opposite —
  **existing subscribers stay on the price they signed up at** until somebody deliberately
  migrates them. Worth knowing before the first one signs up, not after.

## The announcement, when you are ready

The draft was `docs/announcement-01.md`, deleted in commit ae2aeb3 and
recoverable with `git show ae2aeb3^:docs/announcement-01.md`. The points that were
listed here are in it; what is left is your decision about where it goes and
when. The one thing worth keeping in view while editing: the first question
people ask is "where did you get my data", and the answer reads far better
given than extracted — `docs/sources.md` §4 is the answer, and it is public.

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
  **It now runs `npm test` first and will not build if the suite fails** — the
  running container is left untouched, so a red suite costs you nothing but the
  minute it took. `./bin/deploy.sh --skip-tests` deploys anyway when you need it
  to. If it says the test runner is not installed, the server has production
  dependencies only: `npm ci` there, once.
* **An accepted submission indexes itself.** Nothing to run — accepting one in
  the moderation queue reloads the documents and embeds the new plugin in the
  running app, and the page says so. If Ollama is down it says that instead, and
  the nightly `--only-new` picks it up.
* **Data change:** `docker compose run --rm app node bin/ingest.js --only-new`,
  then `docker compose restart app`, then `bin/publish.js` — or the public
  SPARQL copy drifts behind. A restart reuses the image, which is right for data
  and wrong for code.
* **Vendor identity:** `docker compose run --rm app node bin/mint-vendors.js`,
  then `docker compose restart app`. Derives a `pu:Vendor` per vendor from the
  `trn:vendor` strings and links every plugin to one with `foaf:maker`. Run it
  after any ingest that adds plugins, or their makers have no identity and their
  vendor pages show no identifier. `--dry-run` says what it would write. Safe to
  repeat: the IRIs are content hashes, so re-deriving produces the same ones.

  *2026-09-18:* **the ingest now counts what is missing and tells you.** This
  step had been a habit written down and missed twice — most recently by the
  three JigDAW plugins — so `bin/ingest.js` ends by asking the store how many
  plugins carry a vendor string with no minted maker, and names the command when
  the answer is not zero. Silence at the end of a run means there is nothing to
  do.

  **It now also applies `data/curation/vendor-merges.json`** — the vendors who
  are one maker under two names. That file is the only record of a judgement
  nothing in the data implies, and it is reapplied on every run because this
  graph is dropped and rewritten whole. It reaches the container by the
  `data/curation` bind mount, not in the image, so if that mount is ever missing
  the derivation would quietly undo the merges — it refuses instead, and says
  so. Your own entry is in there: `danja` and `Danny Ayers` are now one vendor
  with 86 plugins.
* **Vocabulary change:** `node bin/ingest.js --vocabs-only`, then restart the
  app. The store holds its own copy of `vocabs/*.ttl`, and it is that copy that
  tells a plugin page what `pu:OpenTimeCold` means. **Needed on the next
  deploy**: `pu:claimsVendor` changed from a string to a vendor IRI on
  2026-09-14.
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
