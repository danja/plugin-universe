#!/usr/bin/env node
import logger from 'loglevel'
import Config from '../src/Config.js'
import SPARQLClient from '../src/store/SPARQLClient.js'
import DumpBuilder from '../src/store/DumpBuilder.js'

/**
 * Publish the dataset.
 *
 * Assembling it is a selection over the licence flag every graph has carried
 * since it was written, which is the whole point of setting one at harvest
 * time. Nothing here decides anything; it reads flags and sorts.
 *
 * Usage:
 *   node bin/dump.js                 write to data/dumps
 *   node bin/dump.js --out <dir>     somewhere else
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

const outputDir = flag('out') ?? 'data/dumps'
const report = await new DumpBuilder(client, { outputDir }).build()

console.log(`Dataset written to ${report.outputDir}\n`)
for (const [name, part] of Object.entries(report.parts)) {
  const triples = part.graphs.reduce((total, graph) => total + graph.triples, 0)
  console.log(`  ${name.padEnd(8)} ${String(part.graphs.length).padStart(3)} graphs  ` +
    `${String(triples).padStart(7)} triples  ${part.licence}`)
}

// Withheld graphs are reported every time, not only when something looks wrong.
// A dump that quietly omits data is as hard to trust as one that quietly
// includes it, and "personal data was excluded" is the sentence somebody will
// want to have seen.
console.log(`\n  ${report.withheld.length} graph(s) withheld:`)
for (const graph of report.withheld) {
  console.log(`    ${graph.graph.padEnd(34)} ${graph.licence} — ${graph.reason}`)
}
console.log('\nManifest: MANIFEST.json   Description: void.ttl')
