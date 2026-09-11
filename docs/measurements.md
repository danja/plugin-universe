# Measurements

Most of this catalogue is **harvested** — read from a project's own metadata, a
registry entry, a repository. All of that is what somebody *said* about a
plugin.

A measurement is different. It is what happened when we loaded the plugin and
ran it.

## What a reading is, and is not

A measurement here is a reading from **one binary, on one machine, on one day**.
The tool, its version, the platform and the timestamp come back with every
number, because without them a number is not a fact.

So this catalogue can support "a run on Linux x64 in September 2026, under
pluginval 1.0.4 at strictness 5, reported 0 samples of latency". It cannot
support "this plugin has no latency". The first is an observation; the second is
a claim about the plugin everywhere, forever, and nothing here establishes that.

Two runs of the same tool over the same plugin are two measurements, not one
replacing the other. Nothing is overwritten, and a run whose machine turns out to
have been misconfigured can be discarded whole without disturbing anything else.

## What the verdicts mean

The badge on a plugin page is the `Validation result`. There are five values and
they are deliberately not collapsed into "pass" and "fail", because they are
answers to different questions.

| Verdict | What happened | Whose problem it is |
|---|---|---|
| `passed` | The plugin loaded and got through every test the validator ran. | — |
| `ok` | A scan of the plugin's own metadata completed cleanly. Not the same as being run. | — |
| `failed` | The validator ran the plugin and reported a problem with it. | The plugin's |
| `crashed` | The plugin took the validator down with it, or was killed for exceeding a limit. | The plugin's |
| `unloadable` | Our container could not load the binary at all — usually a system library newer than the one we have. | **Ours** |

That last row is why the list is five rows long. A plugin we cannot load looks,
from the outside, exactly like a plugin that is broken: the validator reports
that it found nothing to test, in the same words it uses for a damaged binary.
Recording those as failures would publish a defect in our container as a defect
in somebody's plugin. So the dynamic loader is asked first, separately, and when
it refuses, that is what gets written down.

### "Passed" is incomplete without a strictness level

pluginval runs at a strictness of 1 to 10. Level 5 is its own recommended
minimum for host compatibility — the plugin loads, behaves, saves and restores
its state. Level 10 adds parameter fuzzing and much longer tests.

They are not the same tests, so a plugin that passes at 5 and fails at 8 has not
contradicted itself. Every reading here carries the level it was taken at, and a
run at a different level sits alongside rather than replacing.

### A crash is a result, not an error

Nothing in this system treats a badly-behaved plugin as a failure of the system.
A plugin that segfaults has told us something true about itself, and writing it
down is the job — along with the name of the test it was in the middle of, which
is usually the most useful sentence in the whole run.

This matters if you are the author of something marked `crashed`. It is a
reproducible finding on a named platform with a named tool at a named strictness,
not a verdict on your work, and we would much rather you could reproduce it than
that we hid it. Everything needed to do so is on the page.

## What gets measured

| Reading | What it is |
|---|---|
| Validation result | The verdict above. |
| Failed tests | How many of the validator's own tests reported a problem, out of those it ran. |
| Open time (cold) | Milliseconds to instantiate the plugin the first time. What you wait for when a session loads. |
| Open time (warm) | Milliseconds to instantiate it again straight after. Far below the cold figure means the cost was loading the binary; close to it means the plugin does that work every time. |
| Latency | Samples of latency the plugin reports while running. |
| Discovered ports | Ports the built binary reports, of every kind. |
| Discovered control ports | Just the control ports — the like-for-like counterpart of the parameter count in a plugin's published metadata. |
| Scan time | How long the measurement took. A scan time, not a benchmark. |

**Not CPU load.** It is defined in the vocabulary and nothing produces it yet.
That needs a host which runs audio through the plugin and measures what it cost,
which is a different tool from the ones here. Until it exists, this catalogue
says nothing about how expensive a plugin is, rather than guessing.

## Why the binary can disagree with its own metadata

It often does, and surfacing that is a large part of the point.

A published profile records what the author wrote down; a scan records what the
binary actually exposes. When they disagree the scan wins — it is closer to what
a host will see. Usually the cause is version skew: a release build from a tag
while the source has moved on. Sometimes it is a real defect. Either way it is a
question nobody could ask before the two were held side by side.

## How it is run

In a disposable container with no network, a read-only filesystem, one core, a
gigabyte of memory, no capabilities, and the plugin mounted read-only. It is the
only part of this system permitted to execute code we did not write, and it is
built to be a poor place to run anything else.

We do not weaken that to make a measurement possible. A tool that needs the
network is the wrong tool.

## Using them

Every reading is in the catalogue as data, under CC0 — they are our own
observations, made with our own equipment, so nobody else's terms attach.

- Filter a search by verdict: `?measured=passed`, or `failed`, `crashed`, `ok`.
- Query them over [SPARQL](/about/sparql), where the tool, platform and
  timestamp are properties you can select and compare.
- Read the [full description of every service](/services).

If you maintain a plugin listed here and think a reading is wrong, please say
so — a measurement that cannot be reproduced is one we want to know about.
