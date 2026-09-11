# Mistakes and corrections

Things that turned out to be wrong, and what replaced them. Kept so the same
ground is not re-covered. Newest first.

Twenty-nine entries is past the point where anyone reads them all, so what follows
is what they have in common. The individual entries keep the specifics, which is
where the value is; this is the index.

---

## The patterns

**1. Two files had to change together, and nothing connected them.**
The most expensive pattern here, and the only one that has recurred five times.
A licence list and the SHACL shape enumerating it; `docs/` being served and
`.dockerignore` excluding it; a new test directory and the Vitest `include`
list; a URL published in a user agent and the route that answers it; a route
with no link to it. Each was found in production or by accident. **The fix that
works is a test asserting the two agree** — the four that have one have not
recurred. Also in
[CLAUDE.md](CLAUDE.md) as a checklist, because it is a thing to check before
finishing, not after.

**2. Output that looked right and was not.**
Turtle that did not parse. A Fuseki assembler that answered every query
correctly and lost the store on restart. Blank nodes cut in half at every write
boundary. Twenty-one plugins silently merged into one another. An index size
counting slots nobody could reach. In each case the system reported success —
`204`, "57 plugins", a clean page — and the defect was only visible to something
that *checked*: a parser, a restart, a count that had to add up. **Assert on the
round trip, not on the operation returning.**

**3. Data harvested but never shown, therefore never verified.**
`foaf:homepage` was collected for 642 plugins, stored with the wrong node type,
and displayed nowhere. Provenance sat in the graph, invisible. Every embedding
contained `[object Object]`. All three had been in every ingest since the code
was written, and all three were found within minutes of putting the values in
front of a person. **Nothing checks a field that nothing reads.**

**4. Assumed a shape instead of looking at the data.**
That a parameter default is a number — the corpus has floats, booleans and a
file path. That fifty hand-written profiles share one shape — one does not. That
a native binding has `reconstruct()` — it does not. That units arrive as strings
— LV2 states them as IRIs, which is the target of the mapping. **One `grep`, or
one `Object.getOwnPropertyNames`, would have answered each.**

**5. Carried over from semem without re-deciding.**
Credential defaulting to `admin`/`admin`, against this project's own
no-fallbacks rule. Fuseki paths and a healthcheck for a different image, adapted
by reading rather than by running. Reuse is why this project exists at all, but
**a thing that worked there is a hypothesis here.**

One more that fits nowhere: a headline metric moved the right way while a second
moved the wrong way, and only reporting both caught it.

---

## 2026-09-11 — Four wrong instructions for a machine I cannot see

**What happened.** Carrying profiler measurements to the server took five
attempts, and every failure was in an instruction rather than in the code:

| Printed | Failed with |
|---|---|
| `--into plugin-universe` | the dataset name is `${SPARQL_DATASET}` on that host; restore refused and exited 1 |
| `cd /chalet/github/plugin-universe` | that is the path *here*; the runbook says `/home/github/plugin-universe` |
| `rsync -a …` | `-a` implies `-o -g`; only root may set owner across hosts |
| `-v /tmp/measurements:…` before the directory existed | docker created it as **root**, and the next rsync could not write into it |

**Root cause.** Writing operational instructions for a machine I have no access
to and cannot test against, with the confidence of something I had run. Each was
a guess about another host's state dressed as a command to paste. The one that
cost the most — the root-owned directory — was caused by an *earlier* failed
instruction, so the errors compounded.

**Prevention.** Three changes, in descending order of how much they help.

1. **The real values now come from `docs/deployment.md`**, which records the
   host and the repository path, rather than from memory.
2. **Every step that cannot be known from here now says so and prints itself.**
   `restore.js` run bare reports the dataset name; the instruction is to paste
   what it says.
3. **Each command carries its reason**, so a reader can tell whether it still
   applies on their machine rather than only whether it worked.

The deeper point is in the last row of that table: `docker run -v /path:…`
silently creating a root-owned directory means a *failed* step leaves the
system in a state where the retry also fails, differently. Anything that
mounts a host path should have the path created deliberately first.

**What did not go wrong.** The code. `restore()` refused every wrong invocation,
named what it wanted, and never half-wrote. The counting, the registry replay
and the manifest checks all held. The failures were entirely in the prose around
them — which is worth remembering next time prose feels like the cheap part.

## 2026-09-11 — Printed a server command with a value only the server knows

**What happened.** `bin/backup.js --scope measurements` printed a ready-to-paste
sequence for carrying profiler readings to the server, including
`node bin/restore.js /measurements --into plugin-universe`. The dataset name is
`${SPARQL_DATASET}` from the server's own environment. `restore.js` compares
`--into` against it and, on a mismatch, prints the real name and exits 1 without
writing — correct behaviour, and easy to lose in the output of a long
`docker compose run`. The delivery looked done and the catalogue stayed empty.

**Root cause.** I hardcoded a guess about another machine's configuration into
an instruction. CLAUDE.md's first line is that there are to be no inline
fallbacks — "if a value is not successfully retrieved from config then that is
an error that needs fixing" — and this is that rule applied to a value that
cannot be retrieved here at all.

**Prevention.** The printed sequence now runs `restore.js` once with no `--into`,
which is the mode that *reports* the dataset name, and tells the reader to paste
what it prints. Two steps instead of one, and neither contains a guess.

**What made it findable at all.** Nothing did, for a while. The symptom was an
absent `measured` facet, which is indistinguishable from a feature nobody built.
`/health` now reports `measured` and `measuredAt`, and a live test binds that
count to the sum of the facet counts — so "did the delivery land" is one request
rather than an inference. The lesson generalises past this bug: **an operation
carried out on another machine needs a way to ask whether it worked**, and a
missing feature and a failed delivery must not look the same.

## 2026-09-11 — A live test sat red for several commits because nothing runs it

**What happened.** `npm run test:live` reported two failures. One was mine —
paging moved from `/` to `/plugins` and the test still asserted the old shape.
The other was not: `resolves every vocabulary IRI the data uses` called
`get('/ns').json()`, `/ns` had since become an HTML page that keeps its JSON for
machines, and the test asked for neither representation. It received the page
and failed parsing it as JSON.

**Root cause.** The same recurring pattern — a route changed representation and
a second file that depended on it did not — with one addition that made it
worse. `test:live` is deliberately excluded from `npm test`, correctly, because
it tests the deployed site over the internet. So the one suite that would have
caught it is the one suite nobody runs by accident. `git log` puts the test
(`8f8a71d`) three commits before the change that broke it (`812fd08`): it had
been red through every deploy since.

**Prevention.** The tests now ask for the representation they want rather than
taking the default, and `/ns` gained the test its own change never got — that a
person gets a page and a machine gets the index. The wider point is in
docs/danja-todo.md already and is worth keeping there: **`npm run test:live` is
the only check that sees the deployment**, and a red test in a suite that is
never run is indistinguishable from no test.

## 2026-09-11 — The profiler's own container made 46 working plugins look broken

**What happened.** The first profiler image with `pluginval` in it was built on
`debian:bookworm-slim`. Pointed at the 46 built downspout VST3s, pluginval
reported `Num plugins found: 0` for every one of them, followed by
`!!! Test 1 failed: No types found. This usually means the plugin binary is
missing or damaged`. Read at face value that is 46 broken plugins, and it would
have been written into the graph as `pu:ValidationResult "failed"` against 46
plugins that are fine.

**Root cause.** bookworm carries glibc 2.36; the plugins were built against
2.38. The dynamic loader refused them, JUCE's format scanner reported no types,
and pluginval said what it says when a binary is missing — which is the same
sentence it says about a genuinely broken plugin. **The base image is a
measurement instrument, and its glibc is the floor under everything the profiler
can load.** Nothing in the design had treated it as anything but packaging.

**What made it findable.** Only running it. The three plugins were checked by
hand with `ldd` inside the image, which named `GLIBC_2.38 not found` in one
line. Nothing in the tool's own output pointed at the container.

**Prevention.** Two changes, and the second matters more than the first.

1. The image is `debian:trixie-slim` (glibc 2.41), with the reason written at
   the top of the Dockerfile: lowering that line changes what every measurement
   means.
2. `PluginvalScanner` now asks the loader *before* it asks pluginval. A plugin
   the image cannot load is recorded as `unloadable` with the missing libraries
   named, and explicitly as a limitation of the profiler rather than a defect in
   the plugin. The next version skew will be reported instead of misattributed,
   which is the part that generalises — trixie will be too old for something
   eventually.

**The same shape, twice more in one session.** `xvfb-run` was removed from the
image but left in the command, and every plugin came back `failed` in 275 ms;
and three new metrics arrived on plugin pages as bare local names because the
store holds its own copy of `vocabs/plugin-universe.ttl` and only a full harvest
reloaded it. Both are pattern 1 — a second thing that had to change — and both
looked like facts about plugins. `bin/profile.js` now prints stderr when a run
produced no log at all, and `bin/ingest.js --vocabs-only` reloads the ontology
graphs on their own.

## 2026-09-09 — A search-and-replace that matched nothing, and a syntax check that could not tell

**What was wrong.** `/moderation` returned
`{"error": "renderModerationPage is not defined"}`. The route, the renderer and
the styling were all correct; the import was not. The edit that was supposed to
add `renderModerationPage` to the import list in `src/api/server.js` used a
search string that did not appear in the file — the real text wrapped across
different lines — so `.replace()` returned the file unchanged and reported
nothing.

**Why it survived a check.** `node --check src/api/server.js` passed. A missing
import is not a syntax error: it is a `ReferenceError` raised the first time the
line runs, which here was the first request to a route nobody had loaded yet.
The check that was run could not, in principle, have caught this class of defect.

**Prevention.** Every scripted replacement now asserts its search string was
found (`assert old in s`) before writing. An edit that silently does nothing is
worse than one that fails, because it reports success. Where the edit is a
single site, use the Edit tool, which errors on a non-match by design.

---

## 2026-09-10 — The restore returned the right number of triples and the wrong data

**What was wrong.** The first whole-dataset restore rehearsal put back 45,114
triples — exactly the number backed up, matching the manifest, and
`bin/restore.js` reported success on every graph. `npm run validate` then found
**208 SHACL violations**: 114 of 594 LV2 ports in `graph:source/flues` had lost
their symbol, type and range, and 94 package files in the Open Audio Stack graph
had lost theirs.

**Root cause: the blank-node rule, reintroduced.** `loadTurtleIntoGraph`
grouped triples **by subject**. A blank node appears twice — as the object of
the triple that points at it, and as the subject of its own triples — so those
two halves land in different groups. A blank node label is scoped to one
`INSERT DATA` request, so whenever the two groups fell either side of a batch
boundary the label stopped referring to the same node, and the node was cut in
half. This is the same defect the ingest pipeline shipped once before, and it
has its own entry in this file.

**Why the checks missed it.** The count was right, which is the whole problem:
splitting a node loses no triples, it only stops them being about the same
thing. `bin/restore.js` counts after loading and refuses to report success on a
mismatch, and the count matched. `tests/store/backup.test.js` did test a blank
node — but the graph had **five triples**, so it never crossed a batch boundary
of 500. It proved the mechanism on a toy.

**Prevention.** Grouping is by connected component now: a subject and every
blank node reachable from it travel as one unit, and `writeGrouped` writes an
oversized unit whole. The test seeds 400 blank nodes — enough to cross several
batches — and asserts directly that no blank node lost its properties. Reverting
the fix makes it fail with "353 cut in half", so it is known to catch this and
not merely to pass.

**The lesson, which is the point of rehearsing at all.** A restore that reports
success is not a restore that worked. The only reason this was found before it
was needed is that the rehearsal validated afterwards instead of trusting the
success message — and the only reason the rehearsal happened is that somebody
asked for it. **Rehearse the restore, and check the data rather than the exit
code.**

---

## 2026-09-10 — Personal data was readable on the public internet, and the test for it was skipped

**What was wrong.** `sparql.plugin-universe.com` was serving the **live
catalogue** dataset. `GRAPH <graph:system/accounts> { ?s ?p ?o }` returned
account records — a name, a GitHub id, an avatar URL — to anyone who asked. It
had been reachable for as long as that server block had been deployed.

**Two causes, and the second is the one worth keeping.**

The configuration: an old `sparql.` server block in `plugin-universe.host.conf`,
left from the original subdomain layout, proxied to `/plugin-universe/query`.
When the new query-only config was added, nginx reported *conflicting server
name* — a **warning**, not an error. It kept the block it loaded first, which
was the old one, and ignored the new one entirely. A warning in a reload nobody
reads is indistinguishable from silence.

The test: an assertion that the public endpoint holds no accounts existed, and
sat inside `describe.skipIf(!sparqlLive)` — gated on the *new* endpoint
responding. It did not respond, so the block skipped, so the one check that
would have caught this never ran. The reasoning at the time was "there is
nothing to check until the endpoint exists". That is exactly backwards: **not
deployed is the state in which nobody is looking.**

**Prevention.** The check is unconditional now and probes five plausible SPARQL
paths across both hostnames, whether or not this project put them there. It
failed immediately and named the endpoint and the graph, which is how the fix
was confirmed.

**A safety assertion must never be gated on the feature it protects being
present.** Gate a feature test on the feature; never gate "is anything leaking"
on anything at all.

**And a bad instruction, which is its own lesson.** The first fix offered was a
`sed` commenting out `server_name`. That leaves a nameless server block, which
nginx can use as a catch-all — it would have served that endpoint for *any*
unmatched hostname and widened the exposure. It was written quickly because the
situation felt urgent. Urgency is when a wrong instruction does the most damage.

---

## 2026-09-10 — A sixth nginx configuration that failed on the server

**What was wrong.** `limit_except GET POST OPTIONS { deny all; }` at `server`
level. It is only valid inside a `location`, so `nginx -t` refused the whole
configuration:

```
[emerg] "limit_except" directive is not allowed here
```

**Root cause, and it is not the directive.** This is the sixth nginx
configuration this project has handed to a person untested — after a duplicate
`gzip`, a `location` in a snippet included at the wrong level, an unknown
`http2` directive, "protocol options redefined", and a missing certificate.
Every one was found by the user running `nginx -t`, and every one was findable
in a second here: nginx is installed on this machine and `nginx:alpine` is in
the local image list. I had simply never looked.

**Prevention.** `deploy/nginx/check.sh` runs a throwaway nginx container over
the real files, and it took four rounds to get right — which is the point,
because each round was a class of false failure that would otherwise have been
mistaken for a broken config:

- **Snippets are not sites.** A file with no `server { }` has to be included
  from inside one, which is what "location is not allowed here" meant the first
  time.
- **Upstream names resolve only in the compose network**, so `app:4100` fails
  for a reason unrelated to the file. They are pointed at loopback for the test,
  and a hostname hides in an `upstream { server … }` block as well as in a
  `proxy_pass`.
- **Certificates are loaded by `nginx -t`**, so a missing one fails the check
  the way mistake five did. Self-signed certificates are generated at whatever
  path each config names — `/etc/nginx/certs` for the containerised site,
  `/etc/letsencrypt/live` for the host one — so no file has to be edited to be
  tested.
- **Some of these files are alternatives**, not companions: the containerised
  and host variants of the same site produce a "duplicate upstream" if loaded
  together, which says nothing about either. Each is checked alone.

The general lesson is the one that keeps recurring in this file. **I had the
tool to check and did not use it**, exactly as with the CSS arithmetic and the
guards that read the wrong file. Reasoning about a configuration language from
its source is not verification.

---

## 2026-09-10 — Fixed the mobile type size by changing something that could not affect it

**What was wrong.** Reported as "too small on mobile". The narrow-screen block
set `body { font-size: 16.5px }`, up from 15px, and the report came back
unchanged.

**Root cause.** `rem` is relative to the **root** element, not to `body`.
Almost every piece of text in this stylesheet is a fraction of a rem —
`.tags` at `.8rem`, the footer at `.82rem`, `.score` at `.78rem` — so raising
body's font-size moved the paragraph text and left the captions, badges,
metadata lines and footer at 12.8px, 13.1px and 12.5px respectively. The half
of the page a reader actually complains about was the half the fix could not
reach.

**Prevention.** The scale hangs off `:root` now, which is the one declaration
that moves all of it, and the narrow block also raises the small print
explicitly. `tests/api/responsive.test.js` asserts the root is what changes and
that nothing in the block is left under `.85rem`.

**The wider lesson.** The first fix was plausible, shipped, and did nothing —
and I described it as done. Reasoning about CSS from the source is exactly as
reliable as reasoning about a query from its text: it looks right until
something measures it. There is no browser in this environment, so the arithmetic
had to stand in — `.8 × 16 = 12.8px` would have shown the problem in one line
before the first attempt, not after it.

**And the second fix was also insufficient**, reported again the same day. Two
things were wrong that the first round did not look for. The breakpoint was
`max-width: 40rem` — 640px — which a phone in landscape and *every* tablet
clears, so those devices fell back to the desktop scale and got the 12.8px
captions the fix was supposed to remove. And the base scale itself was the
problem: `.78rem`, `.8rem`, `.82rem` are densities chosen for a laptop, and the
narrow-screen block only ever papered over them below the breakpoint.

The fix that should have been first: raise the **base** so nothing anywhere is
under `.9rem`, raise the root, and set the breakpoint at 48rem. A special case
bolted onto a bad default fails everywhere the special case does not reach —
which is the same shape as the guards that went blind when their subject moved.
**Three attempts at one bug, each correcting something real and none of them
looking at the whole scale first.**

---

## 2026-09-10 — A person clicking "Edit" was shown raw JSON

**What was wrong.** Signed out, `/plugin/<slug>/wiki/edit` and `/contributions`
answered `401 {"error": "Sign in to edit this page"}`. Correct as a status code
and useless as a response: the reader had just clicked a link on a page, and
what they got was a machine's answer rendered as text.

**Root cause.** Both routes were written while thinking about the API surface,
where 401 is right, and the same handler serves people. The distinction that
matters is not the route but who is asking, and nothing was asking that.

**Prevention.** `needsSignIn` in `src/api/respond.js` looks at `Accept`: a
request that wants HTML is redirected to sign-in with a `return_to` that brings
them back to what they were doing, and everything else still gets 401 and a
sentence. Reported by the user, not by a test — no test asserted what a *person*
sees, only what the status code was.

---

## 2026-09-09 — A guard went blind instead of red when the thing it guarded moved

**What was wrong.** `tests/api/linked-routes.test.js` scrapes `href=` out of
`src/api/render.js` and checks each path against the routes `server.js` serves.
When the page HTML moved into `templates/`, the guard went on reading
`render.js` — where five links remained — and passed.

**Why it was nearly missed.** It did not fail. It found five links instead of a
dozen and asserted, correctly, that all five resolved. The only reason it was
caught is that one assertion happened to be `toBeGreaterThan(5)` and the count
landed exactly on the boundary. A threshold of three would have passed silently
and the guard would have been decorative from then on.

**Prevention.** It now walks `templates/` as well as the renderers, and asserts
it found enough markup to be doing its job. The general point is worth more than
the fix: **a test that reads a location rather than a value quietly stops
testing when the content moves.** When relocating anything, grep for tests that
name the old path.

**It happened again within the hour**, in the other direction: moving the wiki's
routes to `src/wiki/routes.js` left the same guard reading only `server.js`, and
it reported three working routes as broken. Red rather than blind that time,
which is the better failure — but the fix was the same one twice, so both halves
now walk `src/` instead of naming files.

**And a third time, from the same edit.** A regex written to delete the response
helpers from `server.js` matched further than intended and took `VOCABULARIES`
and half of `sendText` with it. `node --check` caught the truncation
immediately, but the missing constant only surfaced as four failing tests. A
multi-line regex deletion across a whole file is not a refactor tool; the lesson
is the one already in this file — **assert what you expect to remove, not just
that something was removed.**

---

## 2026-09-09 — An unbound variable made every synonym match every uncategorised plugin

**What was wrong.** Category synonyms (`skos:altLabel`) were joined into the
plugin text view so that searching "echo" would reach a delay. The join reused
`?cat`, bound in a sibling `OPTIONAL` a few lines above:

```sparql
OPTIONAL { ?plugin pu:category ?cat  BIND(...) }
...
OPTIONAL { GRAPH ?scheme { ?cat skos:altLabel ?altLabel } }
```

For a plugin **with no category** `?cat` is unbound, so the second pattern is
unconstrained and matches every alternative label in the scheme. Those plugins
collected all 134 synonyms in the taxonomy and became lexically matchable by
every word in it. Searching "brickwall" returned a water-sound generator above
three actual limiters.

**Why it survived.** The query ran, returned exactly 645 rows, and the first
plugin inspected had precisely the labels of its own category. The failure was
in the rows that were *not* sampled — the two with no category at all. The
symptom was visible in a statistic that had been printed and not read: "max alt
labels 134" in a corpus whose median was 10.

**Prevention.** The join re-matches the category inside the OPTIONAL rather
than borrowing a variable from a neighbouring one. `tests/store/categories.test.js`
asserts the invariant directly — a plugin with no category has no alternative
labels, and every label a plugin has belongs to one of its own categories.

**The general lesson**, which is pattern 2 again: a number that does not fit
the distribution is a finding. "min 3, max 134, median 10" was printed in the
same output that was used to declare the join correct.

---

## 2026-09-09 — Two edit scripts in one command, and only the second ran

**What was wrong.** A refactor was written as two Python blocks in a single
Bash call: the first was to move three functions out of `src/api/render.js`,
the second to fix up an import in the same file. The first aborted on a wrong
assertion and wrote nothing. The second ran anyway, and replaced the import of
`iri`/`literal` in a file that still used them. `render.js` was left importing
something it did not have and not importing something it did.

**Root cause.** Two dependent edits, two independent failure domains. An
assertion in the first script cannot stop the second, because they are
different processes. The safeguard that made the first script safe — assert
before writing — was exactly what let the second one run on a file in a state
it did not expect.

**Prevention.** Dependent edits go in **one** script, so one assertion aborts
all of them. Where they cannot, re-read and check the file between them rather
than assuming the earlier edit landed.

**Also, the same day and the same shape as the missing import above** — the
extraction left `renderPluginPage` calling `pluginJsonLd`, which had moved to
another module. That one cost nothing: the tests failed immediately and named
the line. The difference between the two is not the mistake, it is whether
anything was watching.

---

## 2026-09-09 — A route with nothing linking to it

**What was wrong.** The moderation queue worked and was reachable only by typing
the URL. `accountBar` had no link to it, so a moderator who did not already know
the address had no way in.

**Root cause.** The same pattern as the crawler user agent that advertised a
route which 404d — pattern 1, in the other direction. A link and a route have to
agree, and nothing connected them.

**Prevention.** `tests/api/linked-routes.test.js` extracts the `case '/…'`
labels and the `path.match(/…/)` regexes from `src/api/server.js` and asserts
that every statically decidable `href`/`action` in `src/api/render.js` resolves
to one of them. It reads the dispatcher rather than keeping a second list, and
it asserts the predicate discriminates so it cannot pass by matching everything.

---

## 2026-09-07 — Wrote tests that never ran

**What was wrong.** `vitest.core.config.js` lists test directories explicitly.
Two new ones — `tests/embeddings/` and later `tests/profiler/` — were written,
committed, and not in that list. Both suites passed locally in the sense that
nothing failed: they were never executed, and the run reported a healthy green
total that did not include them.

**How it surfaced.** Only by noticing that the file count in the summary had not
gone up. Nothing else would have said.

**What replaced it.** Both directories added. There is no guard: a glob over
`tests/**` would remove the failure mode entirely and is worth doing, at the cost
of losing the deliberate core/store split that keeps the fast suite fast.

**Lesson.** A test that does not run is worse than no test, because it reports
as coverage. Check the *file* count after adding a directory, not just the
passing count.

## 2026-09-07 — Advertised a contact page that did not exist

**What was wrong.** `HARVEST_CONFIG.userAgent` sends
`plugin-universe-harvester/0.1 (+https://plugin-universe.com/about/crawler)` on
every outbound request, and had done for every harvest of the Open Audio Stack
registry and of GitHub. There was no such page. The project's own operating
principle is to "identify the crawler honestly with a contact address", and a
link to a 404 is not that.

**How it surfaced.** By accident, while adding maintainer contact details for an
unrelated reason.

**What replaced it.** `docs/crawler.md`, served at that exact path: what the
crawler does, how it paces itself, that a 403 is treated as an answer, and how to
make it stop. Plus a test that reads the user agent string, extracts the URL, and
asserts the path is one the server actually serves — so the promise and the route
cannot drift apart again.

**Lesson.** A URL in an outbound header is a promise to a stranger, and it is
made every time the code runs, long before anyone thinks to check it.

## 2026-09-07 — Excluded from the image the very files the app serves

**What happened.** `/about`, `/terms` and `/about/crawler` returned 500 in
production while every other route was fine.

**Cause.** `.dockerignore` lists `docs` — written when nothing at runtime read
it, and correct at the time. Later the prose pages were built to render the
repository's own Markdown, deliberately, so that the terms on the site and the
terms in the repository could not drift. Nobody revisited the exclusion. The
image therefore had no `docs/`, `loadPage` threw, and the handler turned that
into a 500.

**What replaced it.** `docs/` is in the image — 204K of text against three
broken routes is not a saving. And the check moved from per-request to
**startup**: a deployment missing a page's source file now refuses to start,
naming the routes and the files. A container that will not come up is far easier
to notice than one quietly broken in one corner.

**Lesson.** Adding a runtime dependency on a path means checking what excludes
that path. `.dockerignore`, `.gitignore` and the SHACL shapes have now each been
left behind by a change elsewhere in this project; the pattern is a second file
that has to be edited in step and no test connecting them.

## 2026-09-07 — Harvested the homepage, modelled it wrongly, never showed it

**What was wrong.** Every harvester read a plugin's homepage and 642 of 645
plugins had one in the store. It was written as a **literal**, though
`foaf:homepage` ranges over `foaf:Document` — so a consumer following the link
had a string, not something to follow. And no page displayed it: not the HTML
profile, not the Turtle, not the JSON-LD.

Provenance was in the same state. The named-graph design exists so every
statement traces to a source and a licence, and all of it was there in the
metadata graph — invisible to anyone reading a plugin page.

**Why nothing caught it.** The SHACL shapes did not constrain `foaf:homepage`,
because the shapes were written against what the serialiser emitted rather than
against what the vocabulary says. A shape derived from the code cannot disagree
with the code.

**What replaced it.** `normaliseUrl` in the normaliser, so URLs are validated
once and the serialiser writes IRIs; the shapes now require `foaf:homepage` and
`rdfs:seeAlso` to be IRIs matching `^https?://`; the text view carries the
source graph, and every profile page renders a provenance block naming the
source, its licence, and links to both the origin and the specific source
record.

**A second defect found while doing it.** `DownspoutHarvester` set
`derivedFrom` to the local checkout path it happened to be reading. Publishing
provenance turned that into a broken link and a leak of a local filesystem path
on 50 public pages. It now records the public origin, and the renderer refuses
to linkify anything that is not an http(s) URL.

**Lesson.** Data that is harvested but never displayed is not verified by
anything. Both defects had been in every ingest since the harvesters were
written and were found within minutes of putting the values on a page.

## 2026-09-07 — A Fuseki assembler that lost every named graph on restart

**What happened.** The first real `docker compose up` failed with "dependency
fuseki failed to start". Chasing that turned up four defects in the Fuseki
service, none of which had ever been exercised because local development used a
hand-created dataset rather than the assembler.

1. **The healthcheck called `curl`, which is not in the image.** It could never
   pass, so `depends_on: condition: service_healthy` blocked forever while the
   container itself was perfectly healthy. That is the error the user saw. The
   image has `wget`.
2. **Every path was for a different image.** `secoresearch/fuseki` uses
   `/fuseki-base`, not the `/fuseki` of the official images. The assembler was
   mounted at `/fuseki/config/`, which the server never reads — and a config at
   the wrong path is not an error, it is silence, so the dataset simply was not
   there. The volume was mounted at `/fuseki/databases` for the same reason.
3. **The worst one: named graphs were not persisted at all.** The assembler
   declared `ja:RDFDataset` with a `ja:defaultGraph` of `tdb2:GraphTDB2`. That
   reads as though it says "a TDB2 dataset with a union default graph". It does
   not. It builds a *general* dataset around one persistent graph, so quads
   written to any named graph go into an in-memory structure. Writes returned
   204, queries answered correctly, and a restart emptied the store. Measured:
   insert two triples, restart, count zero.

   Every triple in this system lives in a named graph. This would have lost the
   entire catalogue, silently, on the first restart after going live.

   The fix is to attach the service directly to `tdb2:DatasetTDB2` with
   `tdb2:unionDefaultGraph true`.
4. The documented "create the dataset" step would have created a second,
   differently configured dataset alongside the assembler's.

**Root cause of all four.** The Fuseki service was carried over from semem's
compose file and adapted by reading, never by running. Everything else in this
project has been checked against live services; this one component was checked
against a local Fuseki that had been set up by hand months earlier and therefore
exercised none of it.

**Prevention.** Persistence is now verified the only way it can be — write,
restart, count; then `down`, `up`, count again. A store that answers correctly
until it is restarted is indistinguishable from a working one right up to the
moment it matters.

## 2026-09-07 — Threw away the units vocabulary when the source got it right

**What was wrong.** `normaliseUnit` mapped unit *strings* — "Hz", "%", "ms" — onto
`units:` IRIs. An LV2 bundle does not use strings: it states `units:unit
units:hz` directly, which is the exact target of the mapping. That fell through
to the unrecognised branch, so the plugin ended up with no typed unit at all and
a `pu:unitLabel` reading "http://lv2plug.in/ns/extensions/units#hz".

The mapping worked on every source that needed mapping and failed on the one
source that had already done it correctly.

**How it surfaced.** A test of the new GitHub harvester, written against a
bundle that declares its units the ordinary LV2 way. The seed corpus never
caught it because the flues bundles declare no units at all, so nothing in the
store was actually wrong — but it would have silently degraded every LV2 bundle
harvested from GitHub, which is precisely the population that harvester targets.

**What replaced it.** A `units:` IRI passes through as itself, with its local
name as the label.

**Lesson.** A normaliser is a mapping *towards* a target vocabulary, so it needs
a case for input that is already in it. Worth checking the other maps for the
same shape: `PARAMETER_ALIASES` and `LV2_CLASS_MAP` both key on the source
vocabulary and would behave the same way.

## 2026-09-07 — Cut blank nodes in half at every batch boundary

**What happened.** The first SHACL run over the store reported 24 violations:
ports with no symbol and no name, ports with no type, scale points missing a
label, package files with no download URL, packages with no version. The
registry JSON has a URL on all 1700 of its files, so the data was not the
problem.

**Root cause.** `IngestPipeline` wrote in batches of 500 triples, cutting the
list wherever the count landed. A blank node label in an `INSERT DATA` is scoped
to that request: `_:p42` in one request and `_:p42` in the next are two
different nodes. Every batch boundary that fell inside a plugin therefore split
one of its ports or package files in two — one node holding the `lv2:port` link
and the type, another holding the symbol, the range and the unit. Neither half
was findable by a query expecting a whole one, and nothing complained.

**What replaced it.** Writes are grouped by plugin and a group is never split
across two requests; a group larger than the batch size is written whole.
`tests/store/shapes.test.js` ingests a 300-port plugin — comfortably over the
boundary — and asserts that no port arrives without its symbol.

**Lesson.** This is the class of defect the shapes were written for, and it was
found within a minute of running them for the first time. Chunking a serialised
graph by triple count is only safe if there are no blank nodes in it; there
almost always are.

## 2026-09-07 — Embedded "[object Object]" for every parameter

**What was wrong.** `composeText` joined `plugin.parameters` directly. At the
ingest call site those are port *objects*, so every one of the 86 vectors in the
index carried ten copies of `[object Object]`. The same function emitted roles
and formats as full IRIs — `http://purl.org/stuff/transmissions/AudioEffect` —
which is uniform noise shared by every plugin in the catalogue, diluting the
words that actually discriminate. `plugin.tags` was read but never populated.

**Why it was invisible.** Two record shapes reach the function: the harvest
record and the SPARQL text view, whose query already shortens IRIs and returns
port names as strings. The lexical signal was matching clean text while the
vector index was built from the other shape. The index built, search ran, and
the results were quietly worse.

**What replaced it.** A `textView()` step reduces either shape to the same
fields, shortening IRIs to local names and taking a port's name or symbol; a
parameter it cannot name is an error rather than something to stringify.
`tests/embeddings/composeText.test.js` pins both shapes to identical output.

**Lesson.** A function that silently accepts two input shapes will eventually be
given the wrong one. `String(anObject)` never throws, which is exactly why it
should not be reachable.

## 2026-09-06 — Served Turtle that does not parse

**What was wrong.** `pluginTurtle` wrote category IRIs as `pu:category/midi`.
A Turtle prefixed name may not contain a slash, so every plugin's Turtle
representation failed to parse — at exactly the dereferenceable IRI that is
supposed to make the catalogue linked data.

**What replaced it.** Category IRIs are written out in full. The test now round
-trips the emitted Turtle back through the parser, including a case with quotes,
newlines and a backslash, so "it looks like Turtle" is no longer the standard.

**Lesson.** Generated RDF must be parsed in a test, not eyeballed. The
serialiser used by the ingest path was fine because it emits full IRIs
throughout; only the hand-written rendering path had the bug.

## 2026-09-06 — Minted the same IRI for 21 distinct plugins

**What happened.** A facet count that did not add up: 50 VST3 + 36 LV2 = 86,
against 107 plugins ingested. 21 flues plugins had silently vanished into other
plugins' catalogue entries.

**Two causes, both real.**

1. `mintPlugin` built its identity tuple from vendor, bundle name and class ID.
   LV2 plugins have none of the last two, so every flues plugin hashed on the
   vendor alone — and six bundles share the display name "Flues Synthesizers",
   so they produced byte-identical IRIs and overwrote one another. The fix: when
   there is no bundle or class ID, use the plugin's own canonical IRI, which LV2
   gives every plugin by design and which the harvester was already reading and
   then discarding. Bundle name still wins where present, so the same VST3
   harvested from two sources continues to deduplicate.

2. The harvester was scanning `build-output/`, `releases/` and `build/staging/`
   as well as the source tree, so it read up to four copies of every bundle.
   That is where the duplicate display names came from. `Lv2Harvester` now skips
   build directories and deduplicates by canonical IRI as a backstop. The real
   corpus is 36 flues plugins, not 57, and the harvest is four times faster.

**The deeper fix.** Neither cause would have been noticed from the ingest
output, which cheerfully reported "57 plugins". `IngestPipeline` now collects
IRI collisions and refuses to ingest, naming the colliding records. A silent
merge of two distinct plugins is exactly the kind of corruption that is very
expensive to discover later — and it was the *second* bug's symptom that the
first bug's detector caught.

**Lesson.** When a derived number does not add up, chase it. Idempotent minting
was tested; uniqueness was not.

## 2026-09-06 — pkill matched its own shell

**What was wrong.** `pkill -f "bin/ingest.js"` killed the shell running it,
because `-f` matches the full command line and the pattern appeared in it. The
enclosing command died mid-way, silently discarding a file edit that had not yet
run.

**What replaced it.** Killing by PID. The usual alternative is a character class
(`pgrep -f "[b]in/ingest.js"`) that cannot match the literal pattern text.

## 2026-09-06 — Hybrid retrieval bought recall@1 by selling recall@3

**What happened.** Adding the lexical signal lifted recall@1 from 80% to 87% on
the fixture corpus and fixed the MIDI query that vector-only retrieval could not
rank. But recall@3 *fell*, from 93% to 87%: "make a sound wobble in time with the
track" went from unranked to rank 9, and "add grit and analogue colour to a mix"
from rank 3 to rank 5.

**What was wrong.** Every query token counted equally. In a catalogue of audio
software, "sound", "time", "mix" and "track" appear in most descriptions, so a
long conversational query sprayed weak credit across the whole corpus and buried
the genuine match under plugins that merely shared a common word.

**What replaced it.** `src/search/LexicalIndex.js` weights each term by inverse
document frequency, computed once over the loaded corpus. A term the whole
corpus shares scores near zero; a rare, discriminating term scores near one.
Note that IDF cancels out for a single-token query — it only does work on the
multi-token conversational queries, which is exactly where the damage was.

**Lesson.** A headline metric moving the right way can hide a second metric
moving the wrong way. Report both, and keep a test that asserts hybrid never
loses ground to vector alone at rank 3.

## 2026-09-06 — Assumed a parameter default is a number

**What was wrong.** `DownspoutHarvester` read `trn:default` with a strict
numeric accessor. It threw on the first plugin with a boolean toggle. The corpus
turned out to hold floats, plain integers, the string `"false"`, and a file path
(`/tmp/midiscribe.mid`).

**What replaced it.** `GraphView.scalar()`, which types by datatype where the
source declares one and by lexical form where it does not, returning a number,
a boolean or a string. `minimum`/`maximum` stay strictly numeric, because a
non-numeric bound really would be a defect.

**Lesson.** Survey the actual values before writing the accessor. One `grep`
over the corpus would have shown all four shapes.

## 2026-09-06 — Assumed a hand-maintained corpus is homogeneous

**What was wrong.** `DownspoutHarvester` required every `profile.ttl` to contain
a `trn:PluginProfile`. 49 of the 50 do. `plugins/worms/profile.ttl` is
LV2/DOAP-shaped instead — `lv2:Plugin` with `doap:name`, and `doap:name` inside
the maintainer node where the LV2 bundles use `foaf:name`.

**What replaced it.** The harvester reads whichever shape is present, falling
back to a DOAP reader. A plugin silently missing from the catalogue is a worse
outcome than a slightly more forgiving reader, and the alternative — rejecting
one in fifty — would have gone unnoticed.

**Lesson.** Documentation describes the intended shape. The corpus is the
authority on the actual one.

## 2026-09-06 — schema.org JSON-LD carried undefined keys

**What was wrong.** `pluginJsonLd` set `author: undefined` when a plugin had no
vendor. `JSON.stringify` drops such keys, so the served output was correct, but
any consumer reading the object directly would find a property that is not
really there. A test caught it.

**What replaced it.** Keys are added only when there is a value.

## 2026-09-06 — Assumed faiss-node had `reconstruct()`

**What I did.** Wrote `VectorIndex.compact()` to rebuild the index by reading
each surviving vector back with `index.reconstruct(position)`.

**What was wrong.** `faiss-node` exposes `ntotal, getDimension, isTrained, add,
train, search, write, mergeFrom, removeIds, toBuffer` and the statics `read,
fromBuffer`. There is no `reconstruct`. The test failed immediately, which is
the only reason this cost minutes rather than a design.

**What replaced it.** `removeIds`, which is better anyway — it compacts in
place rather than rebuilding. Its renumbering behaviour was *verified* before
being relied on: removing positions 1 and 3 from a five-vector index leaves the
survivors in relative order renumbered 0,1,2. `compact()` now asserts that FAISS
and the IRI mapping still agree afterwards, so a future change in that behaviour
fails loudly instead of silently returning the wrong plugin.

**Lesson.** Check the actual method list of a native binding before designing
around it. Ten seconds of `Object.getOwnPropertyNames(Object.getPrototypeOf(x))`.

## 2026-09-06 — `VectorIndex.size` counted orphaned slots

**What was wrong.** `size` returned `iriByPosition.length`, which includes
positions superseded by a replacement. After re-adding a vector for the same
IRI, an index holding one logical plugin reported two.

**What replaced it.** `size` is `positionByIri.size` — live entries only. The
distinction matters because `size` is written into the persisted sidecar and
would otherwise misreport the catalogue's extent.

## 2026-09-06 — Expected vector-only retrieval to rank a MIDI query correctly

**What I did.** Wrote an end-to-end test asserting that "generate MIDI CC
automation locked to host tempo" would rank a transport-synced MIDI modulator
first among three plugins.

**What was wrong.** It ranked second, behind a reverb. Investigating: the scores
for that query were 0.558 / 0.532 / 0.523 across three unrelated plugins —
undifferentiated noise. The compressor query in the same test scored 0.848
against 0.509 / 0.463, which is clean separation. So the embedding model
discriminates well when query and description share vocabulary and poorly when
they do not ("automation locked to host tempo" vs "transport-synchronised MIDI
CC modulator").

I checked whether nomic-embed-text's `search_document:` / `search_query:` task
prefixes fixed it. They did not — marginally worse, and it made no difference to
the ordering.

**What replaced it.** The assertion was wrong to make, not the implementation.
Retrieval quality is now measured by `tests/store/retrieval-quality.test.js`
over a 12-plugin corpus and 15 queries, reporting recall@1 and recall@3 against
a floor. Baseline for vector-only retrieval: **recall@1 80%, recall@3 93%**.

**Lesson.** This is the case the hybrid design in `docs/architecture.md` §5
exists for — a lexical signal on "MIDI" resolves it trivially. Worth noting that
the architecture predicted this before the code did. Do not tune a test until it
passes; measure the behaviour and set a floor.

## 2026-09-06 — Ported semem's credential defaulting

**What was wrong.** semem's `SPARQLExecute` defaults missing credentials to
`admin`/`admin`. Copying that would have contradicted the project's own
no-inline-fallbacks rule on the first file written.

**What replaced it.** `SPARQLClient` accepts no credentials at all (a local
unsecured Fuseki is legitimate) or a complete pair, and treats a user without a
password as an error. Guessing a password against a configured endpoint is worse
than stopping.
