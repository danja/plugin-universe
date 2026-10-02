# How it works

How a fact about a plugin gets from whoever knows it into this catalogue, and
what happens to it afterwards. It is written for somebody deciding whether they
can trust a page here, or build on the data.

The short version: nothing here is typed in by hand. Facts are read from
sources that publish them, each fact is kept with a note of which source said
it, and everything is checked against the same set of rules before it is
published.

---

## Where the data comes from

A **source** is somewhere plugin descriptions are published in a form a program
can read. That means a machine-readable description, not a web page.

Each source was reviewed before any code was written to read it, and the review
is published. A source is harvested only if its terms allow it, and sources that
require a notice to travel with their data are marked and kept apart, so what
you take from the public download is genuinely unencumbered.

Every plugin is attributed. A plugin page says which source it came from, which
is not decoration: it is how you go and check, and how you report a mistake.

## What a plugin ends up with

A plugin in this catalogue is an identifier and a pile of facts about it:

- **Name and vendor.** Who made it, and what it is called.
- **Description.** What its author says it does.
- **Format.** Which plugin formats it exists as. One plugin is often three or
  four, because the same code is built for several hosts. See
  [plugin formats](/about/formats).
- **Role.** What it is for: an effect, an instrument, a MIDI generator, and so
  on.
- **Signals.** What it takes in and what it gives out: audio, MIDI, and what
  kind of each. This is what makes it possible to ask "which of my effects can
  take a sidechain key" and get an answer.
- **Parameters.** The controls it has, with their ranges and defaults, where the
  source publishes them.
- **Platforms.** Which operating systems it runs on.
- **Licence and price.** Open source or not, and whether it costs money. These
  are separate facts because they are separate: a plugin can be open source and
  sell official binaries.
- **Measurements.** Where a profiler has run the plugin's own binary.

## The pipeline

### 1. Harvest

A **harvester** reads one source and writes what it finds into a **named
graph**. RDF, and a named graph is a labelled set of triples: the label says
which source these facts came from.

Nothing is merged into one pile. That is deliberate. Re-reading a source is a
DROP of that graph alone followed by writing it again, so a source that
publishes something wrong and then fixes it is corrected by being read twice,
and no other source is touched by either run.

### 2. Check

Every fact is checked against a set of rules before it is written, and again
after. A rule says what a well-formed profile has to contain and what a fact is
allowed to say. A profile that breaks a rule is refused with a message naming
the rule and the plugin, rather than published and discovered later.

The same rules are applied to every source. A profile written for one catalogue
is a valid entry in this one.

### 3. Search

Two searches run at once and their scores are combined.

- **Exact matching** over names, vendors, formats and categories. A search for
  `Valhalla` finds Valhalla.
- **Semantic matching** over a text description of each plugin built from its
  name, vendor, description, categories and signals, using a sentence embedding
  model. This is what lets a query phrased in your words find a plugin described
  in someone else's, and it is why the catalogue can be searched without every
  plugin author using the same words.

Semantic search embeds your query text with a local model. The query never
leaves the server, and no third-party search service sees it.

Filters do not re-rank. They remove. Applying `format=VST3` gives you VST3
plugins in the order search would have given them, not a different order.

### 4. Measure, for some plugins

Most of any plugin catalogue is what somebody said. The **profiler** finds out
what is true: it runs a plugin's own binary inside a sandbox and records what it
reports, such as its parameters, its latency, whether it loads at all, and
whether it crashes.

Where a measurement contradicts a description, the measurement wins. See
[measurements](/about/measurements) for what each verdict means.

Profiling covers a minority of the catalogue. A plugin with no measurement has
not been found to be broken; it has not been run.

## How facts stay honest

**Every fact says where it came from.** Not most of them: all of them. A plugin
page shows the source, and following it takes you to the place the fact was
read from.

**Corrections are written down.** A correction is a proposal against one named
fact, reviewed and then applied, so a change is visible as a change rather than
being a silent overwrite.

**Prose is separate from facts.** Anything a person writes lives in its own
graph under its own licence, and is never mixed into the factual data. See the
[contributor terms](/terms).

## Reading it yourself

Everything here can be read by a program, with no key and no account:

- **[Services](/services)** lists every way in: the web pages, a JSON API, RDF,
  the public SPARQL endpoint, the dataset downloads and an endpoint for
  agents.
- **[The SPARQL endpoint](/about/sparql)** is the one to reach for when you have
  a question the pages do not answer.
- **[The MCP endpoint](/about/mcp)** is the same catalogue as tools an AI agent
  can call.

## What this will not do

Stated plainly, because a catalogue that overstates itself is worse than none.

- **It cannot install anything.** These are descriptions. Downloading and
  running a plugin is your decision and your machine's business.
- **A measurement is about one binary on one machine.** It is evidence, not a
  verdict on the author's work. See
  [measurements](/about/measurements).
- **Absence of a fact is not absence of a feature.** A plugin whose source did
  not publish its parameter list has no parameter list here.
- **It is not a download index.** Where a source publishes a download address
  it is carried through; where it does not, none is invented.