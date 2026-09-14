import { describe, it, expect } from 'vitest'
import {
  profileTurtle, readProfile, profileFieldsFor, ProfileError
} from '../../src/contrib/ProfileDocument.js'
import { loadSubmittable } from '../../src/contrib/Submissions.js'
import { parseTurtle } from '../../src/harvest/TurtleReader.js'
import { NAMESPACES } from '../../src/rdf/NamespaceManager.js'
import { CONTRIBUTION_CONFIG } from '../../config/preferences.js'

/**
 * A profile written out, and read back in.
 *
 * The catalogue would rather authors hosted their own profiles than typed them
 * into this site: a file beside the plugin is versioned with it, editable by
 * its author, and readable by anything that speaks RDF. So `/submit` doubles as
 * a way of producing that file, and accepts one back.
 *
 * **The round trip is the assertion that matters.** Generating a document
 * nobody can parse is a defect invisible to any test that only checks the text
 * contains the right words — and it happened on the first run here:
 * `pu:category/reverb` reads as a prefixed name whose local part contains a
 * slash, which is not legal Turtle, so every generated profile with a category
 * was unparseable. Producing it and reading it back is the only check that
 * catches that class of thing.
 */

const FIELDS = await loadSubmittable()

const GOOD = {
  name: 'Ambo',
  homepage: 'https://example.org/plugins/ambo/',
  vendor: 'danja',
  description: 'Stereo ambient processor.',
  format: ['VST3', 'LV2'],
  category: 'reverb',
  licenceId: 'MIT',
  role: ['AudioEffect'],
  accepts: ['Audio'],
  produces: ['Audio'],
  caution: 'High feedback becomes dense.'
}

describe('writing a profile', () => {
  it('parses as Turtle, which is the whole point of producing it', async () => {
    const dataset = await parseTurtle(profileTurtle(GOOD))
    expect(dataset.size).toBeGreaterThan(8)
  })

  it('parses with a category, which once made it unparseable', async () => {
    // `pu:category/reverb` is not a legal prefixed name. Kept as its own test
    // because the failure was silent: the file looked right and no parser had
    // ever been pointed at it.
    const dataset = await parseTurtle(profileTurtle({ ...GOOD, category: 'delay' }))
    const categories = [...dataset].filter(q => q.predicate.value === `${NAMESPACES.pu}category`)
    expect(categories).toHaveLength(1)
    expect(categories[0].object.value).toBe(`${NAMESPACES.pu}category/delay`)
  })

  it('survives a description containing quotes and newlines', async () => {
    // Escaped through the same `literal()` the store writes with, rather than
    // by concatenation — a quote in a description would otherwise end the
    // string and produce a file that does not parse.
    const awkward = 'He said "hello".\nThen a newline, and a \\ backslash.'
    const dataset = await parseTurtle(profileTurtle({ ...GOOD, description: awkward }))
    const comment = [...dataset].find(q => q.predicate.value === `${NAMESPACES.rdfs}comment`)
    expect(comment.object.value).toBe(awkward)
  })

  it('is about the homepage, so a later harvest describes the same thing', async () => {
    const dataset = await parseTurtle(profileTurtle(GOOD))
    for (const quad of dataset) expect(quad.subject.value).toBe(GOOD.homepage)
  })

  it('types it as a plugin profile, so anything reading it knows what it is', async () => {
    const dataset = await parseTurtle(profileTurtle(GOOD))
    const types = [...dataset].filter(q => q.predicate.value === `${NAMESPACES.rdf}type`)
    expect(types.map(q => q.object.value)).toEqual([`${NAMESPACES.trn}PluginProfile`])
  })

  it('refuses without a homepage, which is the subject it needs', () => {
    expect(() => profileTurtle({ ...GOOD, homepage: '' })).toThrow(ProfileError)
    expect(() => profileTurtle({ ...GOOD, name: '' })).toThrow(ProfileError)
  })

  it('leaves out what was not filled in, rather than writing empty values', async () => {
    const sparse = { name: 'Bare', homepage: 'https://example.org/bare/' }
    const dataset = await parseTurtle(profileTurtle(sparse))
    const predicates = new Set([...dataset].map(q => q.predicate.value))
    expect(predicates.has(`${NAMESPACES.rdfs}comment`)).toBe(false)
    expect(predicates.has(`${NAMESPACES.trn}caution`)).toBe(false)
  })
})

describe('reading a profile back', () => {
  it('recovers every field it wrote', async () => {
    const back = await readProfile(profileTurtle(GOOD), { submittable: FIELDS })
    expect(back.format).toBe('Turtle')
    for (const [key, value] of Object.entries(GOOD)) {
      expect(back.fields[key], key).toEqual(value)
    }
    expect(back.notes).toEqual([])
  })

  it('reads JSON-LD, recognised by looking rather than by asking', async () => {
    const jsonld = JSON.stringify({
      '@context': {
        trn: NAMESPACES.trn, rdfs: NAMESPACES.rdfs, foaf: NAMESPACES.foaf
      },
      '@id': 'https://example.org/fuzz/',
      '@type': 'trn:PluginProfile',
      'rdfs:label': 'Fuzzer',
      'trn:vendor': 'Acme',
      'foaf:homepage': { '@id': 'https://example.org/fuzz/' },
      'trn:format': [{ '@id': 'trn:CLAP' }]
    })
    const back = await readProfile(jsonld, { submittable: FIELDS })
    expect(back.format).toBe('JSON-LD')
    expect(back.fields.name).toBe('Fuzzer')
    expect(back.fields.format).toEqual(['CLAP'])
  })

  it('says what it read and did not keep', async () => {
    // A real profile carries more than this form holds. Somebody who wrote
    // those terms deserves to be told they were read and dropped, rather than
    // assuming the catalogue took them.
    const back = await readProfile(`
      @prefix trn: <${NAMESPACES.trn}> .
      @prefix rdfs: <${NAMESPACES.rdfs}> .
      @prefix foaf: <${NAMESPACES.foaf}> .
      <https://example.org/a/> a trn:PluginProfile ;
        rdfs:label "A" ; trn:vendor "V" ; foaf:homepage <https://example.org/a/> ;
        trn:format trn:LV2 ; trn:bundleName "a.lv2" .
    `, { submittable: FIELDS })
    expect(back.notes.join(' ')).toContain('trn:bundleName')
  })

  it('names a required field the profile does not have', async () => {
    const back = await readProfile(`
      @prefix trn: <${NAMESPACES.trn}> .
      @prefix rdfs: <${NAMESPACES.rdfs}> .
      <https://example.org/a/> a trn:PluginProfile ; rdfs:label "A" .
    `, { submittable: FIELDS })
    expect(back.notes.join(' ')).toMatch(/Formats is not in the profile/)
  })

  it('reads a profile that never says it is one, if only one thing is labelled', async () => {
    // The same forgiveness an LV2 bundle gets: a file right in substance and
    // loose about typing should be read rather than refused.
    const back = await readProfile(`
      @prefix rdfs: <${NAMESPACES.rdfs}> .
      @prefix foaf: <${NAMESPACES.foaf}> .
      <https://example.org/a/> rdfs:label "A" ; foaf:homepage <https://example.org/a/> .
    `, { submittable: FIELDS })
    expect(back.fields.name).toBe('A')
  })

  it('refuses to guess between two plugins', async () => {
    // Picking one would produce a submission about the wrong plugin, which is
    // worse than saying no.
    await expect(readProfile(`
      @prefix trn: <${NAMESPACES.trn}> .
      @prefix rdfs: <${NAMESPACES.rdfs}> .
      <https://example.org/a/> a trn:PluginProfile ; rdfs:label "A" .
      <https://example.org/b/> a trn:PluginProfile ; rdfs:label "B" .
    `, { submittable: FIELDS })).rejects.toThrow(/one at a time/)
  })

  it('refuses two labelled subjects with nothing typed', async () => {
    await expect(readProfile(`
      @prefix rdfs: <${NAMESPACES.rdfs}> .
      <https://example.org/a/> rdfs:label "A" .
      <https://example.org/b/> rdfs:label "B" .
    `, { submittable: FIELDS })).rejects.toThrow(/no way to tell which/)
  })

  it('says what is wrong with a document that does not parse', async () => {
    await expect(readProfile('this is not turtle {{{', { submittable: FIELDS }))
      .rejects.toThrow(/does not parse as Turtle/)
    await expect(readProfile('{"broken": ', { submittable: FIELDS }))
      .rejects.toThrow(/does not parse as JSON-LD/)
  })

  it('refuses an empty paste and one past the length bound', async () => {
    await expect(readProfile('   ', { submittable: FIELDS })).rejects.toThrow(/Paste a profile/)
    const huge = '# comment\n'.repeat(CONTRIBUTION_CONFIG.maxProfileLength)
    await expect(readProfile(huge, { submittable: FIELDS })).rejects.toThrow(/longer than/)
  })

  it('finds nothing to submit in a document about something else', async () => {
    await expect(readProfile(`
      @prefix foaf: <${NAMESPACES.foaf}> .
      <https://example.org/a/> foaf:name "Not a plugin" .
    `, { submittable: FIELDS })).rejects.toThrow(/No plugin found/)
  })
})

describe('what a read profile does next', () => {
  it('produces fields the ordinary validator accepts', async () => {
    // The property that keeps this from being a second write path: a pasted
    // profile is drafted into the form and saved by the same Submit button,
    // through the same validator and the same shapes. If what it drafts could
    // not survive that, it would be a second opinion about what is valid.
    const { validate } = await import('../../src/contrib/Submissions.js')
    const back = await readProfile(profileTurtle(GOOD), { submittable: FIELDS })
    expect(() => validate(back.fields, FIELDS)).not.toThrow()
  })
})

/**
 * A profile for a plugin the catalogue already holds.
 *
 * Every plugin page offers one, so an author who finds their plugin here can
 * take the file and host it rather than filling in a form for facts we already
 * have. The mapping is the interesting part: a document's field names are what
 * a query returned (`formats`, `cautions`, `categories`) and the form's are what
 * a person filled in (`format`, `caution`, `category`).
 */
describe('a profile built from a catalogue document', () => {
  const DOC = {
    iri: `${NAMESPACES.pu}plugin/tear-48b738e8`,
    name: 'TeAr',
    homepage: 'https://github.com/odoare/TeAr',
    vendor: 'Olivier Doaré',
    description: 'The Text Arpeggiator',
    formats: ['VST3', 'AudioUnit'],
    roles: ['Instrument', 'AudioInstrument'],
    accepts: ['Midi'],
    produces: ['Audio'],
    requires: ['HostTransport'],
    categories: ['midi', 'synth'],
    licenceId: 'LGPL-3.0',
    cautions: 'Loud at high feedback.'
  }

  it('parses, which is the only thing a served file must do', async () => {
    const dataset = await parseTurtle(profileTurtle(profileFieldsFor(DOC)))
    expect(dataset.size).toBeGreaterThan(8)
  })

  it('round trips back to the same facts', async () => {
    const back = await readProfile(profileTurtle(profileFieldsFor(DOC)), { submittable: FIELDS })
    expect(back.fields.name).toBe('TeAr')
    expect(back.fields.vendor).toBe('Olivier Doaré')
    expect(back.fields.format).toEqual(['VST3', 'AudioUnit'])
    expect(back.fields.requires).toEqual(['HostTransport'])
    expect(back.fields.caution).toBe('Loud at high feedback.')
  })

  it('maps the document\'s plural names onto the form\'s singular ones', () => {
    // The mapping this function exists for. Getting it wrong produces a profile
    // that is quietly missing half the plugin.
    const fields = profileFieldsFor(DOC)
    expect(fields.format).toEqual(DOC.formats)
    expect(fields.role).toEqual(DOC.roles)
    expect(fields.caution).toBe(DOC.cautions)
  })

  it('takes one category, because the shapes allow one', () => {
    expect(profileFieldsFor(DOC).category).toBe('midi')
  })

  it('falls back to the plugin\'s own IRI when there is no homepage', async () => {
    // Three of the catalogue's plugins have none, and that IRI dereferences
    // through the PURL — a better answer than refusing to produce a file.
    const bare = { name: 'No Home', formats: ['LV2'] }
    const turtle = profileTurtle(profileFieldsFor(bare), { subject: DOC.iri })
    const dataset = await parseTurtle(turtle)
    for (const quad of dataset) expect(quad.subject.value).toBe(DOC.iri)
    expect(turtle, 'an empty homepage would be an IRI of <>').not.toContain('foaf:homepage <>')
  })

  it('says nothing about fields the plugin does not have', async () => {
    const dataset = await parseTurtle(
      profileTurtle(profileFieldsFor({ name: 'Bare', homepage: 'https://example.org/b/' })))
    const predicates = new Set([...dataset].map(quad => quad.predicate.value))
    expect(predicates.has(`${NAMESPACES.trn}caution`)).toBe(false)
    expect(predicates.has(`${NAMESPACES.pu}licenceId`)).toBe(false)
  })

  it('handles an empty document without throwing something unrecognisable', () => {
    // A plugin with no name cannot be described, and the route turns this into
    // a 422 rather than serving an empty file.
    expect(() => profileTurtle(profileFieldsFor({}), { subject: DOC.iri })).toThrow(ProfileError)
  })
})
