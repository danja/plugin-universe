#!/usr/bin/env node
import path from 'path'
import logger from 'loglevel'
import Config from '../src/Config.js'
import SPARQLClient from '../src/store/SPARQLClient.js'
import BackupBuilder from '../src/store/BackupBuilder.js'

/**
 * Back the store up.
 *
 * Not the same job as bin/dump.js: the dump publishes what may be published and
 * withholds accounts and pending contributions, which are precisely the graphs
 * that cannot be rebuilt.
 *
 * Usage:
 *   node bin/backup.js                        full, into a dated directory
 *   node bin/backup.js --scope essential      only what cannot be re-harvested
 *   node bin/backup.js --scope measurements   the profiler runs, to carry to another host
 *   node bin/backup.js --out <dir>            somewhere specific
 *
 * `measurements` is a delivery rather than a backup. The profiler runs on a
 * machine with room and the catalogue is served from one without; this is how
 * a run gets from the first to the second. Each graph carries its registration,
 * so restoring it on the server adds readings and touches nothing else.
 */

logger.setLevel('info')

const args = process.argv.slice(2)
const flag = name => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? null : args[index + 1]
}

const config = Config.load()
const client = new SPARQLClient(config.get('storage.endpoint'))
if (!(await client.isReachable())) {
  console.error(`SPARQL endpoint ${config.get('storage.endpoint.query')} is not reachable.`)
  process.exit(1)
}

const scope = flag('scope') ?? 'full'
// Dated, because "the backup" is never as useful as "the backup from before
// the thing that went wrong".
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
const outputDir = flag('out') ?? path.join('data/backups', `${stamp}-${scope}`)

const manifest = await new BackupBuilder(client).backup({ outputDir, scope })

console.log(`${manifest.scope} backup: ${manifest.graphs.length} graphs, ${manifest.triples} triples`)
console.log(`  ${outputDir}`)

if (manifest.scope === 'measurements') {
  console.log('\nTo carry these to the server:')
  console.log(`  rsync -a ${outputDir}/ danny@hyperdata.it:/tmp/measurements/`)
  console.log('  ssh danny@hyperdata.it')
  console.log('  cd /chalet/github/plugin-universe   # wherever the deployment lives')
  console.log('  docker compose run --rm -v /tmp/measurements:/measurements app \\')
  console.log('    node bin/restore.js /measurements --into plugin-universe')
  console.log('  docker compose run --rm app node bin/ingest.js --vocabs-only')
  console.log('  docker compose restart app')
  console.log('\nThe --vocabs-only step is not optional: the metric labels come from the')
  console.log('store\'s copy of vocabs/plugin-universe.ttl, and without it every reading')
  console.log('shows as a bare local name with no label or unit.')
}
if (manifest.omitted.length > 0 && manifest.scope === 'essential') {
  console.log(`\n  ${manifest.omitted.length} rebuildable graph(s) omitted from an essential backup:`)
  for (const graph of manifest.omitted) console.log(`    ${graph}`)
  console.log('  Re-run the harvesters to get these back; nothing else can.')
}
if (manifest.scope === 'measurements') {
  // Not "omitted" in the sense the essential backup means it — this scope is a
  // delivery of profiler runs, and everything else being absent is the point
  // rather than a caveat. Listing thirteen harvested graphs as though they had
  // gone missing would read as a warning about nothing.
  console.log(`\n  ${manifest.graphs.length} profiler run(s), and nothing else:`)
  for (const graph of manifest.graphs) {
    console.log(`    ${graph.graph.padEnd(44)} ${String(graph.triples).padStart(5)} triples`)
    if (graph.registration?.comment) console.log(`      ${graph.registration.comment}`)
  }
  console.log('\n  Restore one at a time with --graph <iri> if any of these is a test run.')
}
