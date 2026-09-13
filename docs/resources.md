# Resources

## For producers

**Forums and communities**

- [KVR Audio](https://www.kvraudio.com/) - the longest-running plugin database
  and the busiest forum, including its developer sections. Worth knowing that
  this catalogue links to KVR and deliberately does not harvest it; the
  reasoning is in the [source terms review](sources.md).
- [Gearspace](https://gearspace.com/) - pro audio and studio practice, with a
  long archive.
- [VI-Control](https://vi-control.net/) - orchestral and sample-library focused,
  and the place those questions get answered properly.
- [LinuxMusicians](https://linuxmusicians.com/) - the community for audio work
  on Linux, where a good deal of the open-source plugin world lives.
- [r/audioengineering](https://www.reddit.com/r/audioengineering/) and
  [r/WeAreTheMusicMakers](https://www.reddit.com/r/WeAreTheMusicMakers/) -
  broad, busy, and good for "has anyone actually used this".
- [The REAPER forum](https://forum.cockos.com/) and
  [Ardour's discourse](https://discourse.ardour.org/) - two DAW communities that
  are unusually helpful about plugin behaviour rather than only about the host.

**News and reviews**

- [Sound on Sound](https://www.soundonsound.com/) - reviews and technique, with
  a deep archive and [a forum](https://www.soundonsound.com/forum).
- [Bedroom Producers Blog](https://bedroomproducersblog.com/) - free and
  discounted plugins, updated constantly.
- [Rekkerd](https://rekkerd.org/) - release announcements, going back years.
- [MusicRadar](https://www.musicradar.com/) - mainstream gear and software news.
- [Tape Op](https://tapeop.com/) - recording practice rather than plugins
  specifically, and better than most things that are.

**Getting plugins installed**

- [OwlPlug](https://owlplug.com/) - an open-source plugin manager. This
  catalogue publishes a registry view it can read, because a catalogue and an
  installer are different jobs.

## For developers

**Frameworks**

- [JUCE](https://juce.com/) - the C++ framework most commercial plugins are
  built with, and [its forum](https://forum.juce.com/), which is where its
  real documentation ends up.
- [DPF](https://github.com/DISTRHO/DPF) - the DISTRHO Plugin Framework. Lighter
  than JUCE, permissively licensed, and the route to LV2 and CLAP with little
  ceremony.
- [iPlug2](https://github.com/iPlug2/iPlug2) - small, C++, and quick to get a
  prototype making noise.
- [Faust](https://faust.grame.fr/) - a functional language for signal
  processing that compiles to every plugin format going. A different way in:
  you write the DSP and the plugin is generated.
- [Cmajor](https://cmajor.dev/) - a language aimed squarely at audio, from
  people who had already built JUCE.

**The formats themselves**

- [LV2](https://lv2plug.in/) - the specification, in RDF. This catalogue's
  parameter model is `lv2:port` because of it, which is why an LV2 bundle's own
  metadata maps in here untranslated.
- [CLAP](https://cleveraudio.org/) and [the SDK](https://github.com/free-audio/clap)
  - the newest format, permissively licensed, and designed in the open.
- [VST 3](https://steinbergmedia.github.io/vst3_dev_portal/) - the developer
  portal, and [the SDK](https://github.com/steinbergmedia/vst3sdk).

**Testing and measurement**

- [pluginval](https://github.com/Tracktion/pluginval) - the validator that
  hosts a plugin and tries to break it. This catalogue's own
  [measurements](/about/measurements) come from it.
- [clap-validator](https://github.com/free-audio/clap-validator) - the same
  idea for CLAP.

**DSP**

- [musicdsp.org](https://www.musicdsp.org/) - the archive of algorithms and
  code snippets that predates most of the rest of this list.
- [DSPRelated](https://www.dsprelated.com/) - articles, forums and free books.
- [Julius O. Smith's online books](https://ccrma.stanford.edu/~jos/) - filters,
  physical modelling and spectral audio, free and complete. The reference.
- [The Audio Programmer](https://www.theaudioprogrammer.com/) - tutorials and a
  large community aimed at people starting out.

**Open source worth reading**

- [Ardour](https://ardour.org/) - a full DAW, and one of the few large audio
  codebases you can simply go and read.
- [Surge Synth Team](https://github.com/surge-synthesizer) - a synth and an
  effects suite maintained in the open, and a good model of how to run an audio
  project.
- [linuxaudio.org](https://linuxaudio.org/) - the hub for the Linux audio
  ecosystem, its mailing lists and its specifications.
- [Open Audio Stack](https://github.com/open-audio-stack) - an open registry
  format for plugins. This catalogue
  [publishes a view in it](/services), so the tooling that reads it can read
  this too.

---

## Why this page exists at all

A catalogue that tried to be the only place you go would be worse than one that
tells you where else to look. The things listed here do jobs this site does not:
they have people in them, they argue about what sounds good, and they answer
questions that no amount of structured metadata will.

What this site adds is the part they cannot: the same facts about every plugin,
in a form a program can read, that anyone may take and use. See
[Services](/services) for every way to get at it.
