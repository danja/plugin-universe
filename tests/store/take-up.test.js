import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import Config from '../../src/Config.js'
import SPARQLClient from '../../src/store/SPARQLClient.js'
import GraphRegistry from '../../src/store/GraphRegistry.js'
import SearchService from '../../src/search/SearchService.js'
import VectorIndex from '../../src/vectors/VectorIndex.js'
import EmbeddingService from '../../src/embeddings/EmbeddingService.js'
import { iri, literal, typedLiteral, insertDataQuery } from '../../src/store/SPARQLHelper.js'
import { NAMESPACES } from '../../src/rdf/NamespaceManager.js'

/**
 * A plugin accepted after the app started, becoming findable without a restart.
 *
 * This is the gap an accepted submission falls into: `documents` is read once
 * at startup, the lexical index is built from it, and the vector index is a
 * file on disk. A plugin written into a contributor's graph is dereferenceable
 * at its own IRI immediately and absent from every search until something takes
 * it up — which is the shape of defect this project has shipped three times,
 * data collected and never shown.
 *
 * Runs against the live store and a live embedding service, because the thing
 * being tested is whether three separate stores of state end up agreeing.
 */

const pu = NAMESPACES.pu
const config = Config.load()
const client = new SPARQLClient(config.get('storage.endpoint'))

const registry = new GraphRegistry(client, { metadataGraph: `${pu}test/take-up-graphs` })
const GRAPH = GraphRegistry.graphIri('user', 'test-take-up-facts')
const PLUGIN = `${pu}plugin/test-take-up-subject`
const NAME = 'Zarquon Spectral Freezer'

const SCRATCH = `/tmp/pu-take-up-${process.pid}.index`

let search
let index

async function cleanup () {
  for (const graph of [GRAPH, `${pu}test/take-up-graphs`]) {
    await client.update(`DROP SILENT GRAPH ${iri(graph)}`)
  }
  for (const suffix of ['', '.json']) {
    await fs.promises.rm(`${SCRATCH}${suffix}`, { force: true })
  }
}

beforeAll(async () => {
  if (!(await client.isReachable())) {
    throw new Error('These tests require a live store; start it with "npm run store:up".')
  }
  await cleanup()

  // A scratch copy of the real index, so the test never writes to the deployed
  // one — and so it measures what it means to. Opened empty, takeUpNewPlugins
  // would find every plugin in the store unembedded and spend five minutes
  // embedding the whole catalogue, which tests a bulk rebuild rather than the
  // one-new-plugin path this exists for.
  const live = config.get('index.path')
  for (const suffix of ['', '.json']) {
    await fs.promises.copyFile(`${live}${suffix}`, `${SCRATCH}${suffix}`)
  }
  index = await VectorIndex.open({
    path: SCRATCH,
    dimension: config.get('embedding.dimension'),
    model: config.get('embedding.model')
  })
  search = new SearchService({
    client,
    index,
    embeddings: EmbeddingService.fromConfig(config),
    registry
  })
  await search.loadDocuments()
}, 180000)

afterAll(cleanup)

describe('a plugin that arrives after startup', () => {
  it('is absent from search before anything takes it up', async () => {
    const before = await search.search(NAME, { limit: 5 })
    expect(before.results.map(r => r.name)).not.toContain(NAME)
    expect(search.documents.has(PLUGIN)).toBe(false)
  })

  it('becomes findable once taken up, with no restart', async () => {
    await registry.register({
      kind: 'user',
      id: 'test-take-up-facts',
      licence: 'CC0-1.0',
      derivedFrom: `${pu}person/test-take-up`,
      comment: 'Test contributor facts.'
    })
    await client.update(insertDataQuery(GRAPH, [
      `${iri(PLUGIN)} ${iri(NAMESPACES.rdf + 'type')} ${iri(NAMESPACES.trn + 'PluginProfile')} .`,
      `${iri(PLUGIN)} ${iri(NAMESPACES.rdfs + 'label')} ${literal(NAME)} .`,
      `${iri(PLUGIN)} ${iri(NAMESPACES.rdfs + 'comment')} ${literal('Freezes a spectrum and smears it across time.')} .`,
      `${iri(PLUGIN)} ${iri(NAMESPACES.trn + 'vendor')} ${literal('Zarquon Audio')} .`,
      `${iri(PLUGIN)} ${iri(NAMESPACES.trn + 'format')} ${iri(NAMESPACES.trn + 'VST3')} .`,
      `${iri(PLUGIN)} ${iri(NAMESPACES.dcterms + 'created')} ${typedLiteral(new Date())} .`
    ]))

    const taken = await search.takeUpNewPlugins()
    expect(taken.error, `indexing failed: ${taken.error}`).toBeUndefined()
    expect(taken.embedded).toBeGreaterThan(0)

    // All three stores of state must agree, and they are three different
    // mechanisms: a map read from SPARQL, an IDF index built from it, and a
    // FAISS file.
    expect(search.documents.has(PLUGIN), 'not in documents').toBe(true)
    expect(index.positionByIri.has(PLUGIN), 'not in the vector index').toBe(true)

    const found = await search.search(NAME, { limit: 5 })
    expect(found.results.map(r => r.iri), 'not found by name').toContain(PLUGIN)
  }, 180000)

  it('is found by what it does, not only by its name', async () => {
    // The point of embedding it rather than only listing it.
    const found = await search.search('freeze a spectrum and smear it', { limit: 10 })
    expect(found.results.map(r => r.iri)).toContain(PLUGIN)
  }, 120000)

  it('takes up nothing when there is nothing new, and says so', async () => {
    const again = await search.takeUpNewPlugins()
    expect(again.embedded).toBe(0)
    expect(again.gained).toBe(0)
  }, 120000)
})
