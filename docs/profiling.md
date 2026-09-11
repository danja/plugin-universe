# Profiling

Measuring plugins rather than believing them, and doing it without letting them
out.

The design is in [architecture.md §6](architecture.md); the phase plan is in
[plan.md](plan.md). This is how to run it and what it does.

---

## Why there is a profiler at all

Everything else in this catalogue is **harvested** — read from a `profile.ttl`,
a registry entry, a repository. All of that is what someone *said* about a
plugin. The profiler is the only part that finds out.

That distinction is why source precedence puts profiler measurement above
discovery, above vendor submission, above curated editorial
([architecture.md §8](architecture.md)). A scan can contradict a hand-written
profile, and when it does, the scan wins.

It is also the thing no aggregating catalogue has. Anyone can copy a plugin
list; measurements have to be made.

The reader-facing version of this is [measurements.md](measurements.md), served
at `/about/measurements`. Keep the two in step: that one explains what a verdict
means to somebody whose plugin has just been marked `crashed`.

## What it does today

Two tools, answering two different questions. `bin/profile.js --tool <name>`
picks one; both run in the same sandbox and write to their own per-run graph.

**`--tool lilv`** (the default) reads what an LV2 bundle *declares*, through the
library a host uses. Fast, LV2 only, and it does not instantiate anything.

| Metric | What it records |
|---|---|
| `pu:ValidationResult` | `ok`, `failed`, `crashed` or `timed-out`, with the signal where there was one |
| `pu:ScanTime` | milliseconds the scan took. A scan time, not a benchmark |
| `pu:Latency` | whether the plugin reports latency to the host |
| `pu:DiscoveredPorts` | ports of every kind on the built binary |
| `pu:DiscoveredControlPorts` | just the control ports — the like-for-like counterpart of a profile's parameter count |

**`--tool pluginval`** loads the plugin and drives audio through it. This is the
one that reaches VST3, and the one plugins crash under.

| Metric | What it records |
|---|---|
| `pu:ValidationResult` | `passed` or `failed` — pluginval's own word — or `crashed`, `timed-out`, `unloadable` |
| `pu:FailedTests` | how many of its tests reported a problem, out of those it ran |
| `pu:OpenTimeCold` / `pu:OpenTimeWarm` | milliseconds to instantiate, first time and immediately after |
| `pu:LatencySamples` | latency in samples, from a plugin that has actually been asked |
| `pu:ScanTime` | wall clock for the whole validation |

Every pluginval reading also carries `pu:strictness`, `pu:sampleRate` and
`pu:blockSize`. The level is not a detail: "passed pluginval" means nothing
without it, and a run at another level sits alongside rather than replacing.

**Not yet:** CPU load, denormal behaviour, state save/restore integrity.
pluginval exercises a plugin thoroughly but does not report what it cost.
`pu:CpuLoad` is defined in the vocabulary and nothing produces it. That is the
largest remaining gap in Phase 2.

**Not built for:** AU (macOS only), VST2 (Steinberg's SDK is not
redistributable), CLAP (no validator in the image, and nothing in the catalogue
to point it at). LADSPA and VST2 both ship as a bare `.so`, so the scanner
declines to guess which a file is rather than filing a reading under the wrong
format.

## Running it

Build the sandbox image once:

```sh
docker build -f docker/profiler.Dockerfile -t plugin-universe-profiler .
```

The build takes about ten minutes cold: it compiles pluginval from a pinned
commit, with JUCE fetched shallow into a layer of its own. Tracktion publish
binaries, but only for tagged releases, and the tags predate the CMake build
this checkout uses — and a tool whose version drifted between two runs would
make those runs incomparable, which is the thing `pu:tool` exists to prevent.

Then point it at a directory of **built** plugins:

```sh
node bin/profile.js --path ~/github/flues/build-output/plugins-v0.1.0 --dry-run
node bin/profile.js --path ~/github/downspout/build/bin --tool pluginval --dry-run
node bin/profile.js --path ~/github/downspout/build/bin --tool pluginval
```

`--dry-run` scans and prints without writing anything, which is the right way to
try an unfamiliar directory.

Two things about the path catch people out, including me:

- **It must contain the `.lv2` directories directly.** `LV2_PATH` does not
  recurse. `flues/lv2/` holds `chatterbox/chatterbox.lv2/`, one level too deep,
  and scans as nothing.
- **It must be the build output, not the source tree.** A bundle is scannable
  only when `manifest.ttl` sits beside the `.so`. For flues that is
  `build-output/` — which the *harvester* deliberately skips. The harvester
  wants the source of truth; the profiler wants what actually runs. They are
  different questions and they have different right answers.

## The sandbox

This is the only component permitted to execute code the project did not write,
and it is the highest-risk thing here by a distance. lilv `dlopen`s the plugin
binary to read some properties, so **every scan runs third-party native code**.

`src/profiler/Sandbox.js` runs each scan in a disposable container. Every flag
is load-bearing:

| Flag | Why |
|---|---|
| `--network none` | the difference between running untrusted code and running untrusted code on the internet |
| `--read-only` + `--tmpfs /tmp:noexec` | a plugin writing to disk changes nothing that survives |
| `--cap-drop ALL` | nothing here needs a capability |
| `--security-opt no-new-privileges` | a setuid binary in the image cannot escalate |
| `--pids-limit 256` | a fork bomb hits a wall rather than the host |
| `--memory 1024m` (swap equal) | bounded, and no swap to thrash |
| `--cpus 1` | one core |
| `--user 1001` | never root, even inside the container |
| `--volume …:/plugin:ro` | the plugin cannot modify itself |

A wall-clock timeout is enforced inside *and* outside: a container that ignores
the deadline is killed by the parent process. All of these live in
`PROFILER_CONFIG` in `config/preferences.js`.

The confinement is checked rather than assumed. `tests/profiler/` probes the
network, the root filesystem and the plugin mount from inside the container.

### A crash is a result, not an error

Nothing throws because a plugin behaved badly. A plugin that segfaults, hangs or
fills memory has told us something true about itself, and writing that down is
the job. The sandbox throws only when the *sandbox itself* could not be
established — because then the measurement would be a lie.

| Outcome | Means | Whose problem |
|---|---|---|
| `ok` | the tool exited cleanly | — |
| `passed` | pluginval's own verdict: the plugin got through every test it ran | — |
| `failed` | the tool ran and reported a problem with the plugin | the plugin's |
| `crashed` | the plugin took the tool down, or was killed for exceeding a limit | the plugin's |
| `timed-out` | it never finished | the plugin's |
| `unloadable` | the image's dynamic loader could not satisfy the binary | **ours** |

That last row is the expensive one, and it was learned the hard way. On a
bookworm base not one of the downspout VST3s loaded — glibc 2.36 against the
2.38 they were built for — and pluginval reported `Num plugins found: 0`, which
is *also* what it reports about a genuinely damaged binary. Published as-is that
would have been 46 working plugins recorded as failures, with the container the
only thing at fault.

So `PluginvalScanner` runs `ldd` before it runs pluginval, and a plugin the
image cannot load is recorded as `unloadable` with the missing libraries named.
**The base image is a measurement instrument**: its glibc is the floor under
everything the profiler can reach, and trixie will be too old for something
eventually.

One subtlety worth knowing, because getting it wrong is easy and quiet: a
container's exit code is its PID 1's. When a plugin brings down the tool
scanning it, that arrives as **exit 139 with no signal field set at all** —
`128 + SIGSEGV`, reported by the shell. Read as an ordinary non-zero exit, it
looks identical to "this plugin is malformed", and the most interesting result
the profiler can produce is lost. `Sandbox.classify` maps the whole `128 + n`
range.

Relatedly, a process that *is* PID 1 does not receive unhandled signals, so
`kill -SEGV $$` at the top level of a container appears to succeed. That makes
naive crash tests misleading.

## What gets written

One graph per run:

```
graph:profiler/lv2-scan-1788781221771   CC0-1.0
```

A run's graph is droppable on its own. If a host turns out to have been
misconfigured — thermal throttling, a debug build of a library, the wrong
sample rate — its readings go with it and nothing else is touched. That is the
whole reason for the granularity.

Every measurement carries its **platform** and its **timestamp**, and the SHACL
shapes require both:

> A CPU figure without the machine it was taken on is not a fact, it is a
> number.

Two runs of the same tool on the same plugin are two measurements, not one
overwriting the other. Measurements are this project's own observations made
with its own equipment, so they are CC0 and no one else's terms attach.

### Matching a scan to a plugin

Two keys, because the tools identify a plugin differently. lilv reports the
plugin's own IRI, so the link is `owl:sameAs`, which the LV2 harvester preserves
from the bundle. pluginval is pointed at a file and can only report the file, so
the link is `trn:bundleName` — which is the same fact the plugin's IRI was
minted from, not a separate guess about which plugin a file is. A bundle name
claimed by two plugins is dropped rather than resolved arbitrarily: the
ambiguity is the finding.

Either way, a measured plugin the catalogue does not hold is **reported and not
recorded**. A measurement attached to the wrong plugin is worse than no
measurement.

## Reading the results

Latest verdicts:

```sparql
PREFIX pu: <http://purl.org/stuff/plugin-universe/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?name ?outcome ?platform ?when WHERE {
  GRAPH ?run {
    ?m pu:subject ?p ; pu:metric pu:ValidationResult ;
       pu:value ?outcome ; pu:platform ?platform .
    ?m <http://www.w3.org/ns/prov#generatedAtTime> ?when .
  }
  GRAPH ?g { ?p rdfs:label ?name }
}
ORDER BY DESC(?when)
```

**Where the binary disagrees with its profile** — the query the profiler exists
for. Note that it compares control ports against parameters; comparing the
*total* port count instead makes every plugin look wrong, because a binary also
has audio and atom ports:

```sparql
PREFIX pu: <http://purl.org/stuff/plugin-universe/>
PREFIX lv2: <http://lv2plug.in/ns/lv2core#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?name ?binary (COUNT(DISTINCT ?port) AS ?profile) WHERE {
  GRAPH ?run { ?m pu:subject ?p ; pu:metric pu:DiscoveredControlPorts ; pu:value ?binary }
  GRAPH ?g   { ?p rdfs:label ?name . OPTIONAL { ?p lv2:port ?port } }
}
GROUP BY ?name ?binary
HAVING (?binary != COUNT(DISTINCT ?port))
```

On the first real run, over seven built flues bundles, five agreed and two did
not — Flues Disyn at 8 control ports against a profile recording 9, and Flues
Drumkit at 18 against 43. Those bundles are a tagged v0.1.0 build while the
source tree has moved on, so that is most likely version skew rather than a
defect. Which is the point: it is a question that could not be asked before.

## Where to run it

On a machine with room. The sandbox caps one scan at 1 GB and one core, but a
4 GB server already running Fuseki, Ollama and the app has little to spare, and
profiling competes with serving. The measurements are portable — they carry
their platform — so profiling on a workstation and publishing to the server is
the intended shape.

That was the intent for a while before anything implemented it, and the cost
was quiet: the live catalogue held **zero** measurements while `/about/measurements`
explained to readers what the verdicts meant. The delivery path is a backup
scope:

```sh
node bin/backup.js --scope measurements          # here
ssh danny@hyperdata mkdir -p /tmp/pu-measurements   # as you, not as docker's root
rsync -rtv <dir>/ danny@hyperdata:/tmp/pu-measurements/   # -rtv: -a implies -o -g
# there:
docker compose run --rm -v /tmp/pu-measurements:/measurements app \
  node bin/restore.js /measurements --into plugin-universe
docker compose run --rm app node bin/ingest.js --vocabs-only
docker compose restart app
```

`bin/backup.js` prints those steps for you. Three things about it are
load-bearing:

- **It selects `graph:profiler/*` and nothing else.** A run graph is droppable
  on its own by design, so restoring one on the server adds readings and does
  not touch a single harvested, account or contribution graph.
- **Each graph carries its own registration**, replayed there through
  `GraphRegistry.register()`, which replaces one row and leaves the rest alone.
  Bare triples would arrive with no licence — invisible to the CC0 dump — and
  no run, so nothing would say which machine produced them. Carrying the whole
  registry instead would clobber the hundred graphs on the server that this
  backup has never heard of.
- **`--vocabs-only` is not optional.** Metric labels come from the store's copy
  of `vocabs/plugin-universe.ttl`, not from the file on disk. Skip it and every
  reading renders as a bare local name with no label or unit.

Do not weaken the sandbox to make something work. If a tool needs the network,
it is the wrong tool.

## Adding a tool

1. Install it in `docker/profiler.Dockerfile`. Keep the image small: it is
   deliberately a poor place to run anything other than the tool.
2. Write a wrapper beside `src/profiler/Lv2Scanner.js` that runs it through
   `Sandbox` and parses its output into plain values. Parse conservatively —
   tool output is a human-readable report, not an interchange format, and a
   parser that tries to be clever is wrong quietly.
3. Add metrics to `vocabs/plugin-universe.ttl` first, then emit them from
   `MeasurementSerialiser`. Terms before code.
4. Capture real tool output as a test fixture. `tests/fixtures/lv2info-chatgen.txt`
   came from an actual scan; a hand-written sample tests your idea of the format
   rather than the format.

Two more things a new tool has to get right, both learned from adding pluginval:

5. **Check that the image can load the plugin before blaming the plugin.** See
   the `unloadable` row above. Every tool here reports "I found nothing to test"
   and "this binary is damaged" in the same words.
6. **A new metric has to reach the store's copy of the vocabulary**, not just
   the file. `bin/ingest.js --vocabs-only` does that; without it three new
   metrics arrived on plugin pages as bare local names with no label or unit,
   because the labels come from `vocabs/plugin-universe.ttl` *as loaded into
   Fuseki*.

The next one is something that runs audio, for `pu:CpuLoad`.
