#!/usr/bin/env node
import fs from 'fs'
import path from 'path'
import logger from 'loglevel'
import Config from '../src/Config.js'
import SPARQLClient from '../src/store/SPARQLClient.js'
import IngestPipeline from '../src/harvest/IngestPipeline.js'
import DownspoutHarvester from '../src/harvest/DownspoutHarvester.js'
import Lv2Harvester from '../src/harvest/Lv2Harvester.js'
import OpenAudioStackHarvester from '../src/harvest/OpenAudioStackHarvester.js'
import GitHubClient from '../src/harvest/GitHubClient.js'
import GitHubHarvester from '../src/harvest/GitHubHarvester.js'
import { FREE } from '../src/harvest/Licensing.js'
import ShapeValidator from '../src/store/ShapeValidator.js'
import EmbeddingService from '../src/embeddings/EmbeddingService.js'
import VectorIndex from '../src/vectors/VectorIndex.js'
import SearchService from '../src/search/SearchService.js'
import { composeText, textHash } from '../src/embeddings/EmbeddingService.js'

/**
 * Harvest sources, write them to the store, and build the vector index.
 *
 * Sources are configured here rather than discovered: adding one means adding
 * its licence and its provenance deliberately, which is the point (see
 * docs/resources.md §4). GitHub is the one exception, and only in form — its
 * repositories come from a candidate file a person has reviewed, which is the
 * same decision written down somewhere editable.
 *
 * Usage:
 *   node bin/ingest.js [--skip-embeddings] [--skip-validation] [--source <id>]
 *   node bin/ingest.js --github data/curation/github-candidates.json
 *   node bin/ingest.js --only-new        embed just what has no vector yet
 *
 * With --github the GitHub repositories are harvested and nothing else; without
 * it, the configured sources are harvested and GitHub is not touched.
 */

logger.setLevel('info')

const args = process.argv.slice(2)
const flag = name => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? null : args[index + 1]
}
const skipEmbeddings = args.includes('--skip-embeddings')
const onlyNew = args.includes('--only-new')
const onlySource = flag('source')
const githubFile = flag('github')

const config = Config.load()
const client = new SPARQLClient(config.get('storage.endpoint'))

/**
 * GitHub repositories come from a reviewed candidate file, never from a live
 * search. `bin/discover.js` writes that file; a person decides what is in it.
 * Only rows marked `include` are harvested, and each repository gets its own
 * graph carrying its own licence.
 */
async function githubHarvesters (file) {
  if (!fs.existsSync(file)) {
    console.error(`No candidate file at ${file}. Run "node bin/discover.js" and review what it writes.`)
    process.exit(1)
  }
  const { candidates } = JSON.parse(await fs.promises.readFile(file, 'utf8'))
  const github = GitHubClient.fromEnvironment({
    cacheDir: path.join(Config.projectRoot, 'data/cache/github')
  })
  if (!github.authenticated) {
    console.error('No GITHUB_TOKEN in .env; 60 requests an hour is not enough to harvest. See .env.example.')
    process.exit(1)
  }
  const selected = candidates.filter(row => row.include)
  console.log(`${selected.length} of ${candidates.length} repositories marked include in ${file}\n`)
  return selected.map(row => new GitHubHarvester({
    owner: row.owner,
    repo: row.repo,
    licence: row.licence,
    client: github
  }))
}

/**
 * The configured sources.
 *
 * Two of them read a git checkout from the local filesystem, which is right on
 * a development machine and absent on a server. A missing checkout is reported
 * and skipped rather than aborting the run: the remaining source is 559 plugins
 * and there is no sense in having none of them because two repositories are not
 * cloned. It is announced loudly, though — a catalogue quietly missing 86
 * plugins is exactly the kind of gap nobody notices.
 *
 * Set DOWNSPOUT_PATH and FLUES_PATH, or bind-mount the checkouts, to include
 * them. See docs/deployment.md.
 */
function localHarvesters () {
  // `||` rather than `??`: compose passes an unset variable as an empty
  // string, which `??` accepts as a value. See the note in bin/serve.js.
  const downspoutPath = process.env.DOWNSPOUT_PATH || '/home/danny/github/downspout'
  const fluesPath = process.env.FLUES_PATH || '/home/danny/github/flues'

  const candidates = [
    {
      path: downspoutPath,
      env: 'DOWNSPOUT_PATH',
      build: () => new DownspoutHarvester({ repoPath: downspoutPath })
    },
    {
      path: fluesPath,
      env: 'FLUES_PATH',
      build: () => new Lv2Harvester({
        repoPath: fluesPath,
        id: 'flues',
        // Verified per repository, not assumed: flues' bundles carry
        // doap:license <https://opensource.org/licenses/MIT>.
        licence: 'MIT',
        derivedFrom: 'https://github.com/danja/flues',
        vendor: 'Danny Ayers',
        // The user's own repository, MIT and given away.
        pricing: FREE
      })
    }
  ]

  const harvesters = []
  for (const candidate of candidates) {
    if (fs.existsSync(candidate.path)) {
      harvesters.push(candidate.build())
    } else {
      console.log(
        `SKIPPING a source: no checkout at ${candidate.path}. ` +
        `Set ${candidate.env} or bind-mount it to include it.`
      )
    }
  }

  // Needs no local checkout: it fetches the registry over HTTP.
  harvesters.push(new OpenAudioStackHarvester({
    registryUrl: config.get('sources.openAudioStack.registryUrl'),
    cachePath: config.get('sources.openAudioStack.cachePath')
  }))

  if (harvesters.length < candidates.length + 1) console.log('')
  return harvesters
}

const harvesters = (githubFile ? await githubHarvesters(githubFile) : localHarvesters())
  .filter(h => !onlySource || h.id === onlySource)

if (harvesters.length === 0) {
  console.error(`No harvester matches --source ${onlySource}`)
  process.exit(1)
}

if (!(await client.isReachable())) {
  console.error(`SPARQL endpoint ${config.get('storage.endpoint.query')} is not reachable.`)
  process.exit(1)
}

// Shapes run before anything is written (docs/architecture.md §4). Skippable
// for a fast re-run, but not by default: an ingest that writes malformed data
// is cheap to do and expensive to notice.
const validator = args.includes('--skip-validation') ? null : await ShapeValidator.load()

const pipeline = new IngestPipeline(client, { validator })
const reports = []
const failures = []

// A sweep over many repositories must not lose the ones that worked because one
// of them did not. A run over the configured sources is a different matter:
// three of them, each expected to succeed, so a failure there is worth stopping
// for rather than logging past.
const continueOnError = harvesters.length > 3

for (const harvester of harvesters) {
  let report
  try {
    report = await pipeline.run(harvester)
  } catch (error) {
    if (!continueOnError) throw error
    failures.push({ source: harvester.id, reason: error.message })
    console.log(`\n${harvester.id}  ✗  ${error.message}`)
    continue
  }
  reports.push(report)

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
  // Things the harvester could not assert but should not swallow — a truncated
  // git tree, release assets it declined to attribute.
  for (const note of harvester.notes ?? []) console.log(`  note        ${note}`)
}

// Rebuilt from the store, not from this run: writing the scheme drops and
// reloads its graph, so a partial ingest would otherwise delete the concepts
// every other source contributes.
const storedCategories = await pipeline.storedCategories()
const scheme = await pipeline.writeCategoryScheme(storedCategories)
console.log(`\ncategories  →  ${scheme.graph}  (${storedCategories.length} concepts, ${scheme.tripleCount} triples)`)

// The alignment to AUFX-O and schema.org. Assertions of this project about
// other people's IRIs, so CC0 like the rest of the catalogue — it maps to those
// vocabularies rather than reproducing them.
const alignment = await pipeline.writeTurtleFile('vocabs/alignment.ttl', {
  kind: 'alignment',
  id: 'vocabularies',
  licence: 'CC0-1.0',
  derivedFrom: `${config.get('baseUri')}alignment`,
  comment: 'skos:closeMatch mappings from trn:, lv2: and pu: to AUFX-O and schema.org'
})
console.log(`alignment   →  ${alignment.graph}  (${alignment.tripleCount} triples)`)

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

// Only what this run harvested. Adding to the index rather than rebuilding it
// is what makes harvesting one more source affordable: re-embedding the whole
// catalogue is three quarters of an hour of CPU inference.
const harvested = reports.flatMap(report => report.plugins)

/**
 * Plugins in the store that the index has no vector for.
 *
 * Read from the store, not from this run's reports. That distinction is the
 * whole point: `--github` harvests repositories *instead of* the configured
 * sources, so a run without it never opens those graphs — and an --only-new
 * that considered only what it harvested would report "nothing to embed" while
 * a plugin in a graph it did not touch sat there without a vector. Which is
 * exactly what happened.
 *
 * The text view is the same shape composeText produces identical output for,
 * pinned by tests/embeddings/composeText.test.js, so a vector built here is
 * interchangeable with one built from a harvest record.
 */
async function unembedded () {
  const search = new SearchService({ client, index, embeddings })
  const total = await search.loadDocuments()
  const missing = [...search.documents.values()]
    .filter(doc => !index.positionByIri.has(doc.iri))
    .map(doc => ({ iri: doc.iri, plugin: doc }))
  console.log(`\n${total} plugins in the store, ${missing.length} without a vector.`)
  return missing
}

// --only-new compares IRIs, not content. A plugin whose description changed
// keeps its stale vector, because the index records no text hash to compare
// against; a full run is still the way to pick that up. Said plainly because a
// staleness check that silently misses staleness is worse than none.
const all = onlyNew ? await unembedded() : harvested

if (all.length === 0) {
  console.log(`Nothing to embed${onlyNew ? ' — every plugin in the store has a vector' : ''}.`)
  process.exit(failures.length > 0 ? 1 : 0)
}
console.log(`\nEmbedding ${all.length} plugins with ${config.get('embedding.model')}...`)

// Saved periodically as well as at the end. A full rebuild is three quarters
// of an hour of CPU inference, and losing all of it to an interrupted run once
// was enough.
const CHECKPOINT_EVERY = 100

let embedded = 0
const started = Date.now()
for (const { iri, plugin } of all) {
  const text = composeText(plugin)
  const vector = await embeddings.embed(text)
  index.add(iri, vector)
  embedded += 1
  if (embedded % 25 === 0) {
    const rate = (Date.now() - started) / embedded
    const remaining = ((all.length - embedded) * rate / 1000).toFixed(0)
    process.stdout.write(`  ${embedded}/${all.length}  ~${remaining}s remaining   \r`)
  }
  if (embedded % CHECKPOINT_EVERY === 0) await index.save()
}
index.compact()
await index.save()

console.log(`  ${embedded}/${all.length} embedded in ${((Date.now() - started) / 1000).toFixed(1)}s`)
console.log(`  index: ${index.size} vectors at ${index.path}`)
console.log(`  text hash of first: ${textHash(composeText(all[0].plugin))}`)

if (failures.length > 0) {
  console.log(`\n${failures.length} source(s) failed:`)
  for (const failure of failures) console.log(`  ${failure.source}: ${failure.reason}`)
  process.exit(1)
}
