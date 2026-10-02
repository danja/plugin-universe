# Glossary

The words this site uses, defined. Most are ordinary English used precisely
rather than unusually, and a few are technical terms a musician or a producer
will not have met. Nothing here is required reading: it is here so that a word
in another page does not stop you.

---

## The catalogue

**Plugin.** An effect, an instrument, a generator or a utility that adds
something to music made with a computer. A plugin here is a *description* of
one, not the software itself.

**Vendor.** Whoever makes a plugin. A vendor is a person or a company, and the
catalogue keeps them separate from their products. See
[the vendor page](/search?q=&vendor=) through any plugin's link.

**Source.** Somewhere plugin descriptions are published in a form a program can
read. The catalogue harvests from sources; it does not invent entries. Every
plugin page names the source it came from.

**Profile.** The document that describes a plugin: what it is, what it does,
what it takes in and gives out. See [plugin profiles](/about/profiles).

**Catalogued, harvested, indexed, measured.** Four different things, and a
plugin page may be some and not others:

- **Catalogued** - the catalogue has a description of it.
- **Indexed** - that description is searchable. Every catalogued plugin is.
- **Measured** - the profiler has run the plugin's own binary. See
  [measurements](/about/measurements).
- **Harvessed** - not a term used on the site. The internal verb for reading a
  source.

## Formats and packaging

**Format.** The way a plugin is packaged and loaded: VST3, LV2, Audio Unit, CLAP,
AAX, or Jig. One plugin usually exists in several. See
[plugin formats](/about/formats).

**Host.** The program that loads plugins: a DAW such as Cubase or Reaper, or
Ardour, or a browser. A plugin is always loaded by something.

**Standalone.** An application that is a plugin run directly, with no host. Not
a plugin format; the thing a plugin becomes when nothing loads it.

**Installation.** Getting a plugin's files onto your machine. Every format
except Jig needs it, which is the whole difference Jig exists to remove.

**Registry.** A list of what is installed. Jig has none, because a Jig is
fetched by address rather than found in a list.

## What a plugin does

**Effect.** A plugin that changes audio: a reverb, a compressor, an equaliser.

**Instrument.** A plugin that makes sound from a note: a synthesiser, a
sampler, a drum machine.

**Utility.** A plugin that does not make sound or change it much: a tuner, a
meter, a MIDI splitter.

**Audio.** Sound. In the signals a plugin accepts or produces, "Audio" is the
sound itself.

**MIDI.** The note messages a keyboard sends: which note, how hard, when. Not
sound, instructions about sound.

**Control MIDI.** MIDI that does not make notes: controller movements, pitch
bends, program changes.

**Sidechain, or a key signal.** One plugin's audio input used to control how
another signal is treated, rather than being processed itself. A compressor
keyed by a drum track ducks the bass when the drum hits.

**Bus.** A signal path several plugins are chained into, treated as one thing.

**Parameter.** A control on a plugin. A compressor's threshold and ratio are
parameters. See [why some plugins here have their parameters listed and others
do not](#parameters).

**Port.** LV2's word for a parameter, and the one the catalogue's data uses
when a source publishes it in LV2's form.

**Latency.** How long a plugin delays audio passing through it, in
milliseconds. A plugin that reports latency has to be compensated for by the
host, or it arrives late.

**Tail.** Sound a plugin keeps producing after its input stops: a reverb after
the last note.

## How the data is stored

**RDF.** A way of writing facts as subject, predicate and object, so a program
can read them and ask questions about them. "This plugin *has format* VST3" is
one triple.

**IRI.** An address for a thing on the web, written like a URL. Every plugin
here has one, and it resolves: fetching it returns the plugin's description
rather than a web page.

**Named graph.** A labelled set of facts. Plugin Universe keeps each source in
its own named graph, so you can tell which source said what, and re-read one
source without touching the others.

**Vocabulary, or ontology.** An agreed set of words and what they mean, so that
two programs describing the same thing use the same words. See
[/ns](/ns).

**SPARQL.** The query language for RDF: you ask a question about the facts and
get an answer. See [the SPARQL endpoint](/about/sparql).

**Turtle.** The plain-text syntax RDF is usually written in. A plugin profile
is a Turtle document.

**Digest.** A short fingerprint computed from a file's bytes. Change one byte
and the fingerprint changes, which is how a host knows the code it is about to
run is the code that was published.

## Finding things

**Search.** Exact matching plus semantic matching, combined. See
[how it works](/about/how-it-works).

**Semantic matching.** Matching on meaning rather than words. Searching for
"warm analogue bus compressor" can find a plugin whose description never
contains the word "warm", because the search compares what the words mean.

**Facet.** A filter: one of format, category, role, vendor, source, pricing,
licence, measured, platform, accepts or produces. Facets remove results. They
never change the order of what is left.

**Category.** A grouping used for browsing: reverb, synth, distortion. A plugin
can be in several.

**Role.** What a plugin is for: an effect, an instrument, a MIDI generator. One
category, unlike a category.

## Jig

**Jig.** A web plugin. Its address is the plugin; you fetch it rather than
installing it, and the code is verified against a digest before it runs. See
[plugin formats](/about/formats#jig-web-plugins).

**WebAssembly.** The compiled form plugins run in, in a browser and in native
hosts alike. The same kind of compiled code VST3 and LV2 plugins use; the
difference with Jig is how it is delivered and verified.

**Capability.** Something a plugin needs from its host: shared memory, MIDI, a
host that supplies the tempo. A Jig declares what it needs before any code is
fetched.

## Licence and price

**Open source.** The source code is published under a licence that lets you read
and change it. Independent of whether the official binaries cost money.

**Free.** A plugin that costs nothing to use. Independent of whether it is open
source: plenty of plugins are closed and free, and plenty are open and sold.

**CC0.** A public-domain dedication. The factual catalogue here is CC0: take it
and use it, no conditions. See [the terms](/terms).

**CC BY-SA.** Share-alike attribution. Contributor-written prose here is under
CC BY-SA; credit it and pass on the same freedom.