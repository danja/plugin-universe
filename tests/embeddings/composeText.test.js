import { describe, it, expect } from 'vitest'
import { composeText, textView, textHash, EmbeddingError } from '../../src/embeddings/EmbeddingService.js'
import { NAMESPACES } from '../../src/rdf/NamespaceManager.js'

const trn = NAMESPACES.trn

/**
 * The composed text is what gets embedded, so a defect here is invisible: the
 * index builds, the search runs, and the results are quietly worse.
 *
 * Two shapes reach composeText — the harvest record and the SPARQL text view —
 * and they used to produce different text for the same plugin. The harvest
 * record's roles and formats are IRIs and its parameters are port objects, so
 * every vector in the index carried "http://purl.org/stuff/transmissions/..."
 * and ten copies of "[object Object]", while the lexical signal matched against
 * the clean view. These tests pin both shapes to the same output.
 */

const harvestRecord = {
  name: 'Bassops',
  vendor: 'danja',
  roles: [`${trn}AudioEffect`],
  formats: [`${trn}VST3`],
  categories: ['dynamics', 'effect'],
  description: 'Sidechain ducker with harmonic stereo synthesis.',
  tags: ['sidechain', 'bass'],
  parameters: [
    { symbol: 'duck_depth', name: 'Duck Depth' },
    { symbol: 'wet', name: 'Wet' }
  ]
}

const textViewRow = {
  name: 'Bassops',
  vendor: 'danja',
  roles: ['AudioEffect'],
  formats: ['VST3'],
  categories: ['dynamics', 'effect'],
  description: 'Sidechain ducker with harmonic stereo synthesis.',
  tags: ['sidechain', 'bass'],
  parameters: ['Duck Depth', 'Wet']
}

describe('composeText', () => {
  it('produces identical text from a harvest record and from the store', () => {
    expect(composeText(harvestRecord)).toBe(composeText(textViewRow))
    expect(textHash(composeText(harvestRecord))).toBe(textHash(composeText(textViewRow)))
  })

  it('embeds labels, never IRIs', () => {
    const text = composeText(harvestRecord)
    expect(text).toContain('AudioEffect')
    expect(text).toContain('VST3')
    expect(text).not.toContain('http://')
  })

  it('embeds parameter names, never stringified objects', () => {
    const text = composeText(harvestRecord)
    expect(text).toContain('Duck Depth')
    expect(text).not.toContain('[object Object]')
  })

  it('falls back to a port symbol when it has no name', () => {
    const view = textView({ ...harvestRecord, parameters: [{ symbol: 'duck_depth' }] })
    expect(view.parameters).toEqual(['duck_depth'])
  })

  it('refuses a parameter it cannot name rather than stringifying it', () => {
    expect(() => composeText({ ...harvestRecord, parameters: [{ minimum: 0 }] }))
      .toThrow(EmbeddingError)
  })

  it('includes categories and tags, which carry most of a registry entry', () => {
    const text = composeText(harvestRecord)
    expect(text).toContain('dynamics')
    expect(text).toContain('sidechain')
  })

  it('is deterministic, because the hash decides whether an embedding is stale', () => {
    expect(composeText(harvestRecord)).toBe(composeText(harvestRecord))
  })

  it('needs a name', () => {
    expect(() => composeText({ vendor: 'x' })).toThrow(EmbeddingError)
  })

  it('omits absent fields rather than emitting empty separators', () => {
    expect(composeText({ name: 'Bare' })).toBe('Bare')
  })
})
