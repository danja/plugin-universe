# Plugin profiles

A catalogue can list what plugins are called. This one tries to say what they
*do* — and the part it cannot work out for itself is the part their authors
already know.

That description is a **plugin profile**, and if you make plugins, you can fill
one in.

## Why bother

Because it is what makes a plugin findable by somebody who does not know its
name.

Search here works on meaning as well as words. Somebody typing *"granular
synthesiser"* gets LayerEngine, gRainbow and *Oi, Grandad!* — none of which
contains either word anywhere in its name. That works because there is a
description to match against. A plugin with a name and nothing else is
findable by people who already know it, which is the group that needs the
catalogue least.

The profile is also the only thing that can answer **"what goes with this?"**.
If your plugin accepts MIDI and produces audio, it belongs after something that
produces MIDI — and that is a fact nobody can infer from a download page.

## What it asks for

The [submission form](/submit) opens with the things anyone can see: a name, a
homepage, who makes it, what formats it is built for. Those are required.

The rest is the profile, and all of it is optional. Fill in what is true and
skip what is not — a half-filled profile is better than none and much better
than a guess.

**Roles.** What kind of thing it is. More than one is normal: a synth is
usually both an *Instrument* and an *Audio Instrument*, and a utility that also
shapes MIDI is both.

**Accepts and produces.** What goes in and what comes out — audio, an audio
sidechain, MIDI, or one of the more specific MIDI kinds where that is
meaningful. *Control MIDI* means CCs and scene notes used to reshape another
generator rather than to play notes.

These two are the ones most worth your time, and here is what they buy. They
appear on your plugin's page as links, each pointing at the *other* side of the
join: what your plugin accepts links to everything that produces it, so a
reader lands on "what can I put before this?" already answered. They are also
filters — `/?accepts=Midi` is the list of plugins that can follow a MIDI
generator — and the agent-facing API exposes them for the same purpose, which
is how a tool asked to assemble a chain does it. None of that is possible from
a name and a description.

**Requires.** Anything it needs from the host or from hardware. *Host
Transport* means it needs tempo and beat position; a plugin that free-runs does
not.

**Platforms.** Which operating systems it runs on — Windows, macOS, Linux. Tick
all that apply and leave them all clear if you are not sure: blank means "nobody
has said", which is what this catalogue would rather record than a guess.

This one is worth a moment even though it looks trivial. Where a plugin ships
through a registry that states its platforms, or publishes release assets named
for them, the catalogue works it out. Where it does not, **you are the only
source there is** — and "will this run on my machine" is the question that
disqualifies a plugin before anybody reads what it does. It is a link on your
plugin's page and a filter: `/?platform=Windows`.

A plugin that runs **in a browser** is the one case where leaving them all clear
is the complete answer. Pick *Web Audio* as its format — an AudioWorklet
processor over a WebAssembly module, fetched from the plugin's own IRI — and the
format says what a list of operating systems would have been asked to say.
[JigDAW](https://github.com/danja/jigdaw) plugins are harvested this way, and
their profiles are the same shape as the one below with a little more in it.

**Caution.** Anything that surprises people. Heavy CPU at high settings, output
that can jump in level, a parameter best left alone while the tape is rolling.
This is read by someone deciding whether to put your plugin in a live rig, and
it is taken as helpfulness rather than as a flaw.

The vocabulary behind all of it is `trn:`, shared with several other projects,
and the terms are [published as RDF](/ns).

## Hosting it yourself, which is better

The best place for a profile is **next to your plugin**, not in this catalogue.

A file you host is yours. It is versioned with the plugin, so it changes when
the plugin does; it is editable by you without asking anybody; and it stays
correct because you are the one who knows. A row in somebody else's database is
a copy of the truth, kept somewhere you cannot reach, going stale from the
moment it is saved. This catalogue would rather read your file than be the
place your facts live.

It is also not just for us. A profile is ordinary RDF in a vocabulary several
projects share, so anything that speaks RDF can read it — including tools that
do not exist yet, and including ones that compete with this site. That is the
intended outcome.

### The quickest way to get one

**If your plugin is already here**, open its page and press **Download profile**.
That is the file, built from what the catalogue holds — no form, nothing to fill
in. Check it, correct anything we got wrong, and host it.

**If it is not here yet**, fill in the [submission form](/submit) and press
**Download profile** instead of Submit. You get the same kind of file and
nothing is saved here.

Either way: put it beside your plugin as `profile.ttl`, commit it, and you are
done — you never have to submit anything to this catalogue at all.

### What it looks like

```turtle
@prefix trn:  <http://purl.org/stuff/transmissions/> .
@prefix pu:   <http://purl.org/stuff/plugin-universe/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix foaf: <http://xmlns.com/foaf/0.1/> .

<https://example.org/plugins/ambo/>
    a trn:PluginProfile ;
    rdfs:label "Ambo" ;
    rdfs:comment "Stereo ambient processor." ;
    trn:vendor "danja" ;
    foaf:homepage <https://example.org/plugins/ambo/> ;
    trn:format trn:VST3, trn:LV2 ;
    trn:role trn:AudioEffect ;
    trn:accepts trn:Audio ;
    trn:produces trn:Audio ;
    pu:supportedPlatform pu:Windows, pu:MacOS, pu:Linux .
```

That is the whole thing. Every term in it is [published](/ns), and the fifty
profiles in the [downspout](https://github.com/danja/downspout) repository are
real examples of the same shape.

**The subject is the plugin's homepage**, which is deliberate: it is an IRI you
control, and it is what this catalogue identifies a plugin by, so a profile you
write and a plugin we harvest describe the same thing rather than two copies of
it. If you would rather use your own namespace, do — just keep the
`foaf:homepage` line so the two can be joined up.

**JSON-LD works too** if that is more comfortable. It is the same statements in
a different syntax, and both are read here.

### Where to put it

Anywhere it can be fetched. Beside the plugin's download, in the repository, on
the project page — `profile.ttl` next to `index.html` is the obvious choice. If
your plugin is **LV2**, you have a bundle that already carries most of this, and
that is better still: see below.

Two conventions worth following, neither required. Serve it as `text/turtle` if
you can, and keep it at a stable address, because a profile that moves is a
profile that stops being read.

### Telling us it exists

Two ways, and both end in the same place.

**Paste it** at [Submit a profile](/submit/profile). Turtle or JSON-LD — it is
recognised by looking at the file, not by asking you which it is — and what it
holds is drafted into the submission form for you to check.

**Or send us the URL**, and a moderator reads it once. The *Read a page or
profile* box takes the address of the profile itself as readily as the address
of a plugin's page, and decides which it has by what comes back rather than by
the extension — so a `.ttl` served as `text/plain`, which is what most static
hosts and GitHub's raw view do, still reads as a profile. Send it through
[contact](/about/contact) or the [feedback form](/feedback).

Nothing is written until somebody presses Submit, and a profile goes through
exactly the same validation as a typed submission. There is one way into this
catalogue; these are convenient ways of filling it in rather than second doors.

## What it does not ask for, and why

**Parameters and ports.** A knob has a symbol, a range, a default, a unit and
sometimes a set of named positions — five or six fields each, for a plugin that
might have forty. A form for that would be miserable to fill in and worse to
get right.

If your plugin is **LV2**, you have already written this. It is in your
bundle's own Turtle, in exactly the vocabulary this catalogue uses — `lv2:port`,
`lv2:symbol`, `units:unit` — which is why an LV2 bundle maps in here
untranslated.

So send the URL instead of filling anything in. Point us at the `.ttl` that
describes the plugin — the one your `manifest.ttl` names with `rdfs:seeAlso`,
not the manifest itself — and it is read from there: the ports with their
ranges, defaults, units and scale points, what the plugin accepts and produces,
and whether it needs the host's transport. [Send it](/about/contact), or through
the [feedback form](/feedback) if you are signed in.

Two things worth saying plainly. It is **read once, by a person** — nothing here
crawls, and the fetch happens because a moderator asked for it. And it is
**added, never substituted**: anything the catalogue already holds about your
plugin stays as it is, and you are told what was left alone.

This is the one part a profile does not cover, however it reaches us. A profile
carries what the plugin *is*; ports and parameters are read from the bundle
itself, because that is where they already are and nobody should be retyping
them. Send the profile for the description, and the bundle's `.ttl` for the
knobs — they are different files and they are read by different means.

**What goes before and after.** `trn:recommendedBefore` and its companions
point at *other plugins*, so they need a way to pick one rather than a box to
type in. Worth having and not built yet.

## What happens to it

It goes into the catalogue attributed to you, and into the public domain under
[CC0](/terms) — the same terms as every other fact here. That is deliberate and
it is the point of the project: the facts stay free and reusable by anyone,
including by tooling that competes with this site.

Prose you write — a wiki page about your plugin, for instance — is different.
You keep the copyright and license it under CC BY-SA, so you are credited. The
[contributor terms](/terms) set out which is which, and the boundary is
structural rather than a judgement someone makes later: the two kinds of
contribution are written to different graphs.

A first submission waits for review. After a few accepted contributions your
submissions go live as you make them.

## If something here about your plugin is wrong

Say so and it is fixed — [contact](/about/contact), or the *Suggest a
correction* form on the plugin's own page. Corrections do not overwrite what was
harvested: both statements are kept, in separate graphs, and which one a reader
sees is decided by where it came from. An author's own statement outranks a
scrape.

If a plugin of yours is here and you would rather it were not, that is also
fine, and it gets dealt with rather than argued about.
