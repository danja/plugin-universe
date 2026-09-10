#!/usr/bin/env node
import logger from 'loglevel'
import Config from '../src/Config.js'
import SPARQLClient from '../src/store/SPARQLClient.js'
import BackupBuilder from '../src/store/BackupBuilder.js'

/**
 * Put a backup back.
 *
 * Destructive: every graph in the backup is dropped and rewritten, so anything
 * written since is gone. It therefore asks you to name the dataset you mean,
 * rather than accepting a bare --yes — a restore that can be triggered by a
 * typo is a second way to lose the data it exists to protect.
 *
 * Usage:
 *   node bin/restore.js <dir>                              what it would do
 *   node bin/restore.js <dir> --into <dataset>             do it
 *   node bin/restore.js <dir> --into <dataset> --graph <g> just that one
 */

logger.setLevel('info')

const args = process.argv.slice(2)
const flag = name => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? null : args[index + 1]
}

const directory = args.find(arg => !arg.startsWith('--')) ?? null
if (!directory) {
  console.error('Which backup? node bin/restore.js <directory> [--into <dataset>]')
  process.exit(1)
}

const config = Config.load()
const dataset = config.get('storage.endpoint.dataset')
const client = new SPARQLClient(config.get('storage.endpoint'))
if (!(await client.isReachable())) {
  console.error(`SPARQL endpoint ${config.get('storage.endpoint.query')} is not reachable.`)
  process.exit(1)
}

const manifest = await BackupBuilder.readManifest(directory)
const only = flag('graph') ? [flag('graph')] : null
const wanted = only ? manifest.graphs.filter(g => only.includes(g.graph)) : manifest.graphs

console.log(`${manifest.scope} backup from ${manifest.generatedAt}`)
console.log(`Restoring into dataset "${dataset}" would DROP and rewrite:\n`)
for (const graph of wanted) console.log(`  ${graph.graph.padEnd(44)} ${graph.triples} triples`)

const into = flag('into')
if (into !== dataset) {
  console.log(`\nNothing done. To go ahead, name the dataset:\n  --into ${dataset}`)
  if (into) console.error(`("${into}" is not the dataset this configuration points at.)`)
  process.exit(into ? 1 : 0)
}

const report = await new BackupBuilder(client).restore({ directory, confirm: true, only })
console.log(`\nRestored ${report.restored.length} graph(s):`)
for (const graph of report.restored) console.log(`  ${graph.graph.padEnd(44)} ${graph.triples} triples`)
console.log('\nEach graph was counted after loading and matched the backup.')
console.log('The app loads its index at start — restart it if plugin data changed.')
