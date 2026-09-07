#!/usr/bin/env node
import logger from 'loglevel'
import Config from '../src/Config.js'
import SPARQLClient from '../src/store/SPARQLClient.js'
import GraphRegistry from '../src/store/GraphRegistry.js'
import URIMinter from '../src/rdf/URIMinter.js'
import Sandbox from '../src/profiler/Sandbox.js'
import Lv2Scanner from '../src/profiler/Lv2Scanner.js'
import { serialiseScan, serialiseRun, platformDescription } from '../src/profiler/MeasurementSerialiser.js'
import { insertDataQuery, iri } from '../src/store/SPARQLHelper.js'
import { NAMESPACES } from '../src/rdf/NamespaceManager.js'

/**
 * Scan built LV2 bundles and record what they say about themselves.
 *
 * Every scan runs in the sandbox: lilv dlopens a plugin binary to read some
 * properties, so this executes third-party native code every time, and it is
 * the only thing in the project that does.
 *
 * Results go to their own graph per run, tagged with the platform. A run can
 * therefore be dropped whole — if the host turns out to have been
 * misconfigured, its readings go with it and nothing else is touched.
 *
 * Usage:
 *   node bin/profile.js --path /home/danny/github/flues/build-output/plugins-v0.1.0
 *   node bin/profile.js --path <dir> --dry-run
 */

logger.setLevel('info')

const args = process.argv.slice(2)
const flag = name => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? null : args[index + 1]
}
const mountPath = flag('path')
const dryRun = args.includes('--dry-run')

if (!mountPath) {
  console.error('Usage: node bin/profile.js --path <directory of .lv2 bundles> [--dry-run]')
  console.error('\nThe directory must contain the *built* bundles — manifest.ttl beside the .so.')
  console.error('For flues that is build-output/, which the harvester deliberately skips: the')
  console.error('harvester wants the source of truth, the profiler wants what actually runs.')
  process.exit(1)
}

const sandbox = new Sandbox()
if (!(await sandbox.isAvailable())) {
  console.error(
    'The profiler image is not built. Untrusted native code is not run outside the sandbox:\n' +
    '  docker build -f docker/profiler.Dockerfile -t plugin-universe-profiler .'
  )
  process.exit(1)
}

const scanner = new Lv2Scanner({ sandbox })
console.log(`Scanning ${mountPath}`)
console.log(`  platform: ${platformDescription()}`)

const { listing, results } = await scanner.scanAll(mountPath)
if (results.length === 0) {
  console.error(`\nlilv found no plugins there (lv2ls: ${listing.outcome}).`)
  if (listing.stderr) console.error(listing.stderr.slice(0, 400))
  console.error('\nLV2_PATH points at the mount root, and it does not recurse — the directory')
  console.error('must contain the .lv2 bundles directly.')
  process.exit(1)
}

console.log(`\n${results.length} plugin(s):`)
for (const result of results) {
  const scanned = result.scanned
  console.log(
    `  ${(scanned?.name ?? result.uri).padEnd(18)} ${result.outcome.padEnd(9)}` +
    ` ports=${String(scanned?.ports.length ?? 0).padStart(3)}` +
    ` ${result.elapsedMs}ms${result.signal ? `  (${result.signal})` : ''}`
  )
}

if (dryRun) {
  console.log('\n--dry-run: nothing written.')
  process.exit(0)
}

const config = Config.load()
const client = new SPARQLClient(config.get('storage.endpoint'))
if (!(await client.isReachable())) {
  console.error(`\nSPARQL endpoint ${config.get('storage.endpoint.query')} is not reachable.`)
  process.exit(1)
}

// The measurement is about the catalogue's plugin, so the scanned LV2 IRI has
// to be resolved to one. An unmatched scan is reported rather than written
// against a guess: a measurement attached to the wrong plugin is worse than no
// measurement.
const rows = await client.select(
  `SELECT ?plugin ?upstream WHERE { GRAPH ?g { ?plugin ${iri(`${NAMESPACES.owl}sameAs`)} ?upstream } }`
)
const byUpstream = new Map(rows.map(row => [row.upstream, row.plugin]))

const runId = `lv2-scan-${new Date().toISOString()}`
const tool = 'lilv lv2info (debian bookworm)'
const minter = new URIMinter()
const registry = new GraphRegistry(client)

const triples = [...serialiseRun({ runId, tool, plugins: results.length })]
const unmatched = []
for (const result of results) {
  const pluginIri = byUpstream.get(result.uri)
  if (!pluginIri) {
    unmatched.push(result.uri)
    continue
  }
  triples.push(...serialiseScan({ pluginIri, result, tool, runId, minter }))
}

if (unmatched.length) {
  console.log(`\n${unmatched.length} scanned plugin(s) are not in the catalogue, so not recorded:`)
  for (const uri of unmatched.slice(0, 8)) console.log(`  ${uri}`)
}
if (triples.length === 0) {
  console.error('\nNothing to write.')
  process.exit(1)
}

const graphId = `lv2-scan-${Date.now()}`
await registry.drop('profiler', graphId)
const graph = await registry.register({
  kind: 'profiler',
  id: graphId,
  // Measurements are this project's own observations, made with its own
  // equipment. Nobody else's terms attach to them.
  licence: 'CC0-1.0',
  derivedFrom: `${config.get('baseUri')}profiler/${graphId}`,
  runId,
  comment: `lilv scan of ${mountPath} on ${platformDescription()}`
})
await client.update(insertDataQuery(graph, triples))

console.log(`\nmeasurements  →  ${graph}`)
console.log(`  triples     ${triples.length}`)
console.log(`  recorded    ${results.length - unmatched.length} of ${results.length}`)
console.log(`\n  ${iri(graph)} is droppable on its own if this host was misconfigured.`)
