#!/usr/bin/env node
import logger from 'loglevel'
import Config from '../src/Config.js'
import SPARQLClient from '../src/store/SPARQLClient.js'
import ShapeValidator from '../src/store/ShapeValidator.js'
import IngestPipeline from '../src/harvest/IngestPipeline.js'
import JigDawHarvester, { JigDawScreenshots } from '../src/harvest/JigDawHarvester.js'
import ImageStore from '../src/api/ImageStore.js'
import EmbeddingService from '../src/embeddings/EmbeddingService.js'
import VectorIndex from '../src/vectors/VectorIndex.js'
import { composeText } from '../src/embeddings/EmbeddingService.js'
import fs from 'fs'
import path from 'path'

/**
 * Harvest the JigDAW plugins into the catalogue, with a screenshot each.
 *
 * `bin/ingest.js --source jigdaw` already reads these plugins. This exists
 * because of the pictures, and it is a separate script for one reason: taking
 * them needs a browser, and a browser on the path of every ingest is a
 * dependency the rest of the catalogue should not have. Here it is the whole
 * point of the run.
 *
 * It does the same three things ingest.js does for a source — harvest, write
 * the graph, embed what it wrote — and differs only in where the depiction
 * comes from and that it is one source rather than four. Deliberately not a
 * flag on ingest.js: `--source jigdaw` means "re-harvest those triples", and
 * making it also mean "and possibly spend two minutes in Chrome" would make
 * the cheap operation unpredictable and the expensive one undiscoverable.
 *
 * Usage:
 *   node bin/harvest-jigdaw.js                     read the checkout, ship pictures
 *   node bin/harvest-jigdaw.js --no-shots          triples only, no browser
 *   node bin/harvest-jigdaw.js --require-shots     fail if any plugin has no picture
 *   node bin/harvest-jigdaw.js --skip-embeddings   triples and pictures, no index
 *   node bin/harvest-jigdaw.js --path DIR          a checkout somewhere else
 */

logger.setLevel('info')

const args = process.argv.slice(2)
const flag = name => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? null : args[index + 1]
}
const withShots = !args.includes('--no-shots')
const requireShots = args.includes('--require-shots')
const skipEmbeddings = args.includes('--skip-embeddings')
const skipValidation = args.includes('--skip-validation')

// `||` rather than `??`: compose passes an unset variable as an empty string,
// which `??` accepts as a value. See the note in bin/ingest.js.
const repoPath = flag('path') || process.env.JIGDAW_PATH || '/home/danny/github/jigdaw'

if (!fs.existsSync(repoPath)) {
  console.error(
    `No jigdaw checkout at ${repoPath}.\n` +
    '  Clone it there, or pass --path DIR / set JIGDAW_PATH.\n' +
    '  In Docker that path is inside the container and JIGDAW_PATH comes from\n' +
    '  docker-compose.yml, so changing either needs `docker compose up -d`.'
  )
  process.exit(1)
}

const config = Config.load()
const client = new SPARQLClient(config.get('storage.endpoint'))

// The site's own origin, from the same source bin/serve.js reads it, so the
// depiction IRIs written here are the ones this deployment serves. An IRI
// minted against the wrong origin is a picture that 404s on every page.
const origin = (process.env.SITE_ORIGIN || config.get('site.origin')).replace(/\/$/, '')

if (!(await client.isReachable())) {
  console.error(`SPARQL endpoint ${config.get('storage.endpoint.query')} is not reachable.`)
  process.exit(1)
}

const screenshots = withShots ? new JigDawScreenshots({ repoPath }) : null
if (withShots && !screenshots.canRender) {
  const how = 'CHROME_BIN is not set and there is no Chrome at /usr/bin/google-chrome'
  if (requireShots) {
    console.error(`--require-shots, and ${how}. Install Chrome or set CHROME_BIN.`)
    process.exit(1)
  }
  // Not fatal, and said plainly rather than left to be discovered: five of the
  // plugins have no shipped screenshot, so without a browser this run publishes
  // twenty pictures where it could have published twenty-five.
  console.log(`No browser available (${how}).`)
  console.log('  The plugins upstream ships a picture for will still have one; the rest will not.')
  console.log('  Re-run with --require-shots to treat that as a failure.')
}

// Content-addressed, so storing the same panel twice is one file, and the name
// is the hash rather than anything a plugin is named — `data/images`, which
// docker-compose already mounts and BackupBuilder already copies.
const imageStore = new ImageStore({ origin })

const harvester = new JigDawHarvester({ repoPath, screenshots, imageStore })

const validator = skipValidation ? null : await ShapeValidator.load()
const pipeline = new IngestPipeline(client, { validator })

let report
try {
  report = await pipeline.run(harvester)
} catch (error) {
  console.error(`\njigdaw  ✗  ${error.message}`)
  process.exit(1)
}

console.log(`\njigdaw  →  ${report.graph}`)
console.log(`  licence     ${report.licence}`)
console.log(`  plugins     ${report.pluginCount}`)
console.log(`  triples     ${report.tripleCount}`)
console.log(`  elapsed     ${report.elapsedMs} ms`)

const depicted = report.plugins.filter(({ plugin }) => plugin.image)
console.log(`  pictures    ${depicted.length} of ${report.pluginCount}`)
for (const note of harvester.notes ?? []) {
  if (note.includes('no screenshot')) console.log(`  note        ${note}`)
}

if (report.rejected.length) {
  console.log(`  rejected    ${report.rejected.length}`)
  for (const item of report.rejected.slice(0, 10)) console.log(`    ${item.name}: ${item.reason}`)
}

// --require-shots is checked after the write, deliberately. It is a statement
// about coverage ("every plugin in this source has a picture"), and coverage is
// only knowable once the plugins are known. The triples are wanted either way,
// so they are written; a coverage failure exits non-zero and says which
// plugins, which is what a CI step or a person needs to act on.
const missing = report.plugins
  .filter(({ plugin }) => !plugin.image)
  .map(({ plugin }) => plugin.name)
if (requireShots && missing.length > 0) {
  console.error(
    `\n--require-shots: ${missing.length} plugin(s) have no depiction: ${missing.join(', ')}\n` +
    '  The triples were written. Install Chrome and re-run to fill them in.'
  )
  process.exit(1)
}

// Vendor identity is a fold across sources and is minted separately
// (bin/mint-vendors.js) — the same separation, and the same reason, as in
// bin/ingest.js: writing it would mean rewriting a curated graph in the middle
// of a source ingest.
if (!report.categories.includes('midi') && report.pluginCount > 0) {
  console.log('\nNote: no category was contributed by this run; check the role mapping.')
}

if (skipEmbeddings) {
  console.log('\nSkipping embeddings (--skip-embeddings).')
  console.log('Run "node bin/ingest.js --only-new" to fill in any plugin without a vector.')
  process.exit(0)
}

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

console.log(`\nEmbedding ${report.pluginCount} plugin(s) with ${config.get('embedding.model')}...`)
for (const { iri, plugin } of report.plugins) {
  index.add(iri, await embeddings.embed(composeText(plugin)))
}
index.compact()
await index.save()
console.log(`  index: ${index.size} vectors at ${index.path}`)
