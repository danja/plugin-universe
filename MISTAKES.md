# Mistakes and corrections

Things that turned out to be wrong, and what replaced them. Kept so the same
ground is not re-covered. Newest first.

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
