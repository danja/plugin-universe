import { describe, it, expect } from 'vitest'
import { vendorRecords, vendorTriples, identityTriples } from '../../src/catalogue/VendorIdentity.js'
import { vendorKey, vendorSlug } from '../../src/search/documents.js'
import { NAMESPACES } from '../../src/rdf/NamespaceManager.js'

/**
 * A vendor as a resource rather than as a string.
 *
 * `trn:vendor "danja"` is what a source said and it does not move. What this
 * adds is something that can be *pointed at* — the gap that made a claimable,
 * editable vendor profile impossible to build, because a name has nothing to
 * attach a description or an owning account to.
 *
 * Two properties matter most and are asserted hardest:
 *
 *  - **The IRI is stable.** It is a content hash over the folded name, so
 *    re-deriving the same catalogue produces the same IRIs and rebuilding the
 *    graph invalidates nothing that points into it. An identifier that changes
 *    when you regenerate it is not an identifier.
 *  - **The fold is a grouping, not a judgement.** It merges spellings that the
 *    characters say are the same. It must never merge two names on a guess:
 *    "danja" and "Danny Ayers" are one person, nothing derivable from the
 *    strings will ever say so, and the whole point of minting an IRI is that
 *    there is now something for a human to assert it about.
 */

const doc = (iri, vendor) => ({ iri: `${NAMESPACES.pu}plugin/${iri}`, vendor })

describe('folding spellings into vendors', () => {
  it('groups two spellings that differ only in punctuation and case', () => {
    const records = vendorRecords([
      doc('a', 'SFZ Tools'), doc('b', 'SFZ Tools'), doc('c', 'SFZTools')
    ])
    expect(records).toHaveLength(1)
    expect(records[0].key).toBe('sfztools')
    expect(records[0].count).toBe(3)
  })

  it('picks the spelling most plugins use, and the longer one on a tie', () => {
    // The separators are information, and the form with them is the one
    // somebody wrote deliberately. The same rule SearchService groups by,
    // because two rules would be two answers.
    const tied = vendorRecords([doc('a', 'SFZTools'), doc('b', 'SFZ Tools')])
    expect(tied[0].name).toBe('SFZ Tools')
    expect(tied[0].spellings).toEqual(['SFZ Tools', 'SFZTools'])

    const clear = vendorRecords([
      doc('a', 'SFZTools'), doc('b', 'SFZTools'), doc('c', 'SFZ Tools')
    ])
    expect(clear[0].name).toBe('SFZTools')
  })

  it('does NOT merge two different names for one person', () => {
    // The case the whole feature exists for. 86 plugins, one maker, and nothing
    // in the strings that could ever say so — which is why identity has to be
    // asserted rather than computed.
    const records = vendorRecords([doc('a', 'danja'), doc('b', 'Danny Ayers')])
    expect(records).toHaveLength(2)
    expect(records.map(r => r.iri)).toHaveLength(new Set(records.map(r => r.iri)).size)
  })

  it('ignores a plugin with no vendor rather than minting an empty one', () => {
    const records = vendorRecords([doc('a', null), doc('b', ''), doc('c', '   '), doc('d', 'Real')])
    expect(records).toHaveLength(1)
    expect(records[0].name).toBe('Real')
  })

  it('orders by how many plugins, most first', () => {
    const records = vendorRecords([
      doc('a', 'Small'), doc('b', 'Big'), doc('c', 'Big'), doc('d', 'Big')
    ])
    expect(records.map(r => r.name)).toEqual(['Big', 'Small'])
  })
})

describe('the identifier', () => {
  it('is the same every time the same catalogue is derived', () => {
    // Rebuilding is a DROP and a re-derive, so an IRI that moved would orphan
    // every claim, description and logo attached to it.
    const once = vendorRecords([doc('a', 'Airwindows'), doc('b', 'Surge Synth Team')])
    const again = vendorRecords([doc('b', 'Surge Synth Team'), doc('a', 'Airwindows')])
    expect(once.map(r => r.iri).sort()).toEqual(again.map(r => r.iri).sort())
  })

  it('survives a change of spelling, because it is minted from the fold', () => {
    // A vendor whose plugins are later respelled must keep the same identity.
    // That is the defect a key computed from the display name has, and the
    // reason this is minted from `vendorKey` rather than from the name.
    const before = vendorRecords([doc('a', 'SFZTools')])
    const after = vendorRecords([doc('a', 'SFZ Tools')])
    expect(after[0].iri).toBe(before[0].iri)
    expect(after[0].name).not.toBe(before[0].name)
  })

  it('is under the catalogue namespace, by the minter rather than by hand', () => {
    const [record] = vendorRecords([doc('a', 'Airwindows')])
    expect(record.iri.startsWith(`${NAMESPACES.pu}vendor/`)).toBe(true)
    expect(record.iri).toMatch(/\/vendor\/airwindows-[0-9a-f]{8}$/)
  })

  it('keeps the slug readable, so the page address says who it is', () => {
    const [record] = vendorRecords([doc('a', 'Chowdhury DSP')])
    expect(record.slug).toBe('chowdhury-dsp')
    expect(vendorSlug(record.name)).toBe(record.slug)
    expect(vendorKey(record.name)).toBe(record.key)
  })
})

describe('the triples it becomes', () => {
  const [record] = vendorRecords([
    doc('a', 'SFZ Tools'), doc('b', 'SFZ Tools'), doc('c', 'SFZTools')
  ])
  const triples = vendorTriples(record).join('\n')

  it('types it, names it and records the fold', () => {
    expect(triples).toContain(`<${NAMESPACES.pu}Vendor>`)
    expect(triples).toContain(`<${NAMESPACES.foaf}name> "SFZ Tools"`)
    expect(triples).toContain(`<${NAMESPACES.pu}vendorKey> "sfztools"`)
  })

  it('keeps every other spelling as an altLabel', () => {
    // So that merging two vendors later is adding a label, rather than
    // rewriting what a source said.
    expect(triples).toContain(`<${NAMESPACES.skos}altLabel> "SFZTools"`)
    expect(triples).not.toContain('altLabel> "SFZ Tools"')
  })

  it('links each plugin with foaf:maker, not a bespoke predicate', () => {
    // Two widely-used vocabularies already have a word for "the agent that made
    // this". Inventing a third would be a term for this catalogue alone.
    expect(triples.match(new RegExp(`<${NAMESPACES.foaf}maker>`, 'g'))).toHaveLength(3)
  })

  it('does not touch trn:vendor', () => {
    // The string is what the source said. The identity is asserted beside it,
    // and overwriting it would lose the only record of how that source spelled
    // the name.
    expect(triples).not.toContain('trn')
    expect(triples).not.toContain('vendor>')
  })

  it('produces one flat list for the whole catalogue', () => {
    const records = vendorRecords([doc('a', 'One'), doc('b', 'Two')])
    expect(identityTriples(records)).toHaveLength(
      vendorTriples(records[0]).length + vendorTriples(records[1]).length)
  })
})
