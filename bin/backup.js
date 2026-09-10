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
 *   node bin/backup.js --out <dir>            somewhere specific
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
if (manifest.omitted.length > 0) {
  console.log(`\n  ${manifest.omitted.length} rebuildable graph(s) omitted from an essential backup:`)
  for (const graph of manifest.omitted) console.log(`    ${graph}`)
  console.log('  Re-run the harvesters to get these back; nothing else can.')
}
