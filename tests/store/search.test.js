import { describe, it, expect, beforeAll } from 'vitest'
import Config from '../../src/Config.js'
import SPARQLClient from '../../src/store/SPARQLClient.js'
import VectorIndex from '../../src/vectors/VectorIndex.js'
import EmbeddingService from '../../src/embeddings/EmbeddingService.js'
import SearchService from '../../src/search/SearchService.js'

// Runs against the ingested catalogue. Requires `node bin/ingest.js` to have
// been run first.

const config = Config.load()
const client = new SPARQLClient(config.get('storage.endpoint'))
const embeddings = EmbeddingService.fromConfig(config)

let search
let corpusSize

beforeAll(async () => {
  if (!(await client.isReachable())) throw new Error('SPARQL endpoint unreachable')
  const index = await VectorIndex.open({
    dimension: config.get('embedding.dimension'),
    path: config.get('index.path'),
    model: config.get('embedding.model')
  })
  search = new SearchService({ client, index, embeddings })
  corpusSize = await search.loadDocuments()
  if (corpusSize === 0) {
    throw new Error('No plugins in the store. Run "node bin/ingest.js" first.')
  }
}, 60000)

describe('the ingested catalogue', () => {
  it('holds both seed sources', () => {
    // 50 downspout VST3 plugins and 36 flues LV2 bundles.
    expect(corpusSize).toBeGreaterThanOrEqual(80)
  })

  it('has no duplicate plugin IRIs', () => {
    const iris = [...search.documents.keys()]
    expect(new Set(iris).size).toBe(iris.length)
  })

  it('counts the same through SPARQL as through the loaded documents', async () => {
    expect(await search.count()).toBe(corpusSize)
  })

  it('exposes facets driven by the data', async () => {
    const facets = await search.facets()
    expect(facets.format.map(f => f.value)).toEqual(expect.arrayContaining(['VST3', 'LV2']))
    expect(facets.category.length).toBeGreaterThan(0)
    expect(facets.role.length).toBeGreaterThan(0)
  })
})

describe('lexical signal', () => {
  it('scores an exact name match at the top', () => {
    const doc = { name: 'Drift', vendor: 'danja', description: null, roles: [], categories: [], parameters: [] }
    expect(search.lexicalScore(['drift'], doc)).toBe(1)
  })

  it('scores a name token above a description token', () => {
    const named = { name: 'Reverb Machine', vendor: null, description: null, roles: [], categories: [], parameters: [] }
    const described = { name: 'Cathedral', vendor: null, description: 'a reverb', roles: [], categories: [], parameters: [] }
    expect(search.lexicalScore(['reverb'], named)).toBeGreaterThan(search.lexicalScore(['reverb'], described))
  })

  it('scores an unrelated query at zero', () => {
    const doc = { name: 'Drift', vendor: 'danja', description: 'midi modulator', roles: [], categories: [], parameters: [] }
    expect(search.lexicalScore(['xylophone'], doc)).toBe(0)
  })
})

describe('hybrid search over the real catalogue', () => {
  it('finds a plugin by its exact name', async () => {
    const { results } = await search.search('Drift')
    expect(results[0].name).toBe('Drift')
  }, 30000)

  it('answers a descriptive query with a transport-synced MIDI generator', async () => {
    // The catalogue holds many transport-synced MIDI generators, so this does
    // not name one: it asserts the top result is actually of that kind. Naming
    // a specific plugin would be testing the corpus, not the retriever.
    const { results } = await search.search('generate MIDI CC automation locked to host tempo')
    expect(results.length).toBeGreaterThan(0)
    const top = results[0]
    const text = `${top.name} ${top.description ?? ''} ${top.categories.join(' ')}`.toLowerCase()
    expect(/midi|tempo|transport|sync/.test(text)).toBe(true)
  }, 30000)

  it('excludes results that only clear the noise floor of the embedding model', async () => {
    // nomic-embed-text compresses cosine into roughly 0.45-0.70, so nonsense
    // still scores ~0.54 against everything. The threshold in preferences.js is
    // calibrated to that; without it every query returns a full page.
    const { results } = await search.search('warm analogue bus compressor')
    // The catalogue contains no compressor, so anything returned must at least
    // have matched lexically rather than on weak similarity alone.
    for (const r of results) {
      expect(r.signals.lexical > 0 || r.signals.vector >= 0.58).toBe(true)
    }
  }, 30000)

  it('applies a facet filter as a filter, not a score', async () => {
    const { results } = await search.search('plugin', { facets: { format: 'LV2' }, limit: 50 })
    expect(results.length).toBeGreaterThan(0)
    expect(results.every(r => r.formats.includes('LV2'))).toBe(true)
  }, 30000)

  it('composes a facet filter with a semantic query', async () => {
    const { results, signals } = await search.search('modulation', { facets: { format: 'VST3' }, limit: 20 })
    expect(results.every(r => r.formats.includes('VST3'))).toBe(true)
    expect(signals.filtered).toBeGreaterThan(0)
  }, 30000)

  it('reports both signals per result so ranking is explicable', async () => {
    const { results } = await search.search('reverb')
    expect(results[0].signals).toHaveProperty('lexical')
    expect(results[0].signals).toHaveProperty('vector')
  }, 30000)

  it('returns nothing rather than noise for a query matching nothing', async () => {
    const { results } = await search.search('zzzzqqqxyzzy')
    expect(results).toEqual([])
  }, 30000)

  it('browses by facet with no query text', async () => {
    const { results, total } = await search.browse({ facets: { category: 'effect' }, limit: 5 })
    expect(total).toBeGreaterThan(0)
    expect(results.length).toBeLessThanOrEqual(5)
  }, 30000)
})
