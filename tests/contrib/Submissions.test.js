import { describe, it, expect } from 'vitest'
import URIMinter from '../../src/rdf/URIMinter.js'
import { readFileSync } from 'fs'
import { validate, valueTerm, SUBMITTABLE, PLUGIN_FORMATS, SubmissionError, Submissions } from '../../src/contrib/Submissions.js'
import { NAMESPACES } from '../../src/rdf/NamespaceManager.js'
import { FIELD_KINDS } from '../../src/contrib/Corrections.js'

/**
 * Proposing a plugin the catalogue does not have.
 *
 * Corrections were the narrowest first write by a stranger — one fact about one
 * plugin. This is wider, and the thing that keeps it safe is the same: a short
 * whitelist of fields, each with a kind that is checked once.
 *
 * The assertion that matters most is the identity one. Plugin IRIs are minted
 * by hash over an identifying tuple, so two people submitting the same plugin
 * mint the same IRI — and writing the second would silently merge two records
 * of one thing. `IngestPipeline` refuses that for harvesters; a form that did
 * not would reintroduce the defect it cost 21 of 57 flues plugins to find.
 */

const GOOD = {
  name: 'Moka',
  homepage: 'https://danja.github.io/downspout/plugins/moka/',
  vendor: 'danja',
  format: ['VST3', 'LV2'],
  description: 'A MIDI phrase player.',
  category: 'midi'
}

describe('what may be submitted', () => {
  it('asks for what identifies a plugin and what makes it findable', () => {
    const required = Object.entries(SUBMITTABLE).filter(([, s]) => s.required).map(([k]) => k)
    expect(required).toContain('name')
    expect(required).toContain('homepage')
    expect(required).toContain('vendor')
    // Without a format it is invisible to the format facet, which is the first
    // thing most people filter by.
    expect(required).toContain('format')
  })

  it('does not offer the things the catalogue finds out for itself', () => {
    // Measurements, releases, checksums and parameters are discovered, not
    // stated. A form that accepted them would be a way to write anything.
    for (const key of ['measurement', 'cpuLoad', 'release', 'sha256', 'parameters', 'downloadCount']) {
      expect(SUBMITTABLE[key], `${key} should not be submittable`).toBeUndefined()
    }
  })

  it('gives every field a help line, because each is shown beside its input', () => {
    for (const [key, spec] of Object.entries(SUBMITTABLE)) {
      expect(spec.help, `${key} has no help text`).toBeTruthy()
      expect(spec.label, `${key} has no label`).toBeTruthy()
    }
  })
})

describe('validating a submission', () => {
  it('accepts a complete one and trims it', () => {
    const clean = validate({ ...GOOD, name: '  Moka  ' })
    expect(clean.name).toBe('Moka')
    expect(clean.category).toBe('midi')
  })

  it('names the missing field and says what it is for', () => {
    expect(() => validate({ ...GOOD, homepage: '' })).toThrow(/Homepage is needed/)
    expect(() => validate({ ...GOOD, homepage: '' })).toThrow(/identifies the plugin/)
  })

  it('refuses a homepage that is not a URL, and one that is not the web', () => {
    expect(() => validate({ ...GOOD, homepage: 'danja.github.io' })).toThrow(/full URL/)
    expect(() => validate({ ...GOOD, homepage: 'javascript:alert(1)' })).toThrow(/http or https/)
    expect(() => validate({ ...GOOD, homepage: 'file:///etc/passwd' })).toThrow(/http or https/)
  })

  it('refuses a category that is not shaped like one', () => {
    expect(() => validate({ ...GOOD, category: 'Reverb!' })).toThrow(/lowercase/)
  })

  it('refuses a format the catalogue does not know, and lists the ones it does', () => {
    // Not a shape rule — a membership one. "VST 3" and "VST4" are both
    // plausible typings and neither is a format, and a typo here would create
    // a facet value that silently matches nothing.
    expect(() => validate({ ...GOOD, format: ['VST 3'] })).toThrow(/not a format this catalogue knows/)
    expect(() => validate({ ...GOOD, format: ['VST3', 'VST4'] })).toThrow(/VST4/)
    expect(() => validate({ ...GOOD, format: ['VST3', 'VST4'] })).toThrow(/Known: VST3/)
  })

  it('leaves out what was not filled in, rather than writing empty values', () => {
    const clean = validate({ ...GOOD, description: '', category: '', licenceId: '' })
    expect(clean).not.toHaveProperty('description')
    expect(clean).not.toHaveProperty('category')
  })

  it('caps the length of anything typed', () => {
    expect(() => validate({ ...GOOD, description: 'x'.repeat(5000) })).toThrow(/longer than/)
  })
})

describe('the terms a submitted value becomes', () => {
  it('makes IRIs of the things that are IRIs, and literals of the rest', () => {
    expect(valueTerm('url', 'https://example.com/')).toBe('<https://example.com/>')
    expect(valueTerm('category', 'reverb')).toBe(`<${NAMESPACES.pu}category/reverb>`)
    expect(valueTerm('format', 'VST3')).toBe(`<${NAMESPACES.trn}VST3>`)
    expect(valueTerm('text', 'Moka')).toContain('"Moka"')
  })
})

describe('identity', () => {
  const submissions = new Submissions({ select: async () => [], update: async () => {} },
    { minter: new URIMinter() })

  it('mints the same IRI for the same plugin proposed twice', () => {
    // This is the whole reason the homepage is required.
    expect(submissions.pluginIriFor(validate(GOOD)))
      .toBe(submissions.pluginIriFor(validate({ ...GOOD, description: 'different words' })))
  })

  it('mints a different IRI for a different plugin at a different address', () => {
    const other = submissions.pluginIriFor(validate({ ...GOOD, homepage: 'https://example.com/other' }))
    expect(other).not.toBe(submissions.pluginIriFor(validate(GOOD)))
  })

  it('mints under the catalogue namespace, not the serving domain', () => {
    // Never under the serving domain: the PURL redirects to whatever host
    // serves the site, so IRIs survive a change of domain.
    expect(submissions.pluginIriFor(validate(GOOD))).toMatch(
      new RegExp(`^${NAMESPACES.pu}plugin/`))
  })
})

describe('the triples an accepted submission becomes', () => {
  const submissions = new Submissions({ select: async () => [], update: async () => {} },
    { minter: new URIMinter() })
  const clean = validate(GOOD)
  const triples = submissions.triplesFor(submissions.pluginIriFor(clean), clean, new Date('2026-09-11T12:00:00Z'))
  const joined = triples.join('\n')

  it('is a plugin profile with a first-seen date', () => {
    expect(joined).toContain(`<${NAMESPACES.trn}PluginProfile>`)
    expect(joined).toContain(`<${NAMESPACES.dcterms}created>`)
    expect(joined).toContain('2026-09-11')
  })

  it('states each submitted field once, with the right kind of term', () => {
    expect(joined).toContain(`<${NAMESPACES.foaf}homepage> <https://danja.github.io/downspout/plugins/moka/>`)
    expect(joined).toContain(`<${NAMESPACES.trn}format> <${NAMESPACES.trn}VST3>`)
    expect(joined).toContain(`<${NAMESPACES.pu}category> <${NAMESPACES.pu}category/midi>`)
    expect(joined).toContain('"Moka"')
  })

  it('writes nothing for a field that was left blank', () => {
    const sparse = validate({ ...GOOD, description: '', category: '', licenceId: '' })
    const some = submissions.triplesFor('http://x/p', sparse, new Date()).join('\n')
    expect(some).not.toContain(`<${NAMESPACES.pu}category>`)
    expect(some).not.toContain(`<${NAMESPACES.rdfs}comment>`)
  })
})

describe('refusing to write', () => {
  const account = { iri: 'http://x/person/a', login: 'a', trustLevel: 'new' }

  it('refuses a plugin the catalogue already holds, and says which', async () => {
    const submissions = new Submissions(
      { select: async query => (query.includes('?p ?o') ? [{ g: 'graph:source/x' }] : []), update: async () => {} },
      { minter: new URIMinter() })
    await expect(submissions.submit({ account, fields: GOOD })).rejects.toThrow(/already has this plugin/)
    await submissions.submit({ account, fields: GOOD }).catch(error => {
      expect(error.existing).toContain(`${NAMESPACES.pu}plugin/`)
    })
  })

  it('refuses somebody who is not signed in', async () => {
    const submissions = new Submissions({ select: async () => [], update: async () => {} },
      { minter: new URIMinter() })
    await expect(submissions.submit({ account: null, fields: GOOD })).rejects.toThrow(/Sign in/)
  })

  it('refuses a suspended account', async () => {
    const submissions = new Submissions({ select: async () => [], update: async () => {} },
      { minter: new URIMinter() })
    await expect(submissions.submit({ account: { ...account, suspended: true }, fields: GOOD }))
      .rejects.toThrow(/suspended/)
  })

  it('is a SubmissionError, so a handler can tell it from a bug', async () => {
    const submissions = new Submissions({ select: async () => [], update: async () => {} },
      { minter: new URIMinter() })
    await expect(submissions.submit({ account: null, fields: GOOD }))
      .rejects.toBeInstanceOf(SubmissionError)
  })
})

/**
 * A plugin is commonly built for several formats, and the catalogue models it
 * that way — `trn:format` has no maxCount in the shapes.
 */
describe('formats', () => {
  it('are the same nine the SHACL shapes allow', () => {
    // The coupling that has cost this project most: a list in code and the
    // same list in vocabs/shapes.ttl with nothing connecting them. A format
    // missing here is one nobody can submit; one here that the shapes reject
    // is a submission that passes the form and fails at the last moment.
    const shapes = readFileSync('vocabs/shapes.ttl', 'utf8')
    const clause = shapes.slice(shapes.indexOf('sh:path trn:format'))
    const allowed = [...clause.slice(0, clause.indexOf(')')).matchAll(/trn:([A-Za-z0-9]+)/g)]
      .map(match => match[1])
      .filter(name => name !== 'format')
    expect([...PLUGIN_FORMATS].sort()).toEqual(allowed.sort())
  })

  it('accepts several, and keeps them all', () => {
    expect(validate({ ...GOOD, format: ['VST3', 'LV2', 'CLAP'] }).format)
      .toEqual(['VST3', 'LV2', 'CLAP'])
  })

  it('accepts one, given as a bare string, because that is what one checkbox sends', () => {
    expect(validate({ ...GOOD, format: 'LV2' }).format).toEqual(['LV2'])
  })

  it('drops a repeat rather than stating it twice', () => {
    expect(validate({ ...GOOD, format: ['LV2', 'LV2'] }).format).toEqual(['LV2'])
  })

  it('still insists on at least one', () => {
    expect(() => validate({ ...GOOD, format: [] })).toThrow(/Formats are needed/)
    expect(() => validate({ ...GOOD, format: '' })).toThrow(/Formats are needed/)
  })

  it('becomes one triple per format', () => {
    const submissions = new Submissions({ select: async () => [], update: async () => {} },
      { minter: new URIMinter() })
    const clean = validate({ ...GOOD, format: ['VST3', 'LV2'] })
    const joined = submissions.triplesFor('http://x/p', clean, new Date()).join('\n')
    expect(joined).toContain(`<${NAMESPACES.trn}format> <${NAMESPACES.trn}VST3>`)
    expect(joined).toContain(`<${NAMESPACES.trn}format> <${NAMESPACES.trn}LV2>`)
  })
})

describe('a submitted licence is normalised, not merely accepted', () => {
  it('records the identifier for a spelling of it', () => {
    expect(validate({ ...GOOD, licenceId: 'GPLv3' }).licenceId).toBe('GPL-3.0')
  })

  it('refuses one it does not recognise, and says what to type', () => {
    expect(() => validate({ ...GOOD, licenceId: 'whatever you like' })).toThrow(/SPDX/)
  })

  it('still treats blank as "not stated", which is not an error', () => {
    expect(validate({ ...GOOD, licenceId: '' }).licenceId).toBeUndefined()
  })

  it('draws every field kind from the one exported list', () => {
    for (const [key, spec] of Object.entries(SUBMITTABLE)) {
      expect(FIELD_KINDS, key).toContain(spec.kind)
    }
  })
})
