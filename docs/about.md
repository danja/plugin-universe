# About Plugin Universe

An open, machine-readable database of DAW plugins, with search that works on
what a plugin *does*. Everything factual in it is public domain. You can query it, download it, and
build on it without asking.

## Who it is for

**Musicians and producers**, searching by what a plugin does. "Warm analogue bus
compressor" should find compressors - including ones whose descriptions never use
any of those words.

**Plugin developers**, wanting their work found, and wanting comparisons that
were measured rather than asserted.

**Programs and agents** - DAWs, plugin managers, and AI assistants that need
structured knowledge about plugins. This audience is the one nobody currently
serves at all, and it is the reason the whole catalogue is RDF with a public
SPARQL endpoint rather than a database behind a search box.

## Navigation

- [Services](/services) - every way this catalogue can be read: web pages, JSON,
  RDF, a public SPARQL endpoint, a package registry view and an MCP face.
- [Resources](/resources) - forums, news, frameworks, specifications and DSP
  references. Other people's sites, for producers and for developers.
- [Plugin profiles](/about/profiles) - what a profile is, and why it is worth a
  plugin's author filling one in.
- [Promoted listings](/about/promotion) - what a paid placement buys, exactly
  how much it changes ranking, and what it cannot do.
- [Measurements](/about/measurements) - what the profiler measures, what each
  verdict means, and why a reading is about one binary on one machine.
- [Contributor terms](/terms) - what you agree to when you contribute: CC0 for
  facts, CC BY-SA for prose.
- [Vocabularies](/ns) - the RDF terms every published description uses, as
  documents that resolve.
- [The SPARQL endpoint](/about/sparql) and [the MCP endpoint](/about/mcp) - the
  two ways to ask this catalogue a question it has no page for.
- [About the crawler](/about/crawler) - what the harvester does, how it behaves,
  and how to make it stop.
- [Contact](/about/contact) - how to reach the person behind this, and what to
  say.

---

## Why it exists

**The data does not exist in a usable form.** The largest plugin catalogue is a
website, not a dataset. You can read it; you cannot query it, join it against
something else, or point a program at it.

Meanwhile the cost of making a plugin has collapsed. Someone with modest
technical skills and AI assistance can build and ship one, and the number of
plugins is growing faster than any hand-curated list can absorb. A catalogue
that ingests automatically is the right shape of answer to that, and it is worth
building before the flood rather than after.

## What makes it different

**Turtles all the way down.** It is machine-readable to the ground. Every plugin has a permanent
identifier that resolves to Turtle, JSON-LD or a human page depending on what
you ask for. There is no scraping step and no API key for reading.

**It says where everything came from.** Every fact lives in a named graph
carrying its source, the terms that source published under, and when it was
harvested. Look at any plugin page and you can see which source said what, and
follow the link back. A catalogue that cannot be checked is asking to be
trusted.

**It measures.** Most of a catalogue is what someone *said* about a plugin. The
profiler finds out: it runs the plugin's own binary in a sandbox and records
what it reports - ports, latency, whether it loads at all, whether it crashes.
Where a measurement contradicts a description, the measurement wins. See
[profiling.md](profiling.md).

**Search understands descriptions.** Retrieval combines exact matching with
semantic similarity over a composed view of each plugin, so a query phrased in
your words can find a plugin described in someone else's.

## The data

Harvested from sources whose terms permit it, and only those. Each source was
reviewed before a line of code was written to read it, and the review is public:
[sources.md §4](sources.md).

Every plugin carries the two things people ask first - whether the source is
open, and whether it costs money - as separate facts, because they are
independent. Ardour is open source and its official binaries are sold.

### Licence

**The factual catalogue is [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)**
- public domain, no conditions. Names, formats, parameters, categories,
download URLs, measurements. Take it and use it.

**User-authored prose is [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)**
- wiki text, reviews, comments. Share it, adapt it, credit it, and pass on the
same freedom.

The two live in separate graphs, so the boundary is enforced by the store rather
than by anyone remembering which is which at publication time.

Attribution for the factual data is **requested, not required**. If this saves
you work, a link back is appreciated and never demanded.

Some sources publish under terms that require a notice to travel with their
data. Those are marked and kept out of the plain CC0 dump, so what you take from
the public dataset is genuinely unencumbered.

## How it is built

Metadata is harvested into a triple store, embedded for semantic search,
measured by a sandboxed profiler, and served through a web UI, a JSON API, a
public SPARQL endpoint and an endpoint for agents.

It is open source. The design documents, the source-terms review, and a running
list of the mistakes made along the way are all in the repository.

## Being a good neighbour

The project has an operating principle stricter than the law requires, and it is
worth stating openly because it constrains what gets built:

- Use a sanctioned API where one exists; never scrape HTML where an API is
  offered.
- A 403, a rate limit or a bot check is an answer, not an obstacle.
- Harvest at a rate that costs the source nothing, and identify the crawler
  honestly with a contact address.
- Credit sources whether or not their licence compels it.
- Contribute corrections back upstream rather than keeping a better copy
  privately.
- Personal data is not catalogue data. A maintainer's public name and project
  role, yes; their email address, no.

Some sources are deliberately excluded on these grounds even where a narrow
reading of the law might permit them.

## Contributing

Corrections, additions and wiki edits are welcome. See the
[contributor terms](contributor-terms.md) for what you are agreeing to - the
short version is that facts you contribute go into the public domain and prose
you write stays yours under a share-alike licence.

