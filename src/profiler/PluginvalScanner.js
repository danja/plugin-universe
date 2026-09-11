import { readdir } from 'fs/promises'
import path from 'path'
import Sandbox, { OUTCOME } from './Sandbox.js'
import { PROFILER_CONFIG } from '../../config/preferences.js'

/**
 * Hosting plugins under pluginval, in the sandbox.
 *
 * Lv2Scanner reads what a bundle *declares*; this loads the plugin, hands it
 * buffers and watches what happens. That is the difference between a catalogue
 * that repeats a vendor's claims and one that has checked them, and it is why
 * pluginval is the tool this project needed most: it is the only one here that
 * reaches VST3 at all, and lilv reaches nothing that is not LV2.
 *
 * It is also, by a distance, the most dangerous thing the project runs. lilv
 * dlopens a binary; pluginval instantiates it, automates its parameters,
 * fuzzes them, saves and restores its state and processes audio through it, on
 * purpose, at whatever strictness it is asked for. Plugins crash under this.
 * That is the point — Sandbox exists so a crash is a row in the graph rather
 * than an incident.
 *
 * Two things about the run are worth stating plainly, because both change what
 * a verdict means:
 *
 * - **The strictness level is part of the reading.** "Passed pluginval" is not
 *   a fact until it says at what level, so the level is recorded alongside the
 *   verdict rather than assumed from a default that may later change.
 * - **The sample rate and block size are fixed** to the profiler's own, so two
 *   plugins measured here were measured under the same conditions. pluginval
 *   would otherwise sweep five sample rates and five block sizes, which is the
 *   right default for a developer testing their own plugin and the wrong one
 *   for a catalogue comparing many.
 *
 * pluginval is a JUCE GUI application, and the obvious assumption — that its
 * message thread must therefore want an X display — is wrong: it validates
 * headless with no X connection at all. The image had an Xvfb in it on that
 * assumption, and `xvfb-run` hung rather than failing, which is the worst way
 * for an assumption to be wrong. `--skip-gui-tests` declines to open plugin
 * editors, and that is the only part of this that involves a window.
 */

/**
 * Bundle suffixes pluginval can be pointed at, and the format each one is.
 *
 * Only formats this build actually hosts. VST2 is absent because the image is
 * built without the VST2 SDK — Steinberg's licence for it is not something this
 * project can redistribute — and LADSPA and bare-`.so` VST2 both look like a
 * plain shared object from outside, so there is no way to tell them apart by
 * name. Guessing wrong would file a measurement under the wrong format.
 */
export const HOSTED_FORMATS = Object.freeze({
  '.vst3': 'VST3',
  '.lv2': 'LV2',
  '.clap': 'CLAP'
})

/**
 * The outcome of a plugin the profiler's own container cannot load.
 *
 * Deliberately not one of Sandbox's OUTCOME values: those describe how a run
 * ended, and this is a run that was never worth starting. Keeping it distinct
 * is the whole point — "the image is too old for this plugin" and "this plugin
 * fails validation" must not arrive at the catalogue as the same word.
 */
export const UNLOADABLE = 'unloadable'

export class PluginvalScanner {
  constructor ({ sandbox = new Sandbox() } = {}) {
    this.sandbox = sandbox
  }

  /**
   * What pluginval says it is.
   *
   * Asked of the binary rather than read from a constant here, because a tool
   * version in `pu:tool` that came from a hardcoded string records what someone
   * believed was in the image. Two runs recorded under the same tool string
   * must actually have used the same tool, or the comparison the whole
   * measurement model rests on is false.
   */
  async version (mountPath) {
    const run = await this.sandbox.run({
      mountPath,
      command: ['pluginval', '--version'],
      timeoutMs: 30000
    })
    if (run.outcome !== OUTCOME.OK) {
      throw new Error(
        `pluginval did not answer --version in the profiler image (${run.outcome}). ` +
        `Rebuild it: docker build -f docker/profiler.Dockerfile -t plugin-universe-profiler .\n${run.stderr.slice(0, 400)}`
      )
    }
    // "pluginval - 1.0.4"
    return run.stdout.trim().split('\n')[0].trim()
  }

  /**
   * Which of a directory's entries are plugins pluginval can host.
   *
   * Separated from the directory read so it can be tested without a
   * filesystem, and so the naming rule is one thing rather than a filter buried
   * in a loop.
   */
  static bundles (names) {
    const found = []
    for (const name of names) {
      const dot = name.lastIndexOf('.')
      if (dot <= 0) continue
      const format = HOSTED_FORMATS[name.slice(dot).toLowerCase()]
      if (format) found.push({ name, format })
    }
    return found.sort((a, b) => a.name.localeCompare(b.name))
  }

  /** Plugins in a directory, by name. Reading a directory executes nothing. */
  async list (mountPath) {
    return PluginvalScanner.bundles(await readdir(mountPath))
  }

  /**
   * A JUCE RelativeTime description back to milliseconds.
   *
   * pluginval reports times through `RelativeTime::getDescription()`, which is
   * prose for people — "345 ms", "2 secs", "1 min 3 secs". Above a second it
   * has already rounded to whole seconds, so this recovers what was printed and
   * not what was measured; the raw text travels with the reading for that
   * reason. Anything unrecognised is null rather than zero, because "no figure"
   * and "took no time" are different claims.
   */
  static durationMs (text) {
    if (!text) return null
    const units = [
      [/(\d+(?:\.\d+)?)\s*ms\b/, 1],
      [/(\d+(?:\.\d+)?)\s*secs?\b/, 1000],
      [/(\d+(?:\.\d+)?)\s*mins?\b/, 60000],
      [/(\d+(?:\.\d+)?)\s*hours?\b/, 3600000],
      [/(\d+(?:\.\d+)?)\s*days?\b/, 86400000],
      [/(\d+(?:\.\d+)?)\s*weeks?\b/, 604800000]
    ]
    let total = null
    for (const [pattern, scale] of units) {
      const match = text.match(pattern)
      if (!match) continue
      total = (total ?? 0) + Number(match[1]) * scale
    }
    return total === null ? null : Math.round(total)
  }

  /**
   * pluginval's log into a reading.
   *
   * Conservative in the same way Lv2Scanner.parse is, and for the same reason:
   * this is a log written for a person, not an interchange format. Only lines
   * pluginval emits verbatim from its own source are matched, and the verdict
   * comes from the word pluginval prints at the end rather than from counting
   * failures here — a count assembled by this parser would be a second opinion
   * about something the tool already stated.
   */
  static parse (text) {
    const lines = text.split('\n')
    const first = pattern => {
      for (const line of lines) {
        const match = line.match(pattern)
        if (match) return match[1].trim()
      }
      return null
    }

    // "Testing plugin: <identifier>" is followed by
    // "<manufacturer>: <name> v<version>".
    const index = lines.findIndex(line => /^Testing plugin:/.test(line))
    let manufacturer = null
    let name = null
    let version = null
    if (index !== -1 && index + 1 < lines.length) {
      const described = lines[index + 1].match(/^(.*?):\s*(.*?)\s+v(\S+)\s*$/)
      if (described) {
        manufacturer = described[1].trim()
        name = described[2].trim()
        version = described[3].trim()
      }
    }

    // Every test pluginval started, and every failure it reported. The failure
    // line names the test, so the two together say which tests were run and
    // which of them did not pass.
    //
    // The line is "Starting tests in: pluginval / <name>..." — JUCE's own
    // wording, with its unit-test category prefixed. Matched as pluginval
    // actually prints it rather than as its source reads, and the category is
    // dropped because every test here is in it.
    const tests = lines
      .map(line => line.match(/^Starting tests? in:\s*(.+?)\s*\.\.\.\s*$/))
      .filter(Boolean)
      .map(match => match[1].replace(/^pluginval\s*\/\s*/, ''))
    const failures = lines
      .map(line => line.match(/^!!!\s*Test\s+\d+\s+failed:\s*(.+)$/))
      .filter(Boolean)
      .map(match => match[1].trim())

    const verdictLine = lines.map(line => line.trim())
      .filter(line => line === 'SUCCESS' || line === 'FAILURE')
      .pop() ?? null

    const count = pattern => {
      const raw = first(pattern)
      if (raw === null) return null
      const parsed = Number(raw)
      return Number.isInteger(parsed) ? parsed : null
    }

    const coldText = first(/^Time taken to open plugin \(cold\):\s*(.+)$/)
    const warmText = first(/^Time taken to open plugin \(warm\):\s*(.+)$/)

    // Latency in samples, from a plugin that has actually been instantiated and
    // asked. lilv can only see that a latency port exists — pu:Latency, the
    // boolean — and the sample count needs a running host, which is what this
    // is. Signed, because a plugin reporting a negative latency is reporting
    // something wrong about itself and that is worth recording rather than
    // discarding.

    return {
      // pluginval's own word, or null when it never got as far as saying one.
      // Null is the interesting case: it means the process died mid-run.
      verdict: verdictLine,
      started: lines.some(line => line.trim() === 'Validation started'),
      strictness: count(/^Strictness level:\s*(\d+)\s*$/),
      pluginsFound: count(/^Num plugins found:\s*(\d+)\s*$/),
      identifier: first(/^Testing plugin:\s*(.+)$/),
      manufacturer,
      name,
      version,
      // pluginval's inactivity timeout, which it reports itself before killing
      // its own process. Distinct from the sandbox's wall clock: this one knows
      // which test stopped responding.
      timedOut: lines.some(line => line.startsWith('*** FAILED: Timeout after')),
      openColdMs: PluginvalScanner.durationMs(coldText),
      openColdText: coldText,
      openWarmMs: PluginvalScanner.durationMs(warmText),
      openWarmText: warmText,
      reportedLatency: count(/^Reported latency:\s*(-?\d+)\s*$/),
      tests,
      failures
    }
  }

  /**
   * The shared object inside a bundle, relative to the mount.
   *
   * Needed because the loader check below has to name a file, and a bundle is a
   * directory. Only for formats with exactly one — a VST3 bundle holds a single
   * binary per architecture, a CLAP *is* one. An LV2 bundle holds several and
   * has no one answer, so it gets null and no check: lilv is the tool that
   * reaches LV2 anyway, and it reports a bundle it cannot load as an empty
   * scan rather than as a failure.
   *
   * Reading a directory executes nothing.
   */
  async objectPath (mountPath, { name, format }) {
    if (format === 'CLAP') return name
    if (format !== 'VST3') return null
    // Contents/<architecture>/<binary>.so
    const contents = path.join(mountPath, name, 'Contents')
    let architectures
    try {
      architectures = await readdir(contents)
    } catch {
      // A .vst3 that is not a bundle at all. Nothing to check, and pluginval
      // will have its own opinion about it.
      return null
    }
    for (const architecture of architectures.sort()) {
      let files
      try {
        files = await readdir(path.join(contents, architecture))
      } catch {
        continue
      }
      const object = files.find(file => file.endsWith('.so'))
      if (object) return path.join(name, 'Contents', architecture, object)
    }
    return null
  }

  /**
   * Whether the container's dynamic loader can satisfy the plugin at all.
   *
   * This exists because of a reading that would have been a lie. On a Debian
   * bookworm base the 46 built downspout VST3s needed glibc 2.38 against the
   * image's 2.36, so not one of them loaded — and pluginval reported "Num
   * plugins found: 0", which is also exactly what it reports about a plugin
   * that is genuinely broken. Published as-is, the catalogue would have said 46
   * working plugins fail validation, with the profiler's own container as the
   * only thing actually at fault.
   *
   * So the loader is asked first, and separately. A plugin this image cannot
   * load is not measured, and what gets recorded is that the image could not
   * load it — a fact about the profiler, which is the true one.
   *
   * ldd runs inside the sandbox like everything else here: resolving a
   * binary's dependencies runs its loader, and that is third-party code.
   */
  async loadable (mountPath, objectPath) {
    const run = await this.sandbox.run({
      mountPath,
      command: ['ldd', `/plugin/${objectPath}`],
      timeoutMs: 30000
    })
    // ldd reports two different shapes of failure — a missing library
    // ("libdbus-1.so.3 => not found") and a library too old for a symbol
    // version ("version `GLIBC_2.38' not found") — and both matter equally,
    // because both mean the plugin will not load.
    const missing = `${run.stdout}\n${run.stderr}`
      .split('\n')
      .filter(line => line.includes('not found'))
      .map(line => line.trim())
    return { ok: missing.length === 0, missing, run }
  }

  /**
   * Validate one plugin. Everything that can go wrong is reported, not raised.
   *
   * The last test pluginval started before a crash is the most useful line in
   * the whole log — it is the difference between "this plugin is broken" and
   * "this plugin cannot survive parameter fuzzing" — so it is lifted out rather
   * than left in a truncated stderr.
   */
  async validate (mountPath, { name, format }, {
    strictness = PROFILER_CONFIG.pluginvalStrictness,
    timeoutMs = PROFILER_CONFIG.wallClockLimitMs
  } = {}) {
    // The loader first. A plugin this image cannot load would otherwise be
    // measured as a plugin that fails, and the two are not the same finding.
    const object = await this.objectPath(mountPath, { name, format })
    if (object) {
      const loader = await this.loadable(mountPath, object)
      if (!loader.ok) {
        return {
          name,
          format,
          strictness,
          outcome: UNLOADABLE,
          signal: null,
          elapsedMs: loader.run.elapsedMs,
          scanned: null,
          lastTest: null,
          missingLibraries: loader.missing,
          stderr: loader.missing.join('\n').slice(0, 2000)
        }
      }
    }

    const run = await this.sandbox.run({
      mountPath,
      command: [
        'pluginval',
        '--validate', `/plugin/${name}`,
        '--strictness-level', String(strictness),
        '--sample-rates', String(PROFILER_CONFIG.sampleRate),
        '--block-sizes', String(PROFILER_CONFIG.blockSize),
        '--timeout-ms', String(PROFILER_CONFIG.pluginvalTimeoutMs),
        '--skip-gui-tests',
        '--verbose'
      ],
      timeoutMs
    })

    // pluginval writes its log to stdout; a crash message from the runtime
    // arrives on stderr. Both are the record of what happened.
    const parsed = PluginvalScanner.parse(run.stdout)

    return {
      name,
      format,
      strictness,
      outcome: run.outcome,
      signal: run.signal,
      elapsedMs: run.elapsedMs,
      scanned: parsed.started ? parsed : null,
      lastTest: parsed.tests.length > 0 ? parsed.tests[parsed.tests.length - 1] : null,
      missingLibraries: [],
      stderr: run.stderr.slice(0, 2000)
    }
  }

  /** Every hosted plugin in a directory, validated one at a time. */
  async validateAll (mountPath, options = {}) {
    const bundles = await this.list(mountPath)
    const results = []
    for (const bundle of bundles) results.push(await this.validate(mountPath, bundle, options))
    return { bundles, results }
  }
}

export default PluginvalScanner
