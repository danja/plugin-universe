import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import Config from '../../src/Config.js'
import { RETRIEVAL_CONFIG } from '../../config/preferences.js'
import EmbeddingService from '../../src/embeddings/EmbeddingService.js'
import VectorIndex from '../../src/vectors/VectorIndex.js'
import { fuse } from '../../src/search/SearchService.js'
import LexicalIndex, { tokenise } from '../../src/search/LexicalIndex.js'

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
let hybridResults

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
  hybridResults = []
  const lexical = new LexicalIndex()
  const docs = corpus.map(p => ({
    iri: p.iri,
    name: p.name,
    vendor: p.vendor,
    description: p.description,
    roles: p.roles ?? [],
    categories: p.tags ?? [],
    parameters: p.parameters ?? []
  }))

  lexical.build(docs)

  for (const { query, expect: expected } of queries) {
    const vector = await service.embed(query)

    // Vector only, as measured in Phase 0.
    const hits = index.search(vector, 3)
    results.push({ query, expected, rank: hits.findIndex(h => h.iri === expected), hits })

    // Hybrid, using the service's own scoring and fusion rather than a copy
    // of it, so this measures what search() actually does.
    const vectorScores = new Map(
      index.search(vector, RETRIEVAL_CONFIG.candidateLimit, { minScore: RETRIEVAL_CONFIG.minSimilarity })
        .map(h => [h.iri, h.score])
    )
    const queryTokens = tokenise(query)
    const fused = docs
      .map(doc => {
        const lex = lexical.score(queryTokens, doc)
        const vec = vectorScores.get(doc.iri) ?? 0
        return { iri: doc.iri, score: fuse(lex, vec), lexical: lex, vector: vec }
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
    hybridResults.push({ query, expected, rank: fused.findIndex(h => h.iri === expected), hits: fused.slice(0, 3) })
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

describe('hybrid retrieval lifts the vector-only baseline', () => {
  it('reports hybrid recall@1 and recall@3', () => {
    const at1 = hybridResults.filter(r => r.rank === 0).length
    const at3 = hybridResults.filter(r => r.rank >= 0 && r.rank < 3).length
    const vectorAt1 = results.filter(r => r.rank === 0).length
    const pct = n => `${((n / hybridResults.length) * 100).toFixed(0)}%`

    console.log(`\n  hybrid (lexical + vector) over ${corpus.length} plugins, ${hybridResults.length} queries`)
    console.log(`    recall@1: ${at1}/${hybridResults.length} (${pct(at1)})   [vector-only was ${vectorAt1}/${results.length}]`)
    console.log(`    recall@3: ${at3}/${hybridResults.length} (${pct(at3)})`)
    const missed = hybridResults.filter(r => r.rank !== 0)
    if (missed.length) {
      console.log('    not ranked first:')
      for (const m of missed) {
        console.log(`      "${m.query}" -> wanted ${m.expected}${m.rank > 0 ? `, got it at rank ${m.rank + 1}` : ', not in top 3'}`)
      }
    }
    expect(at1).toBeGreaterThan(0)
  })

  it('is at least as good as vector alone at rank 1', () => {
    const hybridAt1 = hybridResults.filter(r => r.rank === 0).length
    const vectorAt1 = results.filter(r => r.rank === 0).length
    expect(hybridAt1).toBeGreaterThanOrEqual(vectorAt1)
  })

  it('meets the hybrid recall@1 floor', () => {
    const at1 = hybridResults.filter(r => r.rank === 0).length
    // Raised from the vector-only floor of 0.6. Lower this only with a reason.
    expect(at1 / hybridResults.length).toBeGreaterThanOrEqual(0.85)
  })

  it('improves mean reciprocal rank, the metric that weighs both effects', () => {
    // Recall@1 and recall@3 pull in opposite directions here: the lexical
    // signal lifts the right answer to first place more often, but where a
    // fixture's expected answer shares no words with the query it can slip a
    // couple of places. MRR is the standard single number that accounts for
    // both, and it is what should not regress.
    const mrr = rows => rows.reduce((sum, r) => sum + (r.rank >= 0 ? 1 / (r.rank + 1) : 0), 0) / rows.length
    const vectorMrr = mrr(results)
    const hybridMrr = mrr(hybridResults)
    console.log(`\n  MRR: vector-only ${vectorMrr.toFixed(3)} -> hybrid ${hybridMrr.toFixed(3)}`)
    expect(hybridMrr).toBeGreaterThanOrEqual(vectorMrr)
  })

  it('does not collapse recall@3 while chasing recall@1', () => {
    // A guard rather than a target. One position of slippage is the honest
    // cost of the lexical signal on queries whose expected answer shares no
    // vocabulary with them; more than that is a regression to investigate.
    const hybridAt3 = hybridResults.filter(r => r.rank >= 0 && r.rank < 3).length
    const vectorAt3 = results.filter(r => r.rank >= 0).length
    expect(hybridAt3).toBeGreaterThanOrEqual(vectorAt3 - 1)
  })

  it('recovers the query that vector-only retrieval could not rank', () => {
    // "generate MIDI CC automation locked to host tempo" ranked the MIDI
    // modulator third on vector similarity alone; the lexical signal on "midi"
    // is what fixes it. This is the concrete case the hybrid design exists for.
    const midi = hybridResults.find(r => r.query.includes('MIDI CC automation'))
    expect(midi.rank).toBe(0)
  })
})
