import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import Config from '../../src/Config.js'
import EmbeddingService, { composeText, textHash } from '../../src/embeddings/EmbeddingService.js'
import VectorIndex from '../../src/vectors/VectorIndex.js'

// Live test against the configured Ollama instance. Not mocked: the point is
// that the embedding pipeline works against a real model at the real dimension.

const config = Config.load()
const service = EmbeddingService.fromConfig(config)

let dir
let indexPath

beforeAll(async () => {
  if (!(await service.isAvailable())) {
    throw new Error(
      `Embedding model ${config.get('embedding.model')} is not available at ` +
      `${config.get('embedding.baseUrl')}. These tests require it.`
    )
  }
  dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pu-e2e-'))
  indexPath = path.join(dir, 'plugins.index')
})

afterAll(async () => {
  if (dir) await fs.promises.rm(dir, { recursive: true, force: true })
})

describe('composeText', () => {
  it('builds the retrieval view from the graph, not from a description field', () => {
    const text = composeText({
      name: 'Drift',
      vendor: 'danja',
      roles: ['MIDI Generator', 'Controller'],
      formats: ['VST3'],
      description: 'Four-lane transport-synchronised MIDI CC modulator.',
      tags: ['modulation', 'lfo'],
      parameters: ['Rate', 'Depth']
    })
    expect(text).toContain('Drift')
    expect(text).toContain('by danja')
    expect(text).toContain('MIDI Generator')
    expect(text).toContain('Parameters: Rate, Depth')
  })

  it('is deterministic, so the staleness hash is meaningful', () => {
    const plugin = { name: 'Drift', vendor: 'danja', tags: ['a', 'b'] }
    expect(textHash(composeText(plugin))).toBe(textHash(composeText({ ...plugin })))
  })

  it('refuses a plugin with no name rather than embedding nothing', () => {
    expect(() => composeText({ vendor: 'x' })).toThrow()
  })
})

describe('embedding pipeline against live Ollama', () => {
  it('produces a vector of exactly the configured dimension', async () => {
    const result = await service.embedPlugin({
      name: 'Drift',
      vendor: 'danja',
      description: 'Four-lane transport-synchronised MIDI CC modulator.'
    })
    expect(result.vector).toHaveLength(config.get('embedding.dimension'))
    expect(result.model).toBe(config.get('embedding.model'))
    expect(result.hash).toHaveLength(16)
  }, 60000)

  it('ranks a semantically related query above an unrelated one', async () => {
    const plugins = [
      {
        iri: 'urn:test:compressor',
        name: 'Glue Bus Compressor',
        vendor: 'test',
        roles: ['Audio Effect'],
        description: 'Warm analogue-modelled bus compressor for glueing a mix together.'
      },
      {
        iri: 'urn:test:reverb',
        name: 'Cathedral',
        vendor: 'test',
        roles: ['Audio Effect'],
        description: 'Large algorithmic reverb with long decay times and modulated tails.'
      },
      {
        iri: 'urn:test:midi',
        name: 'Drift',
        vendor: 'test',
        roles: ['MIDI Generator'],
        description: 'Transport-synchronised MIDI CC modulator with four independent lanes.'
      }
    ]

    const index = await VectorIndex.open({
      dimension: config.get('embedding.dimension'),
      path: indexPath,
      model: config.get('embedding.model')
    })

    for (const plugin of plugins) {
      const { vector } = await service.embedPlugin(plugin)
      index.add(plugin.iri, vector)
    }
    expect(index.size).toBe(3)

    const query = await service.embed('warm analogue bus compressor for mix glue')
    const hits = index.search(query, 3)
    expect(hits[0].iri).toBe('urn:test:compressor')
    // A confident match is well clear of the field, which is what makes a
    // similarity threshold meaningful.
    expect(hits[0].score).toBeGreaterThan(hits[1].score + 0.2)

    // Retrieval quality across a range of queries is measured by the
    // regression suite in retrieval-quality.test.js, not asserted here.

    // Persist, reload, and confirm retrieval survives a restart.
    await index.save()
    const reloaded = await VectorIndex.load({
      dimension: config.get('embedding.dimension'),
      path: indexPath,
      model: config.get('embedding.model')
    })
    expect(reloaded.size).toBe(3)
    expect(reloaded.search(query, 1)[0].iri).toBe('urn:test:compressor')
  }, 120000)
})
