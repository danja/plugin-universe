import { describe, it, expect } from 'vitest'
import { validate, valueTerm, CORRECTABLE, CorrectionError, STATUS } from '../../src/contrib/Corrections.js'
import { NAMESPACES } from '../../src/rdf/NamespaceManager.js'
import { CONTRIBUTION_CONFIG } from '../../config/preferences.js'

const pu = NAMESPACES.pu
const trn = NAMESPACES.trn
const rdfs = NAMESPACES.rdfs
const PLUGIN = `${pu}plugin/drift-88b3b09d`

/**
 * The first write of catalogue data by a person rather than a harvester.
 *
 * A correction is typed — subject, predicate, value — so it can be checked
 * before it is written and applied mechanically after. The alternative, a free
 * text box, is a way to write arbitrary triples into the store wearing a
 * friendly hat.
 */

const good = extra => validate({
  subject: PLUGIN, predicate: `${rdfs}label`, value: 'Drift', ...extra
})

describe('what may be corrected', () => {
  it('accepts a whitelisted property', () => {
    expect(good().predicate).toBe(`${rdfs}label`)
  })

  it('refuses anything not on the list', () => {
    // A contribution form is not a way to write arbitrary triples.
    for (const predicate of [
      `${pu}sourceAvailability`,
      `${pu}verified`,
      'http://example.invalid/anything',
      `${NAMESPACES.prov}wasAttributedTo`
    ]) {
      expect(() => good({ predicate }), predicate).toThrow(CorrectionError)
    }
  })

  it('refuses a subject outside this catalogue', () => {
    expect(() => good({ subject: 'https://evil.invalid/plugin/x' })).toThrow(CorrectionError)
    expect(() => good({ subject: '' })).toThrow(CorrectionError)
  })

  it('names the correctable fields when it refuses', () => {
    // The message is shown to a contributor, so it says what they can do.
    expect(() => good({ predicate: 'http://example.invalid/x' })).toThrow(/Name, Description, Vendor/)
  })
})

describe('what a value may be', () => {
  it('requires one', () => {
    expect(() => good({ value: '   ' })).toThrow(/needed/)
  })

  it('bounds the length', () => {
    expect(() => good({ value: 'x'.repeat(CONTRIBUTION_CONFIG.maxValueLength + 1) })).toThrow(/longer than/)
  })

  it('checks a homepage is really a URL', () => {
    const homepage = `${NAMESPACES.foaf}homepage`
    expect(good({ predicate: homepage, value: 'https://example.invalid' }).value)
      .toBe('https://example.invalid')
    for (const bad of ['not a url', 'javascript:alert(1)', 'ftp://example.invalid']) {
      expect(() => good({ predicate: homepage, value: bad }), bad).toThrow(/http or https/)
    }
  })

  it('checks a category is a slug, not free text', () => {
    expect(good({ predicate: `${pu}category`, value: 'reverb' }).value).toBe('reverb')
    expect(() => good({ predicate: `${pu}category`, value: 'Reverb Machine' })).toThrow(/lowercase/)
  })

  it('checks a format looks like a format name', () => {
    expect(good({ predicate: `${trn}format`, value: 'VST3' }).value).toBe('VST3')
    expect(() => good({ predicate: `${trn}format`, value: '../evil' })).toThrow(/format is a name/)
  })

  it('bounds the rationale', () => {
    expect(good({ rationale: 'The vendor renamed it.' }).rationale).toBe('The vendor renamed it.')
    expect(good({ rationale: '  ' }).rationale).toBeNull()
    expect(() => good({ rationale: 'x'.repeat(CONTRIBUTION_CONFIG.maxRationaleLength + 1) }))
      .toThrow(/under 1000/)
  })

  it('trims, so a value is not stored with stray whitespace', () => {
    expect(good({ value: '  Drift  ' }).value).toBe('Drift')
  })
})

describe('the term a value becomes', () => {
  it('makes a literal of text', () => {
    expect(valueTerm('text', 'Drift')).toBe('"Drift"')
  })

  it('makes an IRI of a homepage', () => {
    expect(valueTerm('url', 'https://example.invalid/')).toBe('<https://example.invalid/>')
  })

  it('makes a scheme concept of a category', () => {
    expect(valueTerm('category', 'reverb')).toBe(`<${pu}category/reverb>`)
  })

  it('makes a format individual of a format', () => {
    expect(valueTerm('format', 'VST3')).toBe(`<${trn}VST3>`)
  })

  it('escapes a literal that would otherwise break the query', () => {
    // The value came from a form. It reaches the store as a literal or not at
    // all — the whitelist decides the predicate, and SPARQLHelper decides the
    // quoting.
    const term = valueTerm('text', 'a "quoted" \\ value\nwith newline')
    expect(term.startsWith('"')).toBe(true)
    expect(term).toContain('\\"')
    expect(term).not.toContain('\n')
  })
})

describe('the correctable list itself', () => {
  it('touches nothing that decides licensing or trust', () => {
    // The things a stranger must not be able to change: a graph's licence, an
    // account's trust, a computed verification flag.
    const forbidden = ['licence', 'trustLevel', 'suspended', 'verified', 'redistributable', 'inCC0Dump']
    for (const predicate of Object.keys(CORRECTABLE)) {
      const local = predicate.replace(/^.*[#/]/, '')
      expect(forbidden, `${local} is correctable`).not.toContain(local)
    }
  })

  it('gives every entry a label and a kind', () => {
    for (const [predicate, field] of Object.entries(CORRECTABLE)) {
      expect(field.label, predicate).toBeTruthy()
      expect(['text', 'url', 'category', 'format'], predicate).toContain(field.kind)
    }
  })
})

describe('statuses', () => {
  it('are the three a review can produce', () => {
    expect(Object.values(STATUS).sort()).toEqual(['accepted', 'pending', 'rejected'])
  })
})
