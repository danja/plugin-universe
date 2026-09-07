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

## What it does today

`bin/profile.js` scans **built LV2 bundles** through lilv — the same library a
host uses, so what it reports is what a host would see — and records the result
as measurements in their own graph.

| Metric | What it records |
|---|---|
| `pu:ValidationResult` | `ok`, `failed`, `crashed` or `timed-out`, with the signal where there was one |
| `pu:ScanTime` | milliseconds the scan took. A scan time, not a benchmark |
| `pu:Latency` | whether the plugin reports latency to the host |
| `pu:DiscoveredPorts` | ports of every kind on the built binary |
| `pu:DiscoveredControlPorts` | just the control ports — the like-for-like counterpart of a profile's parameter count |

**Not yet:** CPU load, denormal behaviour, state save/restore integrity. Those
need a host that actually runs audio through the plugin. `pu:CpuLoad` is
defined in the vocabulary and nothing produces it.

**LV2 only.** lilv reads LV2. The 46 built VST3s in downspout cannot be measured
until there is a `pluginval` wrapper.

## Running it

Build the sandbox image once:

```sh
docker build -f docker/profiler.Dockerfile -t plugin-universe-profiler .
```

Then point it at a directory of **built** bundles:

```sh
node bin/profile.js --path /home/danny/github/flues/build-output/plugins-v0.1.0 --dry-run
node bin/profile.js --path /home/danny/github/flues/build-output/plugins-v0.1.0
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

| Outcome | Means |
|---|---|
| `ok` | the tool exited cleanly |
| `failed` | the tool ran and reported a problem with the plugin |
| `crashed` | the plugin took the tool down, or was killed for exceeding a limit |
| `timed-out` | it never finished |

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

A scan yields an LV2 IRI; a measurement has to attach to a catalogue IRI. The
link is `owl:sameAs`, which the LV2 harvester preserves from the bundle. A
scanned plugin the catalogue does not hold is **reported and not recorded** — a
measurement attached to the wrong plugin is worse than no measurement.

This is also the current limit on coverage: only plugins already harvested *and*
carrying an upstream IRI can be measured. VST3 has no equivalent key and will
need a different one.

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

The next two are `pluginval` — which covers VST/VST3/AU/LV2/LADSPA and would
make the downspout VST3s measurable — and something that runs audio, for
`pu:CpuLoad`.
