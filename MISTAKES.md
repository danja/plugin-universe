# Mistakes and corrections

Things that turned out to be wrong, and what replaced them. Kept so the same
ground is not re-covered. Newest first.

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
