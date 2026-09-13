import { describe, it, expect, beforeAll } from 'vitest'
import Config from '../../src/Config.js'
import SPARQLClient from '../../src/store/SPARQLClient.js'
import VectorIndex from '../../src/vectors/VectorIndex.js'
import EmbeddingService from '../../src/embeddings/EmbeddingService.js'
import SearchService from '../../src/search/SearchService.js'
import { NAMESPACES } from '../../src/rdf/NamespaceManager.js'

/**
 * The comparison `/health` was not making.
 *
 * `healthProblems` decides what to say about a divergence; this decides whether
 * there *is* one, against the real catalogue and the real index. Both halves
 * matter and only one of them can be tested with plain values.
 */

let search

beforeAll(async () => {
  const config = await Config.load()
  const client = new SPARQLClient(config.get('storage.endpoint'))
  const index = await VectorIndex.open({
    dimension: config.get('embedding.dimension'),
    path: config.get('index.path'),
    model: config.get('embedding.model')
  })
  search = new SearchService({
    client,
    index,
    embeddings: EmbeddingService.fromConfig(config),
    origin: config.get('site.origin')
  })
  await search.loadDocuments()
}, 120000)

describe('catalogue against index', () => {
  it('loaded a catalogue worth comparing', () => {
    // Without this the next assertion passes by vacuum, which is the failure
    // mode of every test whose subject is "nothing is missing".
    expect(search.documents.size).toBeGreaterThan(100)
    expect(search.index.size).toBeGreaterThan(100)
  })

  it('finds nothing missing in a store that is consistent', () => {
    const missing = search.unindexed()
    expect(missing, `${missing.length} plugin(s) have no vector: ${missing.slice(0, 5).join(', ')}`)
      .toEqual([])
  })

  it('reports a plugin whose vector never arrived', () => {
    // The case that matters and that a healthy store cannot show. A submission
    // accepted while Ollama is down lands in the catalogue and not the index —
    // `takeUpNewPlugins` allows that on purpose — and the plugin is then
    // findable by name and invisible to semantic search.
    const orphan = `${NAMESPACES.pu}plugin/never-embedded-00000000`
    expect(search.index.has(orphan)).toBe(false)
    search.documents.set(orphan, { iri: orphan, name: 'Never Embedded' })
    try {
      expect(search.unindexed()).toEqual([orphan])
    } finally {
      search.documents.delete(orphan)
    }
    expect(search.unindexed()).toEqual([])
  })
})
