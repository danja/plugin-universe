# Claude : prose from strangers, and getting the HTML out of the code

2026-09-10. The wiki — the CC BY-SA half of the catalogue, planned since Phase 0
and untouched until now — plus a restructuring that came out of building it.

## Why the wiki waited

It was blocked on something that was not technical. Wiki prose is user-authored
work under CC BY-SA, and the terms governing that had not been reviewed. A
second opinion has now judged them adequate to open contributions on, which is
recorded exactly that way in `docs/contributor-terms.md` — a second opinion is
not a lawyer's sign-off, and the document says so rather than claiming a
review it did not have. The trigger for a real review is promotion, which is
also when the DSA and ASA labelling obligations arrive.

## Sanitising without a sanitiser

`marked` does not sanitise; its own documentation says so. `src/api/pages.js`
already renders Markdown with it and carries a warning at the top not to reuse
that path for this — the difference is not the library, it is that those
documents are in the repository and this one is typed into a form by anyone with
a GitHub account.

The usual answer is to render and then clean the HTML with a library. This does
the opposite and stops the dangerous constructs from being emitted at all, which
is a smaller claim to defend than "our sanitiser catches everything":

- **Raw HTML is dropped.** `renderer.html` receives every html token, block and
  inline, and returns nothing. `<script>alert(1)</script>` loses its tags and
  leaves the harmless text. Nothing in the output is markup marked did not
  itself construct — and *that* is the property that makes the rest safe, rather
  than hopeful, because there are no attacker-supplied tags to reason about.
- **Link schemes are filtered.** `[x](javascript:alert(1))` passes through marked
  untouched. Verified against it rather than assumed — it emits that happily.
- **Images are links, not loads.** An image in a wiki page is a URL every
  reader's browser fetches from a third party: a tracking pixel, a hotlink to
  something illegal, or fifty megabytes.

An earlier idea — escape the source before parsing so no HTML can survive — was
abandoned on contact with code blocks, which is exactly where a plugin wiki will
contain markup. Twenty-one tests, written as attacks.

## Revisions, not edits

Nothing is ever edited or deleted. A save writes a new revision superseding the
last through `prov:wasRevisionOf`, so the history *is* the data rather than a log
kept beside it, and reverting is itself a revision — the record of what happened
survives the fixing of it.

Each author's revisions go into their own `-prose` graph under CC BY-SA. Not one
shared wiki graph: the licence requires attribution, erasure has to be a DROP of
one person's graph, and a page written by four people is then four graphs rather
than four rows nobody can separate. The cost is that the current text of a page
is a query across graphs, which is a good trade.

A save built on a stale revision is refused, with the current version handed back
and the editor's own text kept. Silently overwriting somebody's work is the one
thing a wiki must not do.

The attribution had a bug worth recording: the byline read `1b505ba2`, because an
account IRI ends in a content hash and the renderer was falling back to it. That
names nobody, and CC BY-SA requires naming somebody. The queries now join the
login from the accounts graph, and an author whose account has gone is credited
as withdrawn rather than as a hash.

## Free text into SPARQL literals

The specific worry raised was that prose becomes a SPARQL literal, and a quote or
a backslash in somebody's sentence must not end the literal or the update.
`escapeLiteral` was already sound — backslash first, then quotes, newlines and
tabs, with the remaining C0 controls stripped because they have no SPARQL escape.
What was missing was proof, since wiki text is the first genuinely freeform long
text to go in. `tests/store/wiki.test.js` round-trips quotes, backslashes, three
consecutive quote marks, unicode, and a payload shaped like an `INSERT DATA`
escape — then asserts the graph that payload named was never created.

## The HTML comes out of the code

`render.js` had reached 705 lines, most of it markup in template literals,
including the stylesheet — where a backtick inside a CSS comment silently ended
the string and broke the build. Pages are now `templates/*.html`, loaded by name
through `src/api/Templates.js`.

The same discipline the project already had for SPARQL, for the same reasons:
one loader, one syntax, every placeholder required. `{{name}}` escapes,
`{{{name}}}` inserts a fragment already built as HTML, and escaping is the
default because the alternative is remembering.

**No loops and no conditionals**, deliberately. A template language grows until
it is a worse programming language, and each construct added makes the escaping
question harder. A list is `each()`, filling a row template and joining; an
optional block is `when()`, which is a fragment or an empty string. Templates lay
out; code decides.

`render.js` went from 705 lines to 510 **without a single test changing**, which
is the check that it was a move rather than a rewrite. `server.js` crossed the
threshold in the process, so the wiki's routes went to `src/wiki/routes.js`
beside the rest of the wiki and the response helpers to `src/api/respond.js` — a
feature's routes can now live with the feature.

## Three mistakes, all the same mistake

Moving things broke the same guard three times in an afternoon.

`tests/api/linked-routes.test.js` scrapes `href=` out of the renderer and checks
each path against the routes served. When the markup moved to `templates/` it
went on reading `render.js`, found five links instead of a dozen, and **passed**
— it went blind rather than red. The only reason it was caught is that one
assertion happened to be `toBeGreaterThan(5)` and the count landed exactly on the
boundary. Then moving the wiki routes broke the other half of it, red this time.

Third, from the same session: a regex written to delete the response helpers from
`server.js` matched further than intended and removed `VOCABULARIES` and half of
`sendText`. `node --check` caught the truncation at once; the missing constant
surfaced only as four failing tests.

The general lesson is worth more than any of the fixes. **A test that reads a
location rather than a value quietly stops testing when the content moves.** Both
halves of that guard now walk `src/` and `templates/` instead of naming files,
and a multi-line regex deletion across a whole file is not a refactoring tool.

## Where this leaves things

Phase 3 is complete: accounts, corrections, moderation, trust promotion, rate
limiting, a contributions page, and the wiki. 436 core tests and 95 against the
live store.

The live suite gained checks for all of it, and four of them fail — correctly,
because the deployed container is still on `ef41d37` while this work sits at
`b630233`. The build stamp answered that in one request, which is what it is for.
