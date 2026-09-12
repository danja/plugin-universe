import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { loadProfileVocabulary } from '../../src/rdf/ProfileVocabulary.js'
import { SUBMITTABLE, withProfileVocabulary, validate, valueTerm, SubmissionError } from '../../src/contrib/Submissions.js'
import { FIELD_KINDS } from '../../src/contrib/Corrections.js'
import { NAMESPACES } from '../../src/rdf/NamespaceManager.js'
import { renderSubmitPage } from '../../src/api/render.js'
import { PAGES } from '../../src/api/pages.js'

/**
 * The part of a profile only its author knows.
 *
 * `/submit` asked for seven things, all of them visible on a download page.
 * Roles, signals, host requirements and cautions are what makes a plugin
 * findable by description and a chain suggestable — and the vocabulary has
 * carried them since Phase 0 with no way to supply one.
 *
 * The binding that matters here is **form ↔ ontology**. The choices are read
 * from `vocabs/trn-profile.ttl`, not listed in JavaScript, because a list of
 * roles in code is a copy of an ontology — which this project did once with the
 * category scheme, and which is why that scheme had four predicates and could
 * not say what a category meant.
 */

const vocabulary = await loadProfileVocabulary()
const FIELDS = withProfileVocabulary(vocabulary)
const GOOD = { name: 'X', homepage: 'https://example.org/', vendor: 'V', format: ['LV2'] }

describe('the vocabulary is read, not copied', () => {
  it('finds the roles by walking the class hierarchy', () => {
    // So a role added to the vocabulary appears in the form with no code
    // change. Reading trn:PluginRole's subclasses is what makes that true.
    const values = vocabulary.roles.map(r => r.value)
    expect(values).toContain('AudioEffect')
    expect(values).toContain('MidiProcessor')
    expect(values.length).toBeGreaterThanOrEqual(10)
  })

  it('separates signal types from host requirements', () => {
    // Both are owl:NamedIndividual, so the split is by what refers to them and
    // is the fragile part. These counts are the alarm if a third kind of
    // individual is added to the file.
    expect(vocabulary.signals.map(s => s.value)).toContain('Audio')
    expect(vocabulary.signals.map(s => s.value)).toContain('ControlMidi')
    expect(vocabulary.requirements.map(r => r.value)).toEqual(['HostTransport', 'Launchpad'])
    expect(vocabulary.signals.some(s => s.value === 'HostTransport')).toBe(false)
  })

  it('takes labels from the file rather than the local name', () => {
    // "ControlMidi" derived from the IRI would be wrong on a page in front of
    // a vendor; the file says "Control MIDI".
    expect(vocabulary.signals.find(s => s.value === 'ControlMidi').label).toBe('Control MIDI')
    expect(vocabulary.roles.find(r => r.value === 'MidiGenerator').label).toBe('MIDI Generator')
  })

  it('carries the vocabulary comment as help where there is one', () => {
    expect(vocabulary.requirements.find(r => r.value === 'HostTransport').help)
      .toMatch(/tempo/)
  })
})

describe('the form offers exactly what the vocabulary defines', () => {
  it('fills every profile field from its named list', () => {
    for (const [name, spec] of Object.entries(FIELDS)) {
      if (!spec.vocabulary) continue
      expect(spec.choices, name).toEqual(vocabulary[spec.vocabulary].map(t => t.value))
    }
  })

  it('leaves the bare table unfilled, so a caller cannot forget', () => {
    // SUBMITTABLE has choices: null on these, and the renderer refuses a
    // multi-choice group with nothing to tick. That refusal is the reason a
    // caller who skips withProfileVocabulary finds out immediately.
    expect(SUBMITTABLE.role.choices).toBeNull()
    expect(() => renderSubmitPage(SUBMITTABLE, { csrfToken: 't' })).toThrow(/no choices/)
  })

  it('renders every role and signal as something to tick', () => {
    const html = renderSubmitPage(FIELDS, { csrfToken: 't' })
    for (const term of [...vocabulary.roles, ...vocabulary.signals, ...vocabulary.requirements]) {
      expect(html, term.value).toContain(`value="${term.value}"`)
    }
  })

  it('uses a kind the shared list knows', () => {
    for (const [name, spec] of Object.entries(FIELDS)) {
      expect(FIELD_KINDS, name).toContain(spec.kind)
    }
  })
})

describe('what a submitted profile becomes', () => {
  it('mints a trn: IRI, not a string', () => {
    // The shapes require an IRI in the trn: namespace; a literal would be
    // written and then fail validation after the person had gone.
    expect(valueTerm('profileTerm', 'AudioEffect')).toBe(`<${NAMESPACES.trn}AudioEffect>`)
  })

  it('accepts terms the vocabulary defines', () => {
    const clean = validate({
      ...GOOD, role: ['AudioEffect'], accepts: ['Audio'], produces: ['Audio'],
      requires: ['HostTransport'], caution: 'Heavy above 90% feedback.'
    }, FIELDS)
    expect(clean.role).toEqual(['AudioEffect'])
    expect(clean.caution).toBe('Heavy above 90% feedback.')
  })

  it('refuses one it does not, and says what is known', () => {
    // Refused here, where the person can fix it, rather than by SHACL three
    // steps later where nobody sees it.
    expect(() => validate({ ...GOOD, role: ['Sousaphone'] }, FIELDS))
      .toThrow(/not a role this catalogue knows/)
    expect(() => validate({ ...GOOD, accepts: ['Telepathy'] }, FIELDS))
      .toThrow(/AudioEffect|Audio/)
  })

  it('refuses to check at all when the vocabulary was not loaded', () => {
    // Closed rather than open: an unchecked profile term would reach the store
    // and fail validation there.
    expect(() => validate({ ...GOOD, role: ['AudioEffect'] }, SUBMITTABLE))
      .toThrow(/vocabulary was not loaded/)
  })

  it('leaves a profile entirely optional', () => {
    // A vendor who fills in nothing beyond the required fields still submits.
    expect(() => validate(GOOD, FIELDS)).not.toThrow()
  })
})

describe('the page that explains why any of it is worth doing', () => {
  it('is served', () => {
    expect(Object.keys(PAGES)).toContain('/about/profiles')
  })

  it('is linked from the form, where the question gets asked', () => {
    expect(readFileSync('templates/submit.html', 'utf8')).toContain('/about/profiles')
  })

  it('leads with what a profile makes possible rather than a field list', () => {
    const page = readFileSync('docs/profiles.md', 'utf8')
    const opening = page.slice(0, page.indexOf('## What it asks for'))
    expect(opening).toMatch(/findable/)
    expect(opening).toMatch(/what goes with this/i)
  })

  it('says plainly that ports are not asked for, and what to send instead', () => {
    // The decision most likely to be questioned, so it is answered on the page.
    const page = readFileSync('docs/profiles.md', 'utf8')
    expect(page).toMatch(/lv2:port/)
    expect(page).toMatch(/bundle/)
  })

  it('states the licence split, because it is the first thing anyone asks', () => {
    const page = readFileSync('docs/profiles.md', 'utf8')
    expect(page).toMatch(/CC0/)
    expect(page).toMatch(/CC BY-SA/)
  })
})
