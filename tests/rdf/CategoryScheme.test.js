import { describe, it, expect, beforeAll } from 'vitest'
import CategoryScheme from '../../src/rdf/CategoryScheme.js'
import { NAMESPACES } from '../../src/rdf/NamespaceManager.js'

/**
 * The category taxonomy, read from `vocabs/categories.ttl`.
 *
 * It used to be an object literal inside the serialiser holding parent links
 * and nothing else, which is why the scheme in the store had four predicates
 * and could not say what a category meant, what else it is called, or what it
 * corresponds to in LV2. These assertions are mostly about the things a bare
 * hierarchy could not go wrong at, because it could not express them.
 */

const PREFIX = `${NAMESPACES.pu}category/`
let scheme

beforeAll(async () => {
  scheme = await CategoryScheme.load('vocabs/categories.ttl')
})

describe('the file', () => {
  it('defines the concepts the catalogue uses', () => {
    expect(scheme.concepts.size).toBeGreaterThanOrEqual(28)
  })

  it('gives every concept a definition', () => {
    // The point of writing the taxonomy down. A category assigned by mapping
    // from a vendor tag is only reviewable if somebody said what the target
    // means.
    const undefined_ = [...scheme.concepts.values()].filter(c => !c.definition).map(c => c.slug)
    expect(undefined_, `no definition: ${undefined_.join(', ')}`).toEqual([])
  })

  it('gives every concept something else to call it', () => {
    const bare = [...scheme.concepts.values()].filter(c => c.altLabels.length === 0).map(c => c.slug)
    expect(bare, `no alternative labels: ${bare.join(', ')}`).toEqual([])
  })

  it('never repeats the preferred label as an alternative one', () => {
    for (const concept of scheme.concepts.values()) {
      expect(concept.altLabels, concept.slug).not.toContain(concept.prefLabel)
    }
  })

  it('names only parents it defines', () => {
    // A dangling skos:broader only shows up when something walks the hierarchy.
    for (const concept of scheme.concepts.values()) {
      if (concept.broader) expect(scheme.get(concept.broader), `${concept.slug} → ${concept.broader}`).toBeTruthy()
    }
  })

  it('names only related concepts it defines', () => {
    for (const concept of scheme.concepts.values()) {
      for (const related of concept.related) {
        expect(scheme.get(related.slice(PREFIX.length)), `${concept.slug} related ${related}`).toBeTruthy()
      }
    }
  })

  it('has no cycle in the hierarchy', () => {
    for (const concept of scheme.concepts.values()) {
      const seen = new Set([concept.slug])
      let parent = concept.broader
      while (parent) {
        expect(seen.has(parent), `cycle through ${concept.slug}`).toBe(false)
        seen.add(parent)
        parent = scheme.get(parent)?.broader ?? null
      }
    }
  })

  it('points every alignment outside this scheme', () => {
    // closeMatch means "the same idea in another vocabulary". Within the
    // scheme the relation wanted is broader, narrower or related.
    for (const concept of scheme.concepts.values()) {
      for (const match of concept.closeMatches) {
        expect(match.startsWith(PREFIX), `${concept.slug} closeMatch ${match}`).toBe(false)
      }
    }
  })

  it('aligns to LV2 classes that exist', () => {
    // Verified against the LV2 plugins installed on the development machine.
    // `lv2:EffectPlugin` is deliberately absent: it appears in bundles in the
    // wild and was not in the set that could be confirmed, so `effect` has no
    // LV2 match rather than a guessed one.
    const attested = new Set([
      'AllpassPlugin', 'AmplifierPlugin', 'AnalyserPlugin', 'BandpassPlugin', 'ChorusPlugin',
      'CombPlugin', 'CompressorPlugin', 'ConstantPlugin', 'ConverterPlugin', 'DelayPlugin',
      'DistortionPlugin', 'DynamicsPlugin', 'EnvelopePlugin', 'EQPlugin', 'ExpanderPlugin',
      'FilterPlugin', 'FlangerPlugin', 'FunctionPlugin', 'GatePlugin', 'GeneratorPlugin',
      'HighpassPlugin', 'InstrumentPlugin', 'LimiterPlugin', 'LowpassPlugin', 'MIDIPlugin',
      'MixerPlugin', 'ModulatorPlugin', 'MultiEQPlugin', 'OscillatorPlugin', 'ParaEQPlugin',
      'PhaserPlugin', 'PitchPlugin', 'ReverbPlugin', 'SimulatorPlugin', 'SpatialPlugin',
      'SpectralPlugin', 'UtilityPlugin', 'WaveshaperPlugin'
    ])
    const lv2 = NAMESPACES.lv2
    for (const concept of scheme.concepts.values()) {
      for (const match of concept.closeMatches.filter(m => m.startsWith(lv2))) {
        expect(attested.has(match.slice(lv2.length)), `${concept.slug} → ${match}`).toBe(true)
      }
    }
    expect(scheme.get('effect').closeMatches).toEqual([])
  })

  it('does not call an amp an lv2:AmplifierPlugin', () => {
    // The false friend the scope note is there for: LV2's AmplifierPlugin is a
    // gain stage, not a guitar amp.
    expect(scheme.get('amp').closeMatches).not.toContain(`${NAMESPACES.lv2}AmplifierPlugin`)
    expect(scheme.get('amp').scopeNote).toMatch(/gain stage/)
  })
})

describe('the triples it produces', () => {
  it('closes the set over broader, so no parent is referenced undeclared', () => {
    const triples = scheme.triples(['compressor'])
    // compressor → dynamics → effect, all three declared.
    for (const slug of ['compressor', 'dynamics', 'effect']) {
      expect(triples.some(t => t.includes(`<${PREFIX}${slug}>`) && t.includes('#Concept')), slug).toBe(true)
    }
  })

  it('asserts narrower as well as broader, because nothing in the store infers', () => {
    const triples = scheme.triples(['compressor'])
    expect(triples).toContain(`<${PREFIX}dynamics> <${NAMESPACES.skos}narrower> <${PREFIX}compressor> .`)
  })

  it('marks a parentless concept as a top concept', () => {
    const triples = scheme.triples(['effect'])
    expect(triples.some(t => t.includes('topConceptOf'))).toBe(true)
    expect(triples.some(t => t.includes('hasTopConcept'))).toBe(true)
  })

  it('omits a related concept that is not in the emitted set', () => {
    // Otherwise the scheme points at a concept it never declares.
    const triples = scheme.triples(['reverb'])
    expect(triples.some(t => t.includes(`<${NAMESPACES.skos}related>`))).toBe(false)
  })

  it('writes a label and nothing else for a category the file does not describe', () => {
    const triples = scheme.triples(['unheard-of'])
    expect(triples).toContain(`<${PREFIX}unheard-of> <${NAMESPACES.skos}prefLabel> "unheard-of" .`)
    expect(triples.filter(t => t.includes('unheard-of') && t.includes('definition'))).toEqual([])
  })

  it('reports what it could not describe rather than dropping it', () => {
    expect(scheme.undescribed(['reverb', 'unheard-of'])).toEqual(['unheard-of'])
  })

  it('reports concepts nothing uses', () => {
    expect(scheme.unused(['reverb'])).toContain('delay')
  })
})
