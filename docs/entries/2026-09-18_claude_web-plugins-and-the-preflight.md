# Claude : web plugins, two renamed lists, and a preflight nobody could see

2026-09-18. Four items off the inbox: a harvester for JigDAW's browser-native
plugins, moving the two working lists to the repository root, and a review of
cross-origin access and bot policy that turned up three real defects.

## A source that needed almost no translation

JigDAW plugins run in a browser — an AudioWorklet processor over a WebAssembly
module, fetched from the plugin's own dereferenceable IRI — and their profiles
extend the format this catalogue publishes at `/about/profiles`. The groundwork
was already in place from an earlier session: `trn:WebAudio` in
`vocabs/trn-extensions.ttl`, the format in the shapes' `sh:in` list and in
`PLUGIN_FORMATS`, and `trn:requires` widened to accept an IRI from any published
vocabulary rather than only `trn:`.

So `JigDawHarvester` is short, and the interesting parts are what it does not
do. Ports go through `readPort` from `Lv2Bundle` — the same interpretation an
LV2 bundle gets, rather than a second one that would drift. Platforms are
deliberately empty: `pu:supportedPlatform` enumerates three desktop operating
systems, a web plugin runs on none of them in particular, and the format carries
what a platform list would have been asked to say. And the `jig:` half of each
profile — module and processor locations, SRI digests, render quantum, latency,
channel counts — is not harvested at all, because `grep -rn jig: sparql/queries/`
would return nothing and a predicate no query selects is invisible. That is
written in the harvester and in INBOX.md with what closing it would cost.

Three plugins, 403 triples, SHACL conformant, in the local store and searchable:
"seeded bass line generator" returns BassGen at 0.87.

Two things fell out of the wiring that were nothing to do with JigDAW:

- `bin/ingest.js` decided whether to stop on a failed source with
  `harvesters.length > 3` — a proxy for "is this the GitHub sweep". Adding a
  fourth configured source silently flipped a stop-on-error run into a
  log-and-continue one. It asks whether `--github` was passed now.
- The vendor identity layer is derived by a separate script, because the
  identity of a vendor is a fold across sources that no single harvester can
  compute. Skipping it after a harvest leaves new plugins with a vendor string
  and no vendor page, and two store tests went red until it was run. That has
  now been a written-down habit and missed twice, so the ingest ends by asking
  the store how many plugins are in that state and naming the command.

## Two lists moved, and a guard for the class of thing

`docs/todo-misc.md` became `INBOX.md` and `docs/danja-todo.md` became
`HUMANS.md`, both at the root where somebody arriving at the project sees them.
Between them they were referenced from TODO.md, CLAUDE.md, `docs/plan.md`,
`docs/index.md`, `docs/plan-done.md`, MISTAKES.md, two nginx configurations and a
comment in `src/billing/Billing.js` — twenty-odd links, each of which would read
as fine to anybody not chasing it.

That is the pattern at the top of CLAUDE.md with documents instead of code, so
`tests/api/doc-links.test.js` now walks every Markdown file in the repository and
fails on a relative link that does not resolve. It found one straight away that
had nothing to do with the move: `docs/announcement-01.md` was deleted in
ae2aeb3 and HUMANS.md was still recommending it. The line now says where to
recover it from.

## The preflight problem

The inbox asked for a check on unintended CORS issues. The posture is
deliberate — everything is CC0, so `Access-Control-Allow-Origin: *` is right —
and the defects were all in the mechanics, all invisible to the test suites and
to `curl`.

**The application answered every preflight the same way.** One fixed object,
`Access-Control-Allow-Methods: GET, OPTIONS`, for every path — including the ten
in `POST_PATHS` and `/mcp`, which accepts nothing but POST. A browser reading
that never sends the real request, so the endpoint works for anything with a
socket and for nothing in a page. There was no `Access-Control-Allow-Headers` at
all, which refuses a JSON POST on its own. This is the billing-routes failure
wearing different clothes: a second list that had to agree with `POST_PATHS` and
did not, in a place where the failure produces no server-side evidence
whatsoever. `acceptsPost()` is the one list now, read by the guard and by
`preflightHeaders()`.

**nginx and its upstreams were both answering.** Jena's `CrossOriginFilter` is on
by default: Fuseki reflects the request's `Origin`, sets
`Access-Control-Allow-Credentials: true`, and on a preflight advertises seven
methods. The SPARQL vhost added its own three headers on top, and a duplicated
`Access-Control-Allow-Origin` is not twice as permissive — it is invalid, and
every browser refuses the response. **The public SPARQL endpoint could not be
called from a browser at all**, which is most of what a public SPARQL endpoint
is for. The MCP vhost had the same duplication against this application's own
headers. Both now hide the upstream's set, so one answer reaches the client.

`nginx -t` cannot see any of this — it is valid configuration and wrong
behaviour, the same shape as `add_header` in a location replacing the server
block's headers. So the checks are `tests/api/cors.test.js` (every path the
guard opens must be offered POST; every vhost that sets
`Access-Control-Allow-Origin` must hide the upstream's in each location it
proxies) and, in `tests/store/server-starts.test.js`, a real preflight sent to
every write route and to `/mcp` against the running process.

While in those files: the `api.` server block in both nginx variants set HSTS
and neither `X-Content-Type-Options` nor `Referrer-Policy`, which the site block
beside it has always set. `add_header` does not inherit across server blocks any
more than it does across locations.

## On bots, nothing was wrong

Nothing blocks a crawler anywhere: no nginx rule and no application rule matches
on a user agent, and the only limits are per-IP rate zones generous enough that a
polite crawler never meets them. `robots.txt` is permissive by design, its
exclusions are the unbounded query space rather than any content, and the
position on AI crawlers is stated in the file rather than left to be inferred —
"they are not excluded, and that is deliberate". `tests/api/robots.test.js`
already holds it to all of that. The subdomains serve no `robots.txt` of their
own, which reads as permission and is the intended answer, and `rel=canonical`
points at the site's origin from every page, so the API subdomain serving the
same pages is not a duplicate-content problem.

Two judgement calls are recorded in INBOX.md rather than decided unilaterally:
`/dumps/` is crawlable and large, and an external host capability shows its local
name on a plugin page because labels come from the `trn:` vocabulary and
`jig:MidiEvents` is not in it.
