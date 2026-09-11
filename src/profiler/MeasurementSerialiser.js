import os from 'os'
import { NAMESPACES } from '../rdf/NamespaceManager.js'
import { iri, literal, typedLiteral } from '../store/SPARQLHelper.js'
import { PROFILER_CONFIG } from '../../config/preferences.js'

/**
 * Profiler results to triples.
 *
 * A measurement is an observation of a plugin **on a machine at a time**, not a
 * property of the plugin (docs/architecture.md §2.5). So every reading carries
 * its platform and its timestamp, and two runs of the same tool on the same
 * plugin are two measurements rather than one overwriting the other. That is
 * also why they go to a graph per run: a run can be dropped whole if the host
 * turns out to have been misconfigured, without touching anything else.
 *
 * The catalogue's value proposition rests on this being honest. A CPU figure
 * without the machine it was taken on is not a fact, it is a number.
 */

const pu = NAMESPACES.pu
const rdf = NAMESPACES.rdf
const rdfs = NAMESPACES.rdfs
const prov = NAMESPACES.prov

/** What the host running the profiler is, recorded with every reading. */
export function platformDescription () {
  return [os.type(), os.release(), os.arch()].join(' ')
}

/**
 * One scan result to triples.
 *
 * @param {object} spec
 * @param {string} spec.pluginIri - the catalogue IRI the reading is about
 * @param {object} spec.result - an Lv2Scanner result
 * @param {string} spec.tool - tool and version, e.g. "lilv lv2info 0.24.26"
 * @param {string} spec.runId
 * @param {URIMinter} spec.minter
 */
export function serialiseScan ({ pluginIri, result, tool, runId, minter, timestamp = new Date() }) {
  const platform = platformDescription()
  const triples = []
  const stamp = timestamp.toISOString()

  const measurement = (metric, value, extra = []) => {
    const node = minter.mintMeasurement({
      subject: pluginIri, tool, metric, platform, timestamp: `${stamp}#${metric}`
    })
    const s = iri(node)
    triples.push(
      `${s} ${iri(rdf + 'type')} ${iri(pu + 'Measurement')} .`,
      `${s} ${iri(pu + 'subject')} ${iri(pluginIri)} .`,
      `${s} ${iri(pu + 'metric')} ${iri(pu + metric)} .`,
      `${s} ${iri(pu + 'value')} ${value} .`,
      `${s} ${iri(pu + 'tool')} ${literal(tool)} .`,
      `${s} ${iri(pu + 'platform')} ${literal(platform)} .`,
      `${s} ${iri(prov + 'generatedAtTime')} ${typedLiteral(timestamp)} .`,
      `${s} ${iri(pu + 'harvestRun')} ${literal(runId)} .`,
      ...extra.map(([predicate, object]) => `${s} ${iri(predicate)} ${object} .`)
    )
    return node
  }

  // The verdict, always — including, and especially, when the scan failed. A
  // plugin that crashes the tool reading it has told us the most useful thing
  // it can, and the architecture is explicit that this is a result rather than
  // an error.
  measurement('ValidationResult', literal(result.outcome), [
    ...(result.signal ? [[pu + 'signal', literal(result.signal)]] : []),
    ...(result.stderr ? [[rdfs + 'comment', literal(result.stderr.slice(0, 500))]] : [])
  ])

  // How long the scan itself took. Not a benchmark — a scan time, which is what
  // the metric says. CPU load needs a host that actually runs audio through the
  // plugin, and that is the next tool rather than this one.
  measurement('ScanTime', typedLiteral(result.elapsedMs))

  if (result.scanned) {
    const scanned = result.scanned
    if (scanned.hasLatency !== null) {
      measurement('Latency', typedLiteral(scanned.hasLatency), [
        [rdfs + 'comment', literal(scanned.hasLatency
          ? 'The plugin reports latency to the host.'
          : 'The plugin reports no latency.')]
      ])
    }
    // Two counts, because they answer two questions and conflating them
    // manufactures disagreement. The harvested profile records *control* ports
    // — those are the parameters — while a binary has audio and atom ports as
    // well. Comparing the total against the profile's parameter count makes
    // every plugin look wrong; comparing control against control is the
    // like-for-like reading that shows where a binary and its Turtle have
    // actually diverged.
    const controlPorts = scanned.ports.filter(port =>
      port.types.some(type => type.endsWith('#ControlPort'))).length

    measurement('DiscoveredPorts', typedLiteral(scanned.ports.length), [
      [rdfs + 'comment', literal(`lilv reports ${scanned.ports.length} ports of all kinds on the built binary.`)]
    ])
    measurement('DiscoveredControlPorts', typedLiteral(controlPorts), [
      [rdfs + 'comment', literal(`${controlPorts} of them are control ports, which is what the harvested profile records as parameters.`)]
    ])
  }

  return triples
}

/**
 * One pluginval result to triples.
 *
 * The difference from serialiseScan is the strictness level, and it is not a
 * detail. "Passed pluginval" means nothing without the level it passed at —
 * level 5 is a plugin that loads and behaves in a host, level 10 is one that
 * survives parameter fuzzing — so every reading here carries `pu:strictness`,
 * and a run at another level produces measurements that sit alongside these
 * rather than replacing them.
 *
 * The verdict is pluginval's own word where it managed to say one. Where it did
 * not, that silence is the reading: a validator that never printed SUCCESS or
 * FAILURE was killed part-way, and the test it was in the middle of is recorded
 * because that is the sentence a developer needs.
 *
 * @param {object} spec
 * @param {string} spec.pluginIri
 * @param {object} spec.result - a PluginvalScanner result
 * @param {string} spec.tool - tool and version, from `pluginval --version`
 * @param {string} spec.runId
 * @param {URIMinter} spec.minter
 */
export function serialisePluginvalScan ({ pluginIri, result, tool, runId, minter, timestamp = new Date() }) {
  const platform = platformDescription()
  const triples = []
  const stamp = timestamp.toISOString()
  const scanned = result.scanned

  const measurement = (metric, value, extra = []) => {
    const node = minter.mintMeasurement({
      subject: pluginIri, tool, metric, platform, timestamp: `${stamp}#${metric}`
    })
    const s = iri(node)
    triples.push(
      `${s} ${iri(rdf + 'type')} ${iri(pu + 'Measurement')} .`,
      `${s} ${iri(pu + 'subject')} ${iri(pluginIri)} .`,
      `${s} ${iri(pu + 'metric')} ${iri(pu + metric)} .`,
      `${s} ${iri(pu + 'value')} ${value} .`,
      `${s} ${iri(pu + 'tool')} ${literal(tool)} .`,
      `${s} ${iri(pu + 'platform')} ${literal(platform)} .`,
      // The conditions, on every reading rather than only on the run, because a
      // measurement is quoted on its own and travels out of the dump without
      // the run beside it.
      `${s} ${iri(pu + 'strictness')} ${typedLiteral(result.strictness)} .`,
      `${s} ${iri(pu + 'sampleRate')} ${typedLiteral(PROFILER_CONFIG.sampleRate)} .`,
      `${s} ${iri(pu + 'blockSize')} ${typedLiteral(PROFILER_CONFIG.blockSize)} .`,
      `${s} ${iri(prov + 'generatedAtTime')} ${typedLiteral(timestamp)} .`,
      `${s} ${iri(pu + 'harvestRun')} ${literal(runId)} .`,
      ...extra.map(([predicate, object]) => `${s} ${iri(predicate)} ${object} .`)
    )
    return node
  }

  // What pluginval concluded, in its own words where it reached one. "passed"
  // and "failed" are its SUCCESS and FAILURE; anything else is the sandbox's
  // account of a run that did not finish, and the two are deliberately not
  // flattened together — a plugin that fails a test and a plugin that killed
  // the validator are different facts about it.
  const verdict = scanned?.verdict === 'SUCCESS'
    ? 'passed'
    : (scanned?.verdict === 'FAILURE' ? 'failed' : result.outcome)
  const comment = []
  if (result.missingLibraries?.length) {
    // The most important comment this function writes. Without it the reading
    // reads as a fact about the plugin, and it is a fact about the container.
    comment.push(
      'Not measured: the profiler image could not load it. ' +
      `${result.missingLibraries.join(' ')} ` +
      'This is a limitation of the profiler, not a defect in the plugin.'
    )
  }
  if (result.lastTest) comment.push(`Last test started: ${result.lastTest}.`)
  if (scanned?.failures.length) comment.push(`Failed: ${scanned.failures.join('; ')}`)
  if (!scanned && !result.missingLibraries?.length) {
    comment.push('pluginval produced no log; it did not get as far as starting a validation.')
  }

  measurement('ValidationResult', literal(verdict), [
    ...(result.signal ? [[pu + 'signal', literal(result.signal)]] : []),
    ...(comment.length ? [[rdfs + 'comment', literal(comment.join(' ').slice(0, 500))]] : [])
  ])

  // How many of pluginval's own tests reported a failure. Only where it ran
  // tests at all: zero from a validator that never started is a claim of a
  // clean run, and it would be a false one.
  if (scanned && scanned.tests.length > 0) {
    measurement('FailedTests', typedLiteral(scanned.failures.length), [
      [rdfs + 'comment', literal(
        `${scanned.failures.length} failure(s) across ${scanned.tests.length} test(s) at strictness ${result.strictness}.`
      )]
    ])
  }

  // Instantiation cost, cold and warm. Recorded in milliseconds with the text
  // pluginval actually printed, because above a second its own description has
  // already rounded to whole seconds and the number here should not pretend to
  // a precision the log does not have.
  for (const [metric, ms, text] of [
    ['OpenTimeCold', scanned?.openColdMs, scanned?.openColdText],
    ['OpenTimeWarm', scanned?.openWarmMs, scanned?.openWarmText]
  ]) {
    if (typeof ms !== 'number') continue
    measurement(metric, typedLiteral(ms), [[rdfs + 'comment', literal(`pluginval reported "${text}".`)]])
  }

  // Latency in samples, which needs a host that instantiated the plugin and
  // asked it. pu:Latency — the boolean a static scan can establish — is what
  // lilv writes; this is its counterpart, and until pluginval arrived nothing
  // produced it.
  if (typeof scanned?.reportedLatency === 'number') {
    measurement('LatencySamples', typedLiteral(scanned.reportedLatency))
  }

  // Scan time only where a scan happened. The elapsed time of a plugin that
  // never loaded is the time the loader took to refuse it, which is not a
  // measurement of anything about the plugin.
  if (!result.missingLibraries?.length) measurement('ScanTime', typedLiteral(result.elapsedMs))

  return triples
}

/** Provenance for the run itself: what was measured, with what, where, when. */
export function serialiseRun ({ runId, tool, plugins, timestamp = new Date() }) {
  const node = `${pu}profiler-run/${encodeURIComponent(runId)}`
  const s = iri(node)
  return [
    `${s} ${iri(rdf + 'type')} ${iri(prov + 'Activity')} .`,
    `${s} ${iri(rdfs + 'label')} ${literal(`Profiler run ${runId}`)} .`,
    `${s} ${iri(pu + 'tool')} ${literal(tool)} .`,
    `${s} ${iri(pu + 'platform')} ${literal(platformDescription())} .`,
    `${s} ${iri(pu + 'sampleRate')} ${typedLiteral(PROFILER_CONFIG.sampleRate)} .`,
    `${s} ${iri(pu + 'blockSize')} ${typedLiteral(PROFILER_CONFIG.blockSize)} .`,
    `${s} ${iri(prov + 'generatedAtTime')} ${typedLiteral(timestamp)} .`,
    `${s} ${iri(rdfs + 'comment')} ${literal(`${plugins} plugin(s) scanned.`)} .`
  ]
}

export default serialiseScan
