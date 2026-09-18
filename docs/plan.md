# Plugin Universe — Implementation Plan

Status: 2026-09-13. Companion documents: [Architecture](architecture.md),
[What the plan delivered](plan-done.md), [Suggestions](suggestions.md),
[Sources](sources.md).

**This file is what is left to build.** Phases 0, 1, 3 and 5 are complete and are
in [plan-done.md](plan-done.md), along with the built parts of Phases 2 and 4 —
moved there because a plan that is four-fifths achievement is read as a record
rather than as an instruction, and the next action sinks out of sight.

Three documents, three jobs, and they should not repeat each other:

| | |
|---|---|
| **plan.md** (here) | the *design intent* of what is unbuilt — goal, deliverables, exit criteria, risks |
| **[../TODO.md](../TODO.md)** | the *actions*, in priority order, with what is known about each |
| **[HUMANS.md](../HUMANS.md)** | what needs **Danja** — server access, credentials, legal, a decision |

Every component named here is defined in [architecture.md](architecture.md). No
phase depends on anything introduced later.

---

## Where the project actually is

Measured 2026-09-13 from `/health` and `npm test`, not from memory:
**756 plugins**, 756 indexed, **50 measured**, 1208 core tests over 56 files.

- **Phase 2 — the profiler.** Running. The sandbox, both scanners and the
  measurement model are built; what is missing is **CPU load**, which is the one
  measurement nothing produces and the one the phase exists for.
- **Phase 4 — pro tier and revenue.** Promotion, its compliance, and the Stripe
  integration are built. **No real money has moved**, and cannot until Danja's
  tax registration clears Stripe's onboarding.
- **Phase 5 — open data.** Done but for upstream contribution and the
  conditional crawler.

### What is now the critical path

The original sequencing put the profiler second, deliberately: measured data is
the one thing no competing catalogue has and the one thing that cannot be
replicated by aggregation, so it should exist before there is any pressure to
launch. That reasoning still holds and the schedule has drifted off it — Phases 3
and 5 overtook Phase 2 because they were unblocked and it was not.

So the honest statement of priority is:

1. **Nothing blocks an announcement except Danja's own list.** The site works.
   This is the shortest path to the project mattering, and it is not code.
2. **CPU load is the largest remaining gap in the product's differentiator.**
   `pu:CpuLoad` has been defined since Phase 2 was written and is produced by
   nothing.
3. **Payments are built and unproven.** The gate is tax registration, not code.
4. Everything else is improvement to something that already works.

---

## Phase 2 — Profiler — **IN PROGRESS**

**Goal.** Measured data in the graph. The catalogue becomes authoritative rather than aggregated.

Built, and in [plan-done.md](plan-done.md): the sandbox, the lilv scanner, the pluginval host, the
measurement model, per-run graphs, and the readings on plugin pages and as a `measured=` filter.

**Remaining deliverables**

2. *(part)* Tool wrappers producing normalised output. `pluginval` and `lilv`/`lv2info` are done.
   **`clap-validator` (CLAP)** and **`lv2bm` (LV2 benchmarks)** are not.
3. **In-house measurements — the substantial gap.** CPU load at fixed block size and sample rate is
   the headline figure and nothing produces it: pluginval instantiates and exercises a plugin but
   does not report what it cost. Denormal behaviour, state save/restore integrity and scan time are
   in the same position. Reported latency *is* produced (`pu:LatencySamples`).
5. *(part)* Aggregation queries (median CPU across runs) — blocked on there being CPU figures to
   aggregate. The measured facet exists as `?measured=`; whether it earns a dropdown on the form is
   an editorial question at 7% coverage.
6. *(part)* Plugin pages show measurements with their platform context — done, except that **only
   the newest run shows**, so a plugin measured by both lilv and pluginval loses its port counts
   when it is validated.

**Exit criteria**

- [ ] Every plugin in the seed corpus that can be run on the host has a validation verdict and a CPU
  figure in the graph. *Verdicts: 50 of 756. CPU figures: none.*
- [x] A crashing plugin produces a recorded `fail` result and leaves the runner healthy. —
  `sidecar.vst3` proved it.
- [x] A measured facet filter works end to end from the search UI.
- [ ] Two runs of the same plugin on the same host produce figures within a stated tolerance;
  reproducibility is tested, not assumed. **Currently assumed.**

**Risks**

- *Cross-platform coverage.* A Linux host cannot profile AU or AAX. AU is macOS-only; VST2 needs
  Steinberg's SDK, which is not redistributable; LADSPA and VST2 both ship as a bare `.so`, so the
  profiler declines to guess which a file is. Be explicit in the UI about what was measured where;
  treat macOS and Windows runners as later additions, not a blocker.
- *Sandbox escape or resource exhaustion.* The highest-risk component in the system, since it runs
  arbitrary third-party native code. Confined hard; run it on its own machine as soon as volume
  justifies it.
- *Benchmark figures read as authoritative comparisons across machines.* Publish comparisons only
  within a run; always show the platform. **This risk arrives in force with CPU load** — a
  validation verdict travels between machines and a CPU percentage does not.
- *Coverage stays low enough that the measurements are a curiosity.* New, and the one the phase is
  now most exposed to. 50 of 756 is 7%, and every one of them is from a single repository the user
  wrote. A figure over one author's work is not yet the thing that makes the catalogue
  authoritative.

---

## Phase 4 — Pro tier and revenue — **PART BUILT**

**Goal.** The project pays its hosting bills.

Built, and in [plan-done.md](plan-done.md): promotion (deliverable 3), its compliance labelling and
the public ranking disclosure (deliverable 4), the Stripe integration and the Pro entitlement
(deliverables 1 and 2 in part), and vendor identity.

**Remaining deliverables**

1. *(part)* **Payment integration proven end to end.** The code is built and unit-tested; nothing
   has completed a real checkout. The gate is Italian tax registration, which is on
   [HUMANS.md](../HUMANS.md) and which Stripe's own onboarding will enforce.
2. *(part)* **Pro entitlements.** Promoted listings and the Pro subscription are built. The
   **unfiltered query page**, **on-topic advertising** and **blogging** are not.
   - **The vendor profile** is the piece with a designed shape and no code. It is no longer blocked:
     the identity it needed exists, and so does the profile form that the same person would have
     filled in first. Claiming, editing, the CC BY-SA split for a vendor's own words, disclosure
     that a profile is the vendor's own, and the hard line that it must never become a way to edit
     facts — all in [../TODO.md](../TODO.md).
5. **Pro-tier API keys** for bulk and programmatic access. Not started.
6. **Blog and reviews section.** Not started.

**Exit criteria**

- [ ] A paid account can promote a plugin; the placement appears labelled; the boost is bounded and
  documented; the promotion is visible in the public ad-repository query. *Every clause but the
  first is met. No account has paid.*
- [ ] Downgrade and expiry revoke entitlements correctly. *Built as an entitlement checked when
  read, so this should hold by construction — and it has not been exercised against a real
  subscription lifecycle.*

**Risks**

- *Promotion corrupts search quality and users leave.* Keep the bound conservative and keep the
  unfiltered view available; search quality is the entire asset.
- *Payments and tax across jurisdictions.* Use a provider that handles VAT/MOSS rather than building
  it — **and note that Stripe does not solve this in Italy**: invoices must go through SdI in a
  prescribed XML format, and a Stripe invoice is not an SdI invoice. See
  [HUMANS.md](../HUMANS.md).
- *Too few pro customers to matter.* See the revenue alternatives in [suggestions.md](suggestions.md);
  do not let promoted placement be the only model.
- *A vendor profile becomes a way to edit facts.* A profile is the vendor's own words next to the
  catalogue's findings, never on top of them. A `crashed` measurement stays `crashed` on a paid
  profile. That boundary is the whole reason anybody would trust the catalogue, and it is the same
  line `/about/promotion` already draws for placement.

---

## Phase 5 — Open data — **COMPLETE except two deliverables**

**Goal.** Deliver the open-data promise, and make the catalogue something other systems build on.

Built, and in [plan-done.md](plan-done.md): the endpoint, the dumps, the MCP face, the registry
view, `/services`.

**Remaining deliverables**

5. **Contribution back upstream.** The user's own plugins submitted to the open-audio-stack
   registry; the `trn:` extensions proposed to `~/github/transmission` — in particular
   `trn:PluginFormat`, and retiring `trn:min`/`trn:minimum` in favour of the `lv2:` equivalents.
   *This is the operating principle rather than a feature: contribute corrections back upstream
   rather than keeping a better copy privately. The user's plugins being in this catalogue and not
   in theirs is the wrong way round.*
6. *Conditional* — **link-out-only indexing of third-party catalogues** (name and URL, no substantial
   re-publication, robots.txt and terms respected). Profile augmentation from the open web — videos
   and reviews, linked not copied.

   This is the place the rules bite hardest, and the conditions are not negotiable:
   - KVR **links** are permitted and KVR **content** is not.
   - A source gets a row in [sources.md §4](sources.md) **before** any code.
   - Never scrape a search engine.
   - Such graphs are `proprietary-linkout` and excluded from the dumps by their flag.
   - Links rot, so it needs a re-check schedule — and a 403 from Cloudflare means *unknown*, not
     *dead*. Working around the block would be the thing [sources.md §4](sources.md) rule 3 forbids.

**Exit criteria** — the three original ones are met. For what remains:

- [ ] The `trn:` extensions exist upstream rather than only here, so the vocabulary this project
  shares is genuinely shared.

---

## Cross-cutting, running throughout

- **The query regression suite** from Phase 1 grows with each phase; search quality is measured, not
  asserted. The floors are recall@1 80% and recall@3 93%; move them up as the signals improve, and
  never tune a fixture until a test passes.
- **Every harvest is reproducible.** Any source graph can be dropped and rebuilt from source at any
  time.
- **Accessibility is a standing requirement, not a task.** The one-off pass is done and
  `tests/api/accessibility.test.js` holds it over twelve page types; this line is about not
  regressing.
- **Documentation as worklog** — progress notes under `docs/entries/` following the naming
  convention in [CLAUDE.md](../CLAUDE.md). *Currently drifting:* the last entry is 2026-09-10 and
  three days of substantial work since is recorded only in TODO.md's Done section.
- **The seed repos stay in sync.** downspout, flues and valis are both the seed corpus and the test
  data; changes there are the first signal that the normaliser has drifted.
- **A prose claim is a claim, and nothing tests sentences.** Take every figure from the system —
  `/health`, a SPARQL count, a `grep -c` — and where the prose is a commitment, bind it with a test
  as `tests/search/promotion.test.js` binds `/about/promotion`.
