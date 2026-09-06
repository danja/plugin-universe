import { describe, it, expect } from 'vitest'
import {
  normalisePlugin, normaliseParameter, normaliseUnit, correctTerm,
  NormaliseError, LV2_CLASS_MAP, TERM_CORRECTIONS
} from '../../src/harvest/Normaliser.js'
import { NAMESPACES } from '../../src/rdf/NamespaceManager.js'

const trn = NAMESPACES.trn
const lv2 = NAMESPACES.lv2
const units = NAMESPACES.units

describe('parameter normalisation', () => {
  it('accepts trn:min/max and trn:minimum/maximum alike', () => {
    const a = normaliseParameter({ symbol: 'cutoff', min: 20, max: 20000 })
    const b = normaliseParameter({ symbol: 'cutoff', minimum: 20, maximum: 20000 })
    expect(a.minimum).toBe(20)
    expect(a.maximum).toBe(20000)
    expect(b.minimum).toBe(a.minimum)
    expect(b.maximum).toBe(a.maximum)
  })

  it('keeps a non-numeric default rather than rejecting it', () => {
    expect(normaliseParameter({ symbol: 'enabled', default: false }).default).toBe(false)
    expect(normaliseParameter({ symbol: 'path', default: '/tmp/out.mid' }).default).toBe('/tmp/out.mid')
  })

  it('maps known units to the LV2 units vocabulary', () => {
    expect(normaliseUnit('%').iri).toBe(`${units}pc`)
    expect(normaliseUnit('Hz').iri).toBe(`${units}hz`)
    expect(normaliseUnit('ms').iri).toBe(`${units}ms`)
  })

  it('keeps an unrecognised unit label rather than dropping it', () => {
    const { iri, label } = normaliseUnit('widgets')
    expect(iri).toBeNull()
    expect(label).toBe('widgets')
  })

  it('refuses a parameter with neither symbol nor name', () => {
    expect(() => normaliseParameter({ default: 1 })).toThrow(NormaliseError)
  })

  it('refuses an inverted range', () => {
    expect(() => normaliseParameter({ symbol: 'x', minimum: 10, maximum: 1 })).toThrow(NormaliseError)
  })

  it('preserves scale points', () => {
    const p = normaliseParameter({
      symbol: 'scale',
      scalePoints: [{ label: 'Major', value: 1 }, { label: 'Minor', value: 2 }]
    })
    expect(p.scalePoints).toHaveLength(2)
    expect(p.scalePoints[0]).toEqual({ label: 'Major', value: 1 })
  })
})

describe('term corrections', () => {
  it('corrects the typos found in the seed corpus', () => {
    expect(correctTerm(`${trn}MIDI`)).toBe(`${trn}Midi`)
    expect(correctTerm(`${trn}hasParameter`)).toBe(`${trn}parameter`)
    expect(TERM_CORRECTIONS[`${trn}comment`]).toBe(`${NAMESPACES.rdfs}comment`)
  })

  it('leaves correct terms alone', () => {
    expect(correctTerm(`${trn}Midi`)).toBe(`${trn}Midi`)
  })

  it('applies corrections to signal lists', () => {
    const p = normalisePlugin({ name: 'X', produces: [`${trn}MIDI`] })
    expect(p.produces).toEqual([`${trn}Midi`])
  })
})

describe('plugin normalisation', () => {
  it('derives categories from LV2 classes', () => {
    const p = normalisePlugin({ name: 'Cathedral', lv2Classes: [`${lv2}Plugin`, `${lv2}ReverbPlugin`] })
    expect(p.categories).toContain('reverb')
    expect(p.categories).toContain('effect')
    expect(p.roles).toContain(`${trn}AudioEffect`)
  })

  it('derives categories from trn roles for non-LV2 sources', () => {
    const p = normalisePlugin({ name: 'Drift', roles: [`${trn}MidiGenerator`, `${trn}Controller`] })
    expect(p.categories).toEqual(expect.arrayContaining(['midi', 'modulation']))
  })

  it('deduplicates roles arriving from both class and role mappings', () => {
    const p = normalisePlugin({ name: 'X', roles: [`${trn}AudioEffect`], lv2Classes: [`${lv2}EffectPlugin`] })
    expect(p.roles.filter(r => r === `${trn}AudioEffect`)).toHaveLength(1)
  })

  it('ignores an unmapped LV2 class instead of failing', () => {
    const p = normalisePlugin({ name: 'X', lv2Classes: ['http://example.org/UnknownPlugin'] })
    expect(p.categories).toEqual([])
  })

  it('refuses a plugin with no name', () => {
    expect(() => normalisePlugin({ vendor: 'x' })).toThrow(NormaliseError)
  })

  it('maps every LV2 class in the map to at least a role or a category', () => {
    for (const [cls, mapping] of Object.entries(LV2_CLASS_MAP)) {
      if (cls === `${lv2}Plugin`) continue
      expect(mapping.roles.length + mapping.categories.length).toBeGreaterThan(0)
    }
  })
})
