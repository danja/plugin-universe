# Plugin formats

Every audio plugin is not interchangeable. The formats below are the different
ways plugin code is packaged and loaded. A plugin usually exists in more than
one, because the same source is built for more than one host.

This page says what each format is, which hosts load it, and what the numbers
in this catalogue are. It is worth reading the [Jig](#jig-web-plugins) section
even if you have no interest in it: it is the newest of the eight, and the only
one that does not require a plugin to be installed before it can run.

---

## The formats in this catalogue

Counts are for **2 October 2026** and were read from the catalogue's own
[facet data](/facets), not written by hand. A plugin is counted once per format
it states, so the column adds up to more than the 791 plugins in the catalogue.

| Format | Plugins | Host | Runs on | Installed? |
|---|---:|---|---|---|
| VST3 | 509 | Cubase, Reaper, Ableton Live, Logic, Studio One, Bitwig | Windows, macOS, Linux | Yes |
| LV2 | 310 | Ardour, Carla, jalv, REAPER, many others | Windows, macOS, Linux | Yes |
| Audio Unit | 269 | Logic, GarageBand, and anything else that loads Audio Units | macOS only | Yes |
| CLAP | 151 | Bitwig, Cobalt, Reaper, and hosts still arriving | Windows, macOS, Linux | Yes |
| Standalone | 116 | Nothing. It is its own program. | Windows, macOS, Linux | Yes, as a program |
| VST2 | 76 | The older Steinberg plugin standard, still widely supported | Windows, macOS | Yes |
| AAX | 37 | Pro Tools | Windows, macOS | Yes |
| [Jig](#jig-web-plugins) | 27 | Any web browser. No host required. | Anywhere a browser runs | **No** |

Parameter lists are in the catalogue for LV2 and Jig plugins and for almost
nothing else, and [the next section](#the-one-line-each) says why. A format that
does not record a plugin's parameters is not a worse format; it is one whose
description a program cannot read.

Three of these are still being built. CLAP is the one to watch: it is a modern
replacement for VST2, it is open, it is not yet supported by the two biggest
hosts, and 151 plugins already ship it. A plugin author targeting new hosts
today usually ships CLAP and VST3.

## What a format actually is

A format is three decisions, not one:

1. **How the code is packaged.** A folder, a bundle, an archive.
2. **How the host finds it.** A file path the host scans, or a registry, or a
   URL the host fetches.
3. **How the plugin is described.** A text file beside the binary, or a document
   fetched from a server.

Everything else about a plugin, its parameters and what it does, is common to
all of them, which is why this catalogue can describe a plugin once and list
every format it comes in.

---

## Jig: web plugins

**A Jig is a plugin you do not install. You fetch it.**

The idea is that a plugin is a URL, the way a web page is a URL. Dereference
the address and you get a description of the plugin, and from there the code,
which the browser verifies before it runs. There is no installer, no package
manager, no copy of the files on your machine to keep in step with the
version you are running.

The format is specified by [JigDAW](https://strandz.it/jigdaw/), which has 27
plugins in this catalogue, and whose browser host, Jiggy, is where you can try
one.

### What makes it different

**The plugin is its address.** Every Jig has an `https:` address that returns
its description. Installation is having fetched it. Nothing else is installed:
not a library, not a registration, not a bundle to copy into a folder.

**The code is verified before it runs.** The description carries a cryptographic
digest for each piece of code, and a host refuses the plugin if the bytes do
not match. This is the part that matters most: running plugin code means running
somebody else's code, and a digest is what makes the thing that runs the thing
that was published.

**Capabilities are agreed before anything is fetched.** A plugin declares what
it needs, such as shared memory or MIDI, and a host that cannot provide it says
so without downloading the code first.

**A failed plugin does not stop the music.** If a plugin fails to load it is
reported and muted, and the rest of the session keeps playing. A bad plugin is
a small event rather than a lost afternoon.

**Parameters are declared once.** A control's name, range, default and unit are
written in the description, and the host draws the control from that. The
plugin and its panel cannot disagree, because there is nothing for them to
disagree about.

**A plugin with no interface still has one.** A host draws the control panel
from the description when the author ships no editor of their own, and that
panel is accessible: every control has a name, a role and a value. A plugin
author gets an interface without designing one.

### Where it runs

Anywhere a browser runs. No plugin binary per operating system, no separate
build per host, and no reason a plugin cannot work on a machine that has never
seen a DAW.

Audio processing is WebAssembly, which is the same compiled code the native
formats use. The difference is not the quality of the processing; it is that
the delivery is a URL and the verification is built in.

### Two hosts, independently implemented

JigDAW ships two, and they were written separately:

- **Jiggy**, a browser host, which runs Jigs inside a sandboxed frame. It is
  the one you can try at [strandz.it/jigdaw](https://strandz.it/jigdaw/).
- **A native adapter**, a VST3, CLAP and LV2 plugin, which loads the same Jigs
  by address and runs their WebAssembly directly, with no browser. This is the
  interesting part: it means a Jig can appear in a conventional DAW as an
  ordinary plugin.

A format with two independent implementations is a specification rather than a
product.

### Why it is worth publishing here

A Jig is a **valid catalogue entry, without translation**. It writes its
musical description in the same vocabulary every other plugin here uses, so
this catalogue reads a Jig's role, its signals and its parameters exactly as it
reads a VST3's. That is a deliberate design decision on the JigDAW side, and it
is why a Jig appears in this catalogue beside everything else rather than in a
separate list.

### If you are writing one

- **[The specification](https://strandz.it/jigdaw/)** is the normative document:
  what a profile must contain, what a host guarantees, what a plugin must do.
- **[Building and publishing a plugin](https://danja.github.io/jigdaw/for-plugin-authors.html)**
  is the practical guide, from an empty directory to a published plugin.
- **A profile is the whole installation.** Write one in Turtle, point it at your
  code, and you are done. There is no packaging step.
- **Publishing needs hosting that sends CORS headers.** That is the one
  requirement a plugin cannot avoid, and it is explained in the specification.

The 27 Jigs in this catalogue are listed under the
[Jig format filter](/plugins?format=Jig).

---

## Other formats, one line each

**VST3.** The current Steinberg standard, and the one most plugins ship. Loads
in the major commercial hosts on all three desktop platforms.

**VST2.** Its predecessor, from 2006. Still very widely loaded, so a plugin
aiming at the largest audience ships it too. Being phased out by its own maker.

**LV2.** An open standard, and the only format whose plugins carry their
parameters in a form a program can read. In a sample of 40 LV2 plugins from
this catalogue, 30 have their parameter list; in samples of the same size from
the other formats, none do. That is a property of how each format describes a
plugin, not a gap in the harvesting: a VST3 binary does not carry its parameter
list anywhere a reader can get at it, so there is nothing here to read.

**Audio Unit.** Apple's plugin format, built into macOS. Mac only.

**CLAP.** A 2022 open standard, designed as a VST2 replacement and gaining
hosts steadily. Worth watching.

**AAX.** Avid's format, and Pro Tools' own. Loads nowhere else.

**Standalone.** Not a plugin format at all: an application you run directly.
Counted here because it is what a plugin becomes when nobody loads it as a
plugin.

## Choosing one

For a plugin author today:

- **Reach**: VST3, plus CLAP for the hosts that have it.
- **Open standards, and full parameter metadata**: LV2.
- **Mac only, Apple ecosystem**: Audio Unit.
- **Pro Tools**: AAX.
- **The browser, with no install for the person you ship to**: Jig.

## How a plugin author gets listed here

Read [plugin profiles](/about/profiles): what a profile is, why it is worth
filling one in, and how to submit it. A profile is a single document. There is
no registry to apply to and nothing to install on this side.