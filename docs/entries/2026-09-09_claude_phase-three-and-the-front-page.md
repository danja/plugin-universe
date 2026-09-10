# Claude : closing the correction loop, and putting the data on the page

2026-09-09. Phase 3 finished, the front page grew a listing and some pictures,
the taxonomy became an ontology, and the deployment learned to say what it is.
A long day, and the recurring theme was **data that existed and nothing showed**
— which is the third pattern in MISTAKES.md and now has four instances.

## The correction loop closes

The machinery for contributions was already written and half of it was dead
code. `acceptedCount()` existed and nothing called it, so no contributor could
ever become trusted and the queue could only grow; `perAccountPerHour` was
configured and unenforced. Both are wired now, along with a moderation queue at
`/moderation`, a per-account contributions page, and `bin/grant.js` to make the
first moderator from a shell — there is deliberately no web route that does
that, because every such route is a privilege-escalation bug waiting to be
found.

The threshold is the whole design: five accepted corrections and a contributor's
later ones apply on arrival. Review is meant to shrink, not accumulate.
`tests/store/contributions.test.js` proves it over a full cycle against the live
store — the promotion, both decision paths, re-review of a decided correction,
and the hourly limit counted from the store rather than from memory so it
survives a restart.

Two things worth recording about the shape of it. Accepting a correction does
not overwrite the harvested statement: it writes the fact into the contributor's
own CC0 graph and precedence decides which a reader sees, so reverting is a DROP
rather than a repair. And the moderation route was reachable only by typing the
URL for an hour, because the account bar had no link to it — the fifth instance
of "two files that had to change together with nothing connecting them", now
bound by `tests/api/linked-routes.test.js`.

## Data that was there and wasn't shown

Three separate cases in one day, all found within a minute of putting the values
in front of a person.

**Images.** 560 of 645 plugins had carried `foaf:depiction` since the Open Audio
Stack harvester landed and nothing rendered it. They are hotlinked rather than
copied, which makes three things obligatory rather than optional: https only,
because an http image on an https page is blocked silently; `no-referrer`, so
the image host is not told which plugin a reader was looking at; and lazy
loading with fixed dimensions, because a page of results is otherwise twenty-five
blocking requests to somebody else's server. The attribution caption lives
inside the `<figure>` — it was first written into the provenance block, which
renders only when there *is* provenance, so a plugin with an image and no
recorded source would have shown a third-party image with nothing saying whose.

**Measurements.** The profiler has been writing readings since Phase 2 and
nothing displayed them. Showing them found two defects immediately: a scan time
rendered as a bare `364` when only the vocabulary knew it meant milliseconds,
and `pu:Latency` carrying a boolean while the vocabulary defined it as a count
of samples. The second is a modelling error rather than a display one — a static
scan can only establish *whether* a plugin declares latency, not what it reports
at run time — so `pu:Latency` is now that boolean and `pu:LatencySamples` is the
number a running host would produce. Nothing produces it yet; it needs the same
host CPU load does.

**The vocabularies themselves.** Chasing the metric labels turned up something
larger: `vocabs/plugin-universe.ttl` and the two `trn:` files were served from
disk at `/ns/<name>.ttl` and were **not in the store at all**. Every `pu:` and
`trn:` IRI in the published data resolved to a document that the endpoint
holding that data could not read, and no SPARQL query could ask what a term
meant. `bin/ingest.js` loads all three now, one graph each. `shapes.ttl` stays
out deliberately: SHACL shapes are how the store is checked, not part of what it
describes.

## The taxonomy stops being an object literal

The category scheme was a JavaScript dictionary of parent links inside the
serialiser, which is why the scheme in the store had four predicates and no way
to say what a category *meant*. It is now `vocabs/categories.ttl`: 337 triples
over the same 28 concepts, each with a definition, alternative labels, and
`skos:closeMatch` to LV2 plugin classes.

Every LV2 class named was verified against the plugins installed on the
development machine rather than written from memory. Two consequences follow
from taking that seriously. `pucat:effect` has **no** LV2 match, because
`lv2:EffectPlugin` appears in bundles in the wild and was not in the attested
set. And `pucat:amp` maps to `lv2:SimulatorPlugin`, not `lv2:AmplifierPlugin` —
LV2's means a gain stage, not a guitar amp, which is a false friend now recorded
in a `skos:scopeNote` and shown on the category page.

The alternative labels feed the **lexical** signal only. Putting them in the
composed text view would invalidate 645 stored vectors for a signal the lexical
index gives away free. Searching "overdrive" now returns dm-SD1, dm-TubeScreamer
and Schrammel OJD; "brickwall" returns three limiters.

That change also produced the day's best bug. The synonym join reused `?cat`
from a sibling `OPTIONAL`, so for a plugin with **no** category the variable was
unbound, the join was unconstrained, and that plugin collected all 134 synonyms
in the taxonomy — becoming matchable by every word in it. The query ran, returned
exactly the right number of rows, and the first plugin sampled was perfect. The
tell was a statistic already printed and not read: *min 3, max 134, median 10*.
A number that does not fit the distribution is a finding.

## First-seen dates, and a front page

"Most recently added" needed a date the catalogue did not have: `dcterms:issued`
is on package releases and `prov:generatedAtTime` on the harvest graph, so there
was nothing to order 645 plugins by. `dcterms:created` now means *first seen
here*, and the part that matters is that `IngestPipeline` reads the existing
dates **before** the re-harvest drops the graph. A date that resets every run
would make "recently added" a list of whatever was harvested last, which is the
opposite of the claim. Undated plugins sort last, not first — treating a missing
date as `now` would put the whole pre-existing corpus at the top.

One rule decides the front page: a query is ranked and capped at 25, anything
else — facets or nothing at all — is a paged browse.

## The deployment learns to say what it is

Two deploys silently did not happen. Once `git pull` was forgotten on the
server; once `docker compose restart` was used, which reuses the existing image.
Both left a site that looked entirely healthy, and diagnosing the second took
four commands over SSH.

`/health` now reports the commit and build time, filled by a Docker build
argument. There is deliberately **no default**: an unstamped build reports
`null`, which means "nobody can tell what is deployed" and should not be dressed
up as a version. `bin/deploy.sh` is the supported path — it pulls `--ff-only`,
stamps, builds, starts, and then refuses to claim success unless the running
container reports the commit it was just given.

Alongside it, `npm run test:live`: twenty-eight checks against the deployed site,
run deliberately and never as part of a sweep. It covers the class of failure
that cannot be reproduced locally — a container never rebuilt, an ingest run on
the wrong machine, a certificate, a redirect — and in particular checks **from
outside** that no Fuseki path answers, which is the worst mistake available in
this deployment. It caught the missing `git pull` within a minute of existing.

`robots.txt` too, which had been a 404. Permissive by intent: the catalogue is
CC0 and meant to be indexed, so what it excludes is the unbounded URL space —
search results and faceted browsing — while leaving plain paging crawlable.
Automated and AI crawlers are **not** excluded, deliberately: publishing
content-negotiated RDF and an agent-facing API and then blocking machines would
be incoherent. It names no unlisted path either, since a `Disallow` line is a
public advertisement.
