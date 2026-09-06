#!/usr/bin/env node
import logger from 'loglevel'
import Config from '../src/Config.js'
import SPARQLClient from '../src/store/SPARQLClient.js'
import IngestPipeline from '../src/harvest/IngestPipeline.js'
import DownspoutHarvester from '../src/harvest/DownspoutHarvester.js'
import Lv2Harvester from '../src/harvest/Lv2Harvester.js'
import EmbeddingService from '../src/embeddings/EmbeddingService.js'
import VectorIndex from '../src/vectors/VectorIndex.js'
import { composeText, textHash } from '../src/embeddings/EmbeddingService.js'

/**
 * Harvest the seed sources, write them to the store, and build the vector index.
 *
 * Sources are configured here rather than discovered: adding one means adding
 * its licence and its provenance deliberately, which is the point (see
 * docs/resources.md §4).
 *
 * Usage: node bin/ingest.js [--skip-embeddings] [--source <id>]
 */

logger.setLevel('info')

const args = process.argv.slice(2)
const skipEmbeddings = args.includes('--skip-embeddings')
const onlySource = args.includes('--source') ? args[args.indexOf('--source') + 1] : null

const config = Config.load()
const client = new SPARQLClient(config.get('storage.endpoint'))

const harvesters = [
  new DownspoutHarvester({ repoPath: process.env.DOWNSPOUT_PATH ?? '/home/danny/github/downspout' }),
  new Lv2Harvester({
    repoPath: process.env.FLUES_PATH ?? '/home/danny/github/flues',
    id: 'flues',
    // Verified per repository, not assumed: flues' bundles carry
    // doap:license <https://opensource.org/licenses/MIT>.
    licence: 'MIT',
    derivedFrom: 'https://github.com/danja/flues',
    vendor: 'Danny Ayers'
  })
].filter(h => !onlySource || h.id === onlySource)

if (harvesters.length === 0) {
  console.error(`No harvester matches --source ${onlySource}`)
  process.exit(1)
}

if (!(await client.isReachable())) {
  console.error(`SPARQL endpoint ${config.get('storage.endpoint.query')} is not reachable.`)
  process.exit(1)
}

const pipeline = new IngestPipeline(client)
const reports = []
const allCategories = new Set()

for (const harvester of harvesters) {
  const report = await pipeline.run(harvester)
  reports.push(report)
  for (const category of report.categories) allCategories.add(category)

  console.log(`\n${report.source}  →  ${report.graph}`)
  console.log(`  licence     ${report.licence}`)
  console.log(`  plugins     ${report.pluginCount}`)
  console.log(`  triples     ${report.tripleCount}`)
  console.log(`  elapsed     ${report.elapsedMs} ms`)
  if (report.rejected.length) {
    console.log(`  rejected    ${report.rejected.length}`)
    for (const item of report.rejected.slice(0, 10)) {
      console.log(`    ${item.name}: ${item.reason}`)
    }
  }
}

const scheme = await pipeline.writeCategoryScheme(allCategories)
console.log(`\ncategories  →  ${scheme.graph}  (${allCategories.size} concepts, ${scheme.tripleCount} triples)`)

if (skipEmbeddings) {
  console.log('\nSkipping embeddings (--skip-embeddings).')
  process.exit(0)
}

// Build the index from the harvested records rather than by reading embeddings
// back out of the store: the vectors live in the index, not in RDF.
const embeddings = EmbeddingService.fromConfig(config)
if (!(await embeddings.isAvailable())) {
  console.error(`\nEmbedding model ${config.get('embedding.model')} is not available; index not built.`)
  process.exit(1)
}

const index = await VectorIndex.open({
  dimension: config.get('embedding.dimension'),
  path: config.get('index.path'),
  model: config.get('embedding.model')
})

const all = reports.flatMap(report => report.plugins)
console.log(`\nEmbedding ${all.length} plugins with ${config.get('embedding.model')}...`)

let embedded = 0
const started = Date.now()
for (const { iri, plugin } of all) {
  const text = composeText(plugin)
  const vector = await embeddings.embed(text)
  index.add(iri, vector)
  embedded += 1
  if (embedded % 25 === 0) process.stdout.write(`  ${embedded}/${all.length}\r`)
}
index.compact()
await index.save()

console.log(`  ${embedded}/${all.length} embedded in ${((Date.now() - started) / 1000).toFixed(1)}s`)
console.log(`  index: ${index.size} vectors at ${index.path}`)
console.log(`  text hash of first: ${textHash(composeText(all[0].plugin))}`)
