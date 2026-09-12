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

**Accepts and produces.** What goes in and what comes out — audio, MIDI, or one
of the more specific MIDI kinds where that is meaningful. *Control MIDI* means
CCs and scene notes used to reshape another generator rather than to play
notes. These two fields are what make a chain suggestable, and they are the
ones most worth your time.

**Requires.** Anything it needs from the host or from hardware. *Host
Transport* means it needs tempo and beat position; a plugin that free-runs does
not.

**Caution.** Anything that surprises people. Heavy CPU at high settings, output
that can jump in level, a parameter best left alone while the tape is rolling.
This is read by someone deciding whether to put your plugin in a live rig, and
it is taken as helpfulness rather than as a flaw.

The vocabulary behind all of it is `trn:`, shared with several other projects,
and the terms are [published as RDF](/ns).

## What it does not ask for, and why

**Parameters and ports.** A knob has a symbol, a range, a default, a unit and
sometimes a set of named positions — five or six fields each, for a plugin that
might have forty. A form for that would be miserable to fill in and worse to
get right.

If your plugin is **LV2**, you have already written this. It is in your
bundle's own Turtle, in exactly the vocabulary this catalogue uses — `lv2:port`,
`lv2:symbol`, `units:unit` — which is why an LV2 bundle maps in here
untranslated. Send us the URL of your bundle or your repository instead and it
is read from there.

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
