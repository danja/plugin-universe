#!/usr/bin/env node
import logger from 'loglevel'
import Config from '../src/Config.js'
import SPARQLClient from '../src/store/SPARQLClient.js'
import URIMinter from '../src/rdf/URIMinter.js'
import Sandbox from '../src/profiler/Sandbox.js'
import Lv2Scanner from '../src/profiler/Lv2Scanner.js'
import PluginvalScanner, { HOSTED_FORMATS } from '../src/profiler/PluginvalScanner.js'
import ProfilerRun from '../src/profiler/ProfilerRun.js'
import {
  serialiseScan, serialisePluginvalScan, serialiseRun, platformDescription
} from '../src/profiler/MeasurementSerialiser.js'
import { iri } from '../src/store/SPARQLHelper.js'
import { PROFILER_CONFIG } from '../config/preferences.js'

/**
 * Measure built plugins and record what they turn out to be.
 *
 * Two tools, answering two questions.
 *
 *   --tool lilv        reads what an LV2 bundle declares, through the library
 *                      a host would use. Fast, safe-ish, LV2 only.
 *   --tool pluginval   loads the plugin and drives audio through it. Reaches
 *                      VST3 — which lilv cannot see at all — and is the only
 *                      way the catalogue learns anything a vendor did not say.
 *
 * Both run inside the sandbox. lilv dlopens a binary; pluginval instantiates,
 * automates, fuzzes and processes. This is the only part of the project that
 * executes code the project did not write, and plugins do crash under it. A
 * crash is a recorded result.
 *
 * Results go to their own graph per run, tagged with the platform, so a run
 * made on a misconfigured host can be dropped whole.
 *
 * Usage:
 *   node bin/profile.js --path /home/danny/github/flues/build-output/plugins-v0.1.0
 *   node bin/profile.js --path /home/danny/github/downspout/build/bin --tool pluginval
 *   node bin/profile.js --path <dir> --tool pluginval --strictness 8 --dry-run
 */

logger.setLevel('info')

const args = process.argv.slice(2)
const flag = name => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? null : args[index + 1]
}
const mountPath = flag('path')
const tool = flag('tool') ?? 'lilv'
const dryRun = args.includes('--dry-run')

const usage = message => {
  console.error(message)
  console.error('\nUsage: node bin/profile.js --path <directory> [--tool lilv|pluginval]')
  console.error('                           [--strictness 1-10] [--dry-run]')
  console.error('\nThe directory must contain the *built* plugins. For flues that is')
  console.error('build-output/ and for downspout build/bin/ — both of which the harvesters')
  console.error('deliberately skip: a harvester wants the source of truth, the profiler')
  console.error('wants what actually runs.')
  process.exit(1)
}

if (!mountPath) usage('No --path given.')
if (tool !== 'lilv' && tool !== 'pluginval') usage(`Unknown --tool ${JSON.stringify(tool)}.`)

const strictness = flag('strictness') === null
  ? PROFILER_CONFIG.pluginvalStrictness
  : Number(flag('strictness'))
if (!Number.isInteger(strictness) || strictness < 1 || strictness > 10) {
  usage(`--strictness must be an integer 1-10, got ${JSON.stringify(flag('strictness'))}.`)
}

const sandbox = new Sandbox()
if (!(await sandbox.isAvailable())) {
  console.error(
    'The profiler image is not built. Untrusted native code is not run outside the sandbox:\n' +
    '  docker build -f docker/profiler.Dockerfile -t plugin-universe-profiler .'
  )
  process.exit(1)
}

console.log(`Scanning ${mountPath} with ${tool}`)
console.log(`  platform: ${platformDescription()}`)

/**
 * lilv over a directory of LV2 bundles.
 *
 * Matched to the catalogue by the plugin's own IRI, which LV2 plugins have by
 * design and the catalogue preserves with owl:sameAs.
 */
async function withLilv (run, context) {
  const scanner = new Lv2Scanner({ sandbox })
  const { listing, results } = await scanner.scanAll(mountPath)
  if (results.length === 0) {
    console.error(`\nlilv found no plugins there (lv2ls: ${listing.outcome}).`)
    if (listing.stderr) console.error(listing.stderr.slice(0, 400))
    console.error('\nLV2_PATH points at the mount root, and it does not recurse — the')
    console.error('directory must contain the .lv2 bundles directly.')
    process.exit(1)
  }

  console.log(`\n${results.length} plugin(s):`)
  for (const result of results) {
    console.log(
      `  ${(result.scanned?.name ?? result.uri).padEnd(18)} ${result.outcome.padEnd(9)}` +
      ` ports=${String(result.scanned?.ports.length ?? 0).padStart(3)}` +
      ` ${result.elapsedMs}ms${result.signal ? `  (${result.signal})` : ''}`
    )
  }
  if (dryRun) return { results, dryRun: true }

  const byUpstream = await run.byUpstreamIri()
  const toolVersion = 'lilv lv2info (debian bookworm)'
  const triples = [...serialiseRun({ runId: context.runId, tool: toolVersion, plugins: results.length })]
  const unmatched = []
  for (const result of results) {
    const pluginIri = byUpstream.get(result.uri)
    if (!pluginIri) {
      unmatched.push(result.uri)
      continue
    }
    triples.push(...serialiseScan({ pluginIri, result, tool: toolVersion, runId: context.runId, minter: context.minter }))
  }
  return { results, triples, unmatched, tool: toolVersion, kind: 'lv2-scan' }
}

/**
 * pluginval over a directory of built bundles.
 *
 * Matched by bundle file name, which is the same fact the plugin's IRI was
 * minted from — not a separate guess about which plugin a file is.
 */
async function withPluginval (run, context) {
  const scanner = new PluginvalScanner({ sandbox })
  const bundles = await scanner.list(mountPath)
  if (bundles.length === 0) {
    console.error('\nNothing there pluginval can host.')
    console.error(`Looked for: ${Object.keys(HOSTED_FORMATS).join(' ')}`)
    console.error('\nVST2 is not among them: this build carries no VST2 SDK, and a bare .so')
    console.error('could equally be LADSPA, so guessing would file the reading under the')
    console.error('wrong format.')
    process.exit(1)
  }

  const toolVersion = await scanner.version(mountPath)
  console.log(`  tool:     ${toolVersion}, strictness ${strictness}`)
  console.log(`\n${bundles.length} plugin(s):`)

  const results = []
  for (const bundle of bundles) {
    const result = await scanner.validate(mountPath, bundle, { strictness })
    results.push(result)
    const verdict = result.scanned?.verdict ?? result.outcome
    console.log(
      `  ${bundle.name.padEnd(24)} ${String(verdict).padEnd(9)}` +
      ` fail=${String(result.scanned?.failures.length ?? '-').padStart(2)}` +
      ` ${result.elapsedMs}ms${result.signal ? `  (${result.signal})` : ''}` +
      (result.scanned?.verdict ? '' : `  last: ${result.lastTest ?? 'nothing started'}`)
    )
    // A run that produced no log at all is usually the profiler's fault rather
    // than the plugin's — a missing library, a command that is not in the
    // image — and that difference is invisible unless the error is shown.
    // Every one of the three times this went wrong here, the plugin got the
    // blame: `xvfb-run` removed from the image but not from the command read
    // exactly like a plugin that fails in 275ms.
    if (!result.scanned && result.stderr) {
      console.log(`      ${result.stderr.split('\n').slice(0, 3).join('\n      ')}`)
    }
  }
  if (dryRun) return { results, dryRun: true }

  const { byName, ambiguous } = await run.byBundleName()
  if (ambiguous.length) {
    console.log(`\n${ambiguous.length} bundle name(s) are claimed by more than one plugin, so`)
    console.log('nothing is attached to them: ' + ambiguous.slice(0, 5).join(', '))
  }

  const triples = [...serialiseRun({ runId: context.runId, tool: toolVersion, plugins: results.length })]
  const unmatched = []
  for (const result of results) {
    const pluginIri = byName.get(result.name.toLowerCase())
    if (!pluginIri) {
      unmatched.push(result.name)
      continue
    }
    triples.push(...serialisePluginvalScan({
      pluginIri, result, tool: toolVersion, runId: context.runId, minter: context.minter
    }))
  }
  return { results, triples, unmatched, tool: toolVersion, kind: 'pluginval' }
}

const runId = `${tool}-${new Date().toISOString()}`
const context = { runId, minter: new URIMinter() }

// The store is only needed once there is something to write, so --dry-run works
// without it — which is what makes it useful for checking a directory before
// committing a run to the graph.
let run = null
if (!dryRun) {
  const config = Config.load()
  const client = new SPARQLClient(config.get('storage.endpoint'))
  if (!(await client.isReachable())) {
    console.error(`\nSPARQL endpoint ${config.get('storage.endpoint.query')} is not reachable.`)
    process.exit(1)
  }
  run = new ProfilerRun(client)
  context.config = config
  context.client = client
}

const outcome = tool === 'lilv'
  ? await withLilv(run, context)
  : await withPluginval(run, context)

if (outcome.dryRun) {
  console.log('\n--dry-run: nothing written.')
  process.exit(0)
}

if (outcome.unmatched.length) {
  console.log(`\n${outcome.unmatched.length} measured plugin(s) are not in the catalogue, so not recorded:`)
  for (const name of outcome.unmatched.slice(0, 8)) console.log(`  ${name}`)
}
if (outcome.triples.length === 0) {
  console.error('\nNothing to write.')
  process.exit(1)
}

const graphId = `${outcome.kind}-${Date.now()}`
const graph = await run.write({
  id: graphId,
  runId,
  triples: outcome.triples,
  baseUri: context.config.get('baseUri'),
  comment: `${outcome.tool} over ${mountPath}`
})

console.log(`\nmeasurements  →  ${graph}`)
console.log(`  triples     ${outcome.triples.length}`)
console.log(`  recorded    ${outcome.results.length - outcome.unmatched.length} of ${outcome.results.length}`)
console.log(`\n  ${iri(graph)} is droppable on its own if this host was misconfigured.`)
