#!/usr/bin/env node
import fs from 'fs'
import path from 'path'
import logger from 'loglevel'
import Config from '../src/Config.js'
import SPARQLClient from '../src/store/SPARQLClient.js'
import DumpBuilder from '../src/store/DumpBuilder.js'
import Publication from '../src/store/Publication.js'

/**
 * Publish the catalogue to the public SPARQL dataset.
 *
 * Dump, load, verify. The public endpoint serves a separate dataset rather than
 * a read-only view of the catalogue, because a SPARQL endpoint exposes every
 * named graph it holds — so the way to not publish accounts is to not put them
 * there.
 *
 * Usage:
 *   node bin/publish.js              dump afresh, then load
 *   node bin/publish.js --no-dump    load the dump already in data/dumps
 *   node bin/publish.js --audit      only ask what the public dataset holds
 */

logger.setLevel('info')

const args = process.argv.slice(2)
const config = Config.load()

const publicationEndpoint = config.get('storage.publication')
const publication = new Publication(new SPARQLClient(publicationEndpoint))

if (args.includes('--audit')) {
  const graphs = await publication.published()
  const wrong = await publication.audit()
  console.log(`The public dataset holds ${graphs.length} graph(s):`)
  for (const graph of graphs) console.log(`  ${graph}`)
  if (wrong.length > 0) {
    console.error(`\n!! ${wrong.length} graph(s) must not be there: ${wrong.join(', ')}`)
    process.exit(1)
  }
  console.log('\nNothing here that should not be.')
  process.exit(0)
}

if (!args.includes('--no-dump')) {
  const catalogue = new SPARQLClient(config.get('storage.endpoint'))
  if (!(await catalogue.isReachable())) {
    console.error(`SPARQL endpoint ${config.get('storage.endpoint.query')} is not reachable.`)
    process.exit(1)
  }
  const dump = await new DumpBuilder(catalogue).build()
  console.log(`Dumped ${Object.values(dump.parts).reduce((n, part) => n + part.graphs.length, 0)} graphs, ` +
    `withholding ${dump.withheld.length}.`)
}

const report = await publication.publish()

console.log(`\nPublished ${report.graphs.length} graph(s), ${report.triples} triples:`)
for (const graph of report.graphs) {
  console.log(`  ${graph.graph.padEnd(44)} ${String(graph.triples).padStart(6)}  ${graph.licence}`)
}
if (report.removed.length > 0) {
  console.log(`\n  ${report.removed.length} graph(s) removed from the public dataset:`)
  for (const graph of report.removed) console.log(`    ${graph}`)
}

// The description goes beside the dump so nginx can serve it next to the data.
const voidFile = path.join('data/dumps', 'public-void.ttl')
await fs.promises.writeFile(voidFile, publication.describe(report))
console.log(`\nDescription: ${voidFile}`)
console.log('Audit at any time with: node bin/publish.js --audit')
