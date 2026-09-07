# Claude : the registry, the shapes, and two bugs the shapes found

2026-09-07. Continuing Phase 1. Three things landed — the Open Audio Stack
registry harvester, the SHACL shapes, and the AUFX-O alignment graph — and the
shapes immediately paid for themselves.

## The registry

The Open Audio Stack registry is the source the terms review picked out as the
best external one available, and it lives up to it: CC0-1.0, a static JSON API
generated from YAML in git, built explicitly for third-party integration. No
notice to carry, no database-right analysis, no scraping question. One request
to `plugins/index.json` returns 559 packages.

It is also, conveniently, the manifest this project's packaging layer was
already modelled on, so `pu:Package` and `pu:PackageFile` needed no invention —
just filling in.

What it adds beyond breadth is the thing the seed corpus had no source for at
all: **distribution**. 1,700 files with SHA-256 checksums, download URLs,
operating systems, architectures and installer-versus-archive kinds. That is the
difference between "this plugin exists" and "here is the artefact, here is its
hash, here is which of your machines it runs on".

Three decisions worth recording.

**Only unambiguous payloads become formats.** The registry's `contains` field
mixes plugin formats with raw binary payloads: `vst3`, `clap` and `lv2` sit
beside `dll`, `so`, `elf` and `exe`. A bare `dll` is very probably a VST2 — 128
of them are — but "probably" is not a fact, and the project's own rule is that a
scan beats a guess. The unambiguous ones map to `trn:` format individuals; the
rest are kept verbatim as `pu:containsArtefact` for the profiler to settle in
Phase 2.

**Tags are kept whether or not they map.** 60-odd registry tags map onto the
SKOS category scheme; the rest — `juce`, `gen`, `mix bus` — do not. They are
stored as `pu:tag` literals anyway. The cost of leaving a tag unmapped is small
and reversible; the cost of mapping one wrongly is a facet that lies.

**A registry entry is `rdfs:seeAlso`, not `owl:sameAs`.** LV2 plugins have a
canonical IRI for the plugin itself, which earns `sameAs`. The registry's
`index.json` is a document *about* a plugin. Those are different claims.

Identity needed one addition. The registry gives no bundle name and no class ID,
only an `organisation/package` slug — globally unique and stable, which is
exactly what minting wants. `mintPlugin` now has a third ranked branch for it.
The vendor is deliberately not in that tuple: the slug already contains the
organisation, while the display name beside it is editorial and changes.

## The shapes, and what they found

`vocabs/shapes.ttl` was deferred from Phase 0 on the grounds that writing shapes
against imagined data is guesswork. That was right. Written against real
harvested output, every constraint corresponds to something that has gone wrong
or would be silently wrong: a format IRI that is a typo creates a facet matching
nothing; a category outside the concept scheme dangles; a `minimum` above a
`maximum` makes every range check nonsense; a malformed SHA-256 is worse than no
SHA-256, because it looks checkable.

The first run reported 24 violations across two graphs. Ports with no symbol.
Package files with no download URL. Packages with no version.

The registry has a URL on all 1,700 of its files. So the data was not the
problem.

**A blank node label in an `INSERT DATA` is scoped to that request.** `_:p42` in
one request and `_:p42` in the next are two different nodes. The ingest pipeline
was batching writes at 500 triples and cutting the list wherever the count
landed — so every batch boundary that fell inside a plugin split one of its
ports in two: one node holding the `lv2:port` link and the type, another holding
the symbol, the range and the unit. Neither half was findable by any query
expecting a whole one.

This had been in the store since the first ingest. Nothing complained, because
nothing was in a position to. A SELECT for ports returns fewer rows than there
are ports, and there is no denominator to compare it against.

Writes are now grouped — one plugin, one concept — and a group is never split;
an oversized group is written whole. A store test ingests a 300-port plugin,
comfortably over the boundary, and asserts that no port arrives without its
symbol.

The lesson generalises: chunking a serialised graph by triple count is only safe
if it contains no blank nodes, and it usually does.

## The second bug, found on the way

Checking what the registry harvester would embed turned up something worse in
the code that was already running.

`composeText` builds the string that gets embedded. It was joining
`plugin.parameters` directly — and at the ingest call site those are port
*objects*, so every one of the 86 vectors in the index carried ten copies of
`[object Object]`. The same function was emitting roles and formats as full
IRIs, `http://purl.org/stuff/transmissions/AudioEffect`, which is uniform noise
shared by every plugin in a catalogue of audio software, diluting the words that
actually discriminate. And `plugin.tags` was read but never populated, so tags
contributed nothing.

None of this was visible. Two record shapes reach the function — the harvest
record and the SPARQL text view, whose query already shortens IRIs and returns
port names as strings — and the lexical signal was matching the clean one while
the vector index was built from the other. The index built. Search ran. The
results were quietly worse.

A `textView()` step now reduces either shape to the same fields, and a parameter
it cannot name is an error rather than something to stringify. `String(anObject)`
never throws, which is precisely why it should not be reachable.

## Alignment

`vocabs/alignment.ttl` maps `trn:`, `lv2:` and `pu:` to AUFX-O and schema.org.
Every statement is `skos:closeMatch`, not `owl:equivalentClass`, for two reasons
worth keeping: `trn:PluginProfile` is used here as the plugin but named as a
description of one, and asserting equivalence would export that ambiguity into
other people's reasoners; and AUFX-O models formats as classes where this
catalogue models them as individuals, so there is no OWL-DL-safe identity
without punning for a mapping file's convenience.

AUFX-O is CC BY-SA 4.0. The alignment graph is CC0 because it asserts
relationships between their IRIs and ours rather than reproducing their
ontology — a distinction recorded in the terms review alongside the rest.

## Where it stands

645 plugins in three source graphs. The remaining Phase 1 item is the
DOAP/GitHub harvester, which needs two decisions first: which repositories to
sweep, given the registry already covers most open-source plugins that publish
releases, and a token, since 60 requests an hour is neither useful nor polite.
