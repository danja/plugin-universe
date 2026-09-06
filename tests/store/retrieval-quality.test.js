import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import Config from '../../src/Config.js'
import EmbeddingService from '../../src/embeddings/EmbeddingService.js'
import VectorIndex from '../../src/vectors/VectorIndex.js'

/**
 * The query regression suite.
 *
 * docs/plan.md calls for this before any ranking work, so that "does search
 * feel better?" becomes a number. It measures recall@1 and recall@3 over a
 * fixed corpus and asserts a floor; changing a weight, a model or the composed
 * text view moves these numbers, and a regression is visible rather than
 * suspected.
 *
 * The floors are deliberately set at what vector search alone actually
 * achieves today, not at what would be nice. Raising them is the job of the
 * lexical and facet signals in Phase 1.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/corpus.json'), 'utf8'))
const queries = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/queries.json'), 'utf8'))

const config = Config.load()
const service = EmbeddingService.fromConfig(config)

let index
let dir
let results

beforeAll(async () => {
  if (!(await service.isAvailable())) {
    throw new Error(`Embedding model ${config.get('embedding.model')} is not available.`)
  }
  dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pu-quality-'))
  index = await VectorIndex.open({
    dimension: config.get('embedding.dimension'),
    path: path.join(dir, 'fixture.index'),
    model: config.get('embedding.model')
  })
  for (const plugin of corpus) {
    const { vector } = await service.embedPlugin(plugin)
    index.add(plugin.iri, vector)
  }

  results = []
  for (const { query, expect: expected } of queries) {
    const vector = await service.embed(query)
    const hits = index.search(vector, 3)
    const rank = hits.findIndex(h => h.iri === expected)
    results.push({ query, expected, rank, hits })
  }
}, 300000)

afterAll(async () => {
  if (dir) await fs.promises.rm(dir, { recursive: true, force: true })
})

describe('retrieval quality over the fixture corpus', () => {
  it('indexes the whole corpus', () => {
    expect(index.size).toBe(corpus.length)
  })

  it('reports recall@1 and recall@3', () => {
    const at1 = results.filter(r => r.rank === 0).length
    const at3 = results.filter(r => r.rank >= 0).length
    const pct = n => `${((n / results.length) * 100).toFixed(0)}%`

    // Printed so a change in retrieval quality is visible in test output, not
    // only in a pass/fail.
    console.log(`\n  vector-only retrieval over ${corpus.length} plugins, ${results.length} queries`)
    console.log(`    recall@1: ${at1}/${results.length} (${pct(at1)})`)
    console.log(`    recall@3: ${at3}/${results.length} (${pct(at3)})`)
    const missed = results.filter(r => r.rank !== 0)
    if (missed.length) {
      console.log('    not ranked first:')
      for (const m of missed) {
        const got = m.hits[0] ? `${m.hits[0].iri} (${m.hits[0].score.toFixed(3)})` : 'nothing'
        console.log(`      "${m.query}" -> ${got}, wanted ${m.expected}${m.rank > 0 ? ` at rank ${m.rank + 1}` : ' (not in top 3)'}`)
      }
    }

    expect(at1 + at3).toBeGreaterThan(0)
  })

  it('meets the recall@1 floor for vector-only retrieval', () => {
    const at1 = results.filter(r => r.rank === 0).length
    // Floor recorded from observed behaviour. Vector similarity alone is a
    // strong signal for descriptive queries and a weak one for queries whose
    // vocabulary does not overlap the description; the lexical and facet
    // signals in Phase 1 are what lift this.
    expect(at1 / results.length).toBeGreaterThanOrEqual(0.6)
  })

  it('meets the recall@3 floor', () => {
    const at3 = results.filter(r => r.rank >= 0).length
    expect(at3 / results.length).toBeGreaterThanOrEqual(0.8)
  })

  it('scores a confident match well above an unrelated one', () => {
    const confident = results.find(r => r.query.includes('brickwall limiter'))
    expect(confident.hits[0].score).toBeGreaterThan(confident.hits[2].score + 0.1)
  })
})
